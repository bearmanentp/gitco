'use strict';

// ============================================================
// GitCo — app.js (v2: 타이머 리셋 방지, 문제번호, 폴더 기억)
// 개발: 석근우 (geunman@geekbyte.kro.kr)
// ============================================================

const A = {
  cfg: { appsUrl: '', defaultRepo: '', studioFolder: 'problems' },
  ses: { role: 'guest', userId: '', userName: '게스트', classId: '' },
  probs: [],
  cur: null,         // 현재 선택된 문제
  started: null,     // 타이머가 시작된 문제 path
  elapsed: 0,        // 경과 시간
  countdown: 0,      // 남은 시간
  tmr: null,         // setInterval ID
  recs: [],
  py: null,
  pyOk: false,
  repo: { owner: '', repo: '', branch: 'main', folder: 'problems' }
};

// ---- DOM 헬퍼 ----
const $ = id => document.getElementById(id);
const hide = el => { if (typeof el === 'string') el = $(el); if (el) el.classList.add('hidden'); };
const show = el => { if (typeof el === 'string') el = $(el); if (el) el.classList.remove('hidden'); };
const val = id => { const e = $(id); return e ? e.value.trim() : ''; };
const esc = s => { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; };
const fmt = s => { s = Math.max(0, parseInt(s) || 0); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

function atobU(s) {
  try {
    const b = atob(String(s).replace(/\s/g, ''));
    const a = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
    return new TextDecoder().decode(a);
  } catch { return atob(s); }
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function md(text) {
  if (!text) return '';
  let t = String(text).replace(/\[이미지:\s*(https?:\/\/[^\]]+)\]/gi, '<img src="$1" alt="img" loading="lazy">');
  try { if (typeof marked !== 'undefined') t = marked.parse(t, { breaks: true, gfm: true }); else t = t.replace(/\n/g, '<br>'); }
  catch { t = t.replace(/\n/g, '<br>'); }
  return t;
}

function parseRepoIn(raw) {
  raw = String(raw ?? '').trim();
  const m = raw.match(/github\.com\/([^/\s]+)\/([^/\s]+)/i);
  if (m) return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
  const p = raw.split('/').filter(Boolean);
  if (p.length >= 2) return { owner: p[0], repo: p[1].replace(/\.git$/, '') };
  return null;
}

// ---- 토스트 / 로딩 ----
function toast(msg, type = 'info') {
  const c = $('toasts'); if (!c) return;
  const d = document.createElement('div');
  d.className = 'toast ' + (type === 'ok' ? 'ok' : type === 'fail' ? 'fail' : '');
  d.textContent = msg; c.appendChild(d);
  setTimeout(() => d.remove(), 3000);
}
function showLoad(m = '처리 중…') { const o = $('loadingOv'); if (o) { $('loadMsg').textContent = m; o.classList.remove('hidden'); } }
function hideLoad() { const o = $('loadingOv'); if (o) o.classList.add('hidden'); }

// ---- 설정 ----
function saveCfg() {
  A.cfg.appsUrl = val('inAppsUrl');
  A.cfg.defaultRepo = val('inDefRepo');
  localStorage.setItem('gitco_cfg', JSON.stringify(A.cfg));
  toast('설정 저장됨', 'ok');
}
function loadCfg() {
  try { const c = JSON.parse(localStorage.getItem('gitco_cfg') || '{}'); A.cfg = { appsUrl: '', defaultRepo: '', studioFolder: 'problems', ...c }; }
  catch { A.cfg = { appsUrl: '', defaultRepo: '', studioFolder: 'problems' }; }
  if ($('inAppsUrl')) $('inAppsUrl').value = A.cfg.appsUrl || '';
  if ($('inDefRepo')) $('inDefRepo').value = A.cfg.defaultRepo || '';
  if ($('inDirect') && A.cfg.defaultRepo) $('inDirect').value = A.cfg.defaultRepo;
  if ($('stFolder')) $('stFolder').value = A.cfg.studioFolder || 'problems';
}

// ---- 세션 ----
function updUI() {
  const u = $('userLabel'); if (!u) return;
  if (A.ses.role === 'teacher') u.textContent = '👩‍🏫 선생님';
  else if (A.ses.role === 'student') u.textContent = '🧑‍🎓 ' + (A.ses.userName || A.ses.userId);
  else u.textContent = '게스트';
  $('btnLogout').classList.toggle('hidden', A.ses.role === 'guest');
  const b = $('btnAdminIn'); if (b) b.disabled = A.ses.role === 'teacher';
  const b2 = $('btnAdminOut'); if (b2) b2.classList.toggle('hidden', A.ses.role !== 'teacher');
  $('adminPanel').classList.toggle('hidden', A.ses.role !== 'teacher');
}
function logout() {
  A.ses = { role: 'guest', userId: '', userName: '게스트', classId: '' };
  updUI(); toast('로그아웃', 'info');
}

// ---- 페이지 ----
function sw(page) {
  document.querySelectorAll('[data-page]').forEach(el => {
    if (el.tagName === 'SECTION') el.classList.toggle('active', el.dataset.page === page);
  });
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  if (page === 'records') renderRecs();
}

// ---- GitHub API ----
const GH = {
  async req(path, tk) {
    const h = { Accept: 'application/vnd.github+json' };
    if (tk) h.Authorization = `Bearer ${tk}`;
    const r = await fetch('https://api.github.com' + path, { headers: h });
    const t = await r.text();
    if (!r.ok) throw new Error('GitHub ' + r.status + ': ' + t.slice(0, 150));
    return t ? JSON.parse(t) : {};
  },
  enc(s) { return encodeURIComponent(s); },
  async defBranch(o, r, tk) {
    try { const i = await this.req(`/repos/${this.enc(o)}/${this.enc(r)}`, tk); return i.default_branch || 'main'; }
    catch { return 'main'; }
  },
  async search(q, tk) {
    const d = await this.req(`/search/repositories?q=${encodeURIComponent(q)}&per_page=30&sort=stars`, tk);
    return d.items || [];
  },
  async userRepos(name, tk) {
    if (tk) return await this.req('/user/repos?per_page=100&visibility=all&sort=updated', tk);
    return await this.req(`/users/${this.enc(name)}/repos?per_page=100&type=owner&sort=updated`);
  },
  async dir(o, r, p, b, tk) {
    const pp = p ? '/' + p.split('/').map(this.enc).join('/') : '';
    const ref = b ? `?ref=${encodeURIComponent(b)}` : '';
    return await this.req(`/repos/${this.enc(o)}/${this.enc(r)}/contents${pp}${ref}`, tk);
  },
  async fileTxt(o, r, p, b, tk) {
    const d = await this.dir(o, r, p, b, tk);
    if (Array.isArray(d)) throw new Error('폴더입니다');
    if (d.content) return atobU(d.content);
    if (d.download_url) { const x = await fetch(d.download_url); return await x.text(); }
    throw new Error('읽기 실패');
  },
  async walkPy(o, r, p, b, tk, acc) {
    acc = acc || [];
    let items;
    try { items = await this.dir(o, r, p, b, tk); } catch { return acc; }
    if (!Array.isArray(items)) items = [items];
    for (const x of items) {
      if (x.type === 'file' && x.name.endsWith('.py')) acc.push(x);
      else if (x.type === 'dir') await this.walkPy(o, r, x.path, b, tk, acc);
    }
    return acc;
  }
};

// ---- Pyodide ----
async function initPy() {
  if (A.py) return;
  try {
    A.py = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.0/full/' });
    A.pyOk = true;
    const s = $('pyStatus'); if (s) { s.textContent = '🟢 Python 준비됨'; s.classList.add('ok'); }
  } catch (e) {
    const s = $('pyStatus'); if (s) s.textContent = '❌ 로딩 실패';
    toast('Python 로딩 실패: ' + e.message, 'fail');
  }
}

async function runPy(code, stdin = '', tmo = 10000) {
  if (!A.py) await initPy();
  if (!A.py) throw new Error('Python 미준비');
  const w = `
import sys,io,traceback as _tb
_o,_e,_i=sys.stdout,sys.stderr,sys.stdin
sys.stdout=io.StringIO();sys.stderr=io.StringIO();sys.stdin=io.StringIO(${JSON.stringify(stdin || '')})
try: exec(compile(${JSON.stringify(code)},'<code>','exec'),{})
except Exception: _tb.print_exc()
_a,_b=sys.stdout.getvalue(),sys.stderr.getvalue()
sys.stdout,sys.stderr,sys.stdin=_o,_e,_i
(_a,_b)`;
  const res = await Promise.race([
    A.py.runPythonAsync(w),
    new Promise((_, rej) => setTimeout(() => rej(new Error('시간 초과')), tmo))
  ]);
  return { stdout: String(res[0] || ''), stderr: String(res[1] || '') };
}

async function loadLibs(o, r, folder, b, tk) {
  if (!folder || !o || !r) return;
  try {
    const fs = await GH.walkPy(o, r, folder, b, tk);
    for (const f of fs) {
      const code = await GH.fileTxt(o, r, f.path, b, tk);
      const name = f.name.replace(/\.py$/i, '').replace(/[^A-Za-z0-9_]/g, '_');
      if (name && A.py) {
        A.py.runPython(`
import sys,types
_m=types.ModuleType(${JSON.stringify(name)})
exec(compile(${JSON.stringify(code)},'<${name}>','exec'),_m.__dict__)
sys.modules[${JSON.stringify(name)}]=_m`);
      }
    }
  } catch {}
}

// ---- 문제 파싱 ----
function parseProblem(path, content) {
  const lines = String(content || '').split('\n');
  const m = { path, repo: '', number: '', title: '', score: 10, difficulty: '보통', timeLimit: 0, inputEx: '', outputEx: '', description: '', answer: '', template: '' };
  let inDesc = false;
  for (const l of lines) {
    const t = l.trim();
    if (t === '# ===학생코드===' || t === '# ===정답코드===') break;
    if (inDesc) {
      if (t.startsWith('#')) { m.description += '\n' + t.replace(/^#\s?/, ''); continue; }
      inDesc = false;
    }
    if (!t.startsWith('#')) continue;
    const raw = t.replace(/^#\s?/, '');
    const ci = raw.indexOf(':');
    if (ci < 0) continue;
    const k = raw.slice(0, ci).trim(), v = raw.slice(ci + 1).trim();
    if (k === '문제') m.title = v;
    else if (k === '문제번호') m.number = v;
    else if (k === '점수') m.score = parseInt(v) || 10;
    else if (k === '난이도') m.difficulty = v;
    else if (k === '시간제한') m.timeLimit = parseInt(v) || 0;
    else if (k === '입력예시') m.inputEx = v;
    else if (k === '출력예시') m.outputEx = v;
    else if (k === '설명') { m.description = v; inDesc = true; }
  }
  const si = lines.findIndex(l => l.trim() === '# ===학생코드===');
  const ai = lines.findIndex(l => l.trim() === '# ===정답코드===');
  if (si >= 0) m.template = lines.slice(si + 1, ai > si ? ai : undefined).join('\n').trim();
  if (ai >= 0) m.answer = lines.slice(ai + 1).join('\n').trim();
  if (!m.template) m.template = '# 여기에 코드를 작성하세요';
  if (!m.answer) m.answer = m.template;
  if (!m.title) m.title = path.split('/').pop().replace(/\.py$/i, '');
  return m;
}

// ---- 저장소 검색 / 로드 ----
async function searchRepos() {
  const q = val('inQuery'), tk = val('inToken');
  if (!q) return toast('사용자명 또는 검색어 입력', 'fail');
  showLoad('저장소 검색 중…');
  try {
    let list = tk ? await GH.userRepos(q, tk) : await GH.search(q, '');
    const sel = $('repoSel'); sel.innerHTML = '';
    if (!list.length) { sel.innerHTML = '<option>결과 없음</option>'; $('btnLoadSel').disabled = true; }
    else {
      list.forEach(r => {
        const o = document.createElement('option');
        o.value = r.full_name; o.dataset.owner = r.owner.login; o.dataset.repo = r.name;
        o.dataset.branch = r.default_branch || 'main';
        o.textContent = r.full_name + (r.private ? ' (private)' : ' (public)');
        sel.appendChild(o);
      });
      $('btnLoadSel').disabled = false;
    }
    hideLoad(); toast(`${list.length}개 저장소 발견`, 'ok');
  } catch (e) { hideLoad(); toast('검색 실패: ' + e.message, 'fail'); }
}

async function loadDirect() {
  const p = parseRepoIn(val('inDirect'));
  if (!p) return toast('owner/repo 또는 GitHub URL 입력', 'fail');
  showLoad('브랜치 확인…');
  const tk = val('inToken');
  const branch = await GH.defBranch(p.owner, p.repo, tk);
  await loadRepo(p.owner, p.repo, branch, val('inFolder') || 'problems', val('inLib') || 'libraries', tk);
}

async function loadSelected() {
  const sel = $('repoSel'); const opt = sel.options[sel.selectedIndex];
  if (!opt || !opt.dataset.owner) return toast('저장소 선택', 'fail');
  const tk = val('inToken');
  await loadRepo(opt.dataset.owner, opt.dataset.repo, opt.dataset.branch || 'main', val('inFolder') || 'problems', val('inLib') || 'libraries', tk);
}

async function loadRepo(owner, repo, branch, folder, libF, tk) {
  showLoad(`${owner}/${repo} 불러오는 중…`);
  try {
    await initPy();
    A.repo = { owner, repo, branch, folder };
    if (libF) await loadLibs(owner, repo, libF, branch, tk);
    const files = await GH.walkPy(owner, repo, folder, branch, tk);
    if (!files.length) { hideLoad(); toast(`'${folder}'에 .py 없음`, 'fail'); return; }
    A.probs = [];
    for (const f of files) {
      const txt = await GH.fileTxt(owner, repo, f.path, branch, tk);
      const p = parseProblem(f.path, txt);
      p.repo = `${owner}/${repo}`;
      A.probs.push(p);
    }
    // 문제번호 정렬
    A.probs.sort((a, b) => {
      const na = parseInt(a.number) || 999999, nb = parseInt(b.number) || 999999;
      return na - nb;
    });
    A.cur = null;
    stopTimer();
    A.started = null;
    renderProbList();
    // 상세 영역 초기화
    $('lmsMain').innerHTML = '<div class="card empty-state"><div class="e-icon">👈</div><p>왼쪽에서 문제를 선택하세요</p></div>';
    hideLoad(); toast(`${A.probs.length}개 문제 로드 완료`, 'ok');
  } catch (e) { hideLoad(); toast('로드 실패: ' + e.message, 'fail'); }
}

// ---- 문제 목록 ----
function renderProbList() {
  const box = $('probList');
  $('probCnt').textContent = A.probs.length ? `(${A.probs.length}개)` : '';
  if (!A.probs.length) { box.innerHTML = '<p class="empty-msg">문제가 없습니다.</p>'; return; }
  box.innerHTML = A.probs.map((p, i) => {
    const dc = p.difficulty === '쉬움' ? 'd-e' : p.difficulty === '어려움' ? 'd-h' : 'd-m';
    const act = A.cur && A.cur.path === p.path ? ' active' : '';
    const numLabel = p.number || (i + 1);
    return `<div class="prob-item${act}" data-idx="${i}">
      <span class="p-num">${esc(numLabel)}</span>
      <span class="p-title">${esc(p.title)}</span>
      <span class="p-score">${p.score}점</span>
      <span class="${dc}">${esc(p.difficulty)}</span>
    </div>`;
  }).join('');
  box.querySelectorAll('.prob-item').forEach(el => {
    el.addEventListener('click', () => selectProblem(parseInt(el.dataset.idx)));
  });
}

// ---- 문제 선택 (타이머 리셋 안 함) ----
function selectProblem(i) {
  const p = A.probs[i]; if (!p) return;

  // 같은 문제를 다시 눌렀으면 아무것도 안 함
  if (A.cur && A.cur.path === p.path) return;

  // 다른 문제로 전환 → 이전 타이머 정지
  stopTimer();
  A.started = null;

  A.cur = p;
  renderProbList();
  renderDetail(p);
}

// ---- 문제 상세 렌더링 ----
function renderDetail(p) {
  const main = $('lmsMain');
  const tl = p.timeLimit ? `${p.timeLimit}초` : '제한 없음';
  const numLabel = p.number ? `#${p.number}` : '';

  main.innerHTML = `
    <div class="card prob-detail">
      <h2>${numLabel ? `<span style="color:var(--blue)">${esc(numLabel)}</span> ` : ''}${esc(p.title)}</h2>
      <div class="p-meta">점수 <strong>${p.score}</strong> · 난이도 <strong>${esc(p.difficulty)}</strong> · 시간 <strong>${tl}</strong></div>
      <div class="p-body">${md(p.description || '설명이 없습니다.')}</div>

      <div class="start-box" id="startBox">
        <p>준비가 되면 아래 버튼을 눌러 학습을 시작하세요.${p.timeLimit ? `<br>시간 제한: <strong>${p.timeLimit}초</strong>` : ''}</p>
        <button id="btnStart" class="btn blue" style="font-size:16px;padding:12px 32px">🚀 학습 시작</button>
      </div>

      <div id="codeSection" class="hidden">
        <label>입력 (stdin)</label>
        <textarea id="codeStdin" class="inp ta" rows="2">${esc(p.inputEx)}</textarea>
        <div class="c-area">
          <div class="c-bar">
            <span>🐍 Python</span>
            <div style="display:flex;gap:6px">
              <button id="btnReset" class="btn">↩ 초기화</button>
              <button id="btnRun" class="btn">▶ 실행</button>
              <button id="btnSubmit" class="btn blue" ${A.ses.role === 'guest' ? 'disabled' : ''}>✅ 제출</button>
            </div>
          </div>
          <textarea id="codeEditor" class="c-editor" spellcheck="false">${esc(p.template)}</textarea>
        </div>
        <div class="o-area">
          <div class="o-bar">실행 결과</div>
          <pre id="outputArea">코드를 실행하면 결과가 여기에 표시됩니다.</pre>
        </div>
        <div class="timer-line" id="timerLine"></div>
      </div>
    </div>
  `;

  // 학습 시작 버튼
  $('btnStart').addEventListener('click', () => {
    hide('startBox');
    show('codeSection');
    startTimer(p.timeLimit || 0);
  });

  // 초기화
  $('btnReset').addEventListener('click', () => {
    $('codeEditor').value = p.template;
    $('codeStdin').value = p.inputEx;
    const o = $('outputArea'); o.textContent = '초기화됨'; o.className = '';
  });

  $('btnRun').addEventListener('click', () => doRun(false));
  $('btnSubmit').addEventListener('click', () => doRun(true));
  $('codeEditor').addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const t = e.target, s = t.selectionStart;
    t.value = t.value.slice(0, s) + '    ' + t.value.slice(t.selectionEnd);
    t.selectionStart = t.selectionEnd = s + 4;
  });
}

// ---- 타이머 (학습 시작 버튼 눌러야만 시작) ----
function startTimer(lim) {
  stopTimer();
  A.started = A.cur ? A.cur.path : null;
  A.elapsed = 0;
  A.countdown = lim;
  const line = $('timerLine'); if (!line) return;

  if (!lim) {
    line.textContent = '⏱ 진행 시간: 00:00';
    A.tmr = setInterval(() => {
      A.elapsed++;
      line.textContent = `⏱ 진행 시간: ${fmt(A.elapsed)}`;
    }, 1000);
    return;
  }

  line.textContent = `⏱ 남은 시간: ${fmt(lim)}`;
  A.tmr = setInterval(() => {
    A.elapsed++;
    A.countdown--;
    if (A.countdown <= 0) {
      stopTimer();
      line.textContent = '⏰ 시간 초과! 자동 제출됩니다.';
      doRun(true);
    } else {
      line.textContent = `⏱ 남은 시간: ${fmt(A.countdown)}`;
    }
  }, 1000);
}

function stopTimer() {
  if (A.tmr) { clearInterval(A.tmr); A.tmr = null; }
}

// ---- 실행 / 제출 ----
async function doRun(isSubmit) {
  const p = A.cur; if (!p) return toast('문제 선택', 'fail');
  if (!A.pyOk) return toast('Python 로딩중…', 'fail');

  const code = $('codeEditor').value;
  const stdin = $('codeStdin').value;
  const out = $('outputArea');
  out.className = ''; out.textContent = isSubmit ? '채점 중…' : '실행 중…';
  const tmo = Math.max(5000, (p.timeLimit || 30) * 1000);

  try {
    const stu = await runPy(code, stdin, tmo);
    const sOut = stu.stdout.trim(), sErr = stu.stderr.trim();
    if (!isSubmit) {
      out.textContent = sOut || '(출력 없음)';
      if (sErr) out.textContent += '\n[오류]\n' + sErr;
      out.className = sErr ? 'err' : 'ok';
      return;
    }
    const ans = await runPy(p.answer, stdin, tmo);
    const aOut = ans.stdout.trim();
    const ok = sOut === aOut;
    const score = ok ? p.score : 0;
    if (ok) {
      out.textContent = `✅ 정답! +${score}점\n\n${sOut || '(없음)'}`;
      out.className = 'ok'; toast('정답!', 'ok');
    } else {
      out.textContent = `❌ 오답\n\n내 출력:\n${sOut || '(없음)'}\n\n기대 출력:\n${aOut || '(없음)'}`;
      out.className = 'err'; toast('오답', 'fail');
    }
    stopTimer();
    saveRec(p, code, ok, score);
  } catch (e) {
    out.textContent = '오류: ' + e.message; out.className = 'err';
  }
}

function saveRec(p, code, ok, score) {
  const rec = {
    timestamp: new Date().toISOString(),
    studentId: A.ses.userId || 'guest',
    studentName: A.ses.userName || '게스트',
    classId: A.ses.classId || '미지정',
    repo: p.repo || `${A.repo.owner}/${A.repo.repo}`,
    problem: p.title, problemPath: p.path,
    problemNumber: p.number || '',
    result: ok ? 'correct' : 'wrong',
    score, maxScore: p.score, code,
    elapsed: A.elapsed
  };
  A.recs.unshift(rec);
  try { localStorage.setItem('gitco_recs', JSON.stringify(A.recs.slice(0, 500))); } catch {}
  if (A.cfg.appsUrl) {
    fetch(A.cfg.appsUrl, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'submit', ...rec }) }).catch(() => {});
  }
}

// ---- 기록 ----
function renderRecs() {
  try { A.recs = JSON.parse(localStorage.getItem('gitco_recs') || '[]'); } catch { A.recs = []; }
  const q = ($('inRecSrch')?.value || '').toLowerCase();
  const list = q ? A.recs.filter(r => (r.studentId + r.studentName + r.problem).toLowerCase().includes(q)) : A.recs;
  const body = $('recBody');
  const total = list.length, corr = list.filter(r => r.result === 'correct').length;
  const rate = total ? Math.round(corr / total * 100) : 0;
  $('recStats').innerHTML = `제출 <strong>${total}</strong> · 정답 <strong>${corr}</strong> · 정답률 <strong>${rate}%</strong>`;
  if (!total) { body.innerHTML = '<tr><td colspan="7" class="empty-td">기록 없음</td></tr>'; return; }
  body.innerHTML = list.slice(0, 200).map((r, i) => `
    <tr>
      <td>${new Date(r.timestamp).toLocaleString('ko-KR')}</td>
      <td>${esc(r.studentName || r.studentId)}</td>
      <td>${esc(r.repo || '-')}</td>
      <td>${esc(r.problem)}</td>
      <td class="${r.result === 'correct' ? 'r-ok' : 'r-fail'}">${r.result === 'correct' ? '✅' : '❌'}</td>
      <td>${r.score}/${r.maxScore}</td>
      <td><button class="btn" data-ci="${i}">보기</button></td>
    </tr>`).join('');
  body.querySelectorAll('[data-ci]').forEach(b => {
    b.addEventListener('click', () => viewCode(parseInt(b.dataset.ci)));
  });
}
function viewCode(i) {
  const r = A.recs[i]; if (!r || !r.code) return toast('코드 없음', 'fail');
  $('modCode').textContent = r.code;
  $('codeMod').classList.remove('hidden');
}
function closeMod() { $('codeMod').classList.add('hidden'); }
function exportCSV() {
  if (!A.recs.length) return toast('기록 없음', 'fail');
  const h = ['시간', '학생ID', '학생명', '반', '저장소', '문제', '문제번호', '결과', '점수', '만점', '소요시간(초)'];
  const rows = A.recs.map(r => [r.timestamp, r.studentId, r.studentName, r.classId, r.repo, r.problem, r.problemNumber, r.result, r.score, r.maxScore, r.elapsed || 0]);
  const csv = [h, ...rows].map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const b = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(b);
  a.download = `gitco_records_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  URL.revokeObjectURL(a.href); toast('CSV 다운로드', 'ok');
}

// ---- 스튜디오 ----
function updPreview() {
  const title = val('stTitle') || '제목 없음';
  const num = val('stNum') || '1';
  const sc = val('stScore') || 10;
  const df = val('stDiff') || '보통';
  const tm = val('stTime') || 0;
  const desc = $('stDesc')?.value.trim() || '';
  const ie = val('stInEx'), oe = val('stOutEx');
  const ans = $('stAns')?.value.trim() || 'print()';
  const tmp = $('stTmpl')?.value.trim() || '# 여기에 코드를 작성하세요';

  // 폴더 저장 (자동)
  const folder = val('stFolder') || 'problems';
  A.cfg.studioFolder = folder;
  localStorage.setItem('gitco_cfg', JSON.stringify(A.cfg));

  let py = `# 문제: ${title}\n# 문제번호: ${num}\n# 점수: ${sc}\n# 난이도: ${df}\n# 시간제한: ${tm}\n`;
  if (ie) py += `# 입력예시: ${ie}\n`;
  if (oe) py += `# 출력예시: ${oe}\n`;
  py += `# 설명:\n${(desc || '설명 없음').split('\n').map(l => `# ${l}`).join('\n')}\n\n`;
  py += `# ===학생코드===\n${tmp}\n\n# ===정답코드===\n${ans}\n`;

  $('stPrev').textContent = py;
  let m = desc; if (ie) m += `\n\n**입력 예시:** \`${ie}\``; if (oe) m += `\n\n**출력 예시:** \`${oe}\``;
  $('stRend').innerHTML = md(m);
}

function dlPy() {
  updPreview();
  const c = $('stPrev').textContent;
  const num = val('stNum') || '1';
  const title = (val('stTitle') || 'problem').replace(/[^A-Za-z0-9가-힣_-]/g, '_');
  const folder = val('stFolder') || 'problems';
  const filename = `${String(num).padStart(3, '0')}_${title}.py`;

  const b = new Blob([c], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(b);
  a.download = filename; a.click(); URL.revokeObjectURL(a.href);
  toast(`${folder}/${filename} 다운로드`, 'ok');
}

// ---- 관리자 ----
function jsonpCall(url, action, data) {
  return new Promise((resolve, reject) => {
    const cb = `_gc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const s = document.createElement('script');
    window[cb] = d => { delete window[cb]; s.remove(); resolve(d); };
    s.onerror = () => { delete window[cb]; s.remove(); reject(new Error('연결 실패')); };
    s.src = `${url}?action=${encodeURIComponent(action)}&data=${encodeURIComponent(JSON.stringify(data))}&callback=${cb}`;
    document.body.appendChild(s);
    setTimeout(() => { if (window[cb]) { delete window[cb]; s.remove(); reject(new Error('시간 초과')); } }, 10000);
  });
}

async function adminLogin() {
  const pw = val('inAdminPw'); if (!pw) return toast('비밀번호 입력', 'fail');
  let ok = false;
  if (A.cfg.appsUrl) {
    try {
      const hash = await sha256(pw);
      const res = await jsonpCall(A.cfg.appsUrl, 'loginTeacher', { passwordHash: hash });
      ok = res && res.success;
    } catch { ok = (pw === 'admin'); }
  } else ok = (pw === 'admin');
  if (!ok) return toast('비밀번호 오류', 'fail');
  A.ses = { role: 'teacher', userId: 'teacher', userName: '선생님', classId: '' };
  updUI(); toast('관리자 로그인', 'ok');
}

async function chPw() {
  const pw = val('inNewPw'); if (!pw) return toast('새 비밀번호 입력', 'fail');
  const hash = await sha256(pw);
  if (A.cfg.appsUrl) {
    fetch(A.cfg.appsUrl, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'changeTeacherPassword', passwordHash: hash }) }).catch(() => {});
  }
  toast('비밀번호 변경 요청됨', 'ok'); $('inNewPw').value = '';
}

async function addStu() {
  const id = prompt('학번/아이디'); if (!id) return;
  const name = prompt('이름') || '';
  const cls = prompt('반') || '기본';
  const pw = prompt('초기 비밀번호') || '';
  if (!pw) return toast('비밀번호 필수', 'fail');
  const hash = await sha256(pw);
  if (A.cfg.appsUrl) {
    fetch(A.cfg.appsUrl, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'addStudent', userId: id, name, classId: cls, passwordHash: hash }) }).catch(() => {});
  }
  toast(`${id} 학생 추가됨`, 'ok');
}

async function genAcc() {
  const cls = prompt('반 이름', '1학년1반') || '';
  const pfx = prompt('학번 접두사', '1A') || '';
  const cnt = parseInt(prompt('학생 수', '25') || '0');
  const start = parseInt(prompt('시작 번호', '1') || '1');
  if (!cls || !pfx || !cnt) return toast('모든 항목 입력', 'fail');
  if (A.cfg.appsUrl) {
    try {
      const res = await jsonpCall(A.cfg.appsUrl, 'generateAccounts', { classId: cls, prefix: pfx, count: cnt, startNo: start });
      if (res && res.accounts) {
        const txt = res.accounts.map(a => `${a.userId} / ${a.password}`).join('\n');
        const b = new Blob([txt], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(b);
        a.download = `accounts_${cls}.txt`; a.click(); URL.revokeObjectURL(a.href);
        toast(`${res.accounts.length}개 계정 생성 → txt`, 'ok'); return;
      }
    } catch {}
  }
  toast('Apps Script URL 먼저 설정', 'fail');
}

// ---- 이벤트 ----
function bind() {
  document.querySelectorAll('.nav-btn').forEach(b => b.addEventListener('click', () => sw(b.dataset.page)));
  $('btnLogout').addEventListener('click', logout);
  $('btnSearch').addEventListener('click', searchRepos);
  $('btnLoadDirect').addEventListener('click', loadDirect);
  $('btnLoadSel').addEventListener('click', loadSelected);
  $('btnSaveCfg').addEventListener('click', saveCfg);
  $('btnAdminIn').addEventListener('click', adminLogin);
  $('btnAdminOut').addEventListener('click', logout);
  $('btnChPw').addEventListener('click', chPw);
  $('btnAddStu').addEventListener('click', addStu);
  $('btnGenAcc').addEventListener('click', genAcc);
  $('btnCSV').addEventListener('click', exportCSV);
  $('inRecSrch').addEventListener('input', renderRecs);
  $('btnDL').addEventListener('click', dlPy);
  $('btnCloseMod').addEventListener('click', closeMod);
  $('codeMod').addEventListener('click', e => { if (e.target.id === 'codeMod') closeMod(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMod(); });

  ['stTitle', 'stNum', 'stScore', 'stDiff', 'stTime', 'stDesc', 'stInEx', 'stOutEx', 'stAns', 'stTmpl', 'stFolder'].forEach(id => {
    const e = $(id); if (e) e.addEventListener('input', updPreview);
  });
}

// ---- 시작 ----
document.addEventListener('DOMContentLoaded', () => {
  loadCfg();
  bind();
  updUI();
  updPreview();
  renderRecs();
  initPy();
});
