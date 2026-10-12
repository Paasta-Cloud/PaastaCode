export function devicesUI({api,run,notice,onCurrentRevoked,getGeneration}){
  const dialog=document.getElementById("devices-dialog"),list=document.getElementById("device-connections"),refresh=document.getElementById("devices-refresh"),open=document.getElementById("devices-open");
  const date=value=>value&&Number.isFinite(new Date(value).getTime())?new Intl.DateTimeFormat("fa-IR",{dateStyle:"medium"}).format(new Date(value)):"ثبت نشده";
  let viewGeneration;
  async function load(){
    list.setAttribute("aria-busy","true");
    list.replaceChildren();
    try{
      const {devices}=await api("devices");
      if(!Array.isArray(devices))throw new Error("فهرست اتصال‌ها دریافت نشد. پاستاکد را به‌روز کنید و دوباره تلاش کنید.");
      list.replaceChildren();
      if(!devices.length){const empty=document.createElement("p");empty.textContent="اتصال پاستاکد دیگری در این حساب ثبت نشده است.";list.append(empty);}
      for(const device of devices){
        const row=document.createElement("section");row.className="device-connection";
        const title=document.createElement("h3");title.dir="auto";title.textContent=device.name;
        const state=document.createElement("p"),expired=new Date(device.expires_at).getTime()<Date.now();
        state.textContent=(device.device_client_id==="paastacode-deploy"?"انتشار پروژه":"مدل و گفتگو")+" · "+(device.revoked_at?"قطع‌شده":expired?"منقضی‌شده":"فعال")+(device.current?" · همین اتصال":"");
        const detail=document.createElement("p");detail.className="muted";detail.textContent="آخرین استفاده: "+date(device.last_used_at)+" · پایان اعتبار: "+date(device.expires_at);
        const revoke=document.createElement("button");revoke.type="button";revoke.textContent="قطع اتصال";revoke.className="danger-action";revoke.disabled=!!device.revoked_at||expired;
        revoke.onclick=()=>run(revoke,async()=>{
          const confirm=document.getElementById("device-revoke-dialog");document.getElementById("device-revoke-name").textContent=device.name;confirm.returnValue="cancel";
          const accepted=await new Promise(resolve=>{confirm.addEventListener("close",()=>resolve(confirm.returnValue==="revoke"),{once:true});confirm.showModal();});
          if(!accepted||viewGeneration!==getGeneration())return;
          const result=await api("devices?id="+encodeURIComponent(device.id),"DELETE");
          if(result.current){dialog.close();await onCurrentRevoked();}
          else await load();
          notice(result.warning||"اتصال قطع شد. گفتگوهای حساب و فایل‌های پروژه باقی می‌مانند.",!!result.warning);
        });
        row.append(title,state,detail,revoke);list.append(row);
      }
    }finally{list.setAttribute("aria-busy","false");}
  }
  open.onclick=()=>run(open,async()=>{viewGeneration=getGeneration();dialog.showModal();await load();});refresh.onclick=()=>run(refresh,load);
  document.getElementById("devices-close").onclick=()=>dialog.close("cancel");
  return {update(state){open.disabled=!state.connected||state.features?.deviceManagement!==true;}};
}
