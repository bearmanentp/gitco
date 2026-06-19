/* ===== 토큰 ===== */
:root{
  --bg:#0d1117; --bg2:#161b22; --bg3:#21262d; --card:#1c2128;
  --txt:#e6edf3; --txt2:#8b949e; --txt3:#6e7681;
  --blue:#58a6ff; --green:#3fb950; --red:#f85149; --orange:#d29922;
  --border:#30363d; --r:10px;
}
*{ box-sizing:border-box; margin:0; padding:0; }
body{
  background:var(--bg); color:var(--txt);
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  min-height:100vh; display:flex; flex-direction:column;
}
.hidden{ display:none !important; }
code{ background:rgba(255,255,255,.06); padding:1px 5px; border-radius:4px; font-size:.9em; }

/* ===== 헤더 ===== */
#appHeader{
  display:flex; align-items:center; gap:12px;
  background:var(--bg2); border-bottom:1px solid var(--border);
  padding:0 16px; height:56px; position:sticky; top:0; z-index:100;
  flex-wrap:wrap;
}
.brand{ display:flex; align-items:center; gap:8px; font-size:18px; font-weight:800; }
.logo{ font-size:22px; }
#mainNav{ display:flex; gap:2px; flex:1; flex-wrap:wrap; }
.nav-btn{
  background:none; border:none; color:var(--txt2);
  padding:7px 14px; border-radius:8px; cursor:pointer; font-size:13px;
}
.nav-btn:hover{ background:var(--bg3); color:var(--txt); }
.nav-btn.active{ background:var(--blue); color:#fff; }
.header-right{ display:flex; align-items:center; gap:8px; margin-left:auto; }
.status-pill{
  font-size:11px; color:var(--orange);
  background:var(--bg3); padding:3px 8px; border-radius:999px; border:1px solid var(--border);
}
.status-pill.ready{ color:var(--green); }
.user-label{ font-size:12px; color:var(--txt2); }

/* ===== 버튼 ===== */
.btn{
  padding:7px 14px; border:1px solid var(--border); background:var(--bg3);
  color:var(--txt); border-radius:8px; cursor:pointer; font-size:13px;
  transition:.15s;
}
.btn:hover{ background:var(--border); }
.btn.primary{ background:var(--blue); border-color:var(--blue); color:#fff; }
.btn.primary:hover{ filter:brightness(1.1); }
.btn:disabled{ opacity:.5; cursor:not-allowed; }

.btn-row{ display:flex; gap:8px; margin:10px 0; flex-wrap:wrap; }
.row-2{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.row-toolbar{ display:flex; gap:8px; margin:10px 0; }
.row-toolbar .inp{ flex:1; }

/* ===== 페이지 ===== */
main{ flex:1; }
.page{ display:none; padding:16px; max-width:1400px; margin:0 auto; width:100%; }
.page.active{ display:block; animation:fi .2s; }
@keyframes fi{ from{ opacity:0; transform:translateY(4px) } to{ opacity:1; transform:none } }

/* ===== 카드 ===== */
.card{ background:var(--card); border:1px solid var(--border); border-radius:var(--r); padding:18px; margin-bottom:14px; }
.card h3{ font-size:16px; margin-bottom:10px; }
.card h4{ font-size:13px; color:var(--txt2); }
.card hr{ border:none; border-top:1px solid var(--border); margin:14px 0; }

/* ===== 입력 ===== */
label{ display:block; font-size:12px; color:var(--txt2); font-weight:600; margin:10px 0 4px; }
.inp{
  width:100%; padding:9px 11px; background:var(--bg); border:1px solid var(--border);
  color:var(--txt); border-radius:8px; font-size:13px; outline:none; font-family:inherit;
}
.inp:focus{ border-color:var(--blue); }
.ta{ resize:vertical; min-height:80px; font-family:Consolas,Monaco,monospace; }
.code{ min-height:100px; font-size:13px; }
.hint{ font-size:12px; color:var(--txt3); margin-top:4px; }

/* ===== 홈 ===== */
.hero{ max-width:880px; margin:0 auto; padding:48px 16px; text-align:center; }
.hero h1{ font-size:42px; margin-bottom:8px; }
.hero-sub{ color:var(--txt2); margin-bottom:36px; font-size:15px; }
.feature-grid{ display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:14px; margin-bottom:36px; text-align:left; }
.feature{
  background:var(--bg2); border:1px solid var(--border); border-radius:var(--r); padding:18px;
}
.feature h3{ color:var(--blue); margin-bottom:6px; font-size:15px; }
.feature p{ color:var(--txt2); font-size:13px; }
.howto{ text-align:left; max-width:480px; margin:0 auto 30px; }
.howto h2{ font-size:18px; margin-bottom:10px; }
.howto ol{ padding-left:20px; color:var(--txt2); font-size:14px; line-height:2; }
.credit{ font-size:13px; color:var(--txt3); }

/* ===== LMS ===== */
.lms-layout{ display:grid; grid-template-columns:360px 1fr; gap:14px; align-items:start; }
.lms-side, .lms-main{ display:flex; flex-direction:column; gap:14px; }
.lms-main{ min-height:400px; }

.count-pill{ font-size:11px; color:var(--txt3); font-weight:400; margin-left:6px; }
#problemList{ max-height:480px; overflow-y:auto; }
.empty-msg{ color:var(--txt3); font-size:13px; padding:14px 0; }
.empty-state{ text-align:center; padding:60px 20px; color:var(--txt3); }
.empty-icon{ font-size:48px; margin-bottom:8px; }

/* 문제 아이템 */
.prob-item{
  display:flex; align-items:center; gap:8px; padding:9px 12px;
  border:1px solid var(--border); border-radius:8px; margin-bottom:6px;
  background:var(--bg); cursor:pointer; transition:.15s;
}
.prob-item:hover{ border-color:var(--blue); }
.prob-item.active{ border-color:var(--blue); background:rgba(88,166,255,.08); }
.prob-item .p-title{ flex:1; font-size:13px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.prob-item .p-score{ font-size:12px; color:var(--txt3); }
.diff-easy,.diff-mid,.diff-hard{ font-size:11px; padding:2px 8px; border-radius:999px; font-weight:600; }
.diff-easy{ background:rgba(63,185,80,.15); color:var(--green); }
.diff-mid{ background:rgba(210,153,34,.15); color:var(--orange); }
.diff-hard{ background:rgba(248,81,73,.15); color:var(--red); }

/* 문제 상세 */
.prob-detail h2{ font-size:22px; margin-bottom:6px; }
.prob-meta{ color:var(--txt2); font-size:13px; margin-bottom:12px; }
.prob-body{ font-size:14px; line-height:1.8; margin-bottom:14px; }
.prob-body img{ max-width:100%; border-radius:8px; margin:8px 0; }
.code-area{ border:1px solid var(--border); border-radius:var(--r); overflow:hidden; margin-bottom:12px; }
.code-toolbar{ display:flex; justify-content:space-between; align-items:center; background:var(--bg3); padding:8px 12px; border-bottom:1px solid var(--border); }
.code-toolbar span{ font-size:12px; color:var(--txt2); font-weight:600; }
.code-editor{
  width:100%; min-height:240px; padding:14px;
  background:#010409; border:none; color:var(--txt);
  font-family:Consolas,Monaco,monospace; font-size:14px; line-height:1.7;
  resize:vertical; outline:none; tab-size:4;
}
.output-area{ border:1px solid var(--border); border-radius:var(--r); overflow:hidden; }
.output-head{ background:var(--bg3); padding:8px 12px; font-size:12px; color:var(--txt2); border-bottom:1px solid var(--border); }
#outputArea{ padding:14px; min-height:100px; background:#010409; white-space:pre-wrap; font-family:monospace; font-size:13px; }
#outputArea.ok{ color:var(--green); }
#outputArea.err{ color:var(--red); }
.timer-line{ font-size:13px; color:var(--orange); margin:8px 0; }

/* ===== 스튜디오 ===== */
.studio-layout{ display:grid; grid-template-columns:1fr 1fr; gap:14px; }
.preview-box{ background:#010409; padding:14px; border-radius:8px; min-height:200px; white-space:pre-wrap; font-family:monospace; font-size:12px; color:var(--green); overflow:auto; }
.md-render{ background:var(--bg); padding:14px; border-radius:8px; min-height:100px; margin-top:8px; font-size:14px; line-height:1.8; }
.md-render img{ max-width:100%; border-radius:8px; }

/* ===== 기록 ===== */
.stats-bar{ display:flex; gap:18px; padding:10px 0; font-size:13px; color:var(--txt2); flex-wrap:wrap; }
.stats-bar strong{ color:var(--blue); margin:0 4px; }
.table-wrap{ overflow-x:auto; border:1px solid var(--border); border-radius:8px; margin:10px 0; }
table{ width:100%; border-collapse:collapse; font-size:13px; }
th{ background:var(--bg2); color:var(--txt2); padding:10px 12px; text-align:left; border-bottom:1px solid var(--border); white-space:nowrap; }
td{ padding:8px 12px; border-bottom:1px solid var(--border); }
tr:last-child td{ border-bottom:none; }
tr:hover td{ background:rgba(255,255,255,.02); }
.empty-td{ text-align:center; color:var(--txt3); padding:30px; }
.res-ok{ color:var(--green); font-weight:700; }
.res-fail{ color:var(--red); font-weight:700; }

/* ===== 관리 ===== */
.admin-layout{ max-width:760px; margin:0 auto; }
.admin-panel{ margin-top:14px; }
.admin-panel hr{ border:none; border-top:1px solid var(--border); margin:14px 0; }

/* ===== 토스트 / 로딩 ===== */
#toastContainer{ position:fixed; top:68px; right:16px; z-index:500; display:flex; flex-direction:column; gap:6px; }
.toast{
  padding:10px 14px; background:var(--bg2); border:1px solid var(--border);
  border-radius:8px; font-size:13px; min-width:220px;
  border-left:4px solid var(--blue); animation:ts .2s;
}
.toast.ok{ border-left-color:var(--green); }
.toast.fail{ border-left-color:var(--red); }
@keyframes ts{ from{ transform:translateX(60px); opacity:0 } to{ transform:none; opacity:1 } }

.loading-overlay{
  position:fixed; inset:0; background:rgba(0,0,0,.7); z-index:300;
  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px;
}
.spinner{ width:40px; height:40px; border:3px solid var(--border); border-top-color:var(--blue); border-radius:50%; animation:sp .8s linear infinite; }
@keyframes sp{ to{ transform:rotate(360deg) } }

/* ===== 모달 ===== */
.modal-overlay{
  position:fixed; inset:0; background:rgba(0,0,0,.7);
  display:flex; align-items:center; justify-content:center; z-index:400; padding:16px;
}
.modal-box{ background:var(--bg2); border:1px solid var(--border); border-radius:var(--r); padding:20px; max-width:90vw; max-height:80vh; overflow:auto; width:600px; }
.modal-head{ display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; }

/* ===== 푸터 ===== */
footer{ text-align:center; padding:18px; color:var(--txt3); font-size:12px; border-top:1px solid var(--border); }
footer strong{ color:var(--blue); }

/* ===== 반응형 ===== */
@media (max-width:900px){
  .lms-layout, .studio-layout{ grid-template-columns:1fr; }
  .row-2{ grid-template-columns:1fr; }
  #appHeader{ height:auto; padding:10px; }
}
