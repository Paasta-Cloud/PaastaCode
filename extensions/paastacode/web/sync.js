export function syncUI({api,run,notice,getView,getState}){
  const $=id=>document.getElementById(id),root=$("sync-controls");let latest=null,latestView=null;
  const current=view=>getView().id===view.id&&getView().generation===view.generation;
  async function refresh(){
    const view=getView();root.hidden=!view.id||view.mode!=="local"||getState().features?.backgroundSync!==true;
    if(root.hidden)return;
    if(!latestView||!current(latestView)){latest=null;root.hidden=true;}
    const result=await api("sync?id="+encodeURIComponent(view.id));if(!current(view))return;latest=result;latestView=view;root.hidden=false;
    $("sync-open").textContent=result.enabled?(result.paused?"ذخیرهٔ خودکار: متوقف":"ذخیرهٔ خودکار: روشن"):"ذخیرهٔ خودکار: خاموش";
    const labels={conflict:"نسخهٔ حساب تغییر کرده؛ ذخیره متوقف است. متن محلی حفظ شده.",authorization:"دسترسی حساب قطع شده؛ دوباره وارد شوید.",content:"سرویس حساب این متن را نپذیرفت؛ ذخیره متوقف و متن محلی حفظ شده.",runtime:"خواندن متن گفتگو ممکن نشد؛ نسخهٔ حساب حفظ شده و دوباره تلاش می‌کنیم.",network:"اتصال برقرار نشد؛ متن محلی حفظ شده و دوباره تلاش می‌کنیم."};
    $("sync-detail").textContent=labels[result.reason]||(result.lastSavedAt?"آخرین ذخیره: "+new Intl.DateTimeFormat("fa-IR",{timeStyle:"short"}).format(new Date(result.lastSavedAt)):"متن این گفتگو فقط روی دستگاه است.");
    $("sync-review").hidden=result.reason!=="conflict"||!result.cloudId||!result.revision;
    $("sync-copy").hidden=result.reason!=="conflict";
  }
  async function consent(dialog){dialog.returnValue="cancel";return new Promise(resolve=>{dialog.addEventListener("close",()=>resolve(dialog.returnValue==="apply"),{once:true});dialog.showModal();});}
  $("sync-open").onclick=()=>run($("sync-open"),async()=>{
    const view=getView();if(!latest||!view.id||view.mode!=="local"||!current(latestView))return;$("sync-enabled").checked=latest.enabled;
    if(!await consent($("sync-dialog"))||!current(view))return;
    await api("sync","POST",{id:view.id,enabled:$("sync-enabled").checked});await refresh();
    notice($("sync-enabled").checked?"ذخیرهٔ خودکار فقط برای همین گفتگو روشن شد.":"ذخیرهٔ خودکار خاموش شد. نسخهٔ حساب باقی می‌ماند.");
  });
  $("sync-review").onclick=()=>run($("sync-review"),async()=>{
    const view=getView(),cloudId=latest?.cloudId;if(!cloudId)return;
    const saved=await api("cloud/session?id="+encodeURIComponent(cloudId));if(!current(view))return;
    $("sync-review-title").textContent=saved.title;$("sync-review-messages").replaceChildren();
    for(const message of saved.snapshot.messages){const item=document.createElement("p");item.dir="auto";item.textContent=(message.role==="user"?"شما: ":"پاستاکد: ")+message.text;$("sync-review-messages").append(item);}
    $("sync-review-dialog").showModal();
  });
  $("sync-copy").onclick=()=>run($("sync-copy"),async()=>{
    const view=getView();if(!view.id)return;
    if(!await consent($("sync-copy-dialog"))||!current(view))return;
    await api("save","POST",{id:view.id,copy:true});await refresh();notice("نسخهٔ مستقلی از متن محلی در حساب ذخیره شد. نسخهٔ قبلی تغییری نکرد.");
  });
  $("sync-review-close").onclick=()=>$("sync-review-dialog").close("cancel");
  return {refresh,hide(){root.hidden=true;latest=null;latestView=null;}};
}
