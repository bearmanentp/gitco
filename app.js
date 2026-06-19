'use strict';

// =============================================
// GitCo app.js
// 개발: 석근우 (geunman@geekbyte.kro.kr)
// =============================================

// --- 전역 상태 ---
const App = {
    config: { appsUrl: '', defaultRepo: '' },
    session: { role: 'guest', userId: '', userName: '게스트', classId: '' },
    problems: [],
    currentProblem: null,
    records: [],
    pyodide: null,
    pyodideReady: false,
    timerID: null,
    repoInfo: { owner: '', repo: '', branch: 'main', folder: 'problems' }
};

// --- DOM 유틸 ---
function el(id) { return document.getElementById(id); }
function show(id) { const e = el(id); if (e) e.style.display = ''; }
function hide(id) { const e = el(id); if (e) e.style.display = 'none'; }
function val(id) { const e = el(id); return e ? e.value.trim() : ''; }
function setVal(id, v) { const e = el(id); if (e) e.value = v; }
function setText(id, v) { const e = el(id); if (e) e.textContent = v; }
function setHtml(id, v) { const e = el(id); if (e) e.innerHTML = v; }

function toast(msg, type = 'info') {
    const box = el('toasts');
    if (!box) return;
    const d = document.createElement('div');
    d.className = 'toast' + (type === 'ok' ? ' ok' : type === 'fail' ? ' fail' : '');
    d.textContent = msg;
    box.appendChild(d);
    setTimeout(() => d.remove(), 3000);
}

function showLoading(msg = '처리 중...') {
    const ov = el('loading');
    if (ov) { setText('loadingMsg', msg); ov.style.display = 'flex'; }
}
function hideLoading() {
    const ov = el('loading');
    if (ov) ov.style.display = 'none';
}

function esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s ?? '');
    return d.innerHTML;
}

function fmtTime(sec) {
    sec = Math.max(0, parseInt(sec) || 0);
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

function btoaU(s) {
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    bytes.forEach(b => bin += String.fromCharCode(b));
    return btoa(bin);
}

function atobU(s) {
    try {
        const bin = atob(String(s).replace(/\s/g, ''));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new TextDecoder().decode(bytes);
    } catch {
        return atob(s);
    }
}

async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function mdRender(text) {
    if (!text) return '';
    let t = String(text)
        .replace(/\[이미지:\s*(https?:\/\/[^\]]+)\]/gi, '<img src="$1" alt="img" loading="lazy">');
    try {
        if (typeof marked !== 'undefined') t = marked.parse(t, { breaks: true, gfm: true });
        else t = t.replace(/\n/g, '<br>');
    } catch { t = t.replace(/\n/g, '<br>'); }
    return t;
}

function parseRepoInput(raw) {
    raw = String(raw ?? '').trim();
    const urlM = raw.match(/github\.com\/([^/\s]+)\/([^/\s]+)/i);
    if (urlM) return { owner: urlM[1], repo: urlM[2].replace(/\.git$/, '') };
    const parts = raw.split('/').filter(Boolean);
    if (parts.length >= 2) return { owner: parts[0], repo: parts[1].replace(/\.git$/, '') };
    return null;
}

// --- 설정 저장/로드 ---
function saveConfig() {
    App.config.appsUrl = val('inAppsUrl');
    App.config.defaultRepo = val('inDefaultRepo');
    localStorage.setItem('gitco_cfg', JSON.stringify(App.config));
    toast('설정이 저장되었습니다', 'ok');
}

function loadConfig() {
    try {
        const c = JSON.parse(localStorage.getItem('gitco_cfg') || '{}');
        App.config = { appsUrl: '', defaultRepo: '', ...c };
    } catch {
        App.config = { appsUrl: '', defaultRepo: '' };
    }
    setVal('inAppsUrl', App.config.appsUrl);
    setVal('inDefaultRepo', App.config.defaultRepo);
    if (App.config.defaultRepo) setVal('inDirect', App.config.defaultRepo);
}

// --- 세션 UI 업데이트 ---
function updateSessionUI() {
    const label = el('userLabel');
    const logoutBtn = el('btnLogout');
    if (label) {
        label.textContent = App.session.role === 'guest'
            ? '게스트'
            : `${App.session.userName || App.session.userId} (${App.session.role === 'teacher' ? '선생님' : '학생'})`;
    }
    if (logoutBtn) {
        logoutBtn.style.display = (App.session.role !== 'guest') ? '' : 'none';
    }
}

// --- 페이지 전환 ---
function switchPage(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = el(`page-${page}`);
    if (target) target.classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.page === page);
    });
    if (page === 'records') loadRecords();
}

// --- GitHub API ---
const GH = {
    base: 'https://api.github.com',

    async req(path, token) {
        const headers = { Accept: 'application/vnd.github+json' };
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(this.base + path, { headers });
        const txt = await res.text();
        if (!res.ok) throw new Error(`GitHub 오류 ${res.status}: ${txt.slice(0, 200)}`);
        return txt ? JSON.parse(txt) : {};
    },

    async defaultBranch(owner, repo, token) {
        try {
            const info = await this.req(`/repos/${enc(owner)}/${enc(repo)}`, token);
            return info.default_branch || 'main';
        } catch { return 'main'; }
    },

    async search(query, token) {
        const data = await this.req(
            `/search/repositories?q=${encodeURIComponent(query)}&per_page=30&sort=stars&order=desc`,
            token
        );
        return data.items || [];
    },

    async userRepos(username, token) {
        if (token) {
            return await this.req('/user/repos?per_page=100&visibility=all&sort=updated', token);
        }
        return await this.req(`/users/${enc(username)}/repos?per_page=100&type=owner&sort=updated`);
    },

    async contents(owner, repo, path, branch, token) {
        const p = path ? '/' + path.split('/').map(enc).join('/') : '';
        const q = branch ? `?ref=${enc(branch)}` : '';
        return await this.req(`/repos/${enc(owner)}/${enc(repo)}/contents${p}${q}`, token);
    },

    async fileText(owner, repo, path, branch, token) {
        const d = await this.contents(owner, repo, path, branch, token);
        if (Array.isArray(d)) throw new Error(`${path} 는 폴더입니다`);
        if (d.content) return atobU(d.content);
        if (d.download_url) {
            const r = await fetch(d.download_url);
            if (!r.ok) throw new Error('다운로드 실패');
            return await r.text();
        }
        throw new Error('파일 내용을 읽을 수 없습니다');
    },

    async walkPy(owner, repo, folder, branch, token, acc) {
        if (!acc) acc = [];
        let items;
        try { items = await this.contents(owner, repo, folder, branch, token); }
        catch { return acc; }
        if (!Array.isArray(items)) items = [items];
        for (const item of items) {
            if (item.type === 'file' && item.name.endsWith('.py')) acc.push(item);
            else if (item.type === 'dir') await this.walkPy(owner, repo, item.path, branch, token, acc);
        }
        return acc;
    }
};

function enc(s) { return encodeURIComponent(String(s ?? '')); }

// --- Pyodide ---
async function initPyodide() {
    if (App.pyodide) return;
    try {
        setText('pyStatus', 'Python 로딩중...');
        App.pyodide = await loadPyodide({
            indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.0/full/'
        });
        App.pyodideReady = true;
        const s = el('pyStatus');
        if (s) { s.textContent = '🟢 Python 준비됨'; s.className = 'py-status ready'; }
        toast('Python 실행 환경 준비 완료', 'ok');
    } catch (e) {
        setText('pyStatus', '❌ Python 로딩 실패');
        toast('Pyodide 로딩 실패: ' + e.message, 'fail');
    }
}

async function runPython(code, stdin = '', timeoutMs = 10000) {
    if (!App.pyodide) throw new Error('Python이 아직 준비되지 않았습니다');
    const wrapped = `
import sys, io, traceback as _tb
_oi, _oe, _oin = sys.stdout, sys.stderr, sys.stdin
sys.stdout = io.StringIO()
sys.stderr = io.StringIO()
sys.stdin  = io.StringIO(${JSON.stringify(stdin || '')})
try:
    exec(compile(${JSON.stringify(code)}, '<code>', 'exec'), {})
except Exception:
    _tb.print_exc()
_o = sys.stdout.getvalue()
_e = sys.stderr.getvalue()
sys.stdout, sys.stderr, sys.stdin = _oi, _oe, _oin
(_o, _e)
`;
    const result = await Promise.race([
        App.pyodide.runPythonAsync(wrapped),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`시간 초과 (${timeoutMs / 1000}초)`)), timeoutMs))
    ]);
    return { stdout: String(result[0] || ''), stderr: String(result[1] || '') };
}

async function loadLibs(owner, repo, folder, branch, token) {
    if (!folder || !owner || !repo) return;
    try {
        const files = await GH.walkPy(owner, repo, folder, branch, token);
        for (const f of files) {
            const code = await GH.fileText(owner, repo, f.path, branch, token);
            const name = f.name.replace(/\.py$/i, '').replace(/[^A-Za-z0-9_]/g, '_');
            if (name && App.pyodide) {
                App.pyodide.runPython(`
import sys, types
_m = types.ModuleType(${JSON.stringify(name)})
exec(compile(${JSON.stringify(code)}, '<${name}>', 'exec'), _m.__dict__)
sys.modules[${JSON.stringify(name)}] = _m
`);
            }
        }
    } catch (e) {
        console.warn('라이브러리 로드 실패:', e.message);
    }
}

// --- 문제 파싱 ---
function parseProblem(path, content) {
    const lines = String(content || '').split('\n');
    const m = {
        path, repo: `${App.repoInfo.owner}/${App.repoInfo.repo}`,
        title: '', score: 10, difficulty: '보통', timeLimit: 0,
        inputEx: '', outputEx: '', description: '',
        answer: '', template: ''
    };

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

// --- 저장소 검색 ---
async function searchRepos() {
    const query = val('inQuery');
    const token = val('inToken');
    if (!query) return toast('사용자명 또는 검색어를 입력하세요', 'fail');
    showLoading('저장소 검색 중...');
    try {
        let repos;
        if (token) {
            repos = await GH.userRepos(query, token);
        } else {
            repos = await GH.search(query, token);
        }
        fillRepoSelect(repos);
        hideLoading();
        toast(`${repos.length}개 저장소 발견`, 'ok');
    } catch (e) {
        hideLoading();
        toast('검색 실패: ' + e.message, 'fail');
    }
}

function fillRepoSelect(repos) {
    const sel = el('repoSelect');
    sel.innerHTML = '';
    if (!repos || !repos.length) {
        sel.innerHTML = '<option value="">결과 없음</option>';
        el('btnLoadSelected').disabled = true;
        return;
    }
    repos.forEach(r => {
        const o = document.createElement('option');
        o.value = r.full_name;
        o.dataset.owner = r.owner.login;
        o.dataset.repo = r.name;
        o.dataset.branch = r.default_branch || 'main';
        o.textContent = r.full_name + (r.private ? ' (private)' : ' (public)');
        sel.appendChild(o);
    });
    el('btnLoadSelected').disabled = false;
}

async function loadSelectedRepo() {
    const sel = el('repoSelect');
    const opt = sel.options[sel.selectedIndex];
    if (!opt || !opt.dataset.owner) return toast('저장소를 선택하세요', 'fail');
    const token = val('inToken');
    const branch = opt.dataset.branch || 'main';
    const folder = val('inFolder') || 'problems';
    const libFolder = val('inLibFolder') || 'libraries';
    await loadRepo(opt.dataset.owner, opt.dataset.repo, branch, folder, libFolder, token);
}

async function loadDirect() {
    const input = val('inDirect');
    const parsed = parseRepoInput(input);
    if (!parsed) return toast('owner/repo 또는 GitHub URL 형식으로 입력하세요', 'fail');
    const token = val('inToken');
    showLoading('브랜치 확인 중...');
    const branch = await GH.defaultBranch(parsed.owner, parsed.repo, token);
    const folder = val('inFolder') || 'problems';
    const libFolder = val('inLibFolder') || 'libraries';
    await loadRepo(parsed.owner, parsed.repo, branch, folder, libFolder, token);
}

async function loadRepo(owner, repo, branch, folder, libFolder, token) {
    showLoading(`${owner}/${repo} 불러오는 중...`);
    try {
        await initPyodide();
        App.repoInfo = { owner, repo, branch, folder };

        // 라이브러리 로드
        if (libFolder) await loadLibs(owner, repo, libFolder, branch, token);

        // 문제 파일 목록
        const files = await GH.walkPy(owner, repo, folder, branch, token);
        if (!files.length) {
            hideLoading();
            toast(`'${folder}' 폴더에 .py 파일이 없습니다`, 'fail');
            return;
        }

        App.problems = [];
        for (const f of files) {
            const content = await GH.fileText(owner, repo, f.path, branch, token);
            const p = parseProblem(f.path, content);
            App.problems.push(p);
        }

        renderProblemList();
        hideLoading();
        toast(`${App.problems.length}개 문제 로드 완료`, 'ok');
    } catch (e) {
        hideLoading();
        toast('로드 실패: ' + e.message, 'fail');
    }
}

// --- 문제 목록 렌더링 ---
function renderProblemList() {
    const box = el('problemList');
    setText('problemCount', `(${App.problems.length}개)`);
    if (!App.problems.length) {
        box.innerHTML = '<p class="empty-msg">문제가 없습니다.</p>';
        return;
    }
    box.innerHTML = App.problems.map((p, i) => {
        const active = App.currentProblem && App.currentProblem.path === p.path ? ' active' : '';
        const dcls = p.difficulty === '쉬움' ? 'diff-easy' : p.difficulty === '어려움' ? 'diff-hard' : 'diff-mid';
        return `<div class="prob-item${active}" data-idx="${i}">
            <span class="p-title">${esc(p.title)}</span>
            <span class="p-score">${p.score}점</span>
            <span class="${dcls}">${esc(p.difficulty)}</span>
        </div>`;
    }).join('');
    box.querySelectorAll('.prob-item').forEach(item => {
        item.addEventListener('click', () => selectProblem(parseInt(item.dataset.idx)));
    });
}

// --- 문제 선택 ---
function selectProblem(idx) {
    const p = App.problems[idx];
    if (!p) return;
    App.currentProblem = p;
    renderProblemList();
    renderProblemDetail(p);
}

// --- 문제 상세 렌더링 ---
function renderProblemDetail(p) {
    const main = el('lmsMain');
    const tl = p.timeLimit ? `${p.timeLimit}초` : '제한 없음';
    main.innerHTML = `
        <div class="card prob-detail">
            <h2>${esc(p.title)}</h2>
            <div class="prob-meta">
                점수: <strong>${p.score}</strong> &nbsp;·&nbsp;
                난이도: <strong>${esc(p.difficulty)}</strong> &nbsp;·&nbsp;
                시간: <strong>${tl}</strong>
            </div>
            <div class="prob-body">${mdRender(p.description || '설명이 없습니다.')}</div>
            <div class="form-group">
                <label>입력 (stdin)</label>
                <textarea id="codeStdin" class="inp ta" rows="2">${esc(p.inputEx)}</textarea>
            </div>
            <div class="code-editor-wrap">
                <div class="code-toolbar">
                    <span>🐍 Python</span>
                    <div style="display:flex;gap:8px">
                        <button id="btnResetCode" class="btn">↩ 초기화</button>
                        <button id="btnRun" class="btn">▶ 실행</button>
                        <button id="btnSubmit" class="btn blue" ${App.session.role === 'guest' ? 'disabled title="게스트는 제출 불가"' : ''}>✅ 제출</button>
                    </div>
                </div>
                <textarea id="codeEditor" class="code-editor" spellcheck="false">${esc(p.template)}</textarea>
            </div>
            <div class="output-wrap">
                <div class="output-toolbar">실행 결과</div>
                <pre id="outputArea">코드를 실행하면 결과가 여기에 표시됩니다.</pre>
            </div>
            <div class="timer-line" id="timerLine"></div>
        </div>
    `;

    el('btnResetCode').addEventListener('click', () => {
        el('codeEditor').value = p.template;
        el('codeStdin').value = p.inputEx;
        el('outputArea').textContent = '초기화되었습니다.';
        el('outputArea').className = '';
    });
    el('btnRun').addEventListener('click', () => doRun(false));
    el('btnSubmit').addEventListener('click', () => doRun(true));
    el('codeEditor').addEventListener('keydown', handleTab);
    startProblemTimer(p.timeLimit || 0);
}

function handleTab(e) {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const t = e.target;
    const s = t.selectionStart;
    t.value = t.value.slice(0, s) + '    ' + t.value.slice(t.selectionEnd);
    t.selectionStart = t.selectionEnd = s + 4;
}

// --- 타이머 ---
function startProblemTimer(limitSec) {
    stopTimer();
    const line = el('timerLine');
    if (!line) return;
    if (!limitSec) { line.textContent = ''; return; }
    let rem = limitSec;
    line.textContent = `⏱ 남은 시간: ${fmtTime(rem)}`;
    App.timerID = setInterval(() => {
        rem--;
        if (rem <= 0) {
            stopTimer();
            if (line) line.textContent = '⏰ 시간 초과! 자동 제출됩니다.';
            doRun(true);
        } else {
            if (line) line.textContent = `⏱ 남은 시간: ${fmtTime(rem)}`;
        }
    }, 1000);
}
function stopTimer() {
    if (App.timerID) { clearInterval(App.timerID); App.timerID = null; }
}

// --- 코드 실행 / 제출 ---
async function doRun(isSubmit) {
    const p = App.currentProblem;
    if (!p) return toast('문제를 먼저 선택하세요', 'fail');
    if (!App.pyodideReady) return toast('Python이 아직 준비되지 않았습니다', 'fail');

    const code = el('codeEditor') ? el('codeEditor').value : '';
    const stdin = el('codeStdin') ? el('codeStdin').value : '';
    const out = el('outputArea');
    if (!out) return;

    const timeoutMs = Math.max(5000, (p.timeLimit || 30) * 1000);

    out.className = '';
    out.textContent = isSubmit ? '채점 중...' : '실행 중...';

    try {
        const studentRes = await runPython(code, stdin, timeoutMs);
        const studentOut = studentRes.stdout.trim();
        const studentErr = studentRes.stderr.trim();

        if (!isSubmit) {
            out.textContent = studentOut || '(출력 없음)';
            if (studentErr) out.textContent += '\n[오류]\n' + studentErr;
            out.className = studentErr ? 'err' : 'ok';
            return;
        }

        // 제출: 정답 코드 실행
        const answerRes = await runPython(p.answer, stdin, timeoutMs);
        const answerOut = answerRes.stdout.trim();

        const correct = studentOut === answerOut;

        if (correct) {
            out.textContent = `✅ 정답입니다! +${p.score}점\n\n출력:\n${studentOut || '(없음)'}`;
            out.className = 'ok';
            toast('정답!', 'ok');
        } else {
            out.textContent = `❌ 오답입니다.\n\n내 출력:\n${studentOut || '(없음)'}\n\n기대 출력:\n${answerOut || '(없음)'}`;
            out.className = 'err';
            toast('오답', 'fail');
        }

        stopTimer();
        await saveRecord(p, code, correct, correct ? p.score : 0, studentOut, answerOut);

    } catch (e) {
        out.textContent = '오류: ' + e.message;
        out.className = 'err';
    }
}

// --- 기록 저장 ---
async function saveRecord(p, code, correct, score, studentOut, answerOut) {
    const rec = {
        timestamp: new Date().toISOString(),
        studentId: App.session.userId || 'guest',
        studentName: App.session.userName || '게스트',
        classId: App.session.classId || '미지정',
        repo: p.repo || `${App.repoInfo.owner}/${App.repoInfo.repo}`,
        problem: p.title,
        problemPath: p.path,
        result: correct ? 'correct' : 'wrong',
        score, maxScore: p.score,
        code, studentOut, answerOut
    };

    App.records.unshift(rec);
    try { localStorage.setItem('gitco_records', JSON.stringify(App.records.slice(0, 500))); } catch {}

    if (App.config.appsUrl) {
        try {
            await fetch(App.config.appsUrl, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action: 'submit', ...rec })
            });
        } catch {}
    }
}

// --- 기록 렌더링 ---
function loadRecords() {
    try { App.records = JSON.parse(localStorage.getItem('gitco_records') || '[]'); } catch { App.records = []; }
    filterRecords();
}

function filterRecords() {
    const q = (el('inRecordSearch') ? el('inRecordSearch').value : '').toLowerCase().trim();
    const list = q
        ? App.records.filter(r => (r.studentId + r.studentName + r.problem).toLowerCase().includes(q))
        : App.records;
    renderRecords(list);
}

function renderRecords(list) {
    const body = el('recordsBody');
    const stats = el('recordStats');
    if (!body) return;

    const total = list.length;
    const corr = list.filter(r => r.result === 'correct').length;
    const rate = total ? Math.round(corr / total * 100) : 0;
    if (stats) stats.innerHTML = `제출 <strong>${total}</strong>회 · 정답 <strong>${corr}</strong>회 · 정답률 <strong>${rate}%</strong>`;

    if (!total) {
        body.innerHTML = '<tr><td colspan="7" class="empty-td">기록이 없습니다</td></tr>';
        return;
    }
    body.innerHTML = list.slice(0, 300).map((r, i) => `
        <tr>
            <td>${new Date(r.timestamp).toLocaleString('ko-KR')}</td>
            <td>${esc(r.studentName || r.studentId)}</td>
            <td>${esc(r.repo || '-')}</td>
            <td>${esc(r.problem)}</td>
            <td class="${r.result === 'correct' ? 'res-ok' : 'res-fail'}">${r.result === 'correct' ? '✅ 정답' : '❌ 오답'}</td>
            <td>${r.score}/${r.maxScore}</td>
            <td><button class="btn" data-ci="${i}">보기</button></td>
        </tr>`).join('');

    body.querySelectorAll('[data-ci]').forEach(btn => {
        btn.addEventListener('click', () => viewCode(parseInt(btn.dataset.ci)));
    });
}

function viewCode(idx) {
    const r = App.records[idx];
    if (!r || !r.code) return toast('코드 없음', 'fail');
    const modal = el('codeModal');
    const code = el('modalCode');
    if (!modal || !code) return;
    code.textContent = r.code;
    modal.style.display = 'flex';
    if (typeof hljs !== 'undefined') hljs.highlightElement(code);
}

function closeModal() {
    const m = el('codeModal');
    if (m) m.style.display = 'none';
}

function exportCSV() {
    if (!App.records.length) return toast('내보낼 기록이 없습니다', 'fail');
    const h = ['시간', '학생ID', '학생명', '반', '저장소', '문제', '결과', '점수', '만점'];
    const rows = App.records.map(r => [r.timestamp, r.studentId, r.studentName, r.classId, r.repo, r.problem, r.result, r.score, r.maxScore]);
    const csv = [h, ...rows].map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `gitco_records_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('CSV 다운로드 완료', 'ok');
}

// --- 스튜디오 ---
function updatePreview() {
    const title = val('stTitle') || '제목 없음';
    const score = val('stScore') || '10';
    const diff = val('stDiff') || '보통';
    const time = val('stTime') || '0';
    const desc = el('stDesc') ? el('stDesc').value.trim() : '';
    const inEx = val('stInEx');
    const outEx = val('stOutEx');
    const answer = el('stAnswer') ? el('stAnswer').value.trim() : '';
    const template = el('stTemplate') ? el('stTemplate').value.trim() : '# 여기에 코드를 작성하세요';

    let py = `# 문제: ${title}\n# 점수: ${score}\n# 난이도: ${diff}\n# 시간제한: ${time}\n`;
    if (inEx) py += `# 입력예시: ${inEx}\n`;
    if (outEx) py += `# 출력예시: ${outEx}\n`;
    py += `# 설명:\n`;
    (desc || '설명 없음').split('\n').forEach(l => py += `# ${l}\n`);
    py += `\n# ===학생코드===\n${template || '# 여기에 코드를 작성하세요'}\n\n# ===정답코드===\n${answer || '# 정답 코드'}\n`;

    const prev = el('stPreview');
    if (prev) prev.textContent = py;

    let md = desc || '';
    if (inEx) md += `\n\n**입력 예시:** \`${inEx}\``;
    if (outEx) md += `\n\n**출력 예시:** \`${outEx}\``;
    const ren = el('stRender');
    if (ren) ren.innerHTML = mdRender(md);
}

function downloadPy() {
    updatePreview();
    const content = el('stPreview') ? el('stPreview').textContent : '';
    if (!content) return;
    const title = (val('stTitle') || 'problem').replace(/[^A-Za-z0-9가-힣_-]/g, '_');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title}.py`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('.py 파일 다운로드 완료', 'ok');
}

// --- 관리자 ---
async function adminLogin() {
    const pw = val('inAdminPw');
    if (!pw) return toast('비밀번호를 입력하세요', 'fail');

    let success = false;

    if (App.config.appsUrl) {
        try {
            const hash = await sha256(pw);
            // JSONP로 로그인 시도
            const res = await new Promise((resolve, reject) => {
                const cb = `_gitco_cb_${Date.now()}`;
                const s = document.createElement('script');
                window[cb] = d => { delete window[cb]; s.remove(); resolve(d); };
                s.onerror = () => { delete window[cb]; s.remove(); reject(new Error('연결 실패')); };
                s.src = `${App.config.appsUrl}?action=loginTeacher&data=${encodeURIComponent(JSON.stringify({ passwordHash: hash }))}&callback=${cb}`;
                document.body.appendChild(s);
            });
            success = res && res.success;
            if (!success) return toast(res.error || '비밀번호 오류', 'fail');
        } catch (e) {
            // 오프라인이면 기본 비밀번호로 fallback
            if (pw !== 'admin') return toast('비밀번호 오류 (오프라인: admin)', 'fail');
            success = true;
        }
    } else {
        if (pw !== 'admin') return toast('비밀번호 오류 (기본값: admin)', 'fail');
        success = true;
    }

    if (success) {
        App.session = { role: 'teacher', userId: 'teacher', userName: '선생님', classId: '' };
        updateSessionUI();
        show('adminPanel');
        el('btnAdminLogin').disabled = true;
        toast('관리자 로그인 성공', 'ok');
    }
}

async function changeTeacherPw() {
    const pw = val('inNewPw');
    if (!pw) return toast('새 비밀번호를 입력하세요', 'fail');
    const hash = await sha256(pw);
    if (App.config.appsUrl) {
        try {
            await fetch(App.config.appsUrl, {
                method: 'POST', mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action: 'changeTeacherPassword', passwordHash: hash })
            });
        } catch {}
    }
    toast('비밀번호 변경 완료 (서버 반영까지 잠시 걸릴 수 있습니다)', 'ok');
    setVal('inNewPw', '');
}

async function addStudent() {
    const id = prompt('학번/아이디 입력');
    if (!id) return;
    const name = prompt('이름') || '';
    const cls = prompt('반') || '기본';
    const pw = prompt('초기 비밀번호') || '';
    if (!pw) return toast('비밀번호는 필수입니다', 'fail');
    const hash = await sha256(pw);
    if (App.config.appsUrl) {
        try {
            await fetch(App.config.appsUrl, {
                method: 'POST', mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action: 'addStudent', userId: id, name, classId: cls, passwordHash: hash })
            });
        } catch {}
    }
    toast(`${id} 학생 추가 완료 (서버 반영까지 잠시 걸릴 수 있습니다)`, 'ok');
}

async function generateAccounts() {
    const cls = prompt('반 이름', '1학년1반') || '';
    const prefix = prompt('학번 접두사', '1A') || '';
    const count = parseInt(prompt('학생 수', '25') || '0');
    const start = parseInt(prompt('시작 번호', '1') || '1');
    if (!cls || !prefix || !count) return toast('모든 항목을 입력하세요', 'fail');

    if (App.config.appsUrl) {
        try {
            const res = await new Promise((resolve, reject) => {
                const cb = `_gitco_gen_${Date.now()}`;
                const s = document.createElement('script');
                window[cb] = d => { delete window[cb]; s.remove(); resolve(d); };
                s.onerror = () => { delete window[cb]; s.remove(); reject(new Error('연결 실패')); };
                const d = encodeURIComponent(JSON.stringify({ classId: cls, prefix, count, startNo: start }));
                s.src = `${App.config.appsUrl}?action=generateAccounts&data=${d}&callback=${cb}`;
                document.body.appendChild(s);
            });
            if (res && res.accounts) {
                const txt = res.accounts.map(a => `${a.userId} / ${a.password}`).join('\n');
                const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `accounts_${cls}.txt`;
                a.click();
                URL.revokeObjectURL(a.href);
                toast(`${res.accounts.length}개 계정 생성 완료, txt 파일로 다운로드됨`, 'ok');
                return;
            }
        } catch (e) {
            toast('연결 실패: ' + e.message, 'fail');
        }
    } else {
        toast('Apps Script URL을 먼저 설정하세요', 'fail');
    }
}

// --- 학생 로그인 ---
async function studentLogin() {
    const id = val('inStudentId');
    const pw = val('inStudentPw');
    const cls = val('inStudentClass') || '미지정';
    if (!id || !pw) return toast('학생 ID와 비밀번호를 입력하세요', 'fail');

    if (App.config.appsUrl) {
        try {
            const hash = await sha256(pw);
            const res = await new Promise((resolve, reject) => {
                const cb = `_gitco_login_${Date.now()}`;
                const s = document.createElement('script');
                window[cb] = d => { delete window[cb]; s.remove(); resolve(d); };
                s.onerror = () => { delete window[cb]; s.remove(); reject(new Error('서버 연결 실패')); };
                const d = encodeURIComponent(JSON.stringify({ userId: id, passwordHash: hash, classId: cls }));
                s.src = `${App.config.appsUrl}?action=loginStudent&data=${d}&callback=${cb}`;
                document.body.appendChild(s);
            });
            if (res && res.success) {
                App.session = { role: 'student', userId: res.userId || id, userName: res.name || id, classId: res.classId || cls };
                updateSessionUI();
                toast(`${App.session.userName}님, 환영합니다!`, 'ok');
                return;
            } else {
                toast(res?.error || '로그인 실패', 'fail');
                return;
            }
        } catch (e) {
            toast('서버 연결 실패, 로컬 모드로 진행합니다', 'fail');
        }
    }

    // 오프라인 fallback
    App.session = { role: 'student', userId: id, userName: id, classId: cls };
    updateSessionUI();
    toast(`${id}님 (로컬 모드)`, 'ok');
}

function guestLogin() {
    App.session = { role: 'guest', userId: `guest_${Date.now().toString(36)}`, userName: '게스트', classId: '미지정' };
    updateSessionUI();
    toast('게스트 모드로 시작합니다 (기록은 저장되지 않습니다)', 'fail');
}

function logout() {
    App.session = { role: 'guest', userId: '', userName: '게스트', classId: '' };
    updateSessionUI();
    toast('로그아웃했습니다', 'ok');
}

// --- 이벤트 바인딩 ---
function bindEvents() {
    // 네비게이션
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => switchPage(btn.dataset.page));
    });

    // 헤더
    const logoutBtn = el('btnLogout');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    // 학습 - 저장소
    const btnSearch = el('btnSearch');
    const btnLoadDirect = el('btnLoadDirect');
    const btnLoadSelected = el('btnLoadSelected');
    if (btnSearch) btnSearch.addEventListener('click', searchRepos);
    if (btnLoadDirect) btnLoadDirect.addEventListener('click', loadDirect);
    if (btnLoadSelected) btnLoadSelected.addEventListener('click', loadSelectedRepo);

    // 학습 - 로그인
    const btnSL = el('btnStudentLogin');
    const btnG = el('btnGuest');
    if (btnSL) btnSL.addEventListener('click', studentLogin);
    if (btnG) btnG.addEventListener('click', guestLogin);

    // 기록
    const btnExport = el('btnExportCSV');
    const srch = el('inRecordSearch');
    if (btnExport) btnExport.addEventListener('click', exportCSV);
    if (srch) srch.addEventListener('input', filterRecords);

    // 스튜디오
    ['stTitle','stScore','stDiff','stTime','stDesc','stInEx','stOutEx','stAnswer','stTemplate'].forEach(id => {
        const e = el(id);
        if (e) e.addEventListener('input', updatePreview);
    });
    const btnDownload = el('btnDownload');
    if (btnDownload) btnDownload.addEventListener('click', downloadPy);

    // 관리
    const btnSaveCfg = el('btnSaveCfg');
    const btnAdminLogin = el('btnAdminLogin');
    const btnAddStudent = el('btnAddStudent');
    const btnGenAccounts = el('btnGenAccounts');
    const btnChangePw = el('btnChangePw');
    if (btnSaveCfg) btnSaveCfg.addEventListener('click', saveConfig);
    if (btnAdminLogin) btnAdminLogin.addEventListener('click', adminLogin);
    if (btnAddStudent) btnAddStudent.addEventListener('click', addStudent);
    if (btnGenAccounts) btnGenAccounts.addEventListener('click', generateAccounts);
    if (btnChangePw) btnChangePw.addEventListener('click', changeTeacherPw);

    // 모달
    const btnClose = el('btnCloseModal');
    const codeModal = el('codeModal');
    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (codeModal) codeModal.addEventListener('click', e => { if (e.target === codeModal) closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}

// --- 앱 초기화 ---
document.addEventListener('DOMContentLoaded', () => {
    loadConfig();
    bindEvents();
    updateSessionUI();
    updatePreview();
    loadRecords();
    initPyodide();
});
