import './review-ui.js';
export function gitUI({api,run,notice}){
  const $=id=>document.getElementById(id);let state,loading=false,selectedPath;
  const report=(text,error=false)=>{$("git-result").textContent=text;$("git-result").classList.toggle("message-error",error);};
  const perform=(button,work)=>run(button,async()=>{report("در حال انجام…");try{await work();report("عملیات انجام شد.");}catch(error){if(!error.stale)report(error.message,true);}});
  async function refresh(){if(loading)return;loading=true;try{state=await api("git");$("git-branch-label").textContent=state.repository?state.branch:"اتصال گیت";$("git-count").textContent=state.files.length.toLocaleString("fa-IR");$("git-empty").hidden=state.repository;$("git-repository").hidden=!state.repository;$("git-files").replaceChildren();$("git-summary").textContent=state.files.length?state.files.length.toLocaleString("fa-IR")+" فایل تغییر کرده":"همهٔ تغییرات ثبت شده‌اند";$("git-sync-state").textContent=`${state.ahead||0} کامیت برای ارسال · ${state.behind||0} کامیت برای دریافت`;
    for(const file of state.files){const row=document.createElement("div");row.className="git-file";const check=document.createElement("input");check.type="checkbox";check.value=file.path;check.setAttribute("aria-label","انتخاب "+file.path);check.disabled=/(^|\/)(\.env(?:\..*)?|[^/]+\.(pem|key))$/i.test(file.path);const button=document.createElement("button");button.type="button";const path=document.createElement("bdi");path.dir="ltr";path.textContent=file.path;const status=document.createElement("span");status.dir="ltr";status.textContent=file.status.trim();button.append(path,status);button.disabled=check.disabled;button.dataset.path=file.path;button.setAttribute("aria-current",String(file.path===selectedPath));button.onclick=()=>perform(button,async()=>{await showDiff(file.path);});row.append(check,button);$("git-files").append(row);}
    if(!$("git-dialog").open)return;
    const chosen=state.files.find(file=>file.path===selectedPath)||state.files.find(file=>!/(^|\/)(\.env(?:\..*)?|[^/]+\.(pem|key))$/i.test(file.path));
    if(chosen)await showDiff(chosen.path);else{$('git-diff-section').hidden=true;selectedPath=undefined;}
  }finally{loading=false;}}
  async function showDiff(path){selectedPath=path;for(const row of $('git-files').querySelectorAll('button[data-path]'))row.setAttribute('aria-current',String(row.dataset.path===path));const diff=await api('git/diff?path='+encodeURIComponent(path));if(selectedPath!==path)return;const panel=$('git-diff'),signature=JSON.stringify(diff);if(panel.dataset.signature!==signature){const top=panel.scrollTop;globalThis.PaastaReview.fileDiff(panel,diff);panel.scrollTop=top;panel.dataset.signature=signature;}$('git-diff-section').querySelector('summary').textContent=path;$('git-diff-section').hidden=false;}
  async function action(button,input){await perform(button,async()=>{await api("git","POST",input);notice("عملیات گیت انجام شد.");await refresh();});}
  $("git-open").onclick=()=>perform($("git-open"),async()=>{$("git-dialog").showModal();await refresh();});
  $("git-close").onclick=()=>$("git-dialog").close();$("git-refresh").onclick=()=>perform($("git-refresh"),refresh);
  $("git-init").onclick=()=>action($("git-init"),{action:"init"});
  $("git-commit-form").onsubmit=e=>{e.preventDefault();action($("git-commit"),{action:"commit",message:$("git-message").value,paths:[...$("git-files").querySelectorAll("input:checked")].map(e=>e.value)});};
  $("git-remote-form").onsubmit=e=>{e.preventDefault();action($("git-remote-save"),{action:"remote",url:$("git-remote-url").value});};
  $("git-branch-form").onsubmit=e=>{e.preventDefault();action($("git-branch-save"),{action:"branch",branch:$("git-branch-input").value,create:$("git-branch-create").checked});};
  for(const name of ["fetch","pull","push"])$("git-"+name).onclick=()=>action($("git-"+name),{action:name});
  return {refresh};
}
