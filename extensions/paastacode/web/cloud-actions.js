export function conversationExport(saved){
  if(!/^[a-f0-9-]{36}$/i.test(saved.id)||saved.snapshot?.version!==1||!Array.isArray(saved.snapshot.messages))throw new Error("گفتگو برای خروجی گرفتن معتبر نیست.");
  return JSON.stringify({version:1,title:saved.title,messages:saved.snapshot.messages.map(({role,text})=>({role,text}))},null,2)+"\n";
}
export function cloudActions({saved,api,run,notice,isCurrent,onDeleted}){
  const actions=document.createElement("div");actions.className="cloud-actions";
  const download=document.createElement("button");download.type="button";download.textContent="دریافت فایل گفتگو";
  download.onclick=()=>run(download,async()=>{
    if(!isCurrent())return;
    const url=URL.createObjectURL(new Blob([conversationExport(saved)],{type:"application/json;charset=utf-8"}));
    const link=document.createElement("a");link.href=url;link.download="paastacode-conversation-"+saved.id+".json";document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  const remove=document.createElement("button");remove.type="button";remove.className="danger-action";remove.textContent="حذف از حساب";
  const safeDelete=saved.features?.conditionalDelete===true;
  remove.disabled=!safeDelete;
  remove.onclick=()=>run(remove,async()=>{
    const dialog=document.getElementById("cloud-delete-dialog"),confirm=document.getElementById("cloud-delete-confirm");
    if(!safeDelete||!isCurrent()||dialog.open)return;
    document.getElementById("cloud-delete-name").textContent=saved.title;confirm.disabled=false;
    dialog.returnValue="cancel";
    const accepted=await new Promise(resolve=>{dialog.addEventListener("close",()=>resolve(dialog.returnValue==="delete"),{once:true});dialog.showModal();});
    if(!accepted||!isCurrent())return;
    await api("cloud/session?id="+encodeURIComponent(saved.id)+"&revision="+saved.revision,"DELETE");
    if(!isCurrent())return;
    notice("نسخهٔ حساب حذف شد. فایل‌های پروژه و نسخه‌های محلی گفتگو تغییری نکردند.");await onDeleted();
  });
  actions.append(download,remove);
  if(!safeDelete){const hint=document.createElement("p");hint.className="muted";hint.textContent="این سرور از حذف با بررسی نسخه پشتیبانی نمی‌کند. برای حذف امن، سرویس پاستاکد را به‌روز کنید.";actions.append(hint);}
  return actions;
}
