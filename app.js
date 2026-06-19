'use strict';

// ==================================================
// GitCo — app.js
// 개발: 석근우 (geunman@geekbyte.kro.kr)
// ==================================================

const App = {
  cfg: { appsUrl:'', defaultRepo:'' },
  session: { role:'guest', userId:'', userName:'게스트', classId:'' },
  problems: [],
  current: null,
  records: [],
  pyodide: null,
  pyodideReady: false,
  timer: null,
  repo: { owner:'', repo:'', branch:'main', folder:'problems' }
};

// ---- DOM 헬퍼 ----
function $(id){ return document.getElementById(id); }
function hide(el){ if(typeof el==='string') el=$(el); if(el) el.classList.add('hidden'); }
function show(el){ if(typeof el==='string') el=$(el); if(el) el.classList.remove('hidden'); }
function val(id){ const e=$(id); return e? e.value.trim() :''; }
function esc(s){ const d=document.createElement('div'); d.textContent=s??''; return d.innerHTML; }
function fmtTime(s){ s=Math.max(0,parseInt(s)||0); return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }
function atobU(s){ try{ const b=atob(String(s).replace(/\s/g,'')); const a=new Uint8Array(b.length); for(let i=0;i<b.length;i++) a[i]=b.charCodeAt(i); return new TextDecoder().decode(a);}catch{return atob(s);} }

async function sha256(text){
  const buf=await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function mdRender(text){
  if(!text) return '';
  let t=String(text).replace(/\[이미지:\s*(https?:\/\/[^\]]+)\]/gi,'<img src="$1" alt="img" loading="lazy">');
  try{ if(typeof marked!=='undefined') t=marked.parse(t,{breaks:true,gfm:true}); else t=t.replace(/\n/g,'<br>'); }
  catch{ t=t.replace(/\n/g,'<br>'); }
  return t;
}

function parseRepoInput(raw){
  raw=String(raw??'').trim();
  const m=raw.match(/github\.com\/([^/\s]+)\/([^/\s]+)/i);
  if(m) return { owner:m[1], repo:m[2].replace(/\.git$/,'') };
  const p=raw.split('/').filter(Boolean);
  if(p.length>=2) return { owner:p[0], repo:p[1].replace(/\.git$/,'') };
  return null;
}

// ---- 토스트 ----
function toast(msg, type='info'){
  const c=$('toastContainer'); if(!c) return;
  const d=document.createElement('div');
  d.className='toast '+(type==='ok'?'ok':type==='fail'?'fail':'');
  d.textContent=msg; c.appendChild(d);
  setTimeout(()=>d.remove(), 3000);
}
function showLoading(m='처리 중…'){ const ov=$('loadingOverlay'); if(ov){ $('loadingText').textContent=m; ov.classList.remove('hidden'); } }
function hideLoading(){ const ov=$('loadingOverlay'); if(ov) ov.classList.add('hidden'); }

// ---- 설정/세션 ----
function saveCfg(){
  App.cfg.appsUrl=val('inAppsUrl');
  App.cfg.defaultRepo=val('inDefaultRepo');
  localStorage.setItem('gitco_cfg', JSON.stringify(App.cfg));
  toast('설정 저장됨','ok');
}
function loadCfg(){
  try{ const c=JSON.parse(localStorage.getItem('gitco_cfg')||'{}'); App.cfg={appsUrl:'',defaultRepo:'',...c}; }
  catch{ App.cfg={appsUrl:'',defaultRepo:''}; }
  $('inAppsUrl').value=App.cfg.appsUrl||'';
  $('inDefaultRepo').value=App.cfg.defaultRepo||'';
  if(App.cfg.defaultRepo) $('inDirect').value=App.cfg.defaultRepo;
}

function updateSessionUI(){
  const u=$('userLabel'); if(!u) return;
  if(App.session.role==='teacher') u.textContent='👩‍🏫 선생님';
  else if(App.session.role==='student') u.textContent=`🧑‍🎓 ${App.session.userName||App.session.userId}`;
  else u.textContent='게스트';

  $('btnLogout').classList.toggle('hidden', App.session.role==='guest');
  const b=$('btnAdminLogin'); if(b) b.disabled = App.session.role==='teacher';
  const b2=$('btnLogout2'); if(b2) b2.classList.toggle('hidden', App.session.role==='guest');
  $('adminPanel').classList.toggle('hidden', App.session.role!=='teacher');
}

function logout(){
  App.session={role:'guest',userId:'',userName:'게스트',classId:''};
  updateSessionUI();
  toast('로그아웃됨','info');
}

// ---- 페이지 전환 (data-page 기준) ----
function switchPage(page){
  document.querySelectorAll('[data-page]').forEach(el=>{
    if(el.tagName==='SECTION' || el.classList.contains('page')) el.classList.toggle('active', el.dataset.page===page);
  });
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.page===page));
  if(page==='records') renderRecords();
}

// ---- GitHub API (토큰 없어도 공개는 가능) ----
const GH = {
  async req(path, token){
    const h={Accept:'application/vnd.github+json'};
    if(token) h.Authorization=`Bearer ${token}`;
    const r=await fetch('https://api.github.com'+path, {headers:h});
    const t=await r.text();
    if(!r.ok) throw new Error('GitHub 오류 '+r.status+': '+t.slice(0,150));
    return t? JSON.parse(t) : {};
  },
  enc(s){ return encodeURIComponent(s); },
  async defaultBranch(o,r,tk){
    try{ const i=await this.req(`/repos/${this.enc(o)}/${this.enc(r)}`,tk); return i.default_branch||'main'; }
    catch{ return 'main'; }
  },
  async searchRepos(q,tk){
    const d=await this.req(`/search/repositories?q=${encodeURIComponent(q)}&per_page=30&sort=stars&order=desc`,tk);
    return d.items||[];
  },
  async userRepos(name,tk){
    if(tk) return await this.req('/user/repos?per_page=100&visibility=all&sort=updated',tk);
    return await this.req(`/users/${this.enc(name)}/repos?per_page=100&type=owner&sort=updated`);
  },
  async listDir(o,r,p,b,tk){
    const path=p? '/'+p.split('/').map(this.enc).join('/') :'';
    const ref=b? `?ref=${encodeURIComponent(b)}` :'';
    return await this.req(`/repos/${this.enc(o)}/${this.enc(r)}/contents${path}${ref}`,tk);
  },
  async fileText(o,r,p,b,tk){
    const d=await this.listDir(o,r,p,b,tk);
    if(Array.isArray(d)) throw new Error('폴더입니다');
    if(d.content) return atobU(d.content);
    if(d.download_url){ const x=await fetch(d.download_url); return await x.text(); }
    throw new Error('파일 읽기 실패');
  },
  async walkPy(o,r,p,b,tk,acc){
    acc=acc||[];
    let it;
    try{ it=await this.listDir(o,r,p,b,tk); }catch{ return acc; }
    if(!Array.isArray(it)) it=[it];
    for(const x of it){
      if(x.type==='file' && x.name.endsWith('.py')) acc.push(x);
      else if(x.type==='dir') await this.walkPy(o,r,x.path,b,tk,acc);
    }
    return acc;
  }
};

// ---- Pyodide ----
async function initPy(){
  if(App.pyodide) return;
  try{
    App.pyodide=await loadPyodide({indexURL:'https://cdn.jsdelivr.net/pyodide/v0.26.0/full/'});
    App.pyodideReady=true;
    const s=$('pyStatus'); if(s){ s.textContent='🟢 Python 준비됨'; s.classList.add('ready'); }
  }catch(e){
    const s=$('pyStatus'); if(s) s.textContent='❌ 로딩 실패';
    toast('Python 로딩 실패: '+e.message,'fail');
  }
}
async function runPy(code, stdin='', timeoutMs=10000){
  if(!App.pyodide) await initPy();
  if(!App.pyodide) throw new Error('Python 미준비');
  const w=`
import sys, io, traceback as _tb
_o,_e,_i=sys.stdout,sys.stderr,sys.stdin
sys.stdout=io.StringIO(); sys.stderr=io.StringIO(); sys.stdin=io.StringIO(${JSON.stringify(stdin||'')})
try: exec(compile(${JSON.stringify(code)},'<code>','exec'), {})
except Exception: _tb.print_exc()
_a,_b=sys.stdout.getvalue(),sys.stderr.getvalue()
sys.stdout,sys.stderr,sys.stdin=_o,_e,_i
(_a,_b)
`;
  const res=await Promise.race([
    App.pyodide.runPythonAsync(w),
    new Promise((_,rej)=>setTimeout(()=>rej(new Error('시간 초과')), timeoutMs))
  ]);
  return {stdout:String(res[0]||''), stderr:String(res[1]||'')};
}
async function loadLibs(o,r,folder,b,tk){
  if(!folder||!o||!r) return;
  try{
    const fs=await GH.walkPy(o,r,folder,b,tk);
    for(const f of fs){
      const code=await GH.fileText(o,r,f.path,b,tk);
      const name=f.name.replace(/\.py$/i,'').replace(/[^A-Za-z0-9_]/g,'_');
      if(name&&App.pyodide){
        App.pyodide.runPython(`
import sys, types
_m=types.ModuleType(${JSON.stringify(name)})
exec(compile(${JSON.stringify(code)},'<${name}>','exec'),_m.__dict__)
sys.modules[${JSON.stringify(name)}]=_m
`);
      }
    }
  }catch{}
}

// ---- 문제 파싱 ----
function parseProblem(path, content){
  const lines=String(content||'').split('\n');
  const m={path,repo:'',title:'',score:10,difficulty:'보통',timeLimit:0,inputEx:'',outputEx:'',description:'',answer:'',template:''};
  let inDesc=false;
  for(const l of lines){
    const t=l.trim();
    if(t==='# ===학생코드==='||t==='# ===정답코드===') break;
    if(inDesc){
      if(t.startsWith('#')){ m.description+='\n'+t.replace(/^#\s?/,''); continue; }
      inDesc=false;
    }
    if(!t.startsWith('#')) continue;
    const raw=t.replace(/^#\s?/,'');
    const ci=raw.indexOf(':');
    if(ci<0) continue;
    const k=raw.slice(0,ci).trim(), v=raw.slice(ci+1).trim();
    if(k==='문제') m.title=v;
    else if(k==='점수') m.score=parseInt(v)||10;
    else if(k==='난이도') m.difficulty=v;
    else if(k==='시간제한') m.timeLimit=parseInt(v)||0;
    else if(k==='입력예시') m.inputEx=v;
    else if(k==='출력예시') m.outputEx=v;
    else if(k==='설명'){ m.description=v; inDesc=true; }
  }
  const si=lines.findIndex(l=>l.trim()==='# ===학생코드===');
  const ai=lines.findIndex(l=>l.trim()==='# ===정답코드===');
  if(si>=0) m.template=lines.slice(si+1, ai>si?ai:undefined).join('\n').trim();
  if(ai>=0) m.answer=lines.slice(ai+1).join('\n').trim();
  if(!m.template) m.template='# 여기에 코드를 작성하세요';
  if(!m.answer) m.answer=m.template;
  if(!m.title) m.title=path.split('/').pop().replace(/\.py$/i,'');
  return m;
}

// ---- 저장소 검색 ----
async function searchRepos(){
  const q=val('inQuery'); const tk=val('inToken');
  if(!q) return toast('사용자명 또는 검색어를 입력하세요','fail');
  showLoading('저장소 검색 중…');
  try{
    let list;
    if(tk) list=await GH.userRepos(q,tk);
    else list=await GH.searchRepos(q,'');
    const sel=$('repoSelect'); sel.innerHTML='';
    if(!list.length){ sel.innerHTML='<option>결과 없음</option>'; $('btnLoadSelected').disabled=true; }
    else{
      list.forEach(r=>{
        const o=document.createElement('option');
        o.value=r.full_name; o.dataset.owner=r.owner.login; o.dataset.repo=r.name;
        o.dataset.branch=r.default_branch||'main';
        o.textContent=r.full_name+(r.private?' (private)':' (public)');
        sel.appendChild(o);
      });
      $('btnLoadSelected').disabled=false;
    }
    hideLoading(); toast(`${list.length}개 저장소 발견`,'ok');
  }catch(e){ hideLoading(); toast('검색 실패: '+e.message,'fail'); }
}

async function loadDirect(){
  const inp=val('inDirect');
  const p=parseRepoInput(inp);
  if(!p) return toast('owner/repo 또는 GitHub URL 형식으로 입력하세요','fail');
  showLoading('브랜치 확인 중…');
  const tk=val('inToken');
  const branch=await GH.defaultBranch(p.owner,p.repo,tk);
  const folder=val('inFolder')||'problems';
  const libF=val('inLib')||'libraries';
  await loadRepo(p.owner,p.repo,branch,folder,libF,tk);
}

async function loadSelected(){
  const sel=$('repoSelect'); const opt=sel.options[sel.selectedIndex];
  if(!opt||!opt.dataset.owner) return toast('저장소를 선택하세요','fail');
  const tk=val('inToken');
  const branch=opt.dataset.branch||'main';
  const folder=val('inFolder')||'problems';
  const libF=val('inLib')||'libraries';
  await loadRepo(opt.dataset.owner,opt.dataset.repo,branch,folder,libF,tk);
}

async function loadRepo(owner, repo, branch, folder, libF, tk){
  showLoading(`${owner}/${repo} 불러오는 중…`);
  try{
    await initPy();
    App.repo={owner,repo,branch,folder};

    if(libF) await loadLibs(owner,repo,libF,branch,tk);

    const files=await GH.walkPy(owner,repo,folder,branch,tk);
    if(!files.length){ hideLoading(); toast(`'${folder}' 폴더에 .py 없음`,'fail'); return; }

    App.problems=[];
    for(const f of files){
      const text=await GH.fileText(owner,repo,f.path,branch,tk);
      const p=parseProblem(f.path,text);
      p.repo=`${owner}/${repo}`;
      App.problems.push(p);
    }
    App.current=null;
    renderProblemList();
    hideLoading(); toast(`${App.problems.length}개 문제 로드 완료`,'ok');
  }catch(e){ hideLoading(); toast('로드 실패: '+e.message,'fail'); }
}

// ---- 문제 목록 ----
function renderProblemList(){
  const box=$('problemList'); $('problemCount').textContent=App.problems.length?`(${App.problems.length}개)`:'';
  if(!App.problems.length){ box.innerHTML='<p class="empty-msg">문제가 없습니다.</p>'; return; }
  box.innerHTML=App.problems.map((p,i)=>{
    const cls=p.difficulty==='쉬움'?'diff-easy':p.difficulty==='어려움'?'diff-hard':'diff-mid';
    const act=App.current&&App.current.path===p.path?' active':'';
    return `<div class="prob-item${act}" data-idx="${i}">
      <span class="p-title">${esc(p.title)}</span>
      <span class="p-score">${p.score}점</span>
      <span class="${cls}">${esc(p.difficulty)}</span>
    </div>`;
  }).join('');
  box.querySelectorAll('.prob-item').forEach(el=>{
    el.addEventListener('click',()=>selectProblem(parseInt(el.dataset.idx)));
  });
}

function selectProblem(i){
  const p=App.problems[i]; if(!p) return;
  App.current=p; renderProblemList(); renderProblemDetail(p);
}

function renderProblemDetail(p){
  const main=document.querySelector('.lms-main');
  const tl=p.timeLimit? `${p.timeLimit}초` :'제한 없음';
  main.innerHTML=`
    <div class="card prob-detail">
      <h2>${esc(p.title)}</h2>
      <div class="prob-meta">점수 <strong>${p.score}</strong> · 난이도 <strong>${esc(p.difficulty)}</strong> · 시간 <strong>${tl}</strong></div>
      <div class="prob-body">${mdRender(p.description||'설명이 없습니다.')}</div>
      <label>입력 (stdin)</label>
      <textarea id="codeStdin" class="inp ta" rows="2">${esc(p.inputEx)}</textarea>
      <div class="code-area">
        <div class="code-toolbar">
          <span>🐍 Python</span>
          <div style="display:flex;gap:6px">
            <button id="btnResetCode" class="btn">↩ 초기화</button>
            <button id="btnRun" class="btn">▶ 실행</button>
            <button id="btnSubmit" class="btn primary" ${App.session.role==='guest'?'disabled':''}>✅ 제출</button>
          </div>
        </div>
        <textarea id="codeEditor" class="code-editor" spellcheck="false">${esc(p.template)}</textarea>
      </div>
      <div class="output-area">
        <div class="output-head">실행 결과</div>
        <pre id="outputArea">코드를 실행하면 결과가 여기에 표시됩니다.</pre>
      </div>
      <div class="timer-line" id="timerLine"></div>
    </div>
  `;
  $('btnResetCode').addEventListener('click',()=>{
    $('codeEditor').value=p.template; $('codeStdin').value=p.inputEx;
    const o=$('outputArea'); o.textContent='초기화됨'; o.className='';
  });
  $('btnRun').addEventListener('click',()=>doRun(false));
  $('btnSubmit').addEventListener('click',()=>doRun(true));
  $('codeEditor').addEventListener('keydown',e=>{
    if(e.key!=='Tab') return;
    e.preventDefault();
    const t=e.target, s=t.selectionStart;
    t.value=t.value.slice(0,s)+'    '+t.value.slice(t.selectionEnd);
    t.selectionStart=t.selectionEnd=s+4;
  });
  startTimer(p.timeLimit||0);
}

function startTimer(lim){
  stopTimer();
  const line=$('timerLine'); if(!line) return;
  if(!lim){ line.textContent=''; return; }
  let rem=lim;
  line.textContent=`⏱ 남은 시간: ${fmtTime(rem)}`;
  App.timer=setInterval(()=>{
    rem--;
    if(rem<=0){ stopTimer(); line.textContent='⏰ 시간 초과! 자동 제출'; doRun(true); }
    else line.textContent=`⏱ 남은 시간: ${fmtTime(rem)}`;
  },1000);
}
function stopTimer(){ if(App.timer){ clearInterval(App.timer); App.timer=null; } }

async function doRun(isSubmit){
  const p=App.current; if(!p) return toast('문제 먼저 선택','fail');
  if(!App.pyodideReady) return toast('Python 로딩중…','fail');
  const code=$('codeEditor').value, stdin=$('codeStdin').value;
  const out=$('outputArea'); out.className=''; out.textContent=isSubmit?'채점 중…':'실행 중…';
  const tmo=Math.max(5000,(p.timeLimit||30)*1000);
  try{
    const stu=await runPy(code,stdin,tmo);
    const sOut=stu.stdout.trim(), sErr=stu.stderr.trim();
    if(!isSubmit){
      out.textContent=sOut||'(출력 없음)';
      if(sErr) out.textContent+='\n[오류]\n'+sErr;
      out.className=sErr?'err':'ok';
      return;
    }
    const ans=await runPy(p.answer,stdin,tmo);
    const aOut=ans.stdout.trim();
    const ok=sOut===aOut;
    const score=ok? p.score:0;
    if(ok){
      out.textContent=`✅ 정답! +${score}점\n\n${sOut||'(없음)'}`;
      out.className='ok'; toast('정답!','ok');
    }else{
      out.textContent=`❌ 오답\n\n내 출력:\n${sOut||'(없음)'}\n\n기대 출력:\n${aOut||'(없음)'}`;
      out.className='err'; toast('오답','fail');
    }
    stopTimer();
    saveRecord(p, code, ok, score, sOut, aOut);
  }catch(e){
    out.textContent='오류: '+e.message; out.className='err';
  }
}

function saveRecord(p, code, ok, score, sOut, aOut){
  const rec={
    timestamp:new Date().toISOString(),
    studentId:App.session.userId||'guest',
    studentName:App.session.userName||'게스트',
    classId:App.session.classId||'미지정',
    repo:p.repo||`${App.repo.owner}/${App.repo.repo}`,
    problem:p.title, problemPath:p.path,
    result:ok?'correct':'wrong',
    score, maxScore:p.score, code, sOut, aOut
  };
  App.records.unshift(rec);
  try{ localStorage.setItem('gitco_records', JSON.stringify(App.records.slice(0,500))); }catch{}
  if(App.cfg.appsUrl){
    fetch(App.cfg.appsUrl,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain'},body:JSON.stringify({action:'submit',...rec})}).catch(()=>{});
  }
}

// ---- 기록 ----
function renderRecords(){
  try{ App.records=JSON.parse(localStorage.getItem('gitco_records')||'[]'); }catch{ App.records=[]; }
  const q=($('inRecordSearch')?.value||'').toLowerCase();
  const list=q? App.records.filter(r=>(r.studentId+r.studentName+r.problem).toLowerCase().includes(q)):App.records;
  const body=$('recordsBody');
  const total=list.length, corr=list.filter(r=>r.result==='correct').length;
  const rate=total? Math.round(corr/total*100):0;
  $('recordStats').innerHTML=`제출 <strong>${total}</strong> · 정답 <strong>${corr}</strong> · 정답률 <strong>${rate}%</strong>`;
  if(!total){ body.innerHTML='<tr><td colspan="7" class="empty-td">기록이 없습니다</td></tr>'; return; }
  body.innerHTML=list.slice(0,200).map((r,i)=>`
    <tr>
      <td>${new Date(r.timestamp).toLocaleString('ko-KR')}</td>
      <td>${esc(r.studentName||r.studentId)}</td>
      <td>${esc(r.repo||'-')}</td>
      <td>${esc(r.problem)}</td>
      <td class="${r.result==='correct'?'res-ok':'res-fail'}">${r.result==='correct'?'✅ 정답':'❌ 오답'}</td>
      <td>${r.score}/${r.maxScore}</td>
      <td><button class="btn" data-ci="${i}">보기</button></td>
    </tr>`).join('');
  body.querySelectorAll('[data-ci]').forEach(b=>{
    b.addEventListener('click',()=>viewCode(parseInt(b.dataset.ci)));
  });
}
function viewCode(i){
  const r=App.records[i]; if(!r||!r.code) return toast('코드 없음','fail');
  $('modalCode').textContent=r.code;
  $('codeModal').classList.remove('hidden');
}
function closeModal(){ $('codeModal').classList.add('hidden'); }
function exportCSV(){
  if(!App.records.length) return toast('기록 없음','fail');
  const h=['시간','학생ID','학생명','반','저장소','문제','결과','점수','만점'];
  const rows=App.records.map(r=>[r.timestamp,r.studentId,r.studentName,r.classId,r.repo,r.problem,r.result,r.score,r.maxScore]);
  const csv=[h,...rows].map(row=>row.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const b=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(b);
  a.download=`gitco_records_${new Date().toISOString().slice(0,10)}.csv`; a.click();
  URL.revokeObjectURL(a.href); toast('CSV 다운로드','ok');
}

// ---- 스튜디오 ----
function updateStudioPreview(){
  const t=val('stTitle')||'제목 없음';
  const sc=val('stScore')||10;
  const df=val('stDiff')||'보통';
  const tm=val('stTime')||0;
  const desc=$('stDesc')?.value.trim()||'';
  const ie=val('stInEx'); const oe=val('stOutEx');
  const ans=$('stAnswer')?.value.trim()||'print()';
  const tmp=$('stTemplate')?.value.trim()||'# 여기에 코드를 작성하세요';

  let py=`# 문제: ${t}\n# 점수: ${sc}\n# 난이도: ${df}\n# 시간제한: ${tm}\n`;
  if(ie) py+=`# 입력예시: ${ie}\n`;
  if(oe) py+=`# 출력예시: ${oe}\n`;
  py+=`# 설명:\n${(desc||'설명 없음').split('\n').map(l=>`# ${l}`).join('\n')}\n\n`;
  py+=`# ===학생코드===\n${tmp}\n\n# ===정답코드===\n${ans}\n`;

  $('stPreview').textContent=py;
  let md=desc; if(ie) md+=`\n\n**입력 예시:** \`${ie}\``; if(oe) md+=`\n\n**출력 예시:** \`${oe}\``;
  $('stRender').innerHTML=mdRender(md);
}
function downloadPy(){
  updateStudioPreview();
  const c=$('stPreview').textContent;
  const name=(val('stTitle')||'problem').replace(/[^A-Za-z0-9가-힣_-]/g,'_');
  const b=new Blob([c],{type:'text/plain;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(b);
  a.download=`${name}.py`; a.click(); URL.revokeObjectURL(a.href);
  toast('다운로드 완료','ok');
}

// ---- 관리자 ----
async function adminLogin(){
  const pw=val('inAdminPw'); if(!pw) return toast('비밀번호 입력','fail');
  let ok=false;
  if(App.cfg.appsUrl){
    try{
      const hash=await sha256(pw);
      const res=await jsonpCall(App.cfg.appsUrl,'loginTeacher',{passwordHash:hash});
      ok=res&&res.success;
    }catch{ ok=(pw==='admin'); }
  } else ok=(pw==='admin');
  if(!ok) return toast('비밀번호 오류','fail');
  App.session={role:'teacher',userId:'teacher',userName:'선생님',classId:''};
  updateSessionUI(); toast('관리자 로그인','ok');
}
function logoutAdmin(){
  App.session={role:'guest',userId:'',userName:'게스트',classId:''};
  updateSessionUI(); toast('로그아웃','info');
}

async function changeAdminPw(){
  const pw=val('inNewAdminPw'); if(!pw) return toast('새 비번 입력','fail');
  const hash=await sha256(pw);
  if(App.cfg.appsUrl){
    fetch(App.cfg.appsUrl,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain'},body:JSON.stringify({action:'changeTeacherPassword',passwordHash:hash})}).catch(()=>{});
  }
  toast('비밀번호 변경 요청됨 (서버 반영까지 잠시 걸림)','ok');
  $('inNewAdminPw').value='';
}

async function addStudent(){
  const id=prompt('학번/아이디'); if(!id) return;
  const name=prompt('이름')||'';
  const cls=prompt('반')||'기본';
  const pw=prompt('초기 비밀번호')||'';
  if(!pw) return toast('비밀번호 필수','fail');
  const hash=await sha256(pw);
  if(App.cfg.appsUrl){
    fetch(App.cfg.appsUrl,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain'},body:JSON.stringify({action:'addStudent',userId:id,name,classId:cls,passwordHash:hash})}).catch(()=>{});
  }
  toast(`${id} 학생 추가됨`,'ok');
}

async function genAccounts(){
  const cls=prompt('반 이름','1학년1반')||'';
  const pfx=prompt('학번 접두사','1A')||'';
  const cnt=parseInt(prompt('학생 수','25')||'0');
  const start=parseInt(prompt('시작 번호','1')||'1');
  if(!cls||!pfx||!cnt) return toast('모든 항목 입력','fail');
  if(App.cfg.appsUrl){
    try{
      const res=await jsonpCall(App.cfg.appsUrl,'generateAccounts',{classId:cls,prefix:pfx,count:cnt,startNo:start});
      if(res&&res.accounts){
        const txt=res.accounts.map(a=>`${a.userId} / ${a.password}`).join('\n');
        const b=new Blob([txt],{type:'text/plain;charset=utf-8'});
        const a=document.createElement('a'); a.href=URL.createObjectURL(b);
        a.download=`accounts_${cls}.txt`; a.click(); URL.revokeObjectURL(a.href);
        toast(`${res.accounts.length}개 계정 생성 → txt 다운로드`,'ok');
        return;
      }
    }catch{}
  }
  toast('Apps Script URL을 먼저 설정하세요','fail');
}

// JSONP 헬퍼
function jsonpCall(url, action, data){
  return new Promise((resolve,reject)=>{
    const cb=`_gitco_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const s=document.createElement('script');
    window[cb]=d=>{ delete window[cb]; s.remove(); resolve(d); };
    s.onerror=()=>{ delete window[cb]; s.remove(); reject(new Error('연결 실패')); };
    s.src=`${url}?action=${encodeURIComponent(action)}&data=${encodeURIComponent(JSON.stringify(data))}&callback=${cb}`;
    document.body.appendChild(s);
    setTimeout(()=>{ if(window[cb]){ delete window[cb]; s.remove(); reject(new Error('시간 초과')); } }, 10000);
  });
}

// ---- Apps Script 코드 표시 ----
const APPS_SCRIPT_CODE=`// ============================================
// GitCo — Google Apps Script
// (Google Sheets → 확장 프로그램 → Apps Script에 붙여넣기)
// ============================================

function doGet(e){
  const action=(e.parameter.action||'').trim();
  const callback=(e.parameter.callback||'').trim();
  let data={};
  try{ data=e.parameter.data? JSON.parse(e.parameter.data):{}; }catch{ data={}; }
  const result=dispatch(action,data);
  return respond(result, callback);
}
function doPost(e){
  let data={};
  try{ data=e.postData&&e.postData.contents? JSON.parse(e.postData.contents):{}; }catch{ data={}; }
  return respond(dispatch((data.action||'').trim(), data), '');
}

function dispatch(action, data){
  try{
    switch(action){
      case 'loginTeacher': return handleLoginTeacher(data);
      case 'addStudent': return handleAddStudent(data);
      case 'generateAccounts': return handleGenerateAccounts(data);
      case 'changeTeacherPassword': return handleChangeTeacherPassword(data);
      case 'submit': return handleSubmit(data);
      default: return { success:false, error:'Unknown action: '+action };
    }
  }catch(e){ return { success:false, error:e.message }; }
}

function respond(obj, callback){
  const json=JSON.stringify(obj);
  if(callback && /^[A-Za-z_$][\w$]*$/.test(callback)){
    return ContentService.createTextOutput(callback+'('+json+');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

// ---- 시트 헬퍼 ----
function ensureSheet(name, headers){
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  let sh=ss.getSheetByName(name);
  if(!sh) sh=ss.insertSheet(name);
  if(sh.getLastRow()===0 && headers) sh.appendRow(headers);
  return sh;
}
function findRow(sheet, col, val){
  const d=sheet.getDataRange().getValues();
  for(let i=1;i<d.length;i++) if(String(d[i][col])===String(val)) return i+1;
  return 0;
}
function sha256_(text){
  const b=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return b.map(x=>((x+256)%256).toString(16).padStart(2,'0')).join('');
}

// ---- 선생님 ----
function getConfig_(){
  const sh=ensureSheet('Config',['Key','Value']);
  const d=sh.getDataRange().getValues();
  const m={};
  for(let i=1;i<d.length;i++) m[String(d[i][0])]=d[i][1];
  if(!m.teacherPasswordHash) m.teacherPasswordHash=sha256_('admin');
  return m;
}
function setConfig_(k,v){
  const sh=ensureSheet('Config',['Key','Value']);
  const r=findRow(sh,0,k);
  if(r) sh.getRange(r,2).setValue(v); else sh.appendRow([k,v]);
}
function handleLoginTeacher(data){
  const cfg=getConfig_();
  if(String(data.passwordHash||'') !== String(cfg.teacherPasswordHash||'')) return { success:false, error:'비밀번호 불일치' };
  return { success:true, role:'teacher' };
}
function handleChangeTeacherPassword(data){
  setConfig_('teacherPasswordHash', String(data.passwordHash||''));
  return { success:true };
}

// ---- 학생 ----
function handleAddStudent(data){
  const sh=ensureSheet('Students',['UserId','Name','ClassId','PasswordHash']);
  if(findRow(sh,0,data.userId)) return { success:false, error:'이미 있는 학번' };
  sh.appendRow([data.userId, data.name||'', data.classId||'', data.passwordHash||'']);
  return { success:true };
}
function handleGenerateAccounts(data){
  const sh=ensureSheet('Students',['UserId','Name','ClassId','PasswordHash']);
  const prefix=data.prefix||'S';
  const count=parseInt(data.count)||0;
  const start=parseInt(data.startNo)||1;
  const out=[];
  for(let i=0;i<count;i++){
    const uid=prefix+String(start+i).padStart(3,'0');
    if(findRow(sh,0,uid)) continue;
    const pw=makePw_(8);
    sh.appendRow([uid,'', data.classId||'기본', sha256_(pw)]);
    out.push({ userId:uid, password:pw });
  }
  return { success:true, accounts:out };
}
function makePw_(len){
  const c='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let r=''; for(let i=0;i<len;i++) r+=c[Math.floor(Math.random()*c.length)];
  return r;
}

// ---- 기록 ----
function handleSubmit(data){
  const sh=ensureSheet('Records',['Timestamp','StudentId','StudentName','ClassId','Repo','Problem','ProblemPath','Result','Score','MaxScore','Code']);
  sh.appendRow([
    data.timestamp||new Date().toISOString(),
    data.studentId||'', data.studentName||'', data.classId||'',
    data.repo||'', data.problem||'', data.problemPath||'',
    data.result||'', data.score||0, data.maxScore||0,
    String(data.code||'').slice(0,50000)
  ]);
  return { success:true };
}

// ---- 초기 설정 ----
function onOpen(){
  SpreadsheetApp.getUi().createMenu('⚡ GitCo').addItem('초기 설정 실행','initialSetup').addToUi();
}
function initialSetup(){
  ensureSheet('Config',['Key','Value']);
  ensureSheet('Students',['UserId','Name','ClassId','PasswordHash']);
  ensureSheet('Records',['Timestamp','StudentId','StudentName','ClassId','Repo','Problem','ProblemPath','Result','Score','MaxScore','Code']);
  setConfig_('teacherPasswordHash', sha256_('admin'));
  SpreadsheetApp.getActive().toast('GitCo 초기 설정 완료! 관리자 비밀번호: admin');
}`;

function showScript(){
  $('scriptCode').textContent=APPS_SCRIPT_CODE;
  $('scriptModal').classList.remove('hidden');
}
function closeScriptModal(){ $('scriptModal').classList.add('hidden'); }

// ---- 이벤트 ----
function bind(){
  document.querySelectorAll('.nav-btn').forEach(b=>{
    b.addEventListener('click',()=>switchPage(b.dataset.page));
  });
  $('btnLogout').addEventListener('click',logout);
  $('btnSearch').addEventListener('click',searchRepos);
  $('btnLoadDirect').addEventListener('click',loadDirect);
  $('btnLoadSelected').addEventListener('click',loadSelected);
  $('btnSaveCfg').addEventListener('click',saveCfg);
  $('btnAdminLogin').addEventListener('click',adminLogin);
  $('btnLogout2').addEventListener('click',logoutAdmin);
  $('btnChangeAdminPw').addEventListener('click',changeAdminPw);
  $('btnAddStudent').addEventListener('click',addStudent);
  $('btnGenAccounts').addEventListener('click',genAccounts);
  $('btnExportCSV').addEventListener('click',exportCSV);
  $('inRecordSearch').addEventListener('input',renderRecords);
  $('btnDownload').addEventListener('click',downloadPy);
  $('btnCloseModal').addEventListener('click',closeModal);
  $('codeModal').addEventListener('click',e=>{ if(e.target.id==='codeModal') closeModal(); });
  $('btnShowScript').addEventListener('click',showScript);
  $('btnCloseScript').addEventListener('click',closeScriptModal);
  $('scriptModal').addEventListener('click',e=>{ if(e.target.id==='scriptModal') closeScriptModal(); });

  ['stTitle','stScore','stDiff','stTime','stDesc','stInEx','stOutEx','stAnswer','stTemplate'].forEach(id=>{
    const e=$(id); if(e) e.addEventListener('input',updateStudioPreview);
  });

  document.addEventListener('keydown',e=>{ if(e.key==='Escape'){ closeModal(); closeScriptModal(); } });
}

// ---- 시작 ----
document.addEventListener('DOMContentLoaded', ()=>{
  loadCfg();
  bind();
  updateSessionUI();
  updateStudioPreview();
  renderRecords();
  initPy();
});
