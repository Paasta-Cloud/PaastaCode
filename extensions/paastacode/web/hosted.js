export const hostedOrigin="https://code.paasta.cloud";
export function workspaceConnection(value){
  const url=new URL(value);
  const cap=new URLSearchParams(url.hash.slice(1)).get("cap");
  if(url.protocol!=="http:"||url.hostname!=="127.0.0.1"||!url.port||url.username||url.password||url.search||url.pathname!=="/"||!/^\d+$/.test(url.port)||!Number(url.port)||!/^[-_A-Za-z0-9]{43}$/.test(cap||""))throw new Error("پیوند اتصال باید همان پیوند محلیِ ساخته‌شده با پاستاکد باشد.");
  return {origin:url.origin,capability:cap};
}
export async function connectHosted(){
  const form=document.getElementById("workspace-connect"),input=document.getElementById("workspace-link"),error=document.getElementById("workspace-connect-error");
  const fragment=new URLSearchParams(location.hash.slice(1));
  if(fragment.get("local"))input.value=fragment.get("local")+"/#cap="+fragment.get("cap");
  else input.value=sessionStorage.getItem("paastacode-workspace-link")||"";
  history.replaceState(null,"",location.pathname);
  form.hidden=false;document.getElementById("onboarding").hidden=true;
  document.getElementById("login").disabled=true;document.getElementById("new").disabled=true;
  document.getElementById("connection-state").textContent="فضای کاری روی دستگاه شما";
  return new Promise(resolve=>{form.onsubmit=async event=>{
    event.preventDefault();const button=form.querySelector("button");button.disabled=true;error.textContent="";
    try{
      const connection=workspaceConnection(input.value.trim());
      const response=await fetch(connection.origin+"/api/state",{headers:{Authorization:"Bearer "+connection.capability},targetAddressSpace:"loopback",credentials:"omit",signal:AbortSignal.timeout(8000)});
      if(!response.ok)throw new Error("پیوند اتصال معتبر نیست. پاستاکد را با گزینهٔ --hosted اجرا کنید و پیوند جدید را وارد کنید.");
      await response.json();sessionStorage.setItem("paastacode-workspace-link",input.value.trim());
      form.hidden=true;document.getElementById("login").disabled=false;resolve(connection);
    }catch(caught){error.textContent=caught instanceof TypeError||caught.name==="TimeoutError"?"اتصال به دستگاه برقرار نشد. پاستاکد را باز نگه دارید و اجازهٔ دسترسی به شبکهٔ محلی را در مرورگر بررسی کنید.":caught.message;}
    finally{button.disabled=false;}
  };});
}
