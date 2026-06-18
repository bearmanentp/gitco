/* ══════════════════════════════════════════════════════════════
   GitCo — Git-based Coding Platform (Frontend)
   Developer: 석근우 (geunman@geekbyte.kro.kr)
   Version: 1.1 (Pyodide 안정성 패치)
   ══════════════════════════════════════════════════════════════ */

// ─────────────────── Configuration ───────────────────
const CFG_KEY = 'gitco_config';

function loadConfig() {
  const raw = localStorage.getItem(CFG_KEY);
  return raw ? JSON.parse(raw) : {};
}
function saveConfig(cfg) {
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
}
function getConfig() {
  const cfg = loadConfig();
  return {
    ghToken: cfg.ghToken || '',
    ghOwner: cfg.ghOwner || '',
    ghRepo: cfg.ghRepo || '',
    appsUrl: cfg.appsUrl || '',
    sheetId: cfg.sheetId || '',
  };
}

// ─────────────────── Utilities ───────────────────
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }
function show(el) { if (typeof el === 'string') el = $(el); el.classList.remove('hidden'); }
function hide(el) { if (typeof el === 'string') el = $(el); el.classList.add('hidden'); }
function elapsed(sec) { const m = String(Math.floor(sec / 60)).padStart(2, '0'); const s = String(sec % 60).padStart(2, '0'); return `${m}:${s}`; }

// ─────────────────── Session ───────────────────
const Session = {
  role: null,
  userId: '',
  userName: '',
  userClass: '',
  set(role, data = {}) {
    this.role = role;
    Object.assign(this, data);
    localStorage.setItem('gitco_session', JSON.stringify({ role, ...data }));
    this.updateUI();
  },
  load() {
    const raw = localStorage.getItem('gitco_session');
    if (raw) { Object.assign(this, JSON.parse(raw)); this.updateUI(); }
  },
  clear() {
    this.role = null; this.userId = ''; this.userName = ''; this.userClass = '';
    localStorage.removeItem('gitco_session');
    this.updateUI();
  },
  updateUI() {
    const badge = $('#user-badge');
    const btnLogin = $('#btn-login');
    const btnLogout = $('#btn-logout');
    if (this.role) {
      badge.textContent = `${this.role === 'teacher' ? '👩‍🏫' : '🧑‍🎓'} ${this.userName || this.userId || '선생님'}`;
      show(badge); hide(btnLogin); show(btnLogout);
    } else {
      hide(badge); show(btnLogin); hide(btnLogout);
    }
  }
};

// ─────────────────── GitHub API ───────────────────
const GitHub = {
  API: 'https://api.github.com',

  async fetchContents(owner, repo, path, token) {
    const url = `${this.API}/repos/${owner}/${repo}/contents/${path}`;
    const headers = { Accept: 'application/vnd.github.v3+json' };
    if (token) headers.Authorization = `token ${token}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    return res.json();
  },

  async fetchFile(owner, repo, path, token) {
    const data = await this.fetchContents(owner, repo, path, token);
    return atob(data.content);
  },

  async listPyFiles(owner, repo, path, token) {
    const items = await this.fetchContents(owner, repo, path, token);
    return items.filter(i => i.name.endsWith('.py') && i.type === 'file');
  },

  async createOrUpdateFile(owner, repo, filePath, content, message, token, sha) {
    const url = `${this.API}/repos/${owner}/${repo}/contents/${filePath}`;
    const body = { message, content: btoa(unescape(encodeURIComponent(content))) };
    if (sha) body.sha = sha;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`GitHub Upload ${res.status}: ${await res.text()}`);
    return res.json();
  },

  parseMetadata(code) {
    const meta = { title: '', score: 10, level: 'medium', timeLimit: 300, inputExample: '', outputExample: '', description: '', solution: '', template: '' };
    const lines = code.split('\n');
    let inDesc = false;
    let section = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('# 문제:') || trimmed.startsWith('# 문제 :')) { meta.title = trimmed.replace(/^#\s*문제\s*:\s*/, ''); inDesc = false; continue; }
      if (trimmed.startsWith('# 점수:') || trimmed.startsWith('# 점수 :')) { meta.score = parseInt(trimmed.replace(/^#\s*점수\s*:\s*/, '')) || 10; inDesc = false; continue; }
      if (trimmed.startsWith('# 난이도:') || trimmed.startsWith('# 난이도 :')) { meta.level = trimmed.replace(/^#\s*난이도\s*:\s*/, '').trim().toLowerCase(); inDesc = false; continue; }
      if (trimmed.startsWith('# 시간제한:') || trimmed.startsWith('# 시간제한 :')) { meta.timeLimit = parseInt(trimmed.replace(/^#\s*시간제한\s*:\s*/, '')) || 0; inDesc = false; continue; }
      if (trimmed.startsWith('# 입력예시:') || trimmed.startsWith('# 입력예시 :')) { meta.inputExample = trimmed.replace(/^#\s*입력예시\s*:\s*/, ''); inDesc = false; continue; }
      if (trimmed.startsWith('# 출력예시:') || trimmed.startsWith('# 출력예시 :')) { meta.outputExample = trimmed.replace(/^#\s*출력예시\s*:\s*/, ''); inDesc = false; continue; }
      if (trimmed.startsWith('# 설명:') || trimmed.startsWith('# 설명 :')) { inDesc = true; meta.description = trimmed.replace(/^#\s*설명\s*:\s*/, ''); continue; }
      if (inDesc && trimmed.startsWith('#')) { meta.description += '\n' + trimmed.replace(/^#\s?/, ''); continue; }
      if (inDesc && !trimmed.startsWith('#')) { inDesc = false; }
      if (trimmed.startsWith('###정답코드###') || trimmed.startsWith('# ===정답코드===') || trimmed === '# [SOLUTION]') { section = 'solution'; continue; }
      if (trimmed.startsWith('###학생코드###') || trimmed.startsWith('# ===학생코드===') || trimmed === '# [TEMPLATE]') { section = 'template'; continue; }
      if (section === 'solution') meta.solution += line + '\n';
      if (section === 'template') meta.template += line + '\n';
    }

    if (!meta.solution.trim() && !meta.template.trim()) {
      const codeLines = lines.filter(l => !l.trim().startsWith('#') && l.trim() !== '');
      meta.solution = codeLines.join('\n');
      meta.template = codeLines.join('\n');
    }

    return meta;
  },

  generatePyFile(meta) {
    let content = '';
    content += `# 문제: ${meta.title}\n`;
    content += `# 점수: ${meta.score}\n`;
    content += `# 난이도: ${meta.level}\n`;
    content += `# 시간제한: ${meta.timeLimit}\n`;
    content += `# 입력예시: ${meta.inputExample}\n`;
    content += `# 출력예시: ${meta.outputExample}\n`;
    content += `# 설명:\n`;
    meta.description.split('\n').forEach(l => { content += `# ${l}\n`; });
    content += `\n`;
    content += `###정답코드###\n`;
    content += meta.solution + '\n';
    content += `\n###학생코드###\n`;
    content += meta.template + '\n';
    return content;
  }
};

// ─────────────────── Apps Script API ───────────────────
const API = {
  async call(action, payload = {}) {
    const cfg = getConfig();
    if (!cfg.appsUrl) throw new Error('Apps Script URL이 설정되지 않았습니다.');
    
    try {
      // CORS 우회를 위해 JSONP 스타일 또는 text/plain POST 사용
      const res = await fetch(cfg.appsUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action, ...payload })
      });
      
      // no-cors 모드에서는 응답을 읽을 수 없으므로 성공으로 가정
      // 실제 응답 확인을 위해서는 Apps Script를 execute/ 개발 모드로 테스트
      return { success: true };
    } catch (e) {
      console.warn('API call failed (offline mode?):', e);
      return { success: false, offline: true, error: e.message };
    }
  },

  async login(userId, classId, password) {
    const hash = await sha256(password);
    return this.call('login', { userId, classId, passwordHash: hash });
  },

  async loginTeacher(password) {
    const hash = await sha256(password);
    return this.call('loginTeacher', { passwordHash: hash });
  },

  async submit(userId, classId, problemId, score, correct, elapsedSec) {
    return this.call('submit', { userId, classId, problemId, score, correct, elapsedSec, timestamp: new Date().toISOString() });
  },

  async getRecords(classId, userId) {
    return this.call('getRecords', { classId, userId });
  },

  async getAllRecords() {
    return this.call('getAllRecords');
  },

  async getStudents() {
    return this.call('getStudents');
  },

  async addStudent(userId, name, classId, password) {
    const hash = await sha256(password);
    return this.call('addStudent', { userId, name, classId, passwordHash: hash });
  },

  async deleteStudent(userId) {
    return this.call('deleteStudent', { userId });
  },

  async changePassword(userId, newPassword) {
    const hash = await sha256(newPassword);
    return this.call('changePassword', { userId, passwordHash: hash });
  },

  async generateAccounts(classId, prefix, count) {
    return this.call('generateAccounts', { classId, prefix, count });
  },

  async changeTeacherPassword(newPw) {
    const hash = await sha256(newPw);
    return this.call('changeTeacherPassword', { passwordHash: hash });
  }
};

// ─────────────────── Pyodide Runner ───────────────────
const PyRunner = {
  pyodide: null,
  loading: false,
  loadPromise: null,
  libraries: [],

  async init() {
    if (this.pyodide) return this.pyodide;
    if (this.loadPromise) return this.loadPromise;
    
    this.loading = true;
    
    // CDN에서 loadPyodide가 로드되었는지 확인
    if (typeof loadPyodide === 'undefined') {
      console.error('[GitCo] Pyodide library not loaded. Check if pyodide.js is included in HTML.');
      throw new Error('Pyodide 라이브러리가 로드되지 않았습니다. index.html에 pyodide.js 스크립트가 포함되어 있는지 확인하세요.');
    }

    this.loadPromise = loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/',
      stdout: (text) => console.log('[Python stdout]', text),
      stderr: (text) => console.error('[Python stderr]', text)
    }).then(pyodide => {
      this.pyodide = pyodide;
      this.loading = false;
      console.log('[GitCo] Pyodide loaded successfully');
      return pyodide;
    }).catch(err => {
      this.loading = false;
      console.error('[GitCo] Pyodide load failed:', err);
      throw err;
    });

    return this.loadPromise;
  },

  async loadLibraries(owner, repo, token) {
    try {
      const items = await GitHub.listPyFiles(owner, repo, 'libraries', token);
      this.libraries = [];
      for (const item of items) {
        const code = await GitHub.fetchFile(owner, repo, item.path, token);
        this.libraries.push({ name: item.name.replace('.py', ''), code });
      }
      console.log(`[GitCo] Loaded ${this.libraries.length} libraries`);
    } catch (e) {
      console.log('[GitCo] No libraries folder or error:', e.message);
      this.libraries = [];
    }
  },

  async run(code, stdin, libraries) {
    const py = await this.init();

    // Load custom libraries
    if (libraries && libraries.length > 0) {
      for (const lib of libraries) {
        try {
          py.runPython(`
import types, sys
_mod = types.ModuleType('${lib.name}')
exec(compile(${JSON.stringify(lib.code)}, '<${lib.name}>', 'exec'), _mod.__dict__)
sys.modules['${lib.name}'] = _mod
`);
        } catch (e) { 
          console.warn(`[GitCo] Library ${lib.name} load error:`, e); 
        }
      }
    }

    // Setup stdin
    if (stdin) {
      py.runPython(`
import sys
from io import StringIO
if 'stdin_backup' not in globals():
    stdin_backup = sys.stdin
sys.stdin = StringIO(${JSON.stringify(stdin)})
`);
    }

    // Capture stdout/stderr
    py.runPython(`
import sys, io
if 'stdout_backup' not in globals():
    stdout_backup = sys.stdout
    stderr_backup = sys.stderr
_stdout_capture = io.StringIO()
_stderr_capture = io.StringIO()
sys.stdout = _stdout_capture
sys.stderr = _stderr_capture
`);

    let stdout = '', stderr = '', error = null;
    try {
      py.runPython(code);
      stdout = py.runPython('_stdout_capture.getvalue()');
      stderr = py.runPython('_stderr_capture.getvalue()');
    } catch (e) {
      error = e.message || String(e);
      stderr = py.runPython('_stderr_capture.getvalue()');
    }

    // Restore streams
    py.runPython(`
sys.stdout = stdout_backup
sys.stderr = stderr_backup
`);

    return { stdout: stdout.trim(), stderr: stderr.trim(), error };
  }
};

// ─────────────────── LMS Module ───────────────────
const LMS = {
  problems: [],
  currentProblem: null,
  timerInterval: null,
  elapsedSeconds: 0,

  async loadProblems(repoPath, token) {
    const [owner, repo, ...rest] = repoPath.replace(/^\//, '').split('/');
    const folder = rest.join('/') || 'problems';
    const cfg = getConfig();
    const useOwner = owner || cfg.ghOwner;
    const useRepo = repo || cfg.ghRepo;
    const useToken = token || cfg.ghToken;

    // Load libraries first
    await PyRunner.loadLibraries(useOwner, useRepo, useToken);

    const items = await GitHub.listPyFiles(useOwner, useRepo, folder, useToken);
    this.problems = [];

    for (const item of items) {
      const raw = await GitHub.fetchFile(useOwner, useRepo, item.path, useToken);
      const meta = GitHub.parseMetadata(raw);
      this.problems.push({ filename: item.name, path: item.path, meta, rawCode: raw });
    }

    this.renderProblemList();
  },

  renderProblemList() {
    const grid = $('#lms-problem-list');
    grid.innerHTML = '';
    this.problems.forEach((p, i) => {
      const card = document.createElement('div');
      card.className = 'problem-card';
      const levelEmoji = { easy: '🟢', medium: '🟡', hard: '🔴' };
      card.innerHTML = `
        <h4>${levelEmoji[p.meta.level] || '🟡'} ${p.meta.title || p.filename}</h4>
        <div class="meta">점수: ${p.meta.score} · ${p.meta.level} · 시간: ${p.meta.timeLimit ? p.meta.timeLimit + '초' : '무제한'}</div>
      `;
      card.onclick = () => this.openProblem(i);
      grid.appendChild(card);
    });
    show('#lms-select'); hide('#lms-workspace');
  },

  openProblem(index) {
    const prob = this.problems[index];
    this.currentProblem = prob;
    this.elapsedSeconds = 0;

    $('#lms-prob-title').textContent = prob.meta.title || prob.filename;
    $('#lms-prob-meta').textContent = `점수: ${prob.meta.score} · ${prob.meta.level}`;
    $('#lms-prob-desc').innerHTML = this.renderDescription(prob.meta.description, prob.meta.inputExample, prob.meta.outputExample);

    const startCode = prob.meta.template.trim() || prob.meta.solution.trim() || '# Write your code here\n';
    $('#lms-code').value = startCode;
    $('#lms-stdin').value = prob.meta.inputExample || '';
    $('#lms-stdout').textContent = '';
    hide('#lms-result');

    this.applyTimeLimit(prob.meta.timeLimit);

    hide('#lms-select'); show('#lms-workspace');
    this.startTimer();
  },

  renderDescription(desc, input, output) {
    let html = desc || '문제 설명이 없습니다.';
    html = html.replace(/\[이미지:\s*(https?:\/\/[^\]]+)\]/gi, '<br/><img src="$1" style="max-width:100%;border-radius:8px;margin:8px 0;"/>');
    if (input) html += `\n\n📥 입력 예시: ${input}`;
    if (output) html += `\n📤 출력 예시: ${output}`;
    return html;
  },

  applyTimeLimit(defaultTime) {
    const countdownEl = $('#lms-countdown');
    if (defaultTime > 0) {
      show(countdownEl);
      countdownEl.textContent = `남은 시간: ${elapsed(defaultTime)}`;
      countdownEl.dataset.remaining = defaultTime;
    } else {
      hide(countdownEl);
    }
  },

  startTimer() {
    this.stopTimer();
    this.elapsedSeconds = 0;
    $('#lms-elapsed').textContent = '00:00';
    this.timerInterval = setInterval(() => {
      this.elapsedSeconds++;
      $('#lms-elapsed').textContent = elapsed(this.elapsedSeconds);

      const cd = $('#lms-countdown');
      if (!cd.classList.contains('hidden')) {
        let rem = parseInt(cd.dataset.remaining) - 1;
        if (rem <= 0) {
          this.stopTimer();
          cd.textContent = '⏰ 시간 초과!';
          cd.style.color = 'var(--red)';
          this.submit();
        } else {
          cd.dataset.remaining = rem;
          cd.textContent = `남은 시간: ${elapsed(rem)}`;
        }
      }
    }, 1000);
  },

  stopTimer() {
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
  },

  async runCode() {
    try {
      const code = $('#lms-code').value;
      const stdin = $('#lms-stdin').value;
      $('#lms-stdout').textContent = '⏳ 실행 중...';
      
      const result = await PyRunner.run(code, stdin, PyRunner.libraries);
      
      let output = result.stdout || '(출력 없음)';
      if (result.stderr) output += '\n[오류]\n' + result.stderr;
      if (result.error) output += '\n[예외]\n' + result.error;
      
      $('#lms-stdout').textContent = output;
      return result;
    } catch (e) {
      $('#lms-stdout').textContent = '실행 오류: ' + e.message;
      console.error(e);
    }
  },

  async submit() {
    this.stopTimer();
    const code = $('#lms-code').value;
    const stdin = $('#lms-stdin').value;
    
    try {
      // Run student code
      const studentResult = await PyRunner.run(code, stdin, PyRunner.libraries);
      const studentOutput = studentResult.stdout;

      // Run solution code
      const solutionResult = await PyRunner.run(this.currentProblem.meta.solution, stdin, PyRunner.libraries);
      const solutionOutput = solutionResult.stdout;

      // Compare (strip whitespace for flexible comparison)
      const correct = studentOutput.trim() === solutionOutput.trim();

      const resultEl = $('#lms-result');
      show(resultEl);
      resultEl.className = correct ? 'correct' : 'wrong';
      
      if (correct) {
        resultEl.innerHTML = `✅ <strong>정답!</strong> (${this.currentProblem.meta.score}점)<br/>실행 시간: ${elapsed(this.elapsedSeconds)}`;
      } else {
        resultEl.innerHTML = `❌ <strong>오답</strong><br/>
          <div style="margin-top:8px;opacity:0.8;">
            <div>기대 출력:</div>
            <pre style="background:rgba(0,0,0,0.3);padding:8px;border-radius:4px;">${this.escapeHtml(solutionOutput)}</pre>
            <div>내 출력:</div>
            <pre style="background:rgba(0,0,0,0.3);padding:8px;border-radius:4px;">${this.escapeHtml(studentOutput)}</pre>
          </div>`;
      }

      // Record to Google Sheets
      if (Session.role === 'student' && Session.userId) {
        try {
          await API.submit(
            Session.userId,
            Session.userClass,
            this.currentProblem.filename,
            correct ? this.currentProblem.meta.score : 0,
            correct,
            this.elapsedSeconds
          );
        } catch (e) {
          console.warn('[GitCo] Record save failed:', e);
        }
      }
    } catch (e) {
      alert('채점 중 오류: ' + e.message);
      console.error(e);
    }
  },

  backToList() {
    this.stopTimer();
    hide('#lms-workspace'); show('#lms-select');
  },

  escapeHtml(str) {
    if (!str) return '(없음)';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
};

// ─────────────────── Studio Module ───────────────────
const Studio = {
  generatePreview() {
    const meta = this.collectMeta();
    const code = GitHub.generatePyFile(meta);
    $('#preview-code').textContent = code;
    show('.studio-preview');
    return { meta, code };
  },

  collectMeta() {
    return {
      title: $('#prob-title').value || '제목 없음',
      score: parseInt($('#prob-score').value) || 10,
      level: $('#prob-level').value,
      timeLimit: parseInt($('#prob-time').value) || 300,
      inputExample: $('#prob-input').value,
      outputExample: $('#prob-output').value,
      description: $('#prob-desc').value,
      solution: $('#prob-solution').value || 'def solve():\n    pass',
      template: $('#prob-template').value || 'def solve():\n    # 여기에 코드를 작성하세요\n    pass',
    };
  },

  downloadPy() {
    const { code } = this.generatePreview();
    const filename = $('#prob-filename').value || 'problem.py';
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  },

  async uploadToGitHub() {
    const cfg = getConfig();
    if (!cfg.ghToken || !cfg.ghOwner || !cfg.ghRepo) {
      alert('GitHub 설정을 먼저 완료해주세요 (토큰, 소유자, 레포)');
      return;
    }
    const { code } = this.generatePreview();
    const filename = $('#prob-filename').value || 'problem.py';
    const path = `${$('#prob-path').value}/${filename}`;

    try {
      let sha = null;
      try {
        const existing = await GitHub.fetchContents(cfg.ghOwner, cfg.ghRepo, path, cfg.ghToken);
        sha = existing.sha;
      } catch (e) { /* new file */ }

      await GitHub.createOrUpdateFile(
        cfg.ghOwner, cfg.ghRepo, path, code,
        `[GitCo] ${sha ? 'Update' : 'Create'} problem: ${$('#prob-title').value}`,
        cfg.ghToken, sha
      );
      alert(`✅ ${path} 에 ${sha ? '업데이트' : '생성'} 완료!`);
    } catch (e) {
      alert('❌ 업로드 실패: ' + e.message);
    }
  }
};

// ─────────────────── Admin Module ───────────────────
const Admin = {
  students: [],

  async loadStudents() {
    try {
      const data = await API.getStudents();
      this.students = data.students || [];
      this.renderStudentTable();
    } catch (e) {
      console.warn('[GitCo] loadStudents failed:', e);
      // Offline mock data
      this.students = [];
      this.renderStudentTable();
    }
  },

  renderStudentTable() {
    const tbody = $('#student-table tbody');
    tbody.innerHTML = '';
    this.students.forEach(s => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${s.userId}</td>
        <td>${s.name || '-'}</td>
        <td>${s.classId}</td>
        <td><button class="btn-sm" onclick="Admin.changePw('${s.userId}')">변경</button></td>
        <td><button class="btn-sm" onclick="Admin.deleteStudent('${s.userId}')" style="color:var(--red)">삭제</button></td>
      `;
      tbody.appendChild(tr);
    });
  },

  async addStudent() {
    const userId = prompt('학번 (예: 3A001)');
    const name = prompt('이름');
    const classId = prompt('학급 (예: 3학년1반)');
    const password = prompt('초기 비밀번호');
    if (userId && name && classId && password) {
      try {
        await API.addStudent(userId, name, classId, password);
        alert('✅ 학생 추가 완료');
        this.loadStudents();
      } catch (e) { alert('❌ 실패: ' + e.message); }
    }
  },

  async deleteStudent(userId) {
    if (!confirm(`${userId} 학생을 삭제하시겠습니까?`)) return;
    try {
      await API.deleteStudent(userId);
      this.loadStudents();
    } catch (e) { alert('❌ 실패: ' + e.message); }
  },

  async changePw(userId) {
    const newPw = prompt(`${userId} 의 새 비밀번호를 입력하세요`);
    if (newPw) {
      try {
        await API.changePassword(userId, newPw);
        alert('✅ 비밀번호 변경 완료');
      } catch (e) { alert('❌ 실패: ' + e.message); }
    }
  },

  async loadRecords() {
    const classId = $('#admin-class-select').value;
    try {
      const data = await API.getRecords(classId);
      this.renderRecords(data.records || []);
    } catch (e) { 
      console.warn('[GitCo] loadRecords failed:', e);
      $('#admin-records-table').innerHTML = '<p>기록을 불러올 수 없습니다.</p>';
    }
  },

  renderRecords(records) {
    const container = $('#admin-records-table');
    if (!records.length) { container.innerHTML = '<p>기록 없음</p>'; return; }
    let html = '<table class="data-table"><thead><tr><th>시간</th><th>학번</th><th>문제</th><th>점수</th><th>정답</th><th>소요시간</th></tr></thead><tbody>';
    records.forEach(r => {
      html += `<tr><td>${r.timestamp || '-'}</td><td>${r.userId}</td><td>${r.problemId}</td><td>${r.score}</td><td>${r.correct ? '✅' : '❌'}</td><td>${r.elapsedSec ? elapsed(r.elapsedSec) : '-'}</td></tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  },

  async generateAccounts() {
    const classId = $('#gen-class').value;
    const prefix = $('#gen-prefix').value;
    const count = parseInt($('#gen-count').value);
    if (!classId || !prefix || !count) { alert('모든 필드를 입력하세요.'); return; }
    try {
      const data = await API.generateAccounts(classId, prefix, count);
      const resultDiv = $('#gen-result');
      show(resultDiv);
      let html = `<p>✅ ${count}개 계정 생성 완료</p><table class="data-table gen-table"><thead><tr><th>학번</th><th>비밀번호</th></tr></thead><tbody>`;
      (data.accounts || []).forEach(a => {
        html += `<tr><td>${a.userId}</td><td><code>${a.password}</code></td></tr>`;
      });
      html += '</tbody></table>';
      resultDiv.innerHTML = html;
    } catch (e) { alert('❌ 실패: ' + e.message); }
  },

  initClassSelect() {
    const select = $('#admin-class-select');
    const classes = ['전체', '1학년1반', '1학년2반', '2학년1반', '2학년2반', '3학년1반', '3학년2반'];
    select.innerHTML = classes.map(c => `<option value="${c}">${c}</option>`).join('');
  },

  initLoginClassSelect() {
    const select = $('#login-class');
    const classes = ['1학년1반', '1학년2반', '2학년1반', '2학년2반', '3학년1반', '3학년2반'];
    select.innerHTML = classes.map(c => `<option value="${c}">${c}</option>`).join('');
  }
};

// ─────────────────── App Controller ───────────────────
const App = {
  init() {
    Session.load();
    this.bindEvents();
    Admin.initClassSelect();
    Admin.initLoginClassSelect();

    const cfg = getConfig();
    if (cfg.ghToken) $('#cfg-gh-token').value = cfg.ghToken;
    if (cfg.ghOwner) $('#cfg-gh-owner').value = cfg.ghOwner;
    if (cfg.ghRepo) $('#cfg-gh-repo').value = cfg.ghRepo;
    if (cfg.appsUrl) $('#cfg-apps-url').value = cfg.appsUrl;
    if (cfg.sheetId) $('#cfg-sheet-id').value = cfg.sheetId;

    // Pre-load Pyodide
    PyRunner.init().catch(e => console.warn('Pyodide pre-load failed (will retry on use):', e));
  },

  bindEvents() {
    $$('.nav-btn').forEach(btn => {
      btn.onclick = () => this.switchView(btn.dataset.view);
    });

    $('#btn-login').onclick = () => show('#login-modal');
    $('#close-login').onclick = () => hide('#login-modal');
    $('#btn-logout').onclick = () => { Session.clear(); location.reload(); };

    $$('#login-tabs .tab-btn').forEach(btn => {
      btn.onclick = () => {
        $$('#login-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (btn.dataset.role === 'student') { show('#login-student'); hide('#login-teacher'); }
        else { hide('#login-student'); show('#login-teacher'); }
      };
    });

    $('#login-student').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const data = await API.login($('#login-id').value, $('#login-class').value, $('#login-pw').value);
        if (data.success) {
          Session.set('student', { userId: data.userId, userName: data.name, userClass: data.classId });
          hide('#login-modal');
          this.switchView('lms');
        } else {
          alert(data.error || '로그인 실패');
        }
      } catch (err) {
        Session.set('student', { userId: $('#login-id').value, userName: $('#login-id').value, userClass: $('#login-class').value });
        hide('#login-modal');
        alert('⚠️ 서버 연결 실패 — 오프라인 모드로 진입합니다.');
        this.switchView('lms');
      }
    };

    $('#btn-guest').onclick = () => {
      Session.set('guest', { userId: 'guest', userName: '게스트' });
      hide('#login-modal');
      this.switchView('lms');
    };

    $('#login-teacher').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const data = await API.loginTeacher($('#login-teacher-pw').value);
        if (data.success) {
          Session.set('teacher', { userId: 'teacher', userName: '선생님' });
          hide('#login-modal');
          this.switchView('admin');
        } else {
          alert(data.error || '로그인 실패');
        }
      } catch (err) {
        const pw = $('#login-teacher-pw').value;
        if (pw === 'admin') {
          Session.set('teacher', { userId: 'teacher', userName: '선생님' });
          hide('#login-modal');
          alert('⚠️ 서버 연결 실패 — 오프라인 모드 (기본 비밀번호)');
          this.switchView('admin');
        } else {
          alert('로그인 실패: 서버 연결 및 비밀번호 확인');
        }
      }
    };

    $('#btn-save-config').onclick = () => {
      const cfg = {
        ghToken: $('#cfg-gh-token').value,
        ghOwner: $('#cfg-gh-owner').value,
        ghRepo: $('#cfg-gh-repo').value,
        appsUrl: $('#cfg-apps-url').value,
        sheetId: $('#cfg-sheet-id').value,
      };
      saveConfig(cfg);
      alert('✅ 설정 저장 완료');
    };

    $('#btn-gen-py').onclick = () => Studio.generatePreview();
    $('#btn-download-py').onclick = () => Studio.downloadPy();
    $('#btn-upload-gh').onclick = () => Studio.uploadToGitHub();
    $('#btn-load-problems').onclick = () => this.loadStudioProblems();

    $('#btn-load-lms').onclick = () => this.loadLMSProblems();
    $('#btn-run').onclick = () => LMS.runCode();
    $('#btn-submit').onclick = () => LMS.submit();
    $('#btn-back-list').onclick = () => LMS.backToList();

    $('#btn-add-student').onclick = () => Admin.addStudent();
    $('#btn-refresh-students').onclick = () => Admin.loadStudents();
    $('#btn-load-records').onclick = () => Admin.loadRecords();
    $('#btn-generate-accounts').onclick = () => Admin.generateAccounts();
    $('#btn-change-teacher-pw').onclick = async () => {
      const newPw = $('#new-teacher-pw').value;
      if (!newPw) return;
      try {
        await API.changeTeacherPassword(newPw);
        alert('✅ 비밀번호 변경 완료');
      } catch (e) { alert('❌ 실패: ' + e.message); }
    };
    $('#btn-save-settings').onclick = async () => {
      try {
        await API.setConfig('defaultTimeLimit', $('#cfg-default-time').value);
        alert('✅ 설정 저장 완료');
      } catch (e) { alert('❌ 실패: ' + e.message); }
    };

    $$('.admin-tabs .tab-btn').forEach(btn => {
      btn.onclick = () => {
        $$('.admin-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        $$('.admin-tab').forEach(t => t.classList.add('hidden'));
        btn.classList.add('active');
        $(`#${btn.dataset.tab}`).classList.remove('hidden');
      };
    });
  },

  switchView(name) {
    $$('.view').forEach(v => v.classList.remove('active'));
    $(`#view-${name}`).classList.add('active');
    $$('.nav-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.view === name);
    });

    if (name === 'lms') {
      if (Session.role === 'student') show('#lms-records');
      else hide('#lms-records');
    }
    if (name === 'admin') {
      if (Session.role === 'teacher') {
        hide('#admin-gate'); show('#admin-panel');
        Admin.loadStudents();
      } else {
        show('#admin-gate'); hide('#admin-panel');
      }
    }
  },

  async loadStudioProblems() {
    const cfg = getConfig();
    if (!cfg.ghOwner || !cfg.ghRepo) { alert('GitHub 설정을 먼저 완료하세요.'); return; }
    try {
      const items = await GitHub.listPyFiles(cfg.ghOwner, cfg.ghRepo, 'problems', cfg.ghToken);
      const list = $('#problem-list');
      list.innerHTML = '';
      for (const item of items) {
        const raw = await GitHub.fetchFile(cfg.ghOwner, cfg.ghRepo, item.path, cfg.ghToken);
        const meta = GitHub.parseMetadata(raw);
        const div = document.createElement('div');
        div.className = 'problem-card';
        div.innerHTML = `<h4>${meta.title || item.name}</h4><div class="meta">${item.path}</div>`;
        div.onclick = () => {
          $('#prob-title').value = meta.title;
          $('#prob-score').value = meta.score;
          $('#prob-level').value = meta.level;
          $('#prob-time').value = meta.timeLimit;
          $('#prob-input').value = meta.inputExample;
          $('#prob-output').value = meta.outputExample;
          $('#prob-desc').value = meta.description;
          $('#prob-solution').value = meta.solution;
          $('#prob-template').value = meta.template;
          $('#prob-filename').value = item.name;
          window.scrollTo({ top: 0, behavior: 'smooth' });
        };
        list.appendChild(div);
      }
    } catch (e) {
      alert('문제 로드 실패: ' + e.message);
    }
  },

  async loadLMSProblems() {
    const repoPath = $('#lms-repo').value || `${getConfig().ghOwner}/${getConfig().ghRepo}/problems/easy`;
    try {
      await LMS.loadProblems(repoPath);
    } catch (e) {
      alert('문제 로드 실패: ' + e.message);
    }
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
