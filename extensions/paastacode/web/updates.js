export function updatesUI(){
  const desktop=window.paastacodeDesktop;if(!desktop?.update)return;
  const $=id=>document.getElementById(id);$("updates-open").hidden=false;
  const labels={idle:"آمادهٔ بررسی",checking:"در حال بررسی نسخهٔ جدید…",available:"نسخهٔ جدید آمادهٔ دریافت است",current:"برنامه به‌روز است",downloading:"در حال دریافت نسخهٔ جدید…",ready:"نسخهٔ جدید آمادهٔ نصب است",error:"به‌روزرسانی کامل نشد",unavailable:"به‌روزرسانی از این نسخهٔ توسعه فعال نیست"};
  function render(state){$("update-status").textContent=state.error||labels[state.phase];$("update-version").textContent=state.version;$("update-next").textContent=state.availableVersion||"";$("update-automatic").checked=state.automatic;$("update-download").hidden=state.phase!=="available";$("update-install").hidden=state.phase!=="ready";$("update-check").disabled=["checking","downloading","unavailable"].includes(state.phase);$("update-progress").hidden=state.phase!=="downloading";$("update-progress").value=state.percent;}
  async function action(name,value){try{render(await desktop.update(name,value));}catch{$("update-status").textContent="عملیات به‌روزرسانی انجام نشد؛ دوباره تلاش کنید.";}}
  desktop.onUpdate(render);$("updates-open").onclick=async()=>{$("updates-dialog").showModal();await action("state");};$("updates-close").onclick=()=>$("updates-dialog").close();$("update-check").onclick=()=>action("check");$("update-download").onclick=()=>action("download");$("update-install").onclick=()=>action("install");$("update-automatic").onchange=()=>action("automatic",$("update-automatic").checked);
}
