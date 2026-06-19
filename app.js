// ============================================
// GitCo - 완전 통합 (복붙용)
// ============================================

// --- 상태 ---
const state = {
    config: { appsUrl: '', defaultRepo: '' },
    session: { role: 'guest', userId: '', userName: '게스트', classId: '' },
    repo: { owner: '', repo: '', branch: 'main', folder: 'problems', libFolder: 'libraries', repos: [], problems: [], current: null },
    records: [],
    pyodide: null,
    pyodideReady: false,
    studentRecords: [],
    allRecords: []
};

// --- DOM 헬퍼 ---
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

function show(el) { const e = typeof el === 'string' ? $(el) : el; if (e) e.classList.remove('hidden'); }
function hide(el) { const e = typeof el === 'string' ? $(el) : el; if (e) e.classList.add('hidden'); }

function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    const c = $('#toastContainer');
    c.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

function showLoading(t = '처리 중...') { $('#loadingText').textContent = t; show('#loadingOverlay'); }
function hideLoading() { hide('#loadingOverlay'); }

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function formatTime(s) {
    s = Math.max(0, parseInt(s) || 0);
    return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}

function btoaU(s) { return btoa(new TextEncoder().encode(s).reduce((a, b) => a + String.fromCharCode(b), '')); }
function atobU(s) {
    try { return new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0))); } catch { return atob(s); }
}

async function sha256(text) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
}

function mdRender(text) {
    let t = String(text || '');
    t = t.replace(/\[이미지:\s*(https?:\/\/[^\]]+)\]/gi, '<img src="$1" alt="img" loading="lazy" style="max-width:100%">');
    if (typeof marked !== 'undefined') {
        try { t = marked.parse(t, { breaks: true, gfm: true }); } catch {}
    } else { t = t.replace(/\n/g, '<br>'); }
    return t;
}

function parseRepo(s) {
    const raw = String(s || '').trim();
    const m = raw.match(/github\.com\/([^/]+)\/([^/]+)/i);
    if (m) return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
    const p = raw.split('/').filter(Boolean);
    if (p.length >= 2) return { owner: p[0], repo: p[1].replace(/\.git$/, '') };
    return null;
}

// --- 토큰 (localStorage에 저장/로드) ---
function getToken() { return localStorage.getItem('gitco_token') || $('#repoToken').value.trim(); }
function setToken(t) { localStorage.setItem('gitco_token', t || ''); }

// --- 설정 ---
function saveConfig() {
    state.config.appsUrl = $('#cfgAppsUrl').value.trim();
    state.config.defaultRepo = $('#cfgDefaultRepo').value.trim();
    localStorage.setItem('gitco_config', JSON.stringify(state.config));
    toast('설정 저장 완료', 'success');
}
function loadConfig() {
    try {
        const c = JSON.parse(localStorage.getItem('gitco_config') || '{}');
        state.config = { ...{ appsUrl: '', defaultRepo: '' }, ...c };
    } catch {}
    $('#cfgAppsUrl').value = state.config.appsUrl;
    $('#cfgDefaultRepo').value = state.config.defaultRepo;
}

// --- 페이지 전환 ---
function switchPage(page) {
    $$('.page').forEach(p => p.classList.remove('active'));
    $(`#page-${page}`).classList.add('active');
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
}

// --- GitHub API (토큰 없어도 공개 저장소 접근 가능) ---
const GitHub = {
    base: 'https://api.github.com',
    async request(path, token = '') {
        const headers = { Accept: 'application/vnd.github+json' };
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(`${this.base}${path}`, { headers });
        const txt = await res.text();
        if (!res.ok) throw new Error(`GitHub 오류: ${txt || res.status}`);
        return txt ? JSON.parse(txt) : null;
    },
    async searchRepos(query, token) {
        const data = await this.request(`/search/repositories?q=${encodeURIComponent(query)}&per_page=30&sort=stars&order=desc`, token);
        return data.items || [];
    },
    async listUserRepos(username, token) {
        if (token) return await this.request('/user/repos?per_page=100&visibility=all&sort=updated', token);
        return await this.request(`/users/${encodeURIComponent(username)}/repos?per_page=100&type=owner&sort=updated`);
    },
    async listContents(owner, repo, path = '', branch = '', token) {
        const ref = branch ? `?ref=${encodeURIComponent(branch)}` : '';
        const p = path ? '/' + path.split('/').map(encodeURIComponent).join('/') : '';
        return await this.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents${p}${ref}`, token);
    },
    async fetchFile(owner, repo, path, branch, token) {
        const data = await this.listContents(owner, repo, path, branch, token);
        if (Array.isArray(data)) throw new Error('파일이 아닙니다');
        if (data.content) return atobU(data.content);
        if (data.download_url) {
            const r = await fetch(data.download_url);
            return await r.text();
        }
        throw new Error('파일을 읽을 수 없습니다');
    },
    async walkPyFiles(owner, repo, path, branch, token, acc = []) {
        let items = await this.listContents(owner, repo, path, branch, token);
        if (!Array.isArray(items)) items = [items];
        for (const item of items) {
            if (item.type === 'file' && item.name.endsWith('.py')) acc.push(item);
            else if (item.type === 'dir') await this.walkPyFiles(owner, repo, item.path, branch, token, acc);
        }
        return acc;
    },
    async getDefaultBranch(owner, repo, token) {
        try {
            const info = await this.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, token);
            return info.default_branch || 'main';
        } catch { return 'main'; }
    }
};

// --- Pyodide ---
async function initPyodide() {
    if (state.pyodide) return;
    try {
        state.pyodide = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.0/full/' });
        state.pyodideReady = true;
        toast('Python 실행 준비 완료', 'success');
    } catch (e) {
        toast('Python 로딩 실패: ' + e.message, 'error');
    }
}

async function runPython(code, inputText = '', timeout = 10000) {
    if (!state.pyodide) await initPyodide();
    const py = state.pyodide;
    const wrapped = `
import sys, io
_old_out, _old_err = sys.stdout, sys.stderr
_old_in = sys.stdin
_out, _err = io.StringIO(), io.StringIO()
sys.stdout, sys.stderr = _out, _err
sys.stdin = io.StringIO(${JSON.stringify(inputText || '')})
try:
    exec(compile(${JSON.stringify(code)}, '<code>', 'exec'), {}, {})
except Exception:
    import traceback; traceback.print_exc()
sys.stdout, sys.stderr = _old_out, _old_err
sys.stdin = _old_in
_out.getvalue(), _err.getvalue()
`;
    const res = await Promise.race([
        py.runPythonAsync(wrapped),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`실행 시간 초과 (${timeout/1000}초)`)), timeout))
    ]);
    return { stdout: String(res[0] || ''), stderr: String(res[1] || '') };
}

async function loadLibraries(owner, repo, folder, branch, token) {
    if (!folder || !owner || !repo) return;
    try {
        const files = await GitHub.walkPyFiles(owner, repo, folder, branch, token);
        for (const file of files) {
            const code = await GitHub.fetchFile(owner, repo, file.path, branch, token);
            const name = file.name.replace(/\.py$/i, '').replace(/[^A-Za-z0-9_]/g, '_');
            if (name && state.pyodide) {
                state.pyodide.runPython(`
import sys, types
_m = types.ModuleType(${JSON.stringify(name)})
exec(compile(${JSON.stringify(code)}, '<${name}>', 'exec'), _m.__dict__)
sys.modules[${JSON.stringify(name)}] = _m
`);
            }
        }
    } catch {}
}

// --- 문제 파싱 ---
function parseProblem(path, content) {
    const lines = String(content || '').split('\n');
    const meta = {
        path, title: '', score: 10, difficulty: '보통',
        timeLimit: 0, inputEx: '', outputEx: '',
        description: '', answerCode: '', templateCode: '',
        libraries: ''
    };
    let inDesc = false;
    for (const l of lines) {
        const t = l.trim();
        if (t === '# ===학생코드===' || t === '# ===정답코드===') break;
        if (inDesc) {
            if (t.startsWith('#')) { meta.description += '\n' + t.replace(/^#\s?/, ''); continue; }
            else inDesc = false;
        }
        if (!t.startsWith('#')) continue;
        const raw = t.replace(/^#\s?/, '');
        const idx = raw.indexOf(':');
        if (idx < 0) continue;
        const k = raw.slice(0, idx).trim(), v = raw.slice(idx + 1).trim();
        switch (k) {
            case '문제': meta.title = v; break;
            case '점수': meta.score = parseInt(v) || 10; break;
            case '난이도': meta.difficulty = v; break;
            case '시간제한': meta.timeLimit = parseInt(v) || 0; break;
            case '입력예시': meta.inputEx = v; break;
            case '출력예시': meta.outputEx = v; break;
            case '라이브러리': meta.libraries = v; break;
            case '설명': meta.description = v; inDesc = true; break;
        }
    }
    const sm = lines.findIndex(l => l.trim() === '# ===학생코드===');
    const am = lines.findIndex(l => l.trim() === '# ===정답코드===');
    if (sm >= 0) meta.templateCode = lines.slice(sm + 1, am > sm ? am : lines.length).join('\n').trim();
    if (am >= 0) meta.answerCode = lines.slice(am + 1).join('\n').trim();
    if (!meta.templateCode) meta.templateCode = '# 여기에 코드를 작성하세요';
    if (!meta.answerCode) meta.answerCode = meta.templateCode;
    if (!meta.title) meta.title = path.split('/').pop().replace('.py', '');
    return meta;
}

// --- 저장소 검색/로드 ---
async function searchRepos() {
    const query = $('#repoQuery').value.trim();
    const token = getToken();
    if (!query) return toast('사용자명 또는 검색어를 입력하세요', 'warning');
    showLoading('저장소 검색 중...');
    try {
        let repos;
        if (token) repos = await GitHub.listUserRepos(query, token);
        else repos = await GitHub.searchRepos(query, token);
        state.repo.repos = repos;
        const sel = $('#repoSelect');
        sel.innerHTML = '';
        sel.disabled = false;
        if (!repos.length) {
            sel.innerHTML = '<option value="">결과 없음</option>';
            toast('검색 결과가 없습니다', 'warning');
        } else {
            repos.forEach(r => {
                const o = document.createElement('option');
                o.value = r.full_name;
                o.dataset.owner = r.owner.login;
                o.dataset.repo = r.name;
                o.dataset.branch = r.default_branch || 'main';
                o.textContent = `${r.full_name} ${r.private ? '(private)' : '(public)'}`;
                sel.appendChild(o);
            });
            toast(`${repos.length}개 저장소 발견`, 'success');
            $('#btnLoadSelected').disabled = false;
        }
        hideLoading();
    } catch (e) { hideLoading(); toast('검색 실패: ' + e.message, 'error'); }
}

async function loadDirect() {
    const input = $('#repoDirect').value.trim();
    const p = parseRepo(input);
    if (!p) return toast('owner/repo 또는 GitHub URL 형식으로 입력하세요', 'warning');
    const token = getToken();
    const branch = await GitHub.getDefaultBranch(p.owner, p.repo, token);
    const folder = $('#repoFolder').value.trim() || 'problems';
    const libFolder = $('#libFolder').value.trim() || 'libraries';
    await loadRepo(p.owner, p.repo, branch, folder, libFolder, token);
}

async function loadSelected() {
    const sel = $('#repoSelect');
    const opt = sel.options[sel.selectedIndex];
    if (!opt || !opt.dataset.owner) return toast('저장소를 선택하세요', 'warning');
    const token = getToken();
    const branch = $('#repoFolder').value.trim() ? (opt.dataset.branch || 'main') : opt.dataset.branch || 'main';
    const folder = $('#repoFolder').value.trim() || 'problems';
    const libFolder = $('#libFolder').value.trim() || 'libraries';
    state.repo.branch = branch;
    await loadRepo(opt.dataset.owner, opt.dataset.repo, branch, folder, libFolder, token);
}

async function loadRepo(owner, repo, branch, folder, libFolder, token) {
    showLoading('문제 불러오는 중...');
    try {
        await initPyodide();
        await loadLibraries(owner, repo, libFolder, branch, token);
        state.repo.owner = owner; state.repo.repo = repo; state.repo.folder = folder;
        const files = await GitHub.walkPyFiles(owner, repo, folder, branch, token);
        const problems = [];
        for (const f of files) {
            const content = await GitHub.fetchFile(owner, repo, f.path, branch, token);
            const meta = parseProblem(f.path, content);
            meta.repo = `${owner}/${repo}`;
            meta.branch = branch;
            problems.push(meta);
        }
        state.repo.problems = problems;
        renderProblemList();
        hideLoading();
        toast(`${problems.length}개 문제 로드 완료`, 'success');
    } catch (e) { hideLoading(); toast('로드 실패: ' + e.message, 'error'); }
}

function renderProblemList() {
    const list = $('#problemList');
    const count = $('#problemCount');
    const ps = state.repo.problems;
    if (!ps || !ps.length) {
        list.innerHTML = '<p class="empty-text">문제가 없습니다</p>';
        list.classList.add('empty');
        count.textContent = '';
        return;
    }
    list.classList.remove('empty');
    count.textContent = `총 ${ps.length}개 문제`;
    list.innerHTML = ps.map((p, i) => {
        const active = state.repo.current && state.repo.current.path === p.path ? 'active' : '';
        const diffClass = p.difficulty === '쉬움' ? 'badge-easy' : p.difficulty === '어려움' ? 'badge-hard' : 'badge-medium';
        return `<div class="problem-item ${active}" data-idx="${i}">
            <span class="title">${esc(p.title)}</span>
            <span class="score">${p.score}점</span>
            <span class="badge ${diffClass}">${esc(p.difficulty)}</span>
        </div>`;
    }).join('');
    $$('.problem-item').forEach(el => {
        el.onclick = () => selectProblem(parseInt(el.dataset.idx));
    });
}

function selectProblem(idx) {
    const p = state.repo.problems[idx];
    if (!p) return;
    state.repo.current = p;
    renderProblemList();
    renderProblemDetail(p);
}

function renderProblemDetail(p) {
    const area = $('#detailArea');
    const tl = p.timeLimit || '제한 없음';
    area.innerHTML = `
        <div class="problem-header">
            <h2>${esc(p.title)}</h2>
            <div class="meta-info">점수: ${p.score} · 난이도: ${esc(p.difficulty)} · 시간: ${tl}</div>
        </div>
        <div class="problem-desc">${mdRender(p.description)}</div>
        <div class="form-group">
            <label>입력</label>
            <textarea id="codeInput" class="input" rows="2">${esc(p.inputEx)}</textarea>
        </div>
        <div class="form-group">
            <label>Python 코드</label>
            <textarea id="codeEditor" class="textarea code-area" rows="12">${esc(p.templateCode)}</textarea>
        </div>
        <div class="btn-row">
            <button id="btnRun" class="btn">▶ 실행</button>
            <button id="btnSubmit" class="btn btn-primary" ${state.session.role === 'guest' ? 'disabled' : ''}>✅ 제출</button>
        </div>
        <div class="output-box">
            <div class="output-title">출력</div>
            <pre id="outputArea" class="output-content"></pre>
        </div>
        <div class="timer-display" id="timerDisplay"></div>
    `;
    $('#btnRun').onclick = () => runCode(false);
    $('#btnSubmit').onclick = () => submitCode();
    $('#codeEditor').addEventListener('keydown', e => {
        if (e.key === 'Tab') { e.preventDefault();
            const t = e.target; const s = t.selectionStart;
            t.value = t.value.substring(0, s) + '    ' + t.value.substring(t.selectionEnd);
            t.selectionStart = t.selectionEnd = s + 4; }
    });
}

let timerInterval = null;
function startTimer(limit) {
    stopTimer();
    if (!limit) { $('#timerDisplay').textContent = '시간 제한 없음'; return; }
    let remaining = limit;
    $('#timerDisplay').textContent = `남은 시간: ${formatTime(remaining)}`;
    timerInterval = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(timerInterval);
            timerInterval = null;
            $('#timerDisplay').textContent = '⏰ 시간 초과!';
            submitCode();
        } else {
            $('#timerDisplay').textContent = `남은 시간: ${formatTime(remaining)}`;
        }
    }, 1000);
}
function stopTimer() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } }

async function runCode() {
    const p = state.repo.current;
    if (!p) return;
    const code = $('#codeEditor').value;
    const input = $('#codeInput').value;
    const timeout = (p.timeLimit || 300) * 1000;
    $('#outputArea').textContent = '실행 중...';
    try {
        const r = await runPython(code, input, timeout);
        const out = r.stdout.trim() || '(출력 없음)';
        const err = r.stderr.trim();
        $('#outputArea').textContent = err ? out + '\n[오류]\n' + err : out;
        $('#outputArea').className = 'output-content' + (err ? ' error' : ' success');
    } catch (e) {
        $('#outputArea').textContent = e.message;
        $('#outputArea').className = 'output-content error';
    }
}

async function submitCode() {
    const p = state.repo.current;
    if (!p) return;
    if (state.session.role === 'guest') return toast('게스트는 제출할 수 없습니다', 'warning');
    const code = $('#codeEditor').value;
    const input = $('#codeInput').value;
    const timeout = (p.timeLimit || 300) * 1000;
    stopTimer();
    $('#outputArea').textContent = '채점 중...';

    try {
        // 학생 코드 실행
        const studentResult = await runPython(code, input, timeout);
        const studentOut = studentResult.stdout.trim();

        // 정답 코드 실행
        const answerResult = await runPython(p.answerCode, input, timeout);
        const answerOut = answerResult.stdout.trim();

        // 비교
        const correct = studentOut === answerOut;
        const score = correct ? p.score : 0;

        // 결과 표시
        if (correct) {
            $('#outputArea').textContent = `✅ 정답! (+${score}점)\n${studentOut || '(출력 없음)'}`;
            $('#outputArea').className = 'output-content success';
            toast('정답입니다!', 'success');
        } else {
            $('#outputArea').textContent = `❌ 오답\n\n내 출력:\n${studentOut || '(없음)'}\n\n기대 출력:\n${answerOut || '(없음)'}`;
            $('#outputArea').className = 'output-content error';
            toast('오답입니다', 'warning');
        }

        // 기록 저장
        await saveRecord(p, code, correct, score, studentOut, answerOut);

    } catch (e) {
        $('#outputArea').textContent = '채점 오류: ' + e.message;
        $('#outputArea').className = 'output-content error';
    }
}

async function saveRecord(problem, code, correct, score, studentOut, answerOut) {
    const record = {
        timestamp: new Date().toISOString(),
        studentId: state.session.userId,
        studentName: state.session.userName,
        classId: state.session.classId || '미지정',
        repo: problem.repo || `${state.repo.owner}/${state.repo.repo}`,
        branch: problem.branch || state.repo.branch,
        problem: problem.title,
        problemPath: problem.path,
        result: correct ? 'correct' : 'wrong',
        score, maxScore: problem.score, code, studentOut, answerOut,
        elapsed: 0
    };

    // 로컬 저장
    state.records.unshift(record);
    localStorage.setItem('gitco_records', JSON.stringify(state.records));

    // Apps Script로 전송
    if (state.config.appsUrl) {
        try {
            await fetch(state.config.appsUrl, {
                method: 'POST', mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action: 'submit', ...record })
            });
        } catch {}
    }
}

// --- 기록 ---
function loadRecords() {
    try { state.records = JSON.parse(localStorage.getItem('gitco_records') || '[]'); } catch { state.records = []; }
    filterRecords();
}
function filterRecords() {
    const q = ($('#recordSearch').value || '').toLowerCase();
    const filtered = state.records.filter(r =>
        !q || r.studentId?.toLowerCase().includes(q) || r.problem?.toLowerCase().includes(q)
    );
    renderRecords(filtered);
}
function renderRecords(records) {
    const body = $('#recordsBody');
    if (!records.length) {
        body.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text3)">기록 없음</td></tr>';
        $('#recordStats').innerHTML = '<span>0</span> 기록';
        return;
    }
    const total = records.length;
    const corrects = records.filter(r => r.result === 'correct').length;
    const rate = total ? Math.round(corrects/total*100) : 0;
    $('#recordStats').innerHTML = `<span>${total}</span> 제출 · <span>${corrects}</span> 정답 · <span>${rate}%</span> 정답률`;
    body.innerHTML = records.slice(0, 200).map((r, i) => `
        <tr>
            <td>${new Date(r.timestamp).toLocaleString('ko-KR')}</td>
            <td>${esc(r.studentName || r.studentId)}</td>
            <td>${esc(r.repo || '-')}</td>
            <td>${esc(r.problem)}</td>
            <td style="color:${r.result === 'correct' ? 'var(--green)' : 'var(--red)'}">${r.result === 'correct' ? '✅ 정답' : '❌ 오답'}</td>
            <td>${r.score}/${r.maxScore}</td>
            <td>${formatTime(r.elapsed)}</td>
            <td><button class="btn btn-sm" onclick="viewCode(${i})">보기</button></td>
        </tr>
    `).join('');
}
function viewCode(idx) {
    const r = state.records[idx];
    if (!r || !r.code) return toast('코드 없음', 'warning');
    $('#codeContent').textContent = r.code;
    show('#codeModal');
    if (typeof hljs !== 'undefined') hljs.highlightElement($('#codeContent'));
}
function closeModal() { hide('#codeModal'); }

function exportCSV() {
    const r = state.records;
    if (!r.length) return toast('내보낼 기록 없음', 'warning');
    const h = ['시간', '학생ID', '반', '저장소', '문제', '결과', '점수', '만점', '소요시간'];
    const rows = r.map(r => [r.timestamp, r.studentId, r.classId, r.repo, r.problem, r.result, r.score, r.maxScore, r.elapsed]);
    const csv = [h, ...rows].map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const b = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = `gitco_records_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('CSV 다운로드 완료', 'success');
}

// --- 스튜디오 ---
function updateStudioPreview() {
    const title = $('#studioTitle').value.trim() || '제목';
    const score = $('#studioScore').value || 10;
    const diff = $('#studioDifficulty').value;
    const desc = $('#studioDescription').value.trim();
    const inputEx = $('#studioInput').value.trim();
    const outputEx = $('#studioOutput').value.trim();
    const answer = $('#studioAnswer').value.trim() || 'print()';
    const template = $('#studioTemplate').value.trim() || '# 여기에 코드를 작성하세요';

    let py = '';
    py += `# 문제: ${title}\n`;
    py += `# 점수: ${score}\n`;
    py += `# 난이도: ${diff}\n`;
    if (inputEx) py += `# 입력예시: ${inputEx}\n`;
    if (outputEx) py += `# 출력예시: ${outputEx}\n`;
    py += `# 설명:\n`;
    if (desc) desc.split('\n').forEach(l => py += `# ${l}\n`);
    else py += `# 설명 없음\n`;
    py += `\n# ===학생코드===\n${template}\n\n# ===정답코드===\n${answer}\n`;

    $('#studioPreview').textContent = py;
    let md = desc;
    if (inputEx) md += `\n\n**입력 예시:** \`${inputEx}\``;
    if (outputEx) md += `\n\n**출력 예시:** \`${outputEx}\``;
    $('#studioRender').innerHTML = mdRender(md);
}

function downloadPy() {
    const content = $('#studioPreview').textContent;
    if (!content || content === '# 미리보기를 눌러주세요') return updateStudioPreview();
    const title = ($('#studioTitle').value.trim() || 'problem').replace(/[^A-Za-z0-9가-힣_-]/g, '_');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title}.py`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('다운로드 완료', 'success');
}

// --- 관리자 (간소화) ---
async function adminLogin() {
    const pw = $('#adminPw').value.trim();
    if (state.config.appsUrl) {
        try {
            const hash = await sha256(pw);
            const res = await fetch(state.config.appsUrl, {
                method: 'POST', mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action: 'loginTeacher', passwordHash: hash })
            });
            // no-cors라 응답 확인 불가, 일단 성공 가정
        } catch {}
    }
    if (pw === 'admin') {
        state.session = { role: 'teacher', userId: 'teacher', userName: '관리자', classId: '' };
        show('#adminPanel');
        $('#btnAdminLogin').disabled = true;
        toast('관리자 로그인 성공', 'success');
    } else {
        toast('비밀번호가 틀렸습니다', 'error');
    }
}

// --- 이벤트 바인딩 ---
function initEvents() {
    // 페이지 전환
    $$('.nav-btn').forEach(btn => {
        btn.onclick = () => {
            switchPage(btn.dataset.page);
            if (btn.dataset.page === 'records') loadRecords();
        };
    });

    // 학습
    $('#btnSearchRepos').onclick = searchRepos;
    $('#btnLoadDirect').onclick = loadDirect;
    $('#btnLoadSelected').onclick = loadSelected;

    // 기록
    $('#recordSearch').oninput = filterRecords;
    $('#btnExportCSV').onclick = exportCSV;

    // 스튜디오 (실시간 미리보기)
    ['studioTitle','studioScore','studioDifficulty','studioDescription','studioInput','studioOutput','studioAnswer','studioTemplate'].forEach(id => {
        const el = $('#' + id);
        if (el) el.addEventListener('input', updateStudioPreview);
    });
    $('#btnDownloadPy').onclick = downloadPy;

    // 설정
    $('#btnSaveConfig').onclick = saveConfig;

    // 관리자
    $('#btnAdminLogin').onclick = adminLogin;

    // 모달 닫기
    $('#codeModal').addEventListener('click', e => { if (e.target === $('#codeModal')) closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}

// --- 초기화 ---
function init() {
    loadConfig();
    initEvents();
    initPyodide();
    loadRecords();

    // 저장된 토큰 복원
    const savedToken = getToken();
    if (savedToken) $('#repoToken').value = savedToken;

    // 기본 저장소 자동 입력
    if (state.config.defaultRepo) {
        $('#repoDirect').value = state.config.defaultRepo;
    }

    updateStudioPreview();
    toast('GitCo가 준비되었습니다', 'success');
}

document.addEventListener('DOMContentLoaded', init);
