const LS_SETTINGS = 'gitco_settings_v3';
const LS_SESSION = 'gitco_session_v3';
const LS_LOCAL_RECORDS = 'gitco_local_records_v3';

const defaultSettings = {
  githubToken: '',
  defaultRepo: '',
  defaultBranch: 'main',
  defaultFolder: 'problems',
  librariesFolder: 'libraries',
  backupRepo: '',
  backupBranch: 'main',
  appsUrl: '',
  sheetId: '',
  defaultTimeLimit: 300,
  gradingMode: 'strip'
};

const state = {
  settings: { ...defaultSettings },
  session: { role: 'guest', userId: '', userName: 'Guest', classId: '', githubToken: '', isGuest: true },
  repo: {
    owner: '',
    repo: '',
    branch: '',
    folder: 'problems',
    selectedRepos: [],
    problems: [],
    currentProblem: null,
    libraries: []
  },
  students: [],
  records: [],
  recordsDisplayed: [],
  problemTimer: null,
  problemElapsed: 0,
  problemCountdown: 0,
  autoSubmitted: false,
  pyodide: null,
  pyodideReady: false,
  initPromise: null,
  loadedLibModules: []
};

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function show(el) {
  if (typeof el === 'string') el = $(el);
  if (el) el.classList.remove('hidden');
}
function hide(el) {
  if (typeof el === 'string') el = $(el);
  if (el) el.classList.add('hidden');
}
function toast(message, type = 'info') {
  const box = $('#toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<div>${type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️'}</div><div>${escapeHtml(message)}</div>`;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
function showLoading(text = '처리 중...') {
  $('#loadingText').textContent = text;
  $('#loadingOverlay').classList.add('show');
}
function hideLoading() {
  $('#loadingOverlay').classList.remove('show');
}
function escapeHtml(text = '') {
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}
function sanitizeModuleName(name = '') {
  const s = String(name).replace(/[^A-Za-z0-9_]/g, '_');
  return s || 'lib';
}
function sanitizePathPart(text = '') {
  return String(text).replace(/[\/\\:*?"<>|]/g, '_').trim() || 'unknown';
}
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary);
}
function base64ToUtf8(b64) {
  const binary = atob(String(b64).replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function formatElapsed(sec = 0) {
  sec = Math.max(0, parseInt(sec) || 0);
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}
function parseDateMaybe(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function renderMarkdown(text = '') {
  let html = String(text || '');
  html = html.replace(/\[이미지:\s*(https?:\/\/[^\]]+)\]/gi, '<img src="$1" alt="image" loading="lazy">');
  try {
    if (typeof marked !== 'undefined') {
      marked.setOptions({ breaks: true, gfm: true, headerIds: false, mangle: false });
      html = marked.parse(html);
    } else {
      html = html.replace(/\n/g, '<br>');
    }
  } catch {
    html = html.replace(/\n/g, '<br>');
  }
  try {
    if (typeof DOMPurify !== 'undefined') {
      html = DOMPurify.sanitize(html, {
        ADD_TAGS: ['img'],
        ADD_ATTR: ['src', 'alt', 'loading']
      });
    }
  } catch {}
  return html;
}
function normalizeRepoInput(text = '') {
  const raw = String(text).trim();
  if (!raw) return null;

  const urlMatch = raw.match(/github\.com\/([^/]+)\/([^/]+)(?:\/|$)/i);
  if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2].replace(/\.git$/, '') };

  const parts = raw.split('/').filter(Boolean);
  if (parts.length >= 2) return { owner: parts[0], repo: parts[1].replace(/\.git$/, '') };

  return null;
}
function solvedKey(problemId) {
  return `${Session.userId || 'guest'}::${problemId}`;
}
function localRecordsKey() {
  return LS_LOCAL_RECORDS;
}
function loadLocalRecords() {
  try {
    return JSON.parse(localStorage.getItem(localRecordsKey()) || '[]');
  } catch {
    return [];
  }
}
function saveLocalRecords(records) {
  localStorage.setItem(localRecordsKey(), JSON.stringify(records.slice(0, 1000)));
}
function unique(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

const Session = {
  role: 'guest',
  userId: '',
  userName: 'Guest',
  classId: '',
  githubToken: '',
  isGuest: true,
  isTeacher: false,

  set(data) {
    Object.assign(this, data);
    this.isGuest = this.role === 'guest';
    this.isTeacher = this.role === 'teacher';
    localStorage.setItem(LS_SESSION, JSON.stringify({
      role: this.role,
      userId: this.userId,
      userName: this.userName,
      classId: this.classId,
      githubToken: this.githubToken,
      isGuest: this.isGuest,
      isTeacher: this.isTeacher
    }));
    updateSessionUI();
  },

  load() {
    try {
      const raw = localStorage.getItem(LS_SESSION);
      if (raw) Object.assign(this, JSON.parse(raw));
      this.isGuest = this.role === 'guest';
      this.isTeacher = this.role === 'teacher';
    } catch {}
    updateSessionUI();
  },

  clear() {
    localStorage.removeItem(LS_SESSION);
    this.role = 'guest';
    this.userId = '';
    this.userName = 'Guest';
    this.classId = '';
    this.githubToken = '';
    this.isGuest = true;
    this.isTeacher = false;
    updateSessionUI();
  }
};

function updateSessionUI() {
  const badge = $('#userBadge');
  const avatar = $('#userAvatar');
  const name = $('#userName');

  if (Session.role && Session.role !== 'guest' && Session.userId) {
    badge.classList.remove('hidden');
    const label = Session.role === 'teacher' ? 'T' : (Session.userName || Session.userId).slice(0, 1).toUpperCase();
    avatar.textContent = label;
    name.textContent = Session.userName || Session.userId;
  } else {
    badge.classList.add('hidden');
  }

  $('#btnLogout').classList.toggle('hidden', !Session.userId && Session.role === 'guest');
  $('#teacherLoginCard').classList.toggle('hidden', Session.isTeacher);
  $('#adminPanel').classList.toggle('hidden', !Session.isTeacher);
  $('#recordControlsStudent').classList.toggle('hidden', Session.isTeacher);
  $('#recordControlsTeacher').classList.toggle('hidden', !Session.isTeacher);
  $('#btnTeacherLogin').disabled = Session.isTeacher;
  $('#studentId').disabled = false;
  $('#studentPw').disabled = false;
  $('#studentClass').disabled = false;
}

function loadSettingsFromLocal() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}');
    state.settings = { ...defaultSettings, ...saved };
  } catch {
    state.settings = { ...defaultSettings };
  }
}
function applySettingsToUI() {
  $('#cfgGithubToken').value = state.settings.githubToken || '';
  $('#cfgDefaultRepo').value = state.settings.defaultRepo || '';
  $('#cfgDefaultBranch').value = state.settings.defaultBranch || 'main';
  $('#cfgDefaultFolder').value = state.settings.defaultFolder || 'problems';
  $('#cfgLibrariesFolder').value = state.settings.librariesFolder || 'libraries';
  $('#cfgBackupRepo').value = state.settings.backupRepo || '';
  $('#cfgBackupBranch').value = state.settings.backupBranch || 'main';
  $('#cfgAppsUrl').value = state.settings.appsUrl || '';
  $('#cfgSheetId').value = state.settings.sheetId || '';
  $('#cfgDefaultTimeLimit').value = state.settings.defaultTimeLimit || 300;
  $('#cfgGradingMode').value = state.settings.gradingMode || 'strip';

  $('#repoToken').value = state.settings.githubToken || '';
  $('#repoFolder').value = state.settings.defaultFolder || 'problems';
  $('#repoBranch').value = state.settings.defaultBranch || '';
}
function saveSettingsLocal() {
  localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings));
}
function collectSettingsFromUI() {
  state.settings.githubToken = $('#cfgGithubToken').value.trim();
  state.settings.defaultRepo = $('#cfgDefaultRepo').value.trim();
  state.settings.defaultBranch = $('#cfgDefaultBranch').value.trim() || 'main';
  state.settings.defaultFolder = $('#cfgDefaultFolder').value.trim() || 'problems';
  state.settings.librariesFolder = $('#cfgLibrariesFolder').value.trim() || 'libraries';
  state.settings.backupRepo = $('#cfgBackupRepo').value.trim();
  state.settings.backupBranch = $('#cfgBackupBranch').value.trim() || 'main';
  state.settings.appsUrl = $('#cfgAppsUrl').value.trim();
  state.settings.sheetId = $('#cfgSheetId').value.trim();
  state.settings.defaultTimeLimit = parseInt($('#cfgDefaultTimeLimit').value) || 300;
  state.settings.gradingMode = $('#cfgGradingMode').value || 'strip';
}
async function saveSettings() {
  collectSettingsFromUI();
  saveSettingsLocal();
  $('#repoToken').value = state.settings.githubToken || '';
  $('#repoFolder').value = state.settings.defaultFolder || 'problems';
  $('#repoBranch').value = state.settings.defaultBranch || '';

  toast('설정을 저장했습니다', 'success');

  if (Session.isTeacher && state.settings.appsUrl) {
    try {
      await Promise.all([
        API.setConfig('defaultRepo', state.settings.defaultRepo),
        API.setConfig('defaultBranch', state.settings.defaultBranch),
        API.setConfig('defaultFolder', state.settings.defaultFolder),
        API.setConfig('librariesFolder', state.settings.librariesFolder),
        API.setConfig('backupRepo', state.settings.backupRepo),
        API.setConfig('backupBranch', state.settings.backupBranch),
        API.setConfig('defaultTimeLimit', String(state.settings.defaultTimeLimit)),
        API.setConfig('gradingMode', state.settings.gradingMode)
      ]);
      toast('서버 설정도 저장했습니다', 'success');
    } catch (e) {
      toast('서버 설정 저장 실패: ' + e.message, 'warning');
    }
  }
}

const GitHub = {
  API: 'https://api.github.com',

  headers(token = '') {
    const headers = { Accept: 'application/vnd.github+json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  },

  async request(path, token = '') {
    const res = await fetch(`${this.API}${path}`, {
      headers: this.headers(token)
    });
    const txt = await res.text();
    if (!res.ok) throw new Error(txt || `GitHub API error: ${res.status}`);
    return txt ? JSON.parse(txt) : null;
  },

  async searchRepos(query, token = '') {
    const data = await this.request(`/search/repositories?q=${encodeURIComponent(query)}&per_page=50&sort=stars&order=desc`, token);
    return data.items || [];
  },

  async listUserRepos(username, token = '') {
    if (token) {
      return await this.request(`/user/repos?per_page=100&visibility=all&sort=updated`, token);
    }
    return await this.request(`/users/${encodeURIComponent(username)}/repos?per_page=100&type=owner&sort=updated`);
  },

  async listAccessibleRepos(token = '') {
    if (!token) return [];
    return await this.request(`/user/repos?per_page=100&visibility=all&sort=updated`, token);
  },

  async repoInfo(owner, repo, token = '') {
    return await this.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, token);
  },

  async getDefaultBranch(owner, repo, token = '') {
    try {
      const info = await this.repoInfo(owner, repo, token);
      return info.default_branch || 'main';
    } catch {
      return 'main';
    }
  },

  async listContents(owner, repo, path = '', branch = '', token = '') {
    const encPath = path ? '/' + path.split('/').map(encodeURIComponent).join('/') : '';
    const ref = branch ? `?ref=${encodeURIComponent(branch)}` : '';
    return await this.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents${encPath}${ref}`, token);
  },

  async fetchFileText(owner, repo, path, branch = '', token = '') {
    const data = await this.listContents(owner, repo, path, branch, token);
    if (!data || Array.isArray(data)) throw new Error('파일 내용을 읽을 수 없습니다.');
    if (data.content) return base64ToUtf8(data.content);
    if (data.download_url) {
      const res = await fetch(data.download_url);
      if (!res.ok) throw new Error('원본 파일 다운로드 실패');
      return await res.text();
    }
    throw new Error('파일 내용을 읽을 수 없습니다.');
  },

  async walkPyFiles(owner, repo, path = '', branch = '', token = '', acc = []) {
    let data = await this.listContents(owner, repo, path, branch, token);
    if (!Array.isArray(data)) data = [data];

    for (const item of data) {
      if (item.type === 'file' && item.name.endsWith('.py')) {
        acc.push(item);
      } else if (item.type === 'dir') {
        await this.walkPyFiles(owner, repo, item.path, branch, token, acc);
      }
    }
    return acc;
  },

  async uploadFile(owner, repo, path, content, message, branch = 'main', token = '', sha = null) {
    const body = {
      message,
      content: utf8ToBase64(content),
      branch
    };
    if (sha) body.sha = sha;

    const res = await fetch(`${this.API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'PUT',
      headers: {
        ...this.headers(token),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const txt = await res.text();
    if (!res.ok) throw new Error(txt || 'GitHub 업로드 실패');
    return txt ? JSON.parse(txt) : null;
  }
};

function jsonp(url, params = {}) {
  return new Promise((resolve, reject) => {
    const cb = `gitco_cb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');

    const cleanup = () => {
      try { delete window[cb]; } catch {}
      script.remove();
    };

    window[cb] = (data) => {
      cleanup();
      resolve(data);
    };

    const query = new URLSearchParams({ ...params, callback: cb });
    script.src = `${url}?${query.toString()}`;
    script.onerror = () => {
      cleanup();
      reject(new Error('JSONP 요청 실패'));
    };

    document.body.appendChild(script);
  });
}

const API = {
  async call(action, data = {}) {
    if (!state.settings.appsUrl) throw new Error('Apps Script URL이 설정되지 않았습니다.');
    return await jsonp(state.settings.appsUrl, {
      action,
      data: JSON.stringify(data)
    });
  },

  async loginStudent({ userId, password, classId }) {
    const passwordHash = await sha256(password);
    return await this.call('loginStudent', { userId, passwordHash, classId });
  },

  async loginTeacher({ password }) {
    const passwordHash = await sha256(password);
    return await this.call('loginTeacher', { passwordHash });
  },

  async getStudents() {
    return await this.call('getStudents', {});
  },

  async addStudent({ userId, name, classId, password }) {
    const passwordHash = await sha256(password);
    return await this.call('addStudent', { userId, name, classId, passwordHash });
  },

  async deleteStudent({ userId }) {
    return await this.call('deleteStudent', { userId });
  },

  async changeStudentPassword({ userId, password }) {
    const passwordHash = await sha256(password);
    return await this.call('changeStudentPassword', { userId, passwordHash });
  },

  async generateAccounts({ classId, prefix, count, startNo }) {
    return await this.call('generateAccounts', { classId, prefix, count, startNo });
  },

  async changeTeacherPassword({ password }) {
    const passwordHash = await sha256(password);
    return await this.call('changeTeacherPassword', { passwordHash });
  },

  async getConfig() {
    return await this.call('getConfig', {});
  },

  async setConfig(key, value) {
    return await this.call('setConfig', { key, value });
  },

  async getRecords({ scope = 'mine', userId = '', classId = '' }) {
    return await this.call('getRecords', { scope, userId, classId });
  },

  async submit(record) {
    if (!state.settings.appsUrl) return { success: false, error: 'Apps Script URL 없음' };
    try {
      await fetch(state.settings.appsUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ action: 'submit', ...record })
      });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
};

const PyRunner = {
  pyodide: null,
  initPromise: null,
  loadedModules: [],

  async init() {
    if (this.pyodide) return this.pyodide;
    if (this.initPromise) return this.initPromise;

    if (typeof loadPyodide !== 'function') {
      throw new Error('loadPyodide가 로드되지 않았습니다. index.html의 Pyodide 스크립트를 확인하세요.');
    }

    this.initPromise = loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.0/full/'
    }).then(py => {
      this.pyodide = py;
      state.pyodide = py;
      state.pyodideReady = true;
      $('#pyodideStatusDot').classList.add('ready');
      $('#pyodideStatusText').textContent = 'Python 준비됨';
      toast('Python 실행 환경이 준비되었습니다', 'success');
      return py;
    }).catch(err => {
      $('#pyodideStatusText').textContent = 'Python 로딩 실패';
      toast('Pyodide 로딩 실패: ' + err.message, 'error');
      throw err;
    });

    return this.initPromise;
  },

  async clearLibraries() {
    if (!this.pyodide || !this.loadedModules.length) return;
    const list = JSON.stringify(this.loadedModules);
    try {
      this.pyodide.runPython(`
import sys
for _m in ${list}:
    sys.modules.pop(_m, None)
`);
    } catch {}
    this.loadedModules = [];
  },

  async loadLibraries(owner, repo, branch, folder, token) {
    await this.init();
    await this.clearLibraries();

    if (!folder) return [];

    try {
      const files = await GitHub.walkPyFiles(owner, repo, folder, branch, token);
      const libs = [];

      for (const file of files) {
        const moduleName = sanitizeModuleName(file.name.replace(/\.py$/i, ''));
        const code = await GitHub.fetchFileText(owner, repo, file.path, branch, token);
        libs.push({ name: moduleName, code });
      }

      for (const lib of libs) {
        this.pyodide.runPython(`
import sys, types
_mod = types.ModuleType(${JSON.stringify(lib.name)})
exec(compile(${JSON.stringify(lib.code)}, "<${lib.name}>", "exec"), _mod.__dict__)
sys.modules[${JSON.stringify(lib.name)}] = _mod
`);
      }

      this.loadedModules = libs.map(l => l.name);
      return libs;
    } catch (e) {
      console.warn('libraries 로드 실패:', e.message);
      this.loadedModules = [];
      return [];
    }
  },

  async run(code, inputText = '', timeoutMs = 10000) {
    await this.init();
    const py = this.pyodide;

    const wrapped = `
import sys, io, traceback
__gitco_old_stdout = sys.stdout
__gitco_old_stderr = sys.stderr
__gitco_old_stdin = sys.stdin
__gitco_out = io.StringIO()
__gitco_err = io.StringIO()
sys.stdout = __gitco_out
sys.stderr = __gitco_err
sys.stdin = io.StringIO(${JSON.stringify(inputText || '')})
__gitco_ns = {"__name__": "__main__"}
try:
    exec(compile(${JSON.stringify(code)}, "<gitco>", "exec"), __gitco_ns, __gitco_ns)
except Exception:
    traceback.print_exc()
finally:
    sys.stdout = __gitco_old_stdout
    sys.stderr = __gitco_old_stderr
    sys.stdin = __gitco_old_stdin
__gitco_stdout_value = __gitco_out.getvalue()
__gitco_stderr_value = __gitco_err.getvalue()
`;

    const runPromise = py.runPythonAsync(wrapped);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`실행 시간 초과 (${Math.ceil(timeoutMs / 1000)}초)`)), timeoutMs);
    });

    await Promise.race([runPromise, timeoutPromise]);

    let stdout = '';
    let stderr = '';
    try {
      stdout = String(py.runPython('__gitco_stdout_value') || '');
      stderr = String(py.runPython('__gitco_stderr_value') || '');
    } catch {}

    return { stdout, stderr };
  }
};

function parseProblemPy(filepath, content) {
  const lines = String(content || '').split(/\r?\n/);
  const meta = {
    id: filepath,
    filepath,
    title: '',
    score: 10,
    difficulty: '보통',
    timeLimit: 0,
    availableFrom: '',
    availableTo: '',
    inputExample: '',
    outputExample: '',
    description: '',
    libraries: '',
    librariesFolder: '',
    templateCode: '',
    answerCode: ''
  };

  let inDesc = false;
  for (const line of lines) {
    const t = line.trim();
    if (t === '# ===학생코드===' || t === '# ===정답코드===') break;

    if (inDesc) {
      const raw = t.replace(/^#\s?/, '');
      const keyLike = /^(문제|점수|난이도|시간제한|공개시작|공개종료|입력예시|출력예시|라이브러리|라이브러리폴더)\s*:/;
      if (t.startsWith('#') && !keyLike.test(raw)) {
        meta.description += (meta.description ? '\n' : '') + raw;
        continue;
      }
      inDesc = false;
    }

    if (!t.startsWith('#')) continue;

    const raw = t.replace(/^#\s?/, '');
    const idx = raw.indexOf(':');
    const key = idx >= 0 ? raw.slice(0, idx).trim() : '';
    const value = idx >= 0 ? raw.slice(idx + 1).trim() : '';

    switch (key) {
      case '문제': meta.title = value; break;
      case '점수': meta.score = parseInt(value) || 10; break;
      case '난이도': meta.difficulty = value || '보통'; break;
      case '시간제한': meta.timeLimit = parseInt(value) || 0; break;
      case '공개시작': meta.availableFrom = value; break;
      case '공개종료': meta.availableTo = value; break;
      case '입력예시': meta.inputExample = value; break;
      case '출력예시': meta.outputExample = value; break;
      case '라이브러리': meta.libraries = value; break;
      case '라이브러리폴더': meta.librariesFolder = value; break;
      case '설명':
        meta.description += value;
        inDesc = true;
        break;
    }
  }

  const studentMarker = lines.findIndex(l => l.trim() === '# ===학생코드===');
  const answerMarker = lines.findIndex(l => l.trim() === '# ===정답코드===');

  if (studentMarker >= 0) {
    const start = studentMarker + 1;
    const end = answerMarker >= 0 ? answerMarker : lines.length;
    meta.templateCode = lines.slice(start, end).join('\n').trim();
  }

  if (answerMarker >= 0) {
    meta.answerCode = lines.slice(answerMarker + 1).join('\n').trim();
  }

  return meta;
}

function isProblemAvailable(problem) {
  const now = new Date();
  const from = parseDateMaybe(problem.availableFrom);
  const to = parseDateMaybe(problem.availableTo);

  if (from && now < from) return { available: false, reason: `공개 시작 전 (${from.toLocaleString('ko-KR')})` };
  if (to && now > to) return { available: false, reason: `공개 종료됨 (${to.toLocaleString('ko-KR')})` };
  return { available: true, reason: '' };
}

function generatePyContent() {
  const title = $('#studioTitle').value.trim() || '제목 없음';
  const score = parseInt($('#studioScore').value) || 10;
  const difficulty = $('#studioDifficulty').value || '보통';
  const timeLimit = parseInt($('#studioTimeLimit').value) || 0;
  const availableFrom = $('#studioAvailableFrom').value.trim();
  const availableTo = $('#studioAvailableTo').value.trim();
  const description = $('#studioDescription').value.trim();
  const inputExample = $('#studioInputExample').value.trim();
  const outputExample = $('#studioOutputExample').value.trim();
  const answerCode = $('#studioAnswerCode').value.trim();
  const templateCode = $('#studioTemplateCode').value.trim();
  const libraryList = $('#studioLibraryList').value.trim();
  const folder = $('#studioFolder').value.trim() || 'problems';

  let out = '';
  out += `# 문제: ${title}\n`;
  out += `# 점수: ${score}\n`;
  out += `# 난이도: ${difficulty}\n`;
  out += `# 시간제한: ${timeLimit}\n`;
  if (availableFrom) out += `# 공개시작: ${availableFrom}\n`;
  if (availableTo) out += `# 공개종료: ${availableTo}\n`;
  if (inputExample) out += `# 입력예시: ${inputExample}\n`;
  if (outputExample) out += `# 출력예시: ${outputExample}\n`;
  if (libraryList) out += `# 라이브러리: ${libraryList}\n`;
  out += `# 라이브러리폴더: ${state.settings.librariesFolder || 'libraries'}\n`;
  out += `# 설명:\n`;
  if (description) {
    description.split('\n').forEach(line => { out += `# ${line}\n`; });
  } else {
    out += `# 설명 없음\n`;
  }
  out += `\n# ===학생코드===\n`;
  out += (templateCode || '# 여기에 코드를 작성하세요\n') + '\n';
  out += `\n# ===정답코드===\n`;
  out += (answerCode || '# 정답 코드 없음\n') + '\n';
  return out;
}

function updateStudioPreview() {
  const code = generatePyContent();
  $('#studioPreviewCode').textContent = code;
  const description = $('#studioDescription').value.trim() || '문제 설명을 입력하세요.';
  let md = description;
  const inputExample = $('#studioInputExample').value.trim();
  const outputExample = $('#studioOutputExample').value.trim();
  if (inputExample) md += `\n\n**입력 예시:** \`${inputExample}\``;
  if (outputExample) md += `\n\n**출력 예시:** \`${outputExample}\``;
  $('#studioPreviewMarkdown').innerHTML = renderMarkdown(md);
  if (!$('#studioFilename').value.trim()) {
    const safe = ($('#studioTitle').value.trim() || 'problem').replace(/[^A-Za-z0-9ㄱ-ㅎ가-힣]+/g, '_').slice(0, 40);
    $('#studioFilename').value = `${$('#studioFolder').value.trim() || 'problems'}/${safe}.py`;
  }
  return code;
}

function downloadPyFile() {
  const content = updateStudioPreview();
  const filename = $('#studioFilename').value.trim() || 'problem.py';
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename.split('/').pop();
  a.click();
  URL.revokeObjectURL(a.href);
  toast('.py 파일을 다운로드했습니다', 'success');
}

async function uploadToGitHub() {
  const content = updateStudioPreview();
  const repo = state.settings.defaultRepo || $('#cfgDefaultRepo').value.trim();
  const token = state.settings.githubToken || $('#cfgGithubToken').value.trim();
  const branch = state.settings.defaultBranch || $('#cfgDefaultBranch').value.trim() || 'main';

  const parsed = normalizeRepoInput(repo);
  if (!parsed) return toast('기본 문제 Repo를 먼저 입력하세요', 'warning');
  if (!token) return toast('GitHub 토큰을 입력하세요', 'warning');

  const filename = $('#studioFilename').value.trim();
  if (!filename) return toast('파일명을 입력하세요', 'warning');

  showLoading('GitHub 업로드 중...');
  try {
    let sha = null;
    try {
      const existing = await GitHub.listContents(parsed.owner, parsed.repo, filename, branch, token);
      if (existing && !Array.isArray(existing)) sha = existing.sha;
    } catch {}

    await GitHub.uploadFile(
      parsed.owner,
      parsed.repo,
      filename,
      content,
      `[GitCo] problem: ${$('#studioTitle').value.trim() || 'new problem'}`,
      branch,
      token,
      sha
    );

    hideLoading();
    toast('GitHub 업로드 완료', 'success');
  } catch (e) {
    hideLoading();
    toast('GitHub 업로드 실패: ' + e.message, 'error');
  }
}

async function searchRepositories() {
  const user = $('#repoUser').value.trim();
  const query = $('#repoQuery').value.trim();
  const token = $('#repoToken').value.trim() || state.settings.githubToken || '';

  try {
    let repos = [];
    if (query) {
      repos = await GitHub.searchRepos(query, token);
    } else if (user) {
      repos = await GitHub.listUserRepos(user, token);
    } else if (token) {
      repos = await GitHub.listAccessibleRepos(token);
    } else {
      toast('사용자명, 검색어, 또는 토큰을 입력하세요', 'warning');
      return;
    }

    renderRepoSelect(repos);
    toast(`${repos.length}개의 저장소를 찾았습니다`, 'success');
  } catch (e) {
    toast('저장소 검색 실패: ' + e.message, 'error');
  }
}

function renderRepoSelect(repos) {
  state.repo.selectedRepos = repos || [];
  const select = $('#repoSelect');
  select.innerHTML = '';

  if (!repos || repos.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = '검색 결과가 없습니다';
    opt.value = '';
    select.appendChild(opt);
    return;
  }

  repos.forEach(repo => {
    const opt = document.createElement('option');
    opt.value = repo.full_name;
    opt.dataset.owner = repo.owner.login;
    opt.dataset.repo = repo.name;
    opt.dataset.branch = repo.default_branch || 'main';
    opt.textContent = `${repo.full_name} ${repo.private ? '(private)' : '(public)'}`;
    select.appendChild(opt);
  });
}

async function loadSelectedRepository() {
  const select = $('#repoSelect');
  const opt = select.options[select.selectedIndex];
  if (!opt || !opt.dataset.owner) return toast('선택할 저장소가 없습니다', 'warning');

  const owner = opt.dataset.owner;
  const repo = opt.dataset.repo;
  const branch = $('#repoBranch').value.trim() || opt.dataset.branch || 'main';
  const folder = $('#repoFolder').value.trim() || state.settings.defaultFolder || 'problems';
  const token = $('#repoToken').value.trim() || state.settings.githubToken || '';

  await loadProblemsFromRepo(owner, repo, branch, folder, token);
}

async function loadDirectRepository() {
  const parsed = normalizeRepoInput($('#repoDirect').value.trim());
  if (!parsed) return toast('owner/repo 또는 GitHub URL 형식으로 입력하세요', 'warning');

  const token = $('#repoToken').value.trim() || state.settings.githubToken || '';
  let branch = $('#repoBranch').value.trim();
  if (!branch) branch = await GitHub.getDefaultBranch(parsed.owner, parsed.repo, token);

  const folder = $('#repoFolder').value.trim() || state.settings.defaultFolder || 'problems';
  await loadProblemsFromRepo(parsed.owner, parsed.repo, branch, folder, token);
}

async function loadProblemsFromRepo(owner, repo, branch, folder, token) {
  showLoading('문제와 libraries를 불러오는 중...');
  try {
    state.repo.owner = owner;
    state.repo.repo = repo;
    state.repo.branch = branch || 'main';
    state.repo.folder = folder || 'problems';

    $('#repoBranch').value = state.repo.branch;
    $('#repoFolder').value = state.repo.folder;
    $('#cfgDefaultRepo').value = `${owner}/${repo}`;
    $('#cfgDefaultBranch').value = state.repo.branch;
    $('#cfgDefaultFolder').value = state.repo.folder;

    saveSettingsLocal();

    const librariesFolder = state.settings.librariesFolder || 'libraries';
    state.repo.libraries = await PyRunner.loadLibraries(owner, repo, branch, librariesFolder, token);

    const files = await GitHub.walkPyFiles(owner, repo, folder, branch, token);
    const problems = [];

    for (const file of files) {
      const text = await GitHub.fetchFileText(owner, repo, file.path, branch, token);
      const p = parseProblemPy(file.path, text);
      p.repoOwner = owner;
      p.repoName = repo;
      p.branch = branch;
      p.repoPath = folder;
      p.problemFolder = folder;
      p.libraryFolder = librariesFolder;
      p.sourcePath = file.path;
      problems.push(p);
    }

    state.repo.problems = problems;
    state.repo.currentProblem = null;
    renderProblemList();
    hideLoading();
    toast(`${problems.length}개의 문제를 불러왔습니다`, 'success');
  } catch (e) {
    hideLoading();
    toast('문제 로드 실패: ' + e.message, 'error');
  }
}

function renderProblemList() {
  const box = $('#problemList');
  const problems = state.repo.problems || [];

  if (problems.length === 0) {
    box.innerHTML = `
      <div class="empty-state">
        <div class="icon">📭</div>
        <div class="text">문제가 없습니다</div>
      </div>`;
    return;
  }

  const solved = new Set((state.records || []).filter(r => r.result === 'correct' && r.studentId === Session.userId).map(r => r.problemPath || r.problemTitle));
  box.innerHTML = '';

  problems.forEach((p, idx) => {
    const check = isProblemAvailable(p);
    const isLocked = !check.available;
    const isSolved = solved.has(p.sourcePath) || solved.has(p.filepath) || solved.has(p.problemTitle);

    const item = document.createElement('div');
    item.className = `problem-item ${state.repo.currentProblem?.sourcePath === p.sourcePath ? 'active' : ''}`;
    item.innerHTML = `
      <div class="num">${idx + 1}</div>
      <div class="info">
        <div class="title">${escapeHtml(p.title || p.filepath)}</div>
        <div class="meta">${escapeHtml(p.score)}점 · ${escapeHtml(p.difficulty)} · ${p.timeLimit || state.settings.defaultTimeLimit || 0}초</div>
      </div>
      <span class="badge ${isLocked ? 'badge-locked' : isSolved ? 'badge-solved' : 'badge-unsolved'}">
        ${isLocked ? 'LOCK' : isSolved ? 'SOLVED' : 'NEW'}
      </span>
    `;
    item.onclick = () => {
      if (isLocked) return toast(check.reason, 'warning');
      selectProblem(p.sourcePath);
    };
    box.appendChild(item);
  });
}

function selectProblem(sourcePath) {
  const problem = state.repo.problems.find(p => p.sourcePath === sourcePath);
  if (!problem) return;

  const availability = isProblemAvailable(problem);
  if (!availability.available) return toast(availability.reason, 'warning');

  state.repo.currentProblem = problem;
  state.autoSubmitted = false;
  renderProblemList();
  renderProblemDetail(problem);
  startProblemTimer(problem);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderProblemDetail(problem) {
  const card = $('#problemDetailCard');
  const detail = `
    <div class="problem-description">
      <h2>${escapeHtml(problem.title || problem.filepath)}</h2>
      <div class="meta">
        <span>📊 ${escapeHtml(problem.score)}점</span>
        <span>🎯 ${escapeHtml(problem.difficulty)}</span>
        <span>⏱️ ${problem.timeLimit || state.settings.defaultTimeLimit || 0}초</span>
        <span>📁 ${escapeHtml(problem.sourcePath)}</span>
      </div>
      <div class="body">${renderMarkdown(problem.description || '설명이 없습니다.')}</div>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="card-title">코드 편집기</span>
        <div class="btn-row">
          <button class="btn btn-sm" id="btnResetEditor">초기화</button>
          <button class="btn btn-sm" id="btnRunCode">실행</button>
          <button class="btn btn-sm btn-primary" id="btnSubmitCode" ${Session.isGuest ? 'disabled' : ''}>제출</button>
        </div>
      </div>

      <div class="form-group">
        <label>stdin</label>
        <textarea id="problemInput" class="textarea" rows="3" placeholder="입력 예시를 수정해서 실행할 수 있습니다">${escapeHtml(problem.inputExample || '')}</textarea>
      </div>

      <div class="form-group">
        <label>Python 코드</label>
        <textarea id="codeEditor" class="code-editor" spellcheck="false">${escapeHtml(problem.templateCode || '# 여기에 코드를 작성하세요\n')}</textarea>
      </div>

      <div class="output-header">
        <span class="title">실행 결과</span>
        <span id="executionTime" class="small-note">00:00</span>
      </div>
      <div id="outputContent" class="output-content info">실행 결과가 여기에 표시됩니다</div>

      <div class="small-note" id="timerInfo"></div>
    </div>
  `;
  card.innerHTML = detail;

  $('#btnResetEditor').onclick = () => {
    $('#codeEditor').value = problem.templateCode || '# 여기에 코드를 작성하세요\n';
    $('#problemInput').value = problem.inputExample || '';
    $('#outputContent').className = 'output-content info';
    $('#outputContent').textContent = '초기화되었습니다';
  };
  $('#btnRunCode').onclick = () => runCurrentCode(false);
  $('#btnSubmitCode').onclick = () => submitCurrentCode(false);
  $('#codeEditor').addEventListener('keydown', handleEditorTab);
}

function handleEditorTab(e) {
  if (e.key !== 'Tab') return;
  const ta = e.target;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  ta.value = ta.value.substring(0, start) + '    ' + ta.value.substring(end);
  ta.selectionStart = ta.selectionEnd = start + 4;
  e.preventDefault();
}

function startProblemTimer(problem) {
  stopProblemTimer();
  state.problemElapsed = 0;
  const limit = problem.timeLimit || state.settings.defaultTimeLimit || 0;
  state.problemCountdown = limit;
  $('#timerInfo').textContent = limit > 0 ? `남은 시간: ${formatElapsed(limit)}` : '시간 제한 없음';

  state.problemTimer = setInterval(() => {
    state.problemElapsed++;
    const max = problem.timeLimit || state.settings.defaultTimeLimit || 0;
    if (max > 0) {
      state.problemCountdown = Math.max(0, max - state.problemElapsed);
      $('#timerInfo').textContent = `남은 시간: ${formatElapsed(state.problemCountdown)}`;
      if (state.problemCountdown <= 0 && !state.autoSubmitted) {
        state.autoSubmitted = true;
        submitCurrentCode(true);
      }
    } else {
      $('#timerInfo').textContent = `진행 시간: ${formatElapsed(state.problemElapsed)}`;
    }
  }, 1000);
}

function stopProblemTimer() {
  if (state.problemTimer) clearInterval(state.problemTimer);
  state.problemTimer = null;
  state.problemElapsed = 0;
  state.problemCountdown = 0;
}

async function runCurrentCode(isSubmit = false) {
  const problem = state.repo.currentProblem;
  if (!problem) return toast('문제를 먼저 선택하세요', 'warning');

  const code = $('#codeEditor').value;
  const input = $('#problemInput').value;
  const timeoutMs = ((problem.timeLimit || state.settings.defaultTimeLimit || 0) * 1000) || 10000;

  $('#outputContent').className = 'output-content info';
  $('#outputContent').textContent = '실행 중...';
  $('#executionTime').textContent = '';

  try {
    const t0 = performance.now();
    const libs = state.repo.libraries || [];
    // libraries are already loaded globally into Pyodide in PyRunner.loadLibraries
    const result = await PyRunner.run(code, input, timeoutMs);
    const ms = Math.round(performance.now() - t0);

    $('#executionTime').textContent = `${ms}ms`;
    const out = (result.stdout || '').trim();
    const err = (result.stderr || '').trim();

    if (err) {
      $('#outputContent').className = 'output-content error';
      $('#outputContent').textContent = `${out ? out + '\n' : ''}${err}`;
    } else {
      $('#outputContent').className = 'output-content success';
      $('#outputContent').textContent = out || '(출력 없음)';
    }

    if (isSubmit) await gradeAndRecord(code, out, input);
    return result;
  } catch (e) {
    $('#outputContent').className = 'output-content error';
    $('#outputContent').textContent = e.message;
    if (isSubmit) await recordSubmission({
      problem,
      code,
      result: 'wrong',
      score: 0,
      elapsedSec: state.problemElapsed,
      studentOutput: '',
      expectedOutput: ''
    });
  }
}

async function submitCurrentCode(auto = false) {
  if (auto) state.autoSubmitted = true;
  return await runCurrentCode(true);
}

async function gradeAndRecord(studentCode, studentOutput, input) {
  const problem = state.repo.currentProblem;
  if (!problem) return;

  const expected = problem.answerCode ? await getExpectedOutput(problem.answerCode, input) : '';
  let correct = false;

  if (!problem.answerCode) {
    correct = null;
  } else {
    const mode = state.settings.gradingMode || 'strip';
    const a = String(studentOutput || '');
    const b = String(expected || '');

    if (mode === 'exact') correct = a === b;
    else if (mode === 'contains') correct = a.includes(b.trim());
    else correct = a.trim() === b.trim();
  }

  const score = correct === true ? (problem.score || 0) : 0;
  const outputEl = $('#outputContent');

  if (correct === null) {
    outputEl.className = 'output-content info';
    outputEl.textContent = studentOutput || '(출력 없음)';
    toast('정답 코드가 없어서 수동 제출로 기록했습니다', 'warning');
  } else if (correct) {
    outputEl.className = 'output-content success';
    outputEl.textContent = `✅ 정답입니다! +${score}점\n\n${studentOutput || '(출력 없음)'}`;
    toast('정답입니다', 'success');
  } else {
    outputEl.className = 'output-content error';
    outputEl.textContent = `❌ 오답입니다\n\n내 출력:\n${studentOutput || '(없음)'}\n\n기대 출력:\n${expected || '(없음)'}`;
    toast('오답입니다', 'warning');
  }

  state.repo.currentProblem._lastExpectedOutput = expected;
  await recordSubmission({
    problem,
    code: studentCode,
    result: correct === null ? 'submitted' : (correct ? 'correct' : 'wrong'),
    score,
    elapsedSec: state.problemElapsed,
    studentOutput,
    expectedOutput: expected
  });

  if (correct === true) {
    state.records = loadLocalRecords();
    renderProblemList();
  }
}

async function getExpectedOutput(answerCode, input) {
  const timeoutMs = ((state.repo.currentProblem?.timeLimit || state.settings.defaultTimeLimit || 0) * 1000) || 10000;
  const result = await PyRunner.run(answerCode, input, timeoutMs);
  return (result.stdout || '').trim();
}

async function recordSubmission({ problem, code, result, score, elapsedSec, studentOutput, expectedOutput }) {
  const record = {
    timestamp: new Date().toISOString(),
    studentId: Session.userId || 'guest',
    studentName: Session.userName || 'Guest',
    classId: Session.classId || '미지정',
    repoOwner: problem.repoOwner || state.repo.owner,
    repoName: problem.repoName || state.repo.repo,
    branch: problem.branch || state.repo.branch,
    problemPath: problem.sourcePath || problem.filepath,
    problemTitle: problem.title || problem.filepath,
    result,
    score,
    maxScore: problem.score || 0,
    elapsedSec: elapsedSec || 0,
    code: code || '',
    studentOutput: studentOutput || '',
    expectedOutput: expectedOutput || ''
  };

  if (Session.role !== 'guest') {
    const local = loadLocalRecords();
    local.unshift(record);
    saveLocalRecords(local);
    state.records = local;
  }

  // backend record
  if (state.settings.appsUrl && Session.role !== 'guest') {
    try {
      await API.submit(record);
    } catch (e) {
      console.warn('submit to sheet failed:', e);
    }
  }

  // optional GitHub backup
  if (state.settings.backupRepo && (state.settings.githubToken || Session.githubToken)) {
    try {
      const token = state.settings.githubToken || Session.githubToken || '';
      const parsed = normalizeRepoInput(state.settings.backupRepo);
      if (parsed) {
        const branch = state.settings.backupBranch || 'main';
        const safeClass = sanitizePathPart(record.classId);
        const safeStudent = sanitizePathPart(record.studentId);
        const safeProblem = sanitizePathPart(record.problemPath.replace(/\//g, '_'));
        const ts = new Date(record.timestamp).toISOString().replace(/[:.]/g, '-');
        const path = `submissions/${safeClass}/${safeStudent}/${ts}_${safeProblem}.py`;
        const backupContent =
`# GitCo Submission
# Student: ${record.studentName} (${record.studentId})
# Class: ${record.classId}
# Repo: ${record.repoOwner}/${record.repoName}
# Branch: ${record.branch}
# Problem: ${record.problemTitle}
# Result: ${record.result}
# Score: ${record.score}/${record.maxScore}
# Elapsed: ${record.elapsedSec}

${code}
`;
        await GitHub.uploadFile(parsed.owner, parsed.repo, path, backupContent, `[GitCo] submission ${record.studentId}`, branch, token);
      }
    } catch (e) {
      console.warn('backup upload failed:', e.message);
    }
  }

  renderRecords(state.records);
}

async function refreshMyRecords() {
  await loadRecords();
}

function buildClassOptions() {
  const classes = unique([
    '전체',
    ...state.students.map(s => s.classId),
    ...state.records.map(r => r.classId)
  ]);
  $('#recordClassFilter').innerHTML = classes.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
}

async function loadRecords() {
  let records = [];

  if (state.settings.appsUrl) {
    try {
      if (Session.isTeacher) {
        const scope = $('#recordScope').value || 'all';
        const classId = $('#recordClassFilter').value || '전체';
        const res = await API.getRecords({
          scope,
          userId: Session.userId,
          classId
        });
        records = res.records || [];
      } else if (Session.role === 'student') {
        const res = await API.getRecords({
          scope: 'mine',
          userId: Session.userId,
          classId: Session.classId
        });
        records = res.records || [];
      } else {
        records = loadLocalRecords();
      }
    } catch (e) {
      console.warn('loadRecords server failed:', e.message);
      records = loadLocalRecords();
    }
  } else {
    records = loadLocalRecords();
  }

  state.records = records;
  renderRecords(records);
  renderProblemList();
  buildClassOptions();
}

function renderRecords(records) {
  state.recordsDisplayed = records || [];

  const search = $('#recordSearch').value.trim().toLowerCase();
  let list = state.recordsDisplayed;

  if (search) {
    list = list.filter(r =>
      String(r.studentId || '').toLowerCase().includes(search) ||
      String(r.problemTitle || '').toLowerCase().includes(search)
    );
  }

  const tbody = $('#recordsBody');
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-cell">기록이 없습니다</td></tr>`;
    updateRecordStats(list);
    return;
  }

  tbody.innerHTML = list.map((r, idx) => {
    const resultClass = r.result === 'correct' ? 'success' : r.result === 'wrong' ? 'error' : 'info';
    const resultText = r.result === 'correct' ? '정답' : r.result === 'wrong' ? '오답' : '제출';
    const repoText = `${r.repoOwner || ''}/${r.repoName || ''}`.replace(/^\/|\/$/g, '');
    return `
      <tr>
        <td>${escapeHtml(new Date(r.timestamp).toLocaleString('ko-KR'))}</td>
        <td>${escapeHtml(r.studentId || '')}</td>
        <td>${escapeHtml(r.classId || '')}</td>
        <td>${escapeHtml(repoText)}</td>
        <td>${escapeHtml(r.problemTitle || '')}</td>
        <td class="${resultClass}">${resultText}</td>
        <td>${escapeHtml(r.score ?? 0)} / ${escapeHtml(r.maxScore ?? 0)}</td>
        <td>${formatElapsed(r.elapsedSec || 0)}</td>
        <td><button class="btn btn-sm" data-code-index="${idx}">보기</button></td>
      </tr>
    `;
  }).join('');

  $$('[data-code-index]').forEach(btn => {
    btn.onclick = () => viewRecordCode(parseInt(btn.dataset.codeIndex));
  });

  updateRecordStats(list);
}

function updateRecordStats(records) {
  const uniqueStudents = unique((records || []).map(r => r.studentId)).length;
  const total = (records || []).length;
  const correct = (records || []).filter(r => r.result === 'correct').length;
  const rate = total ? Math.round((correct / total) * 100) : 0;

  $('#statStudents').textContent = uniqueStudents;
  $('#statSubmissions').textContent = total;
  $('#statCorrect').textContent = correct;
  $('#statRate').textContent = `${rate}%`;
}

function viewRecordCode(index) {
  const rec = state.recordsDisplayed[index];
  if (!rec || !rec.code) {
    toast('저장된 코드가 없습니다', 'warning');
    return;
  }
  $('#codeViewContent').textContent = rec.code;
  $('#codeViewModal').classList.add('show');
  if (typeof hljs !== 'undefined') hljs.highlightElement($('#codeViewContent'));
}

function exportCSV() {
  const records = state.recordsDisplayed || [];
  if (!records.length) return toast('내보낼 기록이 없습니다', 'warning');

  const headers = ['시간', '학생ID', '학생명', '반', 'RepoOwner', 'RepoName', 'Branch', '문제', '결과', '점수', '만점', '소요시간'];
  const rows = records.map(r => [
    r.timestamp,
    r.studentId,
    r.studentName,
    r.classId,
    r.repoOwner,
    r.repoName,
    r.branch,
    r.problemTitle,
    r.result,
    r.score,
    r.maxScore,
    r.elapsedSec
  ]);

  const csv = [headers, ...rows]
    .map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gitco_records_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('CSV를 다운로드했습니다', 'success');
}

const Admin = {
  async loadStudents() {
    if (state.settings.appsUrl) {
      try {
        const res = await API.getStudents();
        state.students = res.students || [];
      } catch (e) {
        console.warn('loadStudents server failed:', e.message);
        state.students = [];
      }
    } else {
      state.students = [];
    }
    this.renderStudents();
    buildClassOptions();
  },

  renderStudents() {
    const tbody = $('#studentTable');
    if (!state.students.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">학생이 없습니다</td></tr>`;
      return;
    }

    tbody.innerHTML = state.students.map(s => `
      <tr>
        <td>${escapeHtml(s.userId || '')}</td>
        <td>${escapeHtml(s.name || '')}</td>
        <td>${escapeHtml(s.classId || '')}</td>
        <td><button class="btn btn-sm" data-change-pw="${escapeHtml(s.userId)}">변경</button></td>
        <td><button class="btn btn-sm" data-delete-student="${escapeHtml(s.userId)}">삭제</button></td>
      </tr>
    `).join('');

    $$('[data-change-pw]').forEach(btn => {
      btn.onclick = () => this.changeStudentPassword(btn.dataset.changePw);
    });
    $$('[data-delete-student]').forEach(btn => {
      btn.onclick = () => this.deleteStudent(btn.dataset.deleteStudent);
    });
  },

  async addStudent() {
    const userId = prompt('학번/아이디');
    const name = prompt('이름');
    const classId = prompt('반');
    const password = prompt('초기 비밀번호');
    if (!userId || !password) return;

    try {
      if (state.settings.appsUrl) {
        await API.addStudent({ userId, name: name || '', classId: classId || '미지정', password });
      }
      toast('학생이 추가되었습니다', 'success');
      await this.loadStudents();
    } catch (e) {
      toast('학생 추가 실패: ' + e.message, 'error');
    }
  },

  async deleteStudent(userId) {
    if (!confirm(`${userId} 학생을 삭제할까요?`)) return;
    try {
      if (state.settings.appsUrl) await API.deleteStudent({ userId });
      toast('학생을 삭제했습니다', 'success');
      await this.loadStudents();
    } catch (e) {
      toast('삭제 실패: ' + e.message, 'error');
    }
  },

  async changeStudentPassword(userId) {
    const pw = prompt(`${userId} 새 비밀번호`);
    if (!pw) return;
    try {
      if (state.settings.appsUrl) await API.changeStudentPassword({ userId, password: pw });
      toast('비밀번호를 변경했습니다', 'success');
    } catch (e) {
      toast('비밀번호 변경 실패: ' + e.message, 'error');
    }
  },

  async generateAccounts() {
    const classId = prompt('반 이름', '1학년1반');
    const prefix = prompt('학번 접두사', '1A');
    const count = parseInt(prompt('학생 수', '25') || '0');
    const startNo = parseInt(prompt('시작 번호', '1') || '1');
    if (!classId || !prefix || !count) return;

    try {
      if (state.settings.appsUrl) {
        const res = await API.generateAccounts({ classId, prefix, count, startNo });
        const accounts = res.accounts || [];
        alert(accounts.map(a => `${a.userId} / ${a.password}`).join('\n'));
      }
      toast('계정을 생성했습니다', 'success');
      await this.loadStudents();
    } catch (e) {
      toast('계정 생성 실패: ' + e.message, 'error');
    }
  },

  async changeTeacherPassword() {
    const pw = $('#teacherNewPw').value.trim();
    if (!pw) return toast('새 비밀번호를 입력하세요', 'warning');
    try {
      if (state.settings.appsUrl) await API.changeTeacherPassword({ password: pw });
      toast('선생님 비밀번호를 변경했습니다', 'success');
      $('#teacherNewPw').value = '';
    } catch (e) {
      toast('비밀번호 변경 실패: ' + e.message, 'error');
    }
  }
};

function updateRecordControls() {
  $('#recordControlsStudent').classList.toggle('hidden', Session.isTeacher);
  $('#recordControlsTeacher').classList.toggle('hidden', !Session.isTeacher);
  $('#teacherLoginCard').classList.toggle('hidden', Session.isTeacher);
  $('#adminPanel').classList.toggle('hidden', !Session.isTeacher);
}

async function studentLogin() {
  const userId = $('#studentId').value.trim();
  const password = $('#studentPw').value.trim();
  const classId = $('#studentClass').value.trim();

  if (!userId || !password) return toast('학생 ID와 비밀번호를 입력하세요', 'warning');

  try {
    if (state.settings.appsUrl) {
      const res = await API.loginStudent({ userId, password, classId });
      if (!res.success) return toast(res.error || '로그인 실패', 'error');
      Session.set({
        role: 'student',
        userId: res.userId || userId,
        userName: res.name || userId,
        classId: res.classId || classId || '미지정',
        githubToken: $('#repoToken').value.trim() || state.settings.githubToken || '',
        isGuest: false
      });
    } else {
      Session.set({
        role: 'student',
        userId,
        userName: userId,
        classId: classId || '미지정',
        githubToken: $('#repoToken').value.trim() || state.settings.githubToken || '',
        isGuest: false
      });
      toast('로컬 모드로 로그인했습니다', 'info');
    }

    updateRecordControls();
    switchPage('lms');
    await loadRecords();
  } catch (e) {
    if (!state.settings.appsUrl) {
      Session.set({
        role: 'student',
        userId,
        userName: userId,
        classId: classId || '미지정',
        githubToken: $('#repoToken').value.trim() || state.settings.githubToken || '',
        isGuest: false
      });
      updateRecordControls();
      switchPage('lms');
      return;
    }
    toast('로그인 실패: ' + e.message, 'error');
  }
}

function guestLogin() {
  Session.set({
    role: 'guest',
    userId: `guest_${Date.now().toString(36)}`,
    userName: 'Guest',
    classId: '미지정',
    githubToken: $('#repoToken').value.trim() || state.settings.githubToken || '',
    isGuest: true
  });
  updateRecordControls();
  switchPage('lms');
  toast('게스트 모드입니다. 기록 저장은 되지 않습니다', 'info');
}

async function teacherLogin() {
  const password = $('#teacherPw').value.trim();
  if (!password) return toast('관리 비밀번호를 입력하세요', 'warning');

  try {
    if (state.settings.appsUrl) {
      const res = await API.loginTeacher({ password });
      if (!res.success) return toast(res.error || '로그인 실패', 'error');
    } else {
      if (password !== 'admin') return toast('로컬 모드 기본 비밀번호는 admin 입니다', 'error');
    }

    Session.set({
      role: 'teacher',
      userId: 'teacher',
      userName: '선생님',
      classId: '',
      githubToken: state.settings.githubToken || $('#repoToken').value.trim() || '',
      isGuest: false,
      isTeacher: true
    });

    updateRecordControls();
    switchPage('admin');
    await Admin.loadStudents();
    toast('선생님으로 로그인했습니다', 'success');
  } catch (e) {
    if (!state.settings.appsUrl && password === 'admin') {
      Session.set({
        role: 'teacher',
        userId: 'teacher',
        userName: '선생님',
        classId: '',
        githubToken: state.settings.githubToken || $('#repoToken').value.trim() || '',
        isGuest: false,
        isTeacher: true
      });
      updateRecordControls();
      switchPage('admin');
      toast('로컬 관리자 모드로 로그인했습니다', 'info');
      return;
    }
    toast('선생님 로그인 실패: ' + e.message, 'error');
  }
}

function setPyodideStatus(ok) {
  $('#pyodideStatusDot').classList.toggle('ready', !!ok);
  $('#pyodideStatusText').textContent = ok ? 'Python 준비됨' : 'Python 로딩중...';
}

function switchPage(page) {
  $$('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
  $$('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.page === page));

  if (page === 'records') loadRecords();
  if (page === 'admin') updateRecordControls();
}

function closeCodeView() {
  $('#codeViewModal').classList.remove('show');
}

function bindEvents() {
  $('#btnLogout').onclick = () => {
    Session.clear();
    updateRecordControls();
    toast('로그아웃했습니다', 'info');
  };

  $$('.nav-btn').forEach(btn => {
    btn.onclick = () => switchPage(btn.dataset.page);
  });

  $('#btnStudentLogin').onclick = studentLogin;
  $('#btnGuestLogin').onclick = guestLogin;
  $('#btnTeacherLogin').onclick = teacherLogin;

  $('#btnSearchRepos').onclick = searchRepositories;
  $('#btnLoadSelectedRepo').onclick = loadSelectedRepository;
  $('#btnLoadDirectRepo').onclick = loadDirectRepository;
  $('#btnRefreshProblems').onclick = () => {
    if (state.repo.owner && state.repo.repo) {
      loadProblemsFromRepo(
        state.repo.owner,
        state.repo.repo,
        state.repo.branch || state.settings.defaultBranch,
        state.repo.folder || state.settings.defaultFolder,
        $('#repoToken').value.trim() || state.settings.githubToken || ''
      );
    } else {
      toast('먼저 저장소를 불러오세요', 'warning');
    }
  };

  $('#btnPreviewProblem').onclick = updateStudioPreview;
  $('#btnDownloadPy').onclick = downloadPyFile;
  $('#btnUploadGitHub').onclick = uploadToGitHub;
  $('#btnSaveSettings').onclick = saveSettings;

  $('#btnLoadRecords').onclick = loadRecords;
  $('#btnExportCSV').onclick = exportCSV;
  $('#recordSearch').oninput = () => renderRecords(state.recordsDisplayed);
  $('#recordScope').onchange = loadRecords;
  $('#recordClassFilter').onchange = loadRecords;

  $('#btnRefreshStudents').onclick = () => Admin.loadStudents();
  $('#btnAddStudent').onclick = () => Admin.addStudent();
  $('#btnGenerateAccounts').onclick = () => Admin.generateAccounts();
  $('#btnChangeTeacherPw').onclick = () => Admin.changeTeacherPassword();

  $('#btnCloseCodeView').onclick = closeCodeView;
  $('#codeViewModal').addEventListener('click', (e) => {
    if (e.target === $('#codeViewModal')) closeCodeView();
  });

  const studioFields = [
    'studioTitle', 'studioScore', 'studioDifficulty', 'studioTimeLimit', 'studioAvailableFrom', 'studioAvailableTo',
    'studioDescription', 'studioInputExample', 'studioOutputExample', 'studioAnswerCode', 'studioTemplateCode',
    'studioFolder', 'studioLibraryList'
  ];
  studioFields.forEach(id => {
    const el = $('#' + id);
    if (el) el.addEventListener('input', debounce(updateStudioPreview, 250));
    if (el && el.tagName === 'SELECT') el.addEventListener('change', updateStudioPreview);
  });

  $('#codeViewModal').addEventListener('click', (e) => {
    if (e.target === $('#codeViewModal')) closeCodeView();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeCodeView();
    if (e.ctrlKey && e.key === 'Enter') {
      if ($('#page-lms').classList.contains('active') && $('#codeEditor')) {
        e.preventDefault();
        if (e.shiftKey) submitCurrentCode(false);
        else runCurrentCode(false);
      }
    }
  });
}

function debounce(fn, delay = 300) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

async function loadServerConfig() {
  if (!state.settings.appsUrl) return;
  try {
    const res = await API.getConfig();
    if (res && res.config) {
      const c = res.config;
      if (c.defaultRepo) state.settings.defaultRepo = c.defaultRepo;
      if (c.defaultBranch) state.settings.defaultBranch = c.defaultBranch;
      if (c.defaultFolder) state.settings.defaultFolder = c.defaultFolder;
      if (c.librariesFolder) state.settings.librariesFolder = c.librariesFolder;
      if (c.backupRepo) state.settings.backupRepo = c.backupRepo;
      if (c.backupBranch) state.settings.backupBranch = c.backupBranch;
      if (c.defaultTimeLimit) state.settings.defaultTimeLimit = parseInt(c.defaultTimeLimit) || state.settings.defaultTimeLimit;
      if (c.gradingMode) state.settings.gradingMode = c.gradingMode;
      saveSettingsLocal();
      applySettingsToUI();
    }
  } catch (e) {
    console.warn('서버 설정 로드 실패:', e.message);
  }
}

async function initApp() {
  loadSettingsFromLocal();
  Session.load();
  applySettingsToUI();
  updateSessionUI();
  bindEvents();
  state.records = loadLocalRecords();
  renderRecords(state.records);
  buildClassOptions();
  updateStudioPreview();
  setPyodideStatus(false);

  try {
    await PyRunner.init();
  } catch (e) {
    console.warn(e);
  }

  await loadServerConfig();
  applySettingsToUI();

  if (Session.role === 'teacher') {
    updateRecordControls();
    await Admin.loadStudents();
  }

  if (Session.role === 'student') {
    updateRecordControls();
    await loadRecords();
  }

  // default repo prefill
  if (state.settings.defaultRepo) {
    $('#repoDirect').value = state.settings.defaultRepo;
    $('#repoFolder').value = state.settings.defaultFolder || 'problems';
    $('#repoBranch').value = state.settings.defaultBranch || '';
  }
}
document.addEventListener('DOMContentLoaded', initApp);
window.Admin = Admin;
window.switchPage = switchPage;
window.closeCodeView = closeCodeView;
window.searchRepositories = searchRepositories;
window.loadSelectedRepository = loadSelectedRepository;
window.loadDirectRepository = loadDirectRepository;
window.loadRecords = loadRecords;
window.exportCSV = exportCSV;
window.selectProblem = selectProblem;
window.runCurrentCode = runCurrentCode;
window.submitCurrentCode = submitCurrentCode;
window.studentLogin = studentLogin;
window.guestLogin = guestLogin;
window.teacherLogin = teacherLogin;
window.saveSettings = saveSettings;
window.downloadPyFile = downloadPyFile;
window.uploadToGitHub = uploadToGitHub;
window.updateStudioPreview = updateStudioPreview;
