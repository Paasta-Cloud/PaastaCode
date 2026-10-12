import {promptInput,labelDialog} from "./components.js";
import {deploymentUI} from "./deployment.js";
import {connectHosted,hostedOrigin} from "./hosted.js";
import {cloudActions} from "./cloud-actions.js";
import {devicesUI} from "./devices.js";
import {syncUI} from "./sync.js";
const $=id=>document.getElementById(id);
const resizePrompt=promptInput($("prompt"));
for(const dialog of document.querySelectorAll("dialog"))labelDialog(dialog);
if(window.paastacodeDesktop){$("open-workspace").hidden=false;$("open-workspace").onclick=()=>run($("open-workspace"),()=>window.paastacodeDesktop.chooseWorkspace());}
let capability=new URLSearchParams(location.hash.slice(1)).get("cap")||sessionStorage.getItem("paastacode-cap");
let apiOrigin="";
if(capability&&location.origin!==hostedOrigin){sessionStorage.setItem("paastacode-cap",capability);history.replaceState(null,"",location.pathname);}
let state={},session=null,mode="local",lastMessages="",sending=false,refreshing=false,loginTimer,generation=0,listGeneration=0,promptPending=false;
const deployment=deploymentUI({api,run,notice,getState:()=>state});
const devices=devicesUI({api,run,notice,getGeneration:()=>generation,onCurrentRevoked:async()=>{clearAccountView();await loadState();}});
const conversationSync=syncUI({api,run,notice,getState:()=>state,getView:()=>({id:session?.id,mode,generation})});
function notice(message,error=false){$("notice").textContent=message;$("notice").classList.toggle("error",error);$("notice").hidden=!message;}
async function api(path,method="GET",body){
  const version=generation;
  const response=await fetch(apiOrigin+"/api/"+path,{method,credentials:"omit",...(apiOrigin?{targetAddressSpace:"loopback"}:{}),headers:{Authorization:"Bearer "+capability,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});
  const result=await response.json();if(version!==generation){const error=new Error("پاسخ قدیمی نادیده گرفته شد.");error.stale=true;throw error;}if(!response.ok)throw new Error(result.error||"عملیات ناموفق بود.");return result;
}
async function run(button,work){button.disabled=true;try{await work();}catch(error){if(!error.stale)notice(error.message,true);}finally{button.disabled=button.id==="send"?sending:button.id==="devices-open"?(!state.connected||state.features?.deviceManagement!==true):false;}}
function price(){const m=state.models?.find(model=>model.id===$("model").value);$("price").textContent=m?"هر میلیون توکن: ورودی "+Number(m.input_toman_per_million).toLocaleString("fa-IR")+" / خروجی "+Number(m.output_toman_per_million).toLocaleString("fa-IR")+" تومان":"";}
async function loadState(){
  state=await api("state");$("workspace-name").textContent=state.workspace;
  deployment.updateBase(state);
  devices.update(state);
  if(!state.configured)conversationSync.hide();
  $("account-name").textContent=state.account?.name||"حساب پاستا";
  $("account-detail").textContent=state.account?Number(state.account.balanceToman).toLocaleString("fa-IR")+" تومان اعتبار":"هنوز وارد نشدی";
  $("logout").hidden=!state.connected;$("login").hidden=state.connected;
  $("budget-form").hidden=!state.connected||state.configured;
  $("onboarding").hidden=state.configured;$("conversation").hidden=!state.configured;$("composer").hidden=!state.configured;
  $("new").disabled=!state.configured;$("cloud-tab").disabled=!state.connected;
  if(state.models?.length){
    const previous=$("model").value;$("model").replaceChildren(...state.models.map(model=>{const option=document.createElement("option");option.value=model.id;option.textContent=(model.name||model.id)+(model.paastacodePreferred?" · پیشنهادی":"");return option;}));
    if(state.models.some(m=>m.id===previous))$("model").value=previous;price();
  }
  if(state.error)notice(state.error,true);
  if(state.configured)await sessions();
}
async function sessions(){
  const listMode=mode,version=++listGeneration;
  $("sessions").setAttribute("aria-busy","true");
  for(const button of $("sessions").querySelectorAll("button"))button.disabled=true;
  let items;
  try{items=listMode==="cloud"?(await api("cloud")).sessions:await api("sessions");}
  catch(error){if(version===listGeneration)$("sessions").setAttribute("aria-busy","false");throw error;}
  if(version!==listGeneration||mode!==listMode)return;
  $("sessions").setAttribute("aria-busy","false");
  $("sessions").replaceChildren();
  if(!items.length){const text=document.createElement("p");text.className="muted";text.textContent=mode==="cloud"?"هنوز گفتگویی در حساب ذخیره نشده.":"اولین گفتگو را شروع کن.";$("sessions").append(text);return;}
  for(const item of items){
    const button=document.createElement("button");button.textContent=item.title;button.setAttribute("aria-current",String(session?.id===item.id));
    button.onclick=()=>run(button,async()=>{
      generation++;lastMessages="";
      if(listMode==="cloud"){
        session=null;$("composer").hidden=true;$("save").disabled=true;$("permissions").replaceChildren();
        conversationSync.hide();
        const saved=await api("cloud/session?id="+encodeURIComponent(item.id));
        renderMessages(saved.snapshot.messages.map(m=>({info:{role:m.role},parts:[{type:"text",text:m.text}]})));
        session=null;$("permissions").replaceChildren();$("composer").hidden=true;$("save").disabled=true;$("empty").hidden=true;
        $("save-state").textContent="ذخیره‌شده در حساب";
        const viewGeneration=generation;
        $("messages").append(cloudActions({saved,api,run,notice,getState:()=>state,isCurrent:()=>generation===viewGeneration&&mode==="cloud",onDeleted:async()=>{generation++;$("messages").replaceChildren();$("save-state").textContent="نسخهٔ حساب حذف شد";$("empty").hidden=false;await sessions();}}));
        const actions=document.createElement("div");actions.className="suggestions";
        const restore=document.createElement("button");restore.textContent="ادامه در این پروژه";
        restore.onclick=()=>run(restore,async()=>{
          const result=await api("restore","POST",{id:item.id});session=result.session;mode="local";
          $("local-tab").setAttribute("aria-pressed","true");$("cloud-tab").setAttribute("aria-pressed","false");$("composer").hidden=false;
          notice("متن گفتگو برای ادامه آماده است. فایل‌ها و دستورهای قبلی بازسازی نمیشن. درخواست بعدی را بنویس.");
          await sessions();await refresh();$("prompt").focus();
        });
        actions.append(restore);$("messages").append(actions);
      }else {session=item;$("composer").hidden=false;lastMessages="";await refresh();}
      drawer(false);
    });
    $("sessions").append(button);
  }
}
function textContent(parent,text){
  const sections=text.split(/(```[\s\S]*?```)/g);
  for(const section of sections){
    const code=section.startsWith("```"),node=document.createElement(code?"pre":"p");
    node.textContent=code?section.replace(/^```[^\n]*\n?/,"").replace(/```$/,""):section;
    if(code)node.dir="ltr";parent.append(node);
  }
}
function renderMessages(messages){
  $("messages").replaceChildren();$("empty").hidden=messages.length>0;
  for(const message of messages){
    const article=document.createElement("article");article.className="message "+message.info.role;
    const header=document.createElement("header");header.textContent=message.info.role==="user"?"شما":"پاستاکد";article.append(header);
    for(const part of message.parts){
      if(part.type==="text"&&!part.synthetic)textContent(article,part.text);
      if(part.type==="tool"){
        const details=document.createElement("details");details.className="tool";const title=document.createElement("summary");
        const labels={completed:"انجام شد",running:"در حال اجرا",pending:"در انتظار",error:"ناموفق"};
        title.textContent=(part.state?.title||part.tool)+" · "+(labels[part.state?.status]||"");
        const content=document.createElement("pre");content.textContent=String(part.state?.metadata?.diff||part.state?.output||part.state?.error||JSON.stringify(part.state?.input||{},null,2));details.append(title,content);article.append(details);
      }
    }
    if(message.info.error){const error=document.createElement("p");error.textContent=message.info.error.data?.message||"پاسخ کامل نشد؛ درخواست را بررسی کن.";article.append(error);}
    $("messages").append(article);
  }
}
async function refresh(){
  if(refreshing||!state.configured)return;refreshing=true;
  const selected=session,version=generation;
  try{
    if(selected){
      const messages=await api("messages?id="+encodeURIComponent(selected.id));if(version!==generation||session!==selected)return;const serialized=JSON.stringify(messages);
      if(serialized!==lastMessages){renderMessages(messages);lastMessages=serialized;$("save-state").textContent="تغییرات روی این دستگاه";}
      $("save").disabled=!messages.length;
      const status=await api("status");if(version!==generation||session!==selected)return;sending=promptPending||(!!status[selected.id]&&status[selected.id].type!=="idle");
      $("send").disabled=sending;$("stop").hidden=!sending;$("connection-state").textContent=sending?"پاستاکد مشغول کاره":"آماده";
      await conversationSync.refresh();
    }
    const permissions=await api("permissions");if(version!==generation||session!==selected)return;$("permissions").replaceChildren();
    for(const permission of permissions.filter(p=>p.sessionID===session?.id)){
      const box=document.createElement("section");box.className="permission";
      const title=document.createElement("h3");title.textContent="این کار به تأیید تو نیاز داره";
      const info=document.createElement("pre");info.textContent=permission.permission+"\n"+(permission.patterns||[]).join("\n")+"\n"+(permission.metadata?.diff||permission.metadata?.command||JSON.stringify(permission.metadata||{},null,2));
      const actions=document.createElement("div");
      for(const [reply,label] of [["reject","اجازه نمی‌دم"],["once","فقط همین بار"]]){
        const button=document.createElement("button");button.textContent=label;button.onclick=()=>run(button,async()=>{await api("permission","POST",{id:permission.id,reply});await refresh();});actions.append(button);
      }
      box.append(title,info,actions);$("permissions").append(box);
    }
  }catch(error){if(!error.stale)notice(error.message,true);}finally{refreshing=false;}
}
$("login").onclick=()=>run($("login"),async()=>{
  const result=await api("login","POST");$("device").hidden=false;$("device-code").textContent=result.code;$("device-link").href=result.url;
  notice("صفحهٔ تأیید پاستا را باز کن؛ اینجا منتظر می‌مونیم.");
  clearInterval(loginTimer);loginTimer=setInterval(async()=>{
    try{const result=await api("login/poll","POST");if(!result.pending){clearInterval(loginTimer);$("device").hidden=true;notice("");await loadState();}}
    catch(error){clearInterval(loginTimer);notice(error.message,true);}
  },3500);
});
$("budget-form").onsubmit=event=>{event.preventDefault();run($("budget-form").querySelector("button"),async()=>{await api("connect","POST",{dailyLimitToman:Number($("budget").value)});notice("");await loadState();});};
function clearAccountView(){conversationSync.hide();clearInterval(loginTimer);generation++;listGeneration++;session=null;state={};mode="local";lastMessages="";sending=false;promptPending=false;$("send").disabled=false;for(const id of ["messages","permissions","sessions","model"])$(id).replaceChildren();$("prompt").value="";$("save").disabled=true;$("device").hidden=true;$("device-link").removeAttribute("href");$("device-code").textContent="";$("save-state").textContent="روی این دستگاه";$("local-tab").setAttribute("aria-pressed","true");$("cloud-tab").setAttribute("aria-pressed","false");notice("");}
$("logout").onclick=()=>run($("logout"),async()=>{clearInterval(loginTimer);generation++;await api("logout","POST");clearAccountView();await loadState();});
$("new").onclick=()=>run($("new"),async()=>{generation++;session=await api("sessions","POST");mode="local";lastMessages="";$("composer").hidden=false;$("local-tab").setAttribute("aria-pressed","true");$("cloud-tab").setAttribute("aria-pressed","false");await sessions();await refresh();drawer(false);$("prompt").focus();});
$("composer").onsubmit=event=>{
  event.preventDefault();if(sending||!$("prompt").value.trim())return;
  const text=$("prompt").value;sending=true;promptPending=true;let accepted=false;
  run($("send"),async()=>{
    if(!session)session=await api("sessions","POST");
    await api("prompt","POST",{id:session.id,text,model:$("model").value});
    accepted=true;
    $("prompt").value="";resizePrompt();notice("");await sessions();
  }).finally(async()=>{promptPending=false;if(!accepted){sending=false;$("send").disabled=false;}await refresh();});
};
$("prompt").onkeydown=event=>{if(!event.isComposing&&event.key==="Enter"&&(event.ctrlKey||event.metaKey)){event.preventDefault();$("composer").requestSubmit();}};
$("stop").onclick=()=>run($("stop"),async()=>{await api("abort","POST",{id:session.id});await refresh();});
$("save").onclick=()=>$("save-dialog").showModal();
$("save-dialog").addEventListener("close",()=>{if($("save-dialog").returnValue==="save")run($("save"),async()=>{await api("save","POST",{id:session.id});$("save-state").textContent="در حساب ذخیره شد";notice("گفتگو در حساب پاستا ذخیره و دوباره خوانده شد.");});});
$("model").onchange=price;
$("local-tab").onclick=()=>run($("local-tab"),async()=>{mode="local";$("local-tab").setAttribute("aria-pressed","true");$("cloud-tab").setAttribute("aria-pressed","false");if(!session){$("messages").replaceChildren();$("empty").hidden=false;}$("composer").hidden=false;await sessions();});
$("cloud-tab").onclick=()=>run($("cloud-tab"),async()=>{conversationSync.hide();mode="cloud";$("local-tab").setAttribute("aria-pressed","false");$("cloud-tab").setAttribute("aria-pressed","true");await sessions();});
function drawer(open){$("rail").classList.toggle("open",open);$("menu").setAttribute("aria-expanded",String(open));document.querySelector("main").inert=open;$("rail-backdrop").hidden=!open;if(open)$("rail-close").focus();else if(matchMedia("(max-width:640px)").matches)$("menu").focus();}
$("menu").onclick=()=>drawer(true);$("rail-close").onclick=()=>drawer(false);$("rail-backdrop").onclick=()=>drawer(false);
for(const button of document.querySelectorAll("[data-prompt]"))button.onclick=()=>{$("prompt").value=button.dataset.prompt;$("prompt").focus();};
document.addEventListener("keydown",event=>{if(event.key==="Escape")drawer(false);if(event.key==="Tab"&&$("rail").classList.contains("open")){const items=[...$("rail").querySelectorAll("button:not(:disabled),a[href]")].filter(el=>el.offsetParent);const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
matchMedia("(max-width:640px)").addEventListener("change",()=>drawer(false));
if(location.origin===hostedOrigin){const connection=await connectHosted();apiOrigin=connection.origin;capability=connection.capability;}
loadState().catch(error=>notice(error.message,true));setInterval(refresh,1800);
