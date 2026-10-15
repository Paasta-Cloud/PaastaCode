import {icon} from "./components.js";
import {mobileApp} from "./pwa.js";
export const hostedOrigin="https://code.paasta.cloud";
export function workspaceConnection(value){
  const url=new URL(value);
  const cap=new URLSearchParams(url.hash.slice(1)).get("cap");
  if(url.protocol!=="http:"||url.hostname!=="127.0.0.1"||!url.port||url.username||url.password||url.search||url.pathname!=="/"||!/^\d+$/.test(url.port)||!Number(url.port)||!/^[-_A-Za-z0-9]{43}$/.test(cap||""))throw new Error("پیوند اتصال باید همان پیوند محلیِ ساخته‌شده با پاستاکد باشد.");
  return {origin:url.origin,capability:cap};
}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const selectedKey="paastacode-cloud-workspace",intentKey="paastacode-cloud-intent";
const saved=key=>{try{return JSON.parse(sessionStorage.getItem(key)||"null");}catch{return null;}};
const remember=(key,value)=>{try{if(value===null)sessionStorage.removeItem(key);else sessionStorage.setItem(key,JSON.stringify(value));}catch{/* Storage can be disabled by the browser. */}};
export function runtimeRequest(connection,path,method="GET",body,options={}){
  if(!/^[a-z]+(?:\/[a-z]+)*(?:\?[^#]*)?$/.test(path))throw new Error("مسیر درخواست معتبر نیست.");
  const headers={"Content-Type":"application/json",...(method!=="GET"&&options.accountRevision?{"X-PaastaCode-Account":String(options.accountRevision)}:{})};
  const init={method,headers,body:body?JSON.stringify(body):undefined};
  if(connection?.kind==="cloud"){
    if(!uuid.test(connection.id)||!connection.owner?.split(":").every(part=>uuid.test(part))||connection.owner.split(":").length!==2)throw new Error("فضای کار معتبر نیست.");
    headers["X-PaastaCode-Owner"]=connection.owner;
    return {url:`/api/paastacode/workspaces/${connection.id}/runtime/${path}`,init:{...init,credentials:"same-origin"}};
  }
  if(connection?.origin)workspaceConnection(connection.origin+"/#cap="+connection.capability);
  headers.Authorization="Bearer "+(connection?.capability||options.capability);
  return {url:(connection?.origin||"")+"/api/"+path,init:{...init,credentials:"omit",...(connection?.origin?{targetAddressSpace:"loopback"}:{})}};
}
export function invalidateHosted(){
  remember(selectedKey,null);remember(intentKey,null);
  window.dispatchEvent(new Event("paastacode:account-changed"));
  location.reload();
}
export async function connectHosted({onAccount=()=>{}}={}){
  const form=document.getElementById("workspace-connect"),input=document.getElementById("workspace-link"),error=document.getElementById("workspace-connect-error");
  const $=id=>document.getElementById(id),hub=$("hosted-hub"),dialog=$("hosted-dialog");
  const toolbar=document.querySelector(".topbar"),projectChrome=[...document.querySelectorAll(".workspace-name,.header-actions,.thread-heading")];
  const money=value=>Number(value).toLocaleString("fa-IR")+" تومان",date=value=>new Date(value).toLocaleDateString("fa-IR");
  const element=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
  let owner=null,active=null,busy=false,refreshing=false,account=null,catalog=null,intent=null,resolveConnection;
  let restored=false,lastList="",lastRefresh=0;
  const connection=new Promise(resolve=>{resolveConnection=resolve;});
  const fragment=new URLSearchParams(location.hash.slice(1));
  if(!mobileApp&&fragment.get("local"))input.value=fragment.get("local")+"/#cap="+fragment.get("cap");
  else input.value=sessionStorage.getItem("paastacode-workspace-link")||"";
  history.replaceState(null,"",location.pathname+location.search);
  $("hosted-local-content").append(form);form.hidden=false;hub.hidden=false;$("hosted-local").open=!!fragment.get("local");
  $("hosted-local").hidden=mobileApp;
  if(mobileApp){$("hosted-hub").querySelector(".intro-label").textContent="پاستاکد برای اندروید";$("hosted-hub").querySelector(".hosted-badge").textContent="اجرای ابری";}
  $("onboarding").hidden=true;$("conversation").hidden=true;$("composer").hidden=true;
  toolbar.classList.add("workspace-selector");for(const node of projectChrome)node.hidden=true;
  document.getElementById("login").disabled=true;document.getElementById("new").disabled=true;
  document.getElementById("connection-state").textContent="انتخاب فضای کار";
  const feedback=(text,danger=false)=>{$("hosted-feedback").textContent=text;$("hosted-feedback").classList.toggle("error",danger);};
  async function api(path="",method="GET",body){
    const response=await fetch("/api/paastacode/workspaces"+path,{method,credentials:"same-origin",headers:{"Content-Type":"application/json",...(owner?{"X-PaastaCode-Owner":owner}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
    const result=await response.json().catch(()=>({error:"پاسخ سرویس معتبر نیست."}));
    if(!response.ok){if(response.status===403&&owner){invalidateHosted();throw new Error("حساب فعال تغییر کرده است.");}const caught=new Error(result.error||"ارتباط با فضای کار برقرار نشد.");caught.status=response.status;throw caught;}
    return result;
  }
  async function action(button,work){
    if(busy)return;busy=true;button.disabled=true;hub.setAttribute("aria-busy","true");
    try{await work();}catch(caught){feedback(caught.message,true);}finally{busy=false;button.disabled=false;hub.setAttribute("aria-busy","false");}
  }
  async function exportProject(row){
    const exportOwner=owner;let transfer;
    feedback("در حال آماده‌کردن فایل‌های پروژه…");
    try{
      const result=await api(`/${row.id}/runtime/export`,"POST",{});
      if(!/^[-_A-Za-z0-9]{32}$/.test(result?.id||""))throw new Error("پاسخ دریافت پروژه معتبر نیست؛ دوباره تلاش کنید.");
      transfer=result.id;
      // The broker retains this bounded first chunk for the download's retry.
      // A failed ZIP process is reported here before opening a browser download.
      await api(`/${row.id}/runtime/export?id=${transfer}&offset=0`);
      if(owner!==exportOwner)throw new Error("حساب فعال تغییر کرده است؛ پروژه را دوباره انتخاب کنید.");
      const link=element("a");link.href=`/api/paastacode/workspaces/${row.id}/export?`+new URLSearchParams({id:transfer,owner:exportOwner});
      link.download="PaastaCode-project.zip";link.target="_blank";link.rel="noopener noreferrer";
      document.body.append(link);link.click();link.remove();
      feedback("دریافت فایل ZIP شروع شد. نتیجه را در بخش دانلودهای مرورگر بررسی کنید؛ اگر دریافت قطع شد، دوباره خروجی بگیرید.");
    }catch(caught){
      if(transfer&&owner===exportOwner)try{await api(`/${row.id}/runtime/export?id=${transfer}`,"DELETE");}catch{/* The runtime also expires abandoned transfers. */}
      throw caught;
    }
  }
  function open(value){
    if(value.kind==="cloud")remember(selectedKey,value);else remember(selectedKey,null);
    if(active){window.dispatchEvent(new Event("paastacode:workspace-switch"));location.reload();return;}
    active=value;hub.hidden=true;form.hidden=true;$("login").disabled=false;$("hosted-open").hidden=false;
    toolbar.classList.remove("workspace-selector");for(const node of projectChrome)node.hidden=false;
    $("hosted-open").textContent=value.kind==="cloud"?value.name:"فضاهای کار";resolveConnection(value);
  }
  function review(value){
    intent=value;remember(intentKey,value);$("hosted-review").hidden=!value;if(!value)return;
    const q=value.quote,cancel=value.kind==="cancel",free=value.kind==="resume";
    $("hosted-review-title").textContent=cancel?"لغو و حذف فضای کار":free?"ادامهٔ فضای کار":"بررسی هزینهٔ "+(value.kind==="create"?"ساخت":"تمدید");
    $("hosted-review-name").textContent=q.name;$("hosted-costs").replaceChildren();
    const line=(label,amount)=>{$("hosted-costs").append(element("dt",label),element("dd",money(amount)));};
    if(value.kind==="create"){line("اجرای پروژه، یک ماه",q.computeToman);line("نگه‌داری فایل‌ها، یک ماه",q.storageToman);}
    line(cancel?"بازگشت اعتبار پس از حذف":free?"هزینهٔ ادامهٔ دورهٔ فعلی":"جمع پرداخت",cancel?q.refundToman:q.totalToman??q.chargeToman);
    $("hosted-terms").textContent=cancel?"تمام فایل‌ها و تاریخچهٔ اجرای این فضای کار برای همیشه حذف می‌شوند. بازگشت اعتبار پس از پایان پاک‌سازی ثبت می‌شود.":free?"دورهٔ فعلی پرداخت شده است؛ با بررسی ظرفیت، همان فایل‌ها دوباره در دسترس قرار می‌گیرند.":"مصرف مدل‌های هوش مصنوعی جداگانه محاسبه می‌شود. "+(q.retentionDays?`اگر تمدید نکنید، اجرای پروژه متوقف و فایل‌ها ${Number(q.retentionDays).toLocaleString("fa-IR")} روز پس از پایان دوره حذف می‌شوند.`:"تمدید، مهلت نگه‌داری قبلی را تغییر نمی‌دهد.");
    $("hosted-confirm").textContent=cancel?"حذف فایل‌ها و لغو فضای کار":free?"ادامه بدون پرداخت":value.submitted?"تلاش دوباره برای همین سفارش":"تأیید هزینه و "+(value.kind==="create"?"ساخت":"تمدید");
    $("hosted-confirm").classList.toggle("danger-action",cancel);
    $("hosted-expiry").textContent=value.submitted?"اگر پاسخ قطع شده، همین درخواست را دوباره بفرستید؛ پرداخت تکرار نمی‌شود.":"پیش‌نمایش تا ساعت "+new Date(q.expiresAt).toLocaleTimeString("fa-IR",{hour:"2-digit",minute:"2-digit"})+" معتبر است.";
    $("hosted-quote").disabled=!!value.submitted;$("hosted-dismiss").disabled=!!value.submitted;
  }
  async function preview(kind,row){
    if(intent?.submitted)throw new Error("ابتدا نتیجهٔ سفارش قبلی را با «تلاش دوباره» دریافت کنید.");
    const q=await api(`/${row.id}/lifecycle`,"POST",{action:"quote",operation:kind});review({kind,workspaceId:row.id,owner,quote:q});$("hosted-review").scrollIntoView({block:"nearest",behavior:"smooth"});
  }
  function rows(workspaces){
    const paidUntil=end=>new Date(end).getTime()>Date.now();
    $("hosted-export-note").hidden=!workspaces.some(row=>row.status==="ready"&&paidUntil(row.current_period_end));
    const key=JSON.stringify(workspaces.map(row=>[row,paidUntil(row.current_period_end)]));if(key===lastList)return;lastList=key;$("hosted-list").replaceChildren();
    if(!workspaces.length){$("hosted-list").append(element("p",mobileApp?"هنوز فضای کار ابری ندارید. پس از فعال‌شدن سرویس، یک فضای تازه بسازید.":"هنوز فضای کار ابری ندارید. یک فضای تازه بسازید یا به پروژه روی کامپیوترتان وصل شوید.","hosted-empty"));return;}
    const labels={starting:"در حال آماده‌سازی",ready:"آماده",suspended:"متوقف",deleting:"در حال پاک‌سازی",failed:"ساخت ناموفق",stopped:"متوقف"};
    for(const row of workspaces){
      const paid=paidUntil(row.current_period_end),expired=!paid&&["ready","suspended"].includes(row.status);
      const article=element("article",undefined,"hosted-project"),copy=element("div",undefined,"hosted-project-copy"),heading=element("div",undefined,"hosted-project-heading"),name=element("h3",row.name),badge=element("span",expired?"نیاز به تمدید":labels[row.status]||"در حال بررسی","hosted-state");
      name.dir="auto";badge.dataset.state=expired?"expired":row.status;heading.append(name,badge);copy.append(heading,element("p","پایان دوره: "+date(row.current_period_end),"muted"));
      if(row.last_error)copy.append(element("p",row.last_error,"hosted-project-note"));
      const actions=element("div",undefined,"hosted-actions");
      const button=(label,work,cls,symbol)=>{const node=element("button",undefined,cls);if(symbol)node.append(icon(symbol));node.append(document.createTextNode(label));node.type="button";node.onclick=()=>action(node,work);actions.append(node);};
      if(row.status==="ready"&&paid)button("باز کردن",()=>open({kind:"cloud",id:row.id,name:row.name,owner}),"primary");
      if(row.status==="ready"&&paid)button("دریافت پروژه",()=>exportProject(row),undefined,"import");
      if(row.status==="suspended"&&paid&&row.first_ready_at)button("ادامه",()=>preview("resume",row),"primary");
      if(["ready","suspended"].includes(row.status)&&row.first_ready_at)button("تمدید",()=>preview("renew",row));
      if(["starting","ready","suspended"].includes(row.status))button("لغو",()=>preview("cancel",row),"subtle");
      if(row.status==="deleting")actions.append(element("span","بازگشت اعتبار پس از پاک‌سازی","muted"));
      article.append(copy,actions);$("hosted-list").append(article);
    }
  }
  function choices(){
    const fill=(id,items,label)=>{const node=$(id),value=node.value;node.replaceChildren(...items.map(item=>{const option=element("option",label(item));option.value=item.id;return option;}));if(items.some(item=>item.id===value))node.value=value;};
    fill("hosted-plan",catalog.plans||[],p=>`${p.name} · ${(p.cpu_millicores/1000).toLocaleString("fa-IR")} هسته / ${(p.memory_mib/1024).toLocaleString("fa-IR")} گیگابایت · ${money(p.monthly_price_toman)}`);
    fill("hosted-storage",catalog.storage||[],s=>`${s.name} · ${s.region} · هر گیگابایت ${money(s.price_per_gb_month_toman)}`);
    $("hosted-storage").onchange=()=>{const s=catalog.storage.find(s=>s.id===$("hosted-storage").value);if(s){$("hosted-size").min=s.min_size_gb;$("hosted-size").max=s.max_size_gb;$("hosted-size").value=Math.max(s.min_size_gb,Math.min(s.max_size_gb,Number($("hosted-size").value)||s.min_size_gb));}};$("hosted-storage").onchange();
  }
  async function refresh(){
    if(refreshing||busy)return;refreshing=true;lastRefresh=Date.now();
    try{
      const result=await api();const next=result.account;
      if(!next||!uuid.test(next.id)||!uuid.test(next.tenantId))throw new Error("اطلاعات حساب هنوز در دسترس نیست. دوباره تلاش کنید.");
      const nextOwner=next.id+":"+next.tenantId;if(owner&&owner!==nextOwner){invalidateHosted();return;}owner=nextOwner;account=next;onAccount(next);
      $("hosted-login").hidden=true;$("hosted-account-name").textContent=account.name||"حساب پاستا";$("hosted-account-detail").textContent=money(account.balanceToman)+" اعتبار";
      $('hosted-billing').hidden=false;$('hosted-billing').href='https://console.paasta.cloud/paastacode?owner='+encodeURIComponent(owner);
      if(!catalog){catalog=await api("/catalog");choices();}
      $("hosted-create").hidden=!catalog.enabled||!catalog.plans?.length||!catalog.storage?.length;
      rows(result.workspaces||[]);
      if(!restored){restored=true;const pending=saved(intentKey);if(pending?.owner===owner&&pending.quote?.token)review(pending);else remember(intentKey,null);
        const selected=saved(selectedKey);if(selected?.owner!==owner)remember(selectedKey,null);
        const previous=(result.workspaces||[]).find(row=>row.id===selected?.id&&row.status==="ready"&&new Date(row.current_period_end)>new Date());
        if((mobileApp||!fragment.get("local"))&&!intent&&selected?.owner===owner&&previous)open({kind:"cloud",id:previous.id,name:previous.name,owner});
      }
      if(!catalog.enabled&&!intent)feedback(mobileApp?"ساخت فضای کار ابری هنوز فعال نشده است. پروژهٔ تازه را پس از فعال‌شدن سرویس می‌توانید بسازید.":"ساخت فضای کار ابری هنوز فعال نشده است. اتصال به کامپیوترتان در دسترس است.");
    }catch(caught){if(caught.status===403){$("hosted-login").hidden=false;$("hosted-account-detail").textContent="برای دیدن فضاهای کار، وارد حساب پاستا شوید.";$("hosted-list").replaceChildren();}else feedback(caught.message,true);}
    finally{refreshing=false;}
  }
  $("hosted-refresh").onclick=()=>{catalog=null;refresh();};
  $("hosted-create-form").onsubmit=event=>{event.preventDefault();action($("hosted-quote"),async()=>{
    if(intent?.submitted)throw new Error("ابتدا نتیجهٔ سفارش قبلی را دریافت کنید.");
    const q=await api("/quote","POST",{name:$("hosted-name").value.trim(),planId:$("hosted-plan").value,offeringId:$("hosted-storage").value,sizeGiB:Number($("hosted-size").value)});
    review({kind:"create",owner,quote:q});$("hosted-review").scrollIntoView({block:"nearest",behavior:"smooth"});
  });};
  $("hosted-dismiss").onclick=()=>{if(intent?.submitted)return;review(null);$("hosted-quote").disabled=false;};
  $("hosted-confirm").onclick=()=>action($("hosted-confirm"),async()=>{
    if(!intent||intent.owner!==owner)return;const current=intent;current.submitted=true;review(current);
    try{
      const result=current.kind==="create"?await api("","POST",{id:current.quote.id,quote:current.quote.token}):await api(`/${current.workspaceId}/lifecycle`,"POST",{action:"confirm",quote:current.quote.token});
      review(null);$("hosted-quote").disabled=false;feedback(result.status==="pending"?"لغو ثبت شد؛ پاک‌سازی و بازگشت اعتبار در حال انجام است.":current.kind==="create"?"سفارش ثبت شد؛ فضای کار در حال آماده‌شدن است.":"درخواست ثبت شد. وضعیت فضای کار را در فهرست ببینید.");lastList="";
      if(current.kind==="cancel"&&active?.kind==="cloud"&&active.id===current.workspaceId){remember(selectedKey,null);window.dispatchEvent(new Event("paastacode:account-changed"));location.reload();return;}
      setTimeout(refresh,0);
    }catch(caught){if(caught.status&&caught.status<500&&caught.status!==429){current.submitted=false;review(current);}else review(current);throw caught;}
  });
  $("hosted-open").onclick=()=>{$("hosted-dialog-body").append(hub);hub.hidden=false;form.hidden=false;dialog.showModal();refresh();};
  $("hosted-close").onclick=()=>dialog.close();
  window.addEventListener("focus",()=>{if(Date.now()-lastRefresh>1500)refresh();});
  const timer=setInterval(()=>{if(!document.hidden&&(!active||dialog.open))refresh();},8000);window.addEventListener("pagehide",()=>clearInterval(timer),{once:true});
  refresh();
  form.onsubmit=async event=>{
    event.preventDefault();if(mobileApp)return;const button=form.querySelector("button");button.disabled=true;error.textContent="";
    try{
      const connection=workspaceConnection(input.value.trim());
      const response=await fetch(connection.origin+"/api/state",{headers:{Authorization:"Bearer "+connection.capability},targetAddressSpace:"loopback",credentials:"omit",signal:AbortSignal.timeout(8000)});
      if(!response.ok)throw new Error("پیوند اتصال معتبر نیست. پاستاکد را با گزینهٔ --hosted اجرا کنید و پیوند جدید را وارد کنید.");
      await response.json();sessionStorage.setItem("paastacode-workspace-link",input.value.trim());
      open(connection);
    }catch(caught){error.textContent=caught instanceof TypeError||caught.name==="TimeoutError"?"اتصال به دستگاه برقرار نشد. پاستاکد را باز نگه دارید و اجازهٔ دسترسی به شبکهٔ محلی را در مرورگر بررسی کنید.":caught.message;}
    finally{button.disabled=false;}
  };
  return connection;
}
