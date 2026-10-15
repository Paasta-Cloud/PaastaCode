import {enhanceSelects,promptInput,labelDialog,icon} from "./components.js";
import {deploymentUI} from "./deployment.js";
import {connectHosted,hostedOrigin,runtimeRequest,invalidateHosted} from "./hosted.js";
import {cloudActions} from "./cloud-actions.js";
import {devicesUI} from "./devices.js";
import {syncUI} from "./sync.js";
import {workbench} from "./workbench.js";
import {gitUI} from "./git-ui.js";
import {updatesUI} from "./updates.js";
const $=id=>document.getElementById(id);
enhanceSelects();
$("send").replaceChildren(icon("arrowUp"));
$("send").title="ارسال درخواست (Enter)";
let theme="dark";try{theme=localStorage.getItem("paastacode-theme")==="light"?"light":"dark";}catch{}
function setTheme(value){theme=value;document.documentElement.dataset.theme=value;$("theme-toggle").replaceChildren(icon(value==="dark"?"sun":"moon"),document.createTextNode(value==="dark"?"نمای روشن":"نمای تیره"));$("theme-toggle").setAttribute("aria-pressed",String(value==="light"));}
setTheme(theme);$("theme-toggle").onclick=()=>{setTheme(theme==="dark"?"light":"dark");try{localStorage.setItem("paastacode-theme",theme);}catch{}};
for(const [id,name] of Object.entries({attach:"attach","hosted-open":"folder","deploy-open":"deploy","import-open":"import","devices-open":"devices","billing-open":"wallet","updates-open":"update","open-workspace":"folder",save:"save"}))$(id).prepend(icon(name));
document.querySelector(".session-search").prepend(icon("search"));document.querySelector(".empty").prepend(icon("code"));
const bench=workbench();
const resizePrompt=promptInput($("prompt"));
let attachments=[],attachmentLoading=false,attachmentRevision=0;
function renderAttachments(){
  $("attachments").replaceChildren();$("attach").disabled=attachmentLoading||promptPending;
  for(const file of attachments){const item=document.createElement("div");item.className="attachment";const name=document.createElement("bdi");name.dir="auto";name.textContent=file.name;const size=document.createElement("small");size.textContent=Math.ceil(file.size/1024).toLocaleString("fa-IR")+" KB";const remove=document.createElement("button");remove.type="button";remove.textContent="×";remove.setAttribute("aria-label","حذف پیوست "+file.name);remove.disabled=promptPending;remove.onclick=()=>{attachments=attachments.filter(value=>value!==file);renderAttachments();};item.append(name,size,remove);$("attachments").append(item);}
}
function clearAttachments(){attachmentRevision++;attachments=[];attachmentLoading=false;$("attachment-files").value="";$("composer").classList.remove("drag-over");renderAttachments();}
async function addAttachments(files){
  if(promptPending||attachmentLoading)return;
  if(!state.features?.promptAttachments){notice("برای پیوست فایل، اجرای پاستاکد این پروژه را به‌روز کنید.",true);return;}
  const revision=attachmentRevision,selected=[...files];
  if(!selected.length)return;
  if(attachments.length+selected.length>8){notice("حداکثر ۸ فایل به هر درخواست پیوست کنید.",true);return;}
  if(selected.some(file=>file.size>4*1024*1024)||[...attachments,...selected].reduce((sum,file)=>sum+file.size,0)>6*1024*1024){notice("هر فایل حداکثر ۴ مگابایت و مجموع پیوست‌ها حداکثر ۶ مگابایت است.",true);return;}
  attachmentLoading=true;$("send").disabled=true;renderAttachments();
  try{const added=await Promise.all(selected.map(async file=>{if(["image/png","image/jpeg","image/gif","image/webp"].includes(file.type)){try{const image=await createImageBitmap(file);image.close();}catch{throw new Error("تصویر "+file.name+" قابل خواندن نیست؛ فایل سالمی انتخاب کنید.");}}return new Promise((done,fail)=>{const reader=new FileReader();reader.onerror=()=>fail(new Error("خواندن فایل انجام نشد؛ دوباره انتخاب کنید."));reader.onload=()=>done({name:file.name,size:file.size,data:String(reader.result).split(",")[1]});reader.readAsDataURL(file);});}));if(revision===attachmentRevision){attachments.push(...added);notice("");}}
  catch(error){if(revision===attachmentRevision)notice(error.message,true);}
  finally{if(revision===attachmentRevision){attachmentLoading=false;$("attachment-files").value="";$("send").disabled=promptPending;renderAttachments();}}
}
$("attach").onclick=()=>$("attachment-files").click();$("attachment-files").onchange=()=>addAttachments($("attachment-files").files);
$("prompt").addEventListener("paste",event=>{const files=[...event.clipboardData.files];if(files.length){event.preventDefault();void addAttachments(files);}});
$("composer").addEventListener("dragover",event=>{if(event.dataTransfer.types.includes("Files")){event.preventDefault();$("composer").classList.add("drag-over");}});
$("composer").addEventListener("dragleave",event=>{if(!$("composer").contains(event.relatedTarget))$("composer").classList.remove("drag-over");});
$("composer").addEventListener("drop",event=>{event.preventDefault();$("composer").classList.remove("drag-over");void addAttachments(event.dataTransfer.files);});
for(const dialog of document.querySelectorAll("dialog"))labelDialog(dialog);
updatesUI();
if(window.paastacodeDesktop){$("open-workspace").hidden=false;$("open-workspace").onclick=()=>run($("open-workspace"),()=>window.paastacodeDesktop.chooseWorkspace());}
let capability=new URLSearchParams(location.hash.slice(1)).get("cap")||sessionStorage.getItem("paastacode-cap");
let runtimeConnection=null,hostedAccountOwner=null;
const awaitingWorkspace=()=>location.origin===hostedOrigin&&!runtimeConnection;
if(capability&&location.origin!==hostedOrigin){sessionStorage.setItem("paastacode-cap",capability);history.replaceState(null,"",location.pathname);}
let state={},session=null,mode="local",lastMessages="",sending=false,refreshing=false,loginTimer,generation=0,listGeneration=0,promptPending=false,nextAccountPoll=0;
let cloudSelection=null;
function selectionView(){
  const selected=mode==="cloud"?cloudSelection:session;
  for(const button of $("sessions").querySelectorAll("button[data-session]"))button.setAttribute("aria-current",String(button.dataset.session===selected?.id));
  $("conversation-title").textContent=selected?.title||"گفتگوی جدید";
  $("thread-location").textContent=mode==="cloud"?"نسخهٔ ذخیره‌شده در حساب":"گفتگوی پروژه";
}
function filterSessions(){
  const value=$("session-search").value.trim().toLocaleLowerCase();let count=0;
  for(const button of $("sessions").querySelectorAll("button[data-session]")){button.hidden=!button.dataset.title.includes(value);if(!button.hidden)count++;}
  $("session-count").textContent=count.toLocaleString("fa-IR");$("session-no-results").hidden=!value||count>0;
}
$("session-search").oninput=filterSessions;
let currentWorkflow={phase:"build"},workflowSession=null,planReady=false,importToken=null,importRevision=0;
const modelCost=m=>`ورودی ${Number(m.input_toman_per_million).toLocaleString("fa-IR")} / خروجی ${Number(m.output_toman_per_million).toLocaleString("fa-IR")} تومان، هر میلیون توکن`;
function workflowView(){
  $("composer").dataset.phase=$("workflow-phase").value;
  const automatic=$("workflow-phase").value==="auto",planning=$("workflow-phase").value==="plan";
  const runningModel=currentWorkflow.phase==="plan"?currentWorkflow.planModel:currentWorkflow.buildModel;
  const selectedModel=automatic&&currentWorkflow.phase==="build"?$("execution-model").value:$("model").value;
  const canRestart=sending&&session&&runningModel&&selectedModel!==runningModel;
  $("plan-controls").hidden=!state.features?.modelWorkflow||!planning&&!automatic;
  $("execute-plan").hidden=automatic;
  const interrupted=currentWorkflow.automatic?.state==="interrupted";
  const activeModel=state.models?.find(m=>m.id===runningModel);
  $("workflow-summary").replaceChildren(document.createTextNode(interrupted?"ادامهٔ قبلی نامطمئن است؛ خودکار تکرار نشد.":currentWorkflow.automatic?.state==="failed"?"ادامهٔ خودکار انجام نشد؛ نتیجه را بررسی کنید.":sending?(currentWorkflow.phase==="plan"?"در حال بررسی و برنامه‌ریزی":"در حال اجرای درخواست"):automatic?"برنامه‌ریزی و اجرا با پاستاکد":planning?"فقط برنامه‌ریزی":"اجرا با یک مدل"));
  if(sending&&activeModel){const name=document.createElement("bdi");name.textContent=activeModel.name||activeModel.id;$("workflow-summary").append(document.createTextNode(" · "),name);}
  $("workflow-resume").hidden=!interrupted;$("workflow-resume").disabled=promptPending;
  $("model-role").textContent=automatic||planning?"مدل برنامه‌ریزی":"مدل پاستا";
  $("workflow-hint").textContent=planning?"برنامه‌ریزی فقط‌خواندنی است، حتی با Full Access.":canRestart?"مدل عوض شد؛ برای ادامهٔ همین کار، توقف و ادامه را بزنید.":"";
  $("workflow-phase").disabled=sending;
  $("execute-plan").disabled=sending||!planReady||currentWorkflow.phase!=="plan";
  $("model-restart").hidden=!canRestart;
  $("model-restart").disabled=promptPending;
  const model=state.models?.find(m=>m.id===$("execution-model").value);$("execution-price").textContent=model?modelCost(model):"";
  price();
}
async function loadWorkflow(){
  if(!session||!state.features?.modelWorkflow)return;
  const id=session.id,value=await api("workflow?id="+encodeURIComponent(id));if(session?.id!==id||promptPending)return;
  if(workflowSession===id&&JSON.stringify(currentWorkflow)===JSON.stringify(value))return;
  currentWorkflow=value;workflowSession=id;$("workflow-phase").value=state.features?.automaticWorkflow&&(value.automatic||state.workflowModels&&!value.planModel&&!value.buildModel)?"auto":value.phase;
  const selected=$("workflow-phase").value==="auto"?value.planModel:value.phase==="plan"?value.planModel:value.buildModel;
  if(state.models?.some(m=>m.id===selected))$("model").value=selected;
  else if(selected){$("model").value="";notice("مدل قبلی دیگر در پاستاکد قابل استفاده نیست. برای ادامه، یک مدل پولی انتخاب کنید؛ قیمت آن کنار ورودی آمده است.");}
  if(state.models?.some(m=>m.id===value.buildModel))$("execution-model").value=value.buildModel;
  else if(value.buildModel&&$("workflow-phase").value==="auto"){$("execution-model").value="";notice("مدل اجرای قبلی دیگر در دسترس نیست. مدل اجرا و قیمت آن را در تنظیمات مدل‌ها بررسی کنید.");}
  price();workflowView();
}
const deployment=deploymentUI({api,run,notice,getState:()=>state});
const devices=devicesUI({api,run,notice,getGeneration:()=>generation,onCurrentRevoked:async()=>{clearAccountView();await loadState();}});
const conversationSync=syncUI({api,run,notice,getState:()=>state,getView:()=>({id:session?.id,mode,generation})});
const git=gitUI({api,run,notice});
function accessView(value){$("access-mode").value=value||"review";$("access-mode").dataset.mode=value||"review";$("access-description").textContent=value==="full"?"Full Access: تغییر فایل و اجرای دستور بدون پرسش":"تغییر فایل و اجرای دستور با تأیید شما";}
function notice(message,error=false){$("notice").textContent=message;$("notice").classList.toggle("error",error);$("notice").hidden=!message;}
async function api(path,method="GET",body){
  const version=generation;
  let request;
  if(awaitingWorkspace()){
    if(!hostedAccountOwner)throw new Error("برای دیدن گفتگوها، وارد حساب پاستا شوید.");
    if(method!=="GET"||!(path==="cloud"||/^cloud\/session\?id=[0-9a-f-]{36}$/i.test(path)))throw new Error("ابتدا یک فضای کار انتخاب کنید یا به پروژه روی کامپیوترتان وصل شوید.");
    request={url:"/api/paastacode/sessions"+(path==="cloud"?"":"?id="+encodeURIComponent(new URLSearchParams(path.split("?")[1]).get("id"))),init:{credentials:"same-origin",cache:"no-store",headers:{"X-PaastaCode-Owner":hostedAccountOwner}}};
  }else request=runtimeRequest(runtimeConnection,path,method,body,{capability,accountRevision:state.features?.independentRuntime?state.accountRevision:undefined});
  const response=await fetch(request.url,request.init);
  if(runtimeConnection?.kind==="cloud"&&[403,404].includes(response.status)){const result=await response.clone().json().catch(()=>({}));if(result.workspaceError){clearAccountView();invalidateHosted();throw new Error("فضای کار را دوباره انتخاب کنید.");}}
  const result=await response.json().catch(()=>null);if(version!==generation){const error=new Error("پاسخ قدیمی نادیده گرفته شد.");error.stale=true;throw error;}
  if(awaitingWorkspace()&&response.status===403){hostedAccountOwner=null;clearAccountView();$("account-name").textContent="حساب پاستا";$("account-detail").textContent="ورود دوباره لازم است";$("hosted-hub").hidden=false;$("conversation").hidden=true;$("hosted-login").hidden=false;document.querySelector(".thread-heading").hidden=true;throw new Error("دسترسی حساب تغییر کرده است؛ دوباره وارد حساب پاستا شوید.");}
  if(!result||typeof result!=="object")throw new Error("پاسخ سرویس کامل دریافت نشد؛ دوباره تلاش کنید.");
  if(result.accountChanged){clearAccountView();await loadState();}if(!response.ok)throw new Error(result.error||"عملیات ناموفق بود.");return result;
}
async function run(button,work){button.disabled=true;try{await work();}catch(error){if(!error.stale)notice(error.message,true);}finally{button.disabled=button.id==="send"?sending:button.id==="devices-open"?(!state.connected||state.features?.deviceManagement!==true):false;}}
function price(){
  const automatic=$("workflow-phase").value==="auto",active=sending?(currentWorkflow.phase==="plan"?currentWorkflow.planModel:currentWorkflow.buildModel):null;
  const m=state.models?.find(model=>model.id===(active||$("model").value)),executor=state.models?.find(model=>model.id===$("execution-model").value);
  $("price").textContent=m?(active?"مدل فعال: "+(m.name||m.id)+" · ":automatic?"برنامه‌ریزی: ":"")+modelCost(m)+(automatic&&!active&&executor?" · اجرا با "+(executor.name||executor.id)+": "+modelCost(executor):""):"";
}
async function refreshQuota(){
  const summary=$('subscription-summary');if(!state.configured||!state.features?.subscriptionUsage){summary.hidden=true;return;}
  const owner=state.account?.tenantId+':'+state.account?.id;
  try{const quota=await api('quota');if(owner!==state.account?.tenantId+':'+state.account?.id)return;summary.hidden=false;if(!quota.active){$('subscription-plan').textContent='اشتراک فعال ندارید';$('subscription-dates').textContent='';$('subscription-week-label').textContent='مصرف و خرید را در کنسول بررسی کنید.';$('subscription-week').hidden=true;$('subscription-reset').textContent='';return;}
    $('subscription-plan').textContent=quota.plan;$('subscription-dates').textContent='اعتبار تا '+new Date(quota.endsAt).toLocaleDateString('fa-IR',{timeZone:'Asia/Tehran'});const remaining=quota.quotas.week.remainingPercent;$('subscription-week-label').textContent='سهمیهٔ هفتگی: '+Number(remaining).toLocaleString('fa-IR')+'٪ باقی‌مانده';$('subscription-week').hidden=false;$('subscription-week').value=remaining;$('subscription-reset').textContent=(quota.mode==='payg'?'مصرف فعلی با کیف پول · ':quota.mode==='paused'?'مصرف متوقف است · ':'')+'بازنشانی '+new Date(quota.quotas.week.resetAt).toLocaleString('fa-IR',{timeZone:'Asia/Tehran',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  }catch{if(owner===state.account?.tenantId+':'+state.account?.id){summary.hidden=false;$('subscription-plan').textContent='وضعیت اشتراک دریافت نشد';$('subscription-dates').textContent='از «اشتراک و مصرف» بررسی کنید.';$('subscription-week-label').textContent='';$('subscription-week').hidden=true;$('subscription-reset').textContent='';}}
}
setInterval(()=>void refreshQuota(),15000);
async function loadState(){
  state=await api("state");
  if(state.connected&&!state.configured&&state.billingStatus?.active&&state.billingStatus.mode==='subscription'&&state.billingStatus.canConnectWithoutLimit){notice('اشتراک فعال است؛ در حال آماده‌سازی پروژه…');try{await api('connect','POST',{});state=await api('state');notice('');}catch(error){if(!error.stale)notice(error.message,true);}}
  void refreshQuota();$("workspace-name").textContent=runtimeConnection?.kind==="cloud"?runtimeConnection.name:state.workspace;$("workspace-name").dir=runtimeConnection?.kind==="cloud"?"auto":"ltr";
  $("attach").hidden=!state.features?.promptAttachments;
  $("workflow-controls").hidden=!state.features?.modelWorkflow;$("import-open").hidden=!state.features?.projectImport;$("import-open").disabled=!state.configured;
  $("workflow-phase").querySelector('[value="auto"]').disabled=!state.features?.automaticWorkflow;
  if(!workflowSession)$("workflow-phase").value=state.features?.automaticWorkflow&&state.workflowModels?"auto":"build";
  $("git-open").disabled=!state.configured||!state.features?.git;$("access-mode").disabled=!state.features?.workspaceAccess;accessView(state.accessMode);
  deployment.updateBase(state);
  devices.update(state);
  if(!state.configured)conversationSync.hide();
  $("account-name").textContent=state.account?.name||"حساب پاستا";
  $('billing-open').hidden=!state.billingUrl;if(state.billingUrl)$('billing-open').href=state.billingUrl;
  $("account-detail").textContent=state.account?Number(state.account.balanceToman).toLocaleString("fa-IR")+" تومان اعتبار":"هنوز وارد نشدی";
  $("logout").hidden=!state.connected;$("login").hidden=state.connected;
  $("budget-form").hidden=!state.connected||state.configured||!!state.billingStatus;
  const onboarding=state.connected&&!state.configured&&!!state.billingStatus;$('subscription-onboarding').hidden=!onboarding;
  if(onboarding){for(const id of ['subscription-buy','subscription-wallet'])$(id).href=state.billingUrl;$('subscription-continue').hidden=!state.billingStatus.canConnectWithoutLimit;$('subscription-buy').hidden=!!state.billingStatus.canConnectWithoutLimit;$('subscription-heading').textContent=state.billingStatus.active?'اشتراک شما آماده است':'با اشتراک کدنویسی شروع کنید';$('subscription-description').textContent=state.billingStatus.mode==='paused'?'مصرف حساب متوقف است. برای ادامه، روش مصرف را در حساب پاستا انتخاب کنید.':'اشتراک و سهمیهٔ شما بین پاستاکد و ابزارهای کدنویسی مشترک است.';}
  $("onboarding").hidden=state.configured;$("conversation").hidden=!state.configured;$("composer").hidden=!state.configured;
  document.querySelector(".thread-heading").hidden=!state.configured;
  $("new").disabled=!state.configured;$("cloud-tab").disabled=!state.connected;
  if(state.models?.length){
    const previous=$("model").value;$("model").replaceChildren(...state.models.map(model=>{const option=document.createElement("option");option.value=model.id;option.textContent=(model.name||model.id)+(model.paastacodePreferred?" · پیشنهادی":"");return option;}));
    $("model").value=previous&&state.models.some(m=>m.id===previous)?previous:state.workflowModels?.planModel||state.models[0].id;price();
    const execution=$("execution-model").value;
    const models=[...state.models].sort((a,b)=>(Number(a.input_toman_per_million)+Number(a.output_toman_per_million))-(Number(b.input_toman_per_million)+Number(b.output_toman_per_million)));
    $("execution-model").replaceChildren(...models.map(model=>{const option=document.createElement("option");option.value=model.id;option.textContent=model.name||model.id;return option;}));
    $("execution-model").value=models.some(m=>m.id===execution)?execution:state.workflowModels?.buildModel||models[0].id;workflowView();
  }
  if(state.error)notice(state.error,true);
  if(state.configured){await sessions();if(state.features?.git)git.refresh().catch(()=>{});}
}
async function sessions(){
  const listMode=mode,version=++listGeneration;
  $("sessions").setAttribute("aria-busy","true");
  for(const button of $("sessions").querySelectorAll("button"))button.disabled=true;
  let items;
  try{items=listMode==="cloud"?(await api("cloud")).sessions:awaitingWorkspace()?[]:await api("sessions");if(!Array.isArray(items))throw new Error("فهرست گفتگوها کامل دریافت نشد؛ دوباره تلاش کنید.");}
  catch(error){if(version===listGeneration)$("sessions").setAttribute("aria-busy","false");throw error;}
  if(version!==listGeneration||mode!==listMode)return;
  $("sessions").setAttribute("aria-busy","false");
  $("sessions").replaceChildren();
  selectionView();filterSessions();
  if(!items.length){const text=document.createElement("p");text.className="muted";text.textContent=mode==="cloud"?"هنوز گفتگویی در حساب ذخیره نشده.":"اولین گفتگو را شروع کن.";$("sessions").append(text);return;}
  for(const item of items){
    const button=document.createElement("button");button.dataset.session=item.id;button.dataset.title=String(item.title||"گفتگوی جدید").toLocaleLowerCase();button.title=item.title||"گفتگوی جدید";
    const title=document.createElement("span");title.className="session-title";title.textContent=button.title;
    const marker=document.createElement("span");marker.className="session-marker";marker.setAttribute("aria-hidden","true");marker.textContent="✓";
    button.append(icon("chat"),title,marker);
    const time=item.time?.updated||item.updated_at;
    if(time&&Number.isFinite(new Date(time).getTime())){const meta=document.createElement("small");meta.textContent=new Date(time).toLocaleDateString("fa-IR",{month:"short",day:"numeric"});button.append(meta);}
    button.onclick=()=>run(button,async()=>{
      clearAttachments();
      generation++;lastMessages="";bench.reset();
      if(listMode==="cloud"){
        session=null;cloudSelection=item;selectionView();$("composer").hidden=true;$("save").disabled=true;$("permissions").replaceChildren();
        conversationSync.hide();
        const saved=await api("cloud/session?id="+encodeURIComponent(item.id));
        if(awaitingWorkspace()){$("hosted-hub").hidden=true;$("conversation").hidden=false;document.querySelector(".thread-heading").hidden=false;}
        renderMessages(saved.snapshot.messages.map(m=>({info:{role:m.role},parts:[{type:"text",text:m.text}]})));
        session=null;$("permissions").replaceChildren();$("composer").hidden=true;$("save").disabled=true;$("empty").hidden=true;
        $("save-state").textContent="ذخیره‌شده در حساب";
        const viewGeneration=generation;
        $("messages").append(cloudActions({saved,api,run,notice,getState:()=>state,readOnly:awaitingWorkspace(),isCurrent:()=>generation===viewGeneration&&mode==="cloud",onDeleted:async()=>{generation++;$("messages").replaceChildren();$("save-state").textContent="نسخهٔ حساب حذف شد";$("empty").hidden=false;await sessions();}}));
        const actions=document.createElement("div");actions.className="suggestions";
        const restore=document.createElement("button");restore.textContent=awaitingWorkspace()?"انتخاب فضای کار":"ادامه در این پروژه";
        if(awaitingWorkspace()){const help=document.createElement("p");help.className="muted";help.textContent="برای ادامهٔ کدنویسی، یک فضای کار باز کنید یا به پروژه روی کامپیوترتان وصل شوید.";actions.append(help);}
        restore.onclick=()=>run(restore,async()=>{
          if(awaitingWorkspace()){await switchTab("local");return;}
          const result=await api("restore","POST",{id:item.id});session=result.session;mode="local";
          $("local-tab").setAttribute("aria-pressed","true");$("cloud-tab").setAttribute("aria-pressed","false");$("composer").hidden=false;
          notice("متن گفتگو برای ادامه آماده است. فایل‌ها و دستورهای قبلی بازسازی نمیشن. درخواست بعدی را بنویس.");
          await sessions();await refresh();$("prompt").focus();
        });
        actions.append(restore);$("messages").append(actions);
      }else {session=item;selectionView();$("composer").hidden=false;lastMessages="";await refresh();}
      drawer(false);
    });
    $("sessions").append(button);
  }
  const selected=items.find(item=>item.id===(mode==="cloud"?cloudSelection?.id:session?.id));
  if(selected){if(mode==="cloud")cloudSelection=selected;else session={...session,title:selected.title};}
  selectionView();filterSessions();
}
function renderMessages(messages){
  bench.render(messages);
}
async function refresh(){
  if(refreshing)return;refreshing=true;
  try{
    if((state.features?.independentRuntime||state.features?.workspaceAccess)&&Date.now()>=nextAccountPoll){
      nextAccountPoll=Date.now()+5000;const next=await api("state");
      const identity=value=>JSON.stringify([value.connected,value.configured,value.account?.id,value.account?.tenantId]);
      if(identity(next)!==identity(state)){clearAccountView();await loadState();refreshing=false;return;}
      const billing=value=>JSON.stringify([value.billingStatus?.active,value.billingStatus?.mode,value.billingStatus?.canConnectWithoutLimit,value.billingStatus?.plan,value.billingStatus?.startsAt,value.billingStatus?.endsAt,value.billingStatus?.models]);
      if(billing(next)!==billing(state)){await loadState();refreshing=false;return;}
      state.accountRevision=next.accountRevision;state.accessMode=next.accessMode;accessView(state.accessMode);
    }
  }catch(error){if(!error.stale)notice(error.message,true);refreshing=false;return;}
  if(!state.configured){refreshing=false;return;}
  const selected=session,version=generation;let runtimeStatus;
  try{
    if(selected){
      if(!promptPending)await loadWorkflow();
      const messages=await api("messages?id="+encodeURIComponent(selected.id));if(version!==generation||session!==selected)return;const serialized=JSON.stringify(messages);
      const last=messages.at(-1);planReady=last?.info?.role==="assistant"&&last.info.agent==="paasta-plan"&&!!last.info.time?.completed&&!last.info.error&&last.parts.some(p=>p.type==="text"&&p.text?.trim());
      if(serialized!==lastMessages){renderMessages(messages);lastMessages=serialized;$("save-state").textContent=runtimeConnection?.kind==="cloud"?"تغییرات در فضای کار ابری":"تغییرات روی این دستگاه";}
      $("save").disabled=!messages.length;
      const status=await api("status");if(version!==generation||session!==selected)return;runtimeStatus=status[selected.id];sending=promptPending||currentWorkflow.automatic?.state==="planning"||(!!runtimeStatus&&runtimeStatus.type!=="idle");
      bench.activity(sending,{status:status[selected.id]});
      workflowView();
      await conversationSync.refresh();
    }else bench.activity(promptPending);
    const permissions=await api("permissions");if(version!==generation||session!==selected)return;const currentPermissions=permissions.filter(p=>p.sessionID===session?.id),signature=JSON.stringify(currentPermissions);
    if($('permissions').dataset.signature!==signature){$('permissions').dataset.signature=signature;$("permissions").replaceChildren();
    for(const permission of currentPermissions){
      const box=document.createElement("section");box.className="permission";
      const title=document.createElement("h3");title.textContent="این کار به تأیید تو نیاز داره";
      const info=document.createElement("pre");info.textContent=permission.permission+"\n"+(permission.patterns||[]).join("\n")+"\n"+(permission.metadata?.diff||permission.metadata?.command||JSON.stringify(permission.metadata||{},null,2));
      const actions=document.createElement("div");
      for(const [reply,label] of [["reject","اجازه نمی‌دم"],["once","فقط همین بار"]]){
        const button=document.createElement("button");button.textContent=label;button.onclick=()=>run(button,async()=>{await api("permission","POST",{id:permission.id,reply});await refresh();});actions.append(button);
      }
      box.append(title,info,actions);$("permissions").append(box);
    }
    }
    bench.activity(sending,{approval:$("permissions").children.length>0,status:runtimeStatus});
  }catch(error){if(!error.stale)notice(error.message,true);}finally{refreshing=false;}
}
$("login").onclick=()=>{const approval=window.open("about:blank","_blank");if(approval)approval.opener=null;return run($("login"),async()=>{
  try{
  const result=await api("login","POST");$("device").hidden=false;$("device-code").textContent=result.code;$("device-link").href=result.url;
  const authorization=new URL(result.url);if(authorization.protocol==='https:'&&['paasta.cloud','console.paasta.cloud'].includes(authorization.hostname)&&authorization.pathname==='/cli/authorize'){if(approval&&!approval.closed)approval.location.replace(authorization.href);else window.open(authorization.href,'_blank','noopener,noreferrer');}else{approval?.close();throw new Error('نشانی ورود معتبر نیست.');}
  notice("ورود را در مرورگر تأیید کنید. اگر مرورگر باز نشد، از پیوند زیر استفاده کنید.");
  clearInterval(loginTimer);loginTimer=setInterval(async()=>{
    try{const result=await api("login/poll","POST");if(!result.pending){clearInterval(loginTimer);$("device").hidden=true;notice("");await loadState();}}
    catch(error){clearInterval(loginTimer);notice(error.message,true);}
  },3500);
  }catch(error){approval?.close();throw error;}
});};
$('subscription-continue').onclick=()=>run($('subscription-continue'),async()=>{await api('connect','POST',{});await loadState();});
$("budget-form").onsubmit=event=>{event.preventDefault();run($("budget-form").querySelector("button"),async()=>{await api("connect","POST",{dailyLimitToman:Number($("budget").value)});notice("");await loadState();});};
function clearAccountView(){
  delete $("permissions").dataset.signature;
  $("subscription-summary").hidden=true;clearAttachments();importRevision++;currentWorkflow={phase:"build"};workflowSession=null;planReady=false;importToken=null;$("import-dialog").close();$("import-text").textContent="";$("import-file").value="";$("workflow-phase").value="build";bench.reset();conversationSync.hide();clearInterval(loginTimer);generation++;listGeneration++;session=null;cloudSelection=null;$("session-search").value="";state={};mode="local";selectionView();filterSessions();lastMessages="";sending=false;promptPending=false;$("send").disabled=false;for(const id of ["messages","permissions","sessions","model"])$(id).replaceChildren();$("prompt").value="";$("save").disabled=true;$("device").hidden=true;$("device-link").removeAttribute("href");$("device-code").textContent="";$("save-state").textContent=runtimeConnection?.kind==="cloud"?"در فضای کار ابری":"روی این دستگاه";$("local-tab").setAttribute("aria-pressed","true");$("cloud-tab").setAttribute("aria-pressed","false");notice("");}
$("logout").onclick=()=>run($("logout"),async()=>{clearInterval(loginTimer);generation++;await api("logout","POST");clearAccountView();await loadState();});
$("new").onclick=()=>run($("new"),async()=>{clearAttachments();generation++;bench.reset();session=await api("sessions","POST");mode="local";lastMessages="";$("composer").hidden=false;$("local-tab").setAttribute("aria-pressed","true");$("cloud-tab").setAttribute("aria-pressed","false");await sessions();await refresh();drawer(false);$("prompt").focus();});
$("composer").onsubmit=event=>{
  event.preventDefault();if(sending||attachmentLoading||(!$("prompt").value.trim()&&!attachments.length))return;
  submitPrompt();
};
function submitPrompt(extra={}){
  if(promptPending||attachmentLoading)return;
  if(!state.models?.some(m=>m.id===(extra.executePlan?$("execution-model").value:$("model").value))){notice("برای ادامه، یک مدل از فهرست انتخاب کنید.",true);return;}
  const automatic=$("workflow-phase").value==="auto";
  if(automatic&&!state.models?.some(m=>m.id===$("execution-model").value)){notice("مدل اجرا و قیمت آن را در تنظیمات مدل‌ها انتخاب کنید.",true);return;}
  const text=$("prompt").value,selection={model:extra.executePlan||automatic&&extra.restart&&currentWorkflow.phase==="build"?$("execution-model").value:$("model").value,phase:extra.restart?currentWorkflow.phase:extra.executePlan?"build":automatic?"plan":$("workflow-phase").value,executionModel:extra.executePlan?undefined:$("execution-model").value};sending=true;promptPending=true;let accepted=false;
  bench.follow();bench.activity(true);
  renderAttachments();
  run($("send"),async()=>{
    if(!session)session=await api("sessions","POST");
    const result=await api("prompt","POST",{id:session.id,text:extra.restart||extra.executePlan?"ادامهٔ درخواست":text.trim()?text:"پیوست‌ها را بررسی کن.",attachments:extra.restart||extra.executePlan?[]:attachments.map(({name,data})=>({name,data})),model:selection.model,...(state.features?.modelWorkflow?{phase:selection.phase,executionModel:selection.executionModel,...(state.features.automaticWorkflow?{autoExecute:automatic&&selection.phase==="plan"}:{})}:{}),...extra});
    if(result.workflow){currentWorkflow=result.workflow;workflowSession=session.id;$("workflow-phase").value=currentWorkflow.automatic?"auto":currentWorkflow.phase;if(extra.executePlan){$("workflow-phase").value="build";$("model").value=currentWorkflow.buildModel;price();}}
    accepted=true;
    if(!extra.restart&&!extra.executePlan){$("prompt").value="";clearAttachments();resizePrompt();}notice("");await sessions();
  }).finally(async()=>{promptPending=false;renderAttachments();if(!accepted){sending=false;$("send").disabled=false;}await refresh();});
}
$("prompt").onkeydown=event=>{if(!event.isComposing&&event.keyCode!==229&&event.key==="Enter"&&!event.shiftKey){event.preventDefault();if(!event.repeat)$("composer").requestSubmit();}};
$("stop").onclick=()=>run($("stop"),async()=>{await api("abort","POST",{id:session.id});await refresh();});
$("save").onclick=()=>$("save-dialog").showModal();
$("save-dialog").addEventListener("close",()=>{if($("save-dialog").returnValue==="save")run($("save"),async()=>{await api("save","POST",{id:session.id});$("save-state").textContent="در حساب ذخیره شد";notice("گفتگو در حساب پاستا ذخیره و دوباره خوانده شد.");});});
$("model").onchange=()=>{price();workflowView();};
$("workflow-phase").onchange=()=>{const selected=$("workflow-phase").value==="plan"?currentWorkflow.planModel:currentWorkflow.buildModel;if(state.models?.some(m=>m.id===selected))$("model").value=selected;price();workflowView();};
$("execution-model").onchange=workflowView;
$("model-restart").onclick=()=>submitPrompt({restart:true});
$("workflow-resume").onclick=()=>submitPrompt({restart:true});
$("execute-plan").onclick=()=>{if(!sending&&planReady)submitPrompt({executePlan:true});};
$("import-open").onclick=()=>{importRevision++;importToken=null;$("import-review").hidden=true;$("import-result").textContent="";$("import-dialog").showModal();};
$("import-close").onclick=()=>$("import-dialog").close();
$("import-form").onchange=()=>{importRevision++;importToken=null;$("import-review").hidden=true;};
$("import-form").onsubmit=event=>{event.preventDefault();run($("import-form").querySelector("button"),async()=>{
  const revision=++importRevision,accountGeneration=generation;
  importToken=null;$("import-review").hidden=true;$("import-result").textContent="در حال بررسی…";
  try{const file=$("import-file").files[0];if(file&&file.size>900000)throw new Error("فایل گفتگو بیش از حد بزرگ است؛ خروجی کوتاه‌تری انتخاب کنید.");
    const input={source:$("import-source").value,rules:$("import-rules").checked,text:file?await file.text():undefined,format:file?.name.toLowerCase().endsWith(".jsonl")?"jsonl":"text"};
    if(revision!==importRevision||accountGeneration!==generation)return;
    const result=await api("import/preview","POST",input);
    if(revision!==importRevision||accountGeneration!==generation)return;
    importToken=result.token;$("import-files").textContent=result.files.join(" · ");$("import-text").textContent=result.messages.map(m=>m.text).join("\n\n");$("import-review").hidden=false;$("import-result").textContent="پیش‌نمایش آماده است. هنوز گفتگویی ساخته نشده.";
  }catch(error){$("import-result").textContent=error.message;}
});};
$("import-confirm").onclick=()=>run($("import-confirm"),async()=>{if(!importToken)return;try{
  const result=await api("import","POST",{token:importToken});generation++;bench.reset();session=result.session;mode="local";lastMessages="";workflowSession=null;
  $("local-tab").setAttribute("aria-pressed","true");$("cloud-tab").setAttribute("aria-pressed","false");$("composer").hidden=false;$("import-dialog").close();drawer(false);
  await sessions();await refresh();notice("متن وارد شد. درخواست بعدی را بنویسید؛ فایل‌های پروژه تغییری نکردند.");$("prompt").focus();
}catch(error){$("import-result").textContent=error.message;}});
$("access-mode").onchange=()=>run($("access-mode"),async()=>{try{const result=await api("access","POST",{mode:$("access-mode").value});state.accessMode=result.mode;accessView(result.mode);notice(result.mode==="full"?"Full Access برای این پروژه روشن شد. ابزارهای کدنویسی بدون تأیید اجرا می‌شوند.":"تأیید تغییر فایل و اجرای دستور دوباره فعال شد.");await refresh();}catch(error){accessView(state.accessMode);throw error;}});
async function switchTab(next){
  clearAttachments();
  notice("");
  generation++;mode=next;session=null;cloudSelection=null;lastMessages="";sending=false;planReady=false;workflowSession=null;
  bench.reset();conversationSync.hide();$("messages").replaceChildren();$("permissions").replaceChildren();$("empty").hidden=false;
  $("composer").hidden=next==="cloud"||awaitingWorkspace();$("save").disabled=true;$("save-state").textContent=next==="cloud"?"یک گفتگوی ذخیره‌شده را انتخاب کنید":"یک گفتگو را انتخاب کنید";
  if(awaitingWorkspace()){$("hosted-hub").hidden=false;$("conversation").hidden=true;document.querySelector(".thread-heading").hidden=true;}
  $("local-tab").setAttribute("aria-pressed",String(next==="local"));$("cloud-tab").setAttribute("aria-pressed",String(next==="cloud"));selectionView();await sessions();
}
$("local-tab").onclick=()=>run($("local-tab"),()=>switchTab("local"));
$("cloud-tab").onclick=()=>run($("cloud-tab"),()=>switchTab("cloud"));
function drawer(open){$("rail").classList.toggle("open",open);$("menu").setAttribute("aria-expanded",String(open));document.querySelector("main").inert=open;$("rail-backdrop").hidden=!open;if(open)$("rail-close").focus();else if(matchMedia("(max-width:640px)").matches)$("menu").focus();}
$("menu").onclick=()=>drawer(true);$("rail-close").onclick=()=>drawer(false);$("rail-backdrop").onclick=()=>drawer(false);
for(const button of document.querySelectorAll("[data-prompt]"))button.onclick=()=>{$("prompt").value=button.dataset.prompt;$("prompt").focus();};
document.addEventListener("keydown",event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="n"&&!$("new").disabled&&!document.querySelector("dialog[open]")){event.preventDefault();$("new").click();}if(event.key==="Escape")drawer(false);if(event.key==="Tab"&&$("rail").classList.contains("open")){const items=[...$("rail").querySelectorAll("button:not(:disabled),a[href],input:not(:disabled)")].filter(el=>el.offsetParent);const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
matchMedia("(max-width:640px)").addEventListener("change",()=>drawer(false));
if(location.origin===hostedOrigin){runtimeConnection=await connectHosted({onAccount:account=>{if(!awaitingWorkspace())return;hostedAccountOwner=account.id+":"+account.tenantId;$("account-name").textContent=account.name||"حساب پاستا";$("account-detail").textContent=Number(account.balanceToman).toLocaleString("fa-IR")+" تومان اعتبار";}});capability=runtimeConnection.capability;}
if(runtimeConnection){
  if(runtimeConnection.kind==="cloud"){$("local-tab").textContent="این فضای کار";$("save-state").textContent="در فضای کار ابری";}
  const draftKey="paastacode-draft:"+(runtimeConnection.kind==="cloud"?runtimeConnection.owner+":"+runtimeConnection.id:runtimeConnection.origin);
  try{$("prompt").value=sessionStorage.getItem(draftKey)||"";sessionStorage.removeItem(draftKey);resizePrompt();}catch{/* Browser storage is optional. */}
  window.addEventListener("paastacode:workspace-switch",()=>{try{sessionStorage.setItem(draftKey,$("prompt").value);}catch{/* Keep switching available. */}});
}
window.addEventListener("paastacode:account-changed",clearAccountView);
loadState().catch(error=>notice(error.message,true));setInterval(refresh,1800);
