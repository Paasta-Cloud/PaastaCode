import {promptInput,labelDialog} from "./components.js";
import {deploymentUI} from "./deployment.js";
import {connectHosted,hostedOrigin,runtimeRequest,invalidateHosted} from "./hosted.js";
import {cloudActions} from "./cloud-actions.js";
import {devicesUI} from "./devices.js";
import {syncUI} from "./sync.js";
import {workbench} from "./workbench.js";
import {gitUI} from "./git-ui.js";
import {updatesUI} from "./updates.js";
const $=id=>document.getElementById(id);
const bench=workbench();
const resizePrompt=promptInput($("prompt"));
for(const dialog of document.querySelectorAll("dialog"))labelDialog(dialog);
updatesUI();
if(window.paastacodeDesktop){$("open-workspace").hidden=false;$("open-workspace").onclick=()=>run($("open-workspace"),()=>window.paastacodeDesktop.chooseWorkspace());}
let capability=new URLSearchParams(location.hash.slice(1)).get("cap")||sessionStorage.getItem("paastacode-cap");
let runtimeConnection=null;
if(capability&&location.origin!==hostedOrigin){sessionStorage.setItem("paastacode-cap",capability);history.replaceState(null,"",location.pathname);}
let state={},session=null,mode="local",lastMessages="",sending=false,refreshing=false,loginTimer,generation=0,listGeneration=0,promptPending=false,nextAccountPoll=0;
let currentWorkflow={phase:"build"},workflowSession=null,planReady=false,importToken=null,importRevision=0;
const modelCost=m=>`ورودی ${Number(m.input_toman_per_million).toLocaleString("fa-IR")} / خروجی ${Number(m.output_toman_per_million).toLocaleString("fa-IR")} تومان، هر میلیون توکن`;
function workflowView(){
  $("composer").dataset.phase=$("workflow-phase").value;
  const planning=$("workflow-phase").value==="plan";
  $("plan-controls").hidden=!state.features?.modelWorkflow||!planning;
  $("workflow-hint").textContent=planning?"برنامه‌ریزی فقط‌خواندنی است، حتی با Full Access.":sending?"انتخاب مدل برای پیام بعدی؛ برای تغییر اکنون، توقف و ادامه را بزنید.":"مدل انتخابی برای پیام بعدی است.";
  $("workflow-phase").disabled=sending;
  $("execute-plan").disabled=sending||!planReady||currentWorkflow.phase!=="plan";
  $("model-restart").hidden=!sending||!session||$("model").value===(currentWorkflow.phase==="plan"?currentWorkflow.planModel:currentWorkflow.buildModel);
  $("model-restart").disabled=promptPending;
  const model=state.models?.find(m=>m.id===$("execution-model").value);$("execution-price").textContent=model?modelCost(model):"";
}
async function loadWorkflow(){
  if(!session||!state.features?.modelWorkflow)return;
  const id=session.id,value=await api("workflow?id="+encodeURIComponent(id));if(session?.id!==id||promptPending)return;
  if(workflowSession===id&&JSON.stringify(currentWorkflow)===JSON.stringify(value))return;
  currentWorkflow=value;workflowSession=id;$("workflow-phase").value=value.phase;
  const selected=value.phase==="plan"?value.planModel:value.buildModel;
  if(state.models?.some(m=>m.id===selected))$("model").value=selected;
  if(state.models?.some(m=>m.id===value.buildModel))$("execution-model").value=value.buildModel;
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
  const request=runtimeRequest(runtimeConnection,path,method,body,{capability,accountRevision:state.features?.independentRuntime?state.accountRevision:undefined});
  const response=await fetch(request.url,request.init);
  if(runtimeConnection?.kind==="cloud"&&[403,404].includes(response.status)){const result=await response.clone().json().catch(()=>({}));if(result.workspaceError){clearAccountView();invalidateHosted();throw new Error("فضای کار را دوباره انتخاب کنید.");}}
  const result=await response.json();if(version!==generation){const error=new Error("پاسخ قدیمی نادیده گرفته شد.");error.stale=true;throw error;}if(result.accountChanged){clearAccountView();await loadState();}if(!response.ok)throw new Error(result.error||"عملیات ناموفق بود.");return result;
}
async function run(button,work){button.disabled=true;try{await work();}catch(error){if(!error.stale)notice(error.message,true);}finally{button.disabled=button.id==="send"?sending:button.id==="devices-open"?(!state.connected||state.features?.deviceManagement!==true):false;}}
function price(){const m=state.models?.find(model=>model.id===$("model").value);$("price").textContent=m?"هر میلیون توکن: ورودی "+Number(m.input_toman_per_million).toLocaleString("fa-IR")+" / خروجی "+Number(m.output_toman_per_million).toLocaleString("fa-IR")+" تومان":"";}
async function loadState(){
  state=await api("state");$("workspace-name").textContent=runtimeConnection?.kind==="cloud"?runtimeConnection.name:state.workspace;$("workspace-name").dir=runtimeConnection?.kind==="cloud"?"auto":"ltr";
  $("workflow-controls").hidden=!state.features?.modelWorkflow;$("import-open").hidden=!state.features?.projectImport;$("import-open").disabled=!state.configured;
  $("git-open").disabled=!state.configured||!state.features?.git;$("access-mode").disabled=!state.features?.workspaceAccess;accessView(state.accessMode);
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
    const execution=$("execution-model").value;
    const models=[...state.models].sort((a,b)=>(Number(a.input_toman_per_million)+Number(a.output_toman_per_million))-(Number(b.input_toman_per_million)+Number(b.output_toman_per_million)));
    $("execution-model").replaceChildren(...models.map(model=>{const option=document.createElement("option");option.value=model.id;option.textContent=model.name||model.id;return option;}));
    if(models.some(m=>m.id===execution))$("execution-model").value=execution;workflowView();
  }
  if(state.error)notice(state.error,true);
  if(state.configured){await sessions();if(state.features?.git)git.refresh().catch(()=>{});}
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
      generation++;lastMessages="";bench.reset();
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
      const status=await api("status");if(version!==generation||session!==selected)return;runtimeStatus=status[selected.id];sending=promptPending||(!!runtimeStatus&&runtimeStatus.type!=="idle");
      bench.activity(sending,{status:status[selected.id]});
      workflowView();
      await conversationSync.refresh();
    }else bench.activity(promptPending);
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
    bench.activity(sending,{approval:$("permissions").children.length>0,status:runtimeStatus});
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
function clearAccountView(){importRevision++;currentWorkflow={phase:"build"};workflowSession=null;planReady=false;importToken=null;$("import-dialog").close();$("import-text").textContent="";$("import-file").value="";$("workflow-phase").value="build";bench.reset();conversationSync.hide();clearInterval(loginTimer);generation++;listGeneration++;session=null;state={};mode="local";lastMessages="";sending=false;promptPending=false;$("send").disabled=false;for(const id of ["messages","permissions","sessions","model"])$(id).replaceChildren();$("prompt").value="";$("save").disabled=true;$("device").hidden=true;$("device-link").removeAttribute("href");$("device-code").textContent="";$("save-state").textContent=runtimeConnection?.kind==="cloud"?"در فضای کار ابری":"روی این دستگاه";$("local-tab").setAttribute("aria-pressed","true");$("cloud-tab").setAttribute("aria-pressed","false");notice("");}
$("logout").onclick=()=>run($("logout"),async()=>{clearInterval(loginTimer);generation++;await api("logout","POST");clearAccountView();await loadState();});
$("new").onclick=()=>run($("new"),async()=>{generation++;bench.reset();session=await api("sessions","POST");mode="local";lastMessages="";$("composer").hidden=false;$("local-tab").setAttribute("aria-pressed","true");$("cloud-tab").setAttribute("aria-pressed","false");await sessions();await refresh();drawer(false);$("prompt").focus();});
$("composer").onsubmit=event=>{
  event.preventDefault();if(sending||!$("prompt").value.trim())return;
  submitPrompt();
};
function submitPrompt(extra={}){
  if(promptPending)return;
  const text=$("prompt").value,selection={model:extra.executePlan?$("execution-model").value:$("model").value,phase:extra.restart?currentWorkflow.phase:extra.executePlan?"build":$("workflow-phase").value,executionModel:extra.executePlan?undefined:$("execution-model").value};sending=true;promptPending=true;let accepted=false;
  bench.follow();bench.activity(true);
  run($("send"),async()=>{
    if(!session)session=await api("sessions","POST");
    const result=await api("prompt","POST",{id:session.id,text:extra.restart||extra.executePlan?"ادامهٔ درخواست":text,model:selection.model,...(state.features?.modelWorkflow?{phase:selection.phase,executionModel:selection.executionModel}:{}),...extra});
    if(result.workflow){currentWorkflow=result.workflow;workflowSession=session.id;$("workflow-phase").value=currentWorkflow.phase;if(extra.executePlan){$("workflow-phase").value="build";$("model").value=currentWorkflow.buildModel;price();}}
    accepted=true;
    if(!extra.restart&&!extra.executePlan){$("prompt").value="";resizePrompt();}notice("");await sessions();
  }).finally(async()=>{promptPending=false;if(!accepted){sending=false;$("send").disabled=false;}await refresh();});
}
$("prompt").onkeydown=event=>{if(!event.isComposing&&event.key==="Enter"&&(event.ctrlKey||event.metaKey)){event.preventDefault();$("composer").requestSubmit();}};
$("stop").onclick=()=>run($("stop"),async()=>{await api("abort","POST",{id:session.id});await refresh();});
$("save").onclick=()=>$("save-dialog").showModal();
$("save-dialog").addEventListener("close",()=>{if($("save-dialog").returnValue==="save")run($("save"),async()=>{await api("save","POST",{id:session.id});$("save-state").textContent="در حساب ذخیره شد";notice("گفتگو در حساب پاستا ذخیره و دوباره خوانده شد.");});});
$("model").onchange=()=>{price();workflowView();};
$("workflow-phase").onchange=()=>{const selected=$("workflow-phase").value==="plan"?currentWorkflow.planModel:currentWorkflow.buildModel;if(state.models?.some(m=>m.id===selected))$("model").value=selected;price();workflowView();};
$("execution-model").onchange=workflowView;
$("model-restart").onclick=()=>submitPrompt({restart:true});
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
$("local-tab").onclick=()=>run($("local-tab"),async()=>{mode="local";$("local-tab").setAttribute("aria-pressed","true");$("cloud-tab").setAttribute("aria-pressed","false");if(!session){$("messages").replaceChildren();$("empty").hidden=false;}$("composer").hidden=false;await sessions();});
$("cloud-tab").onclick=()=>run($("cloud-tab"),async()=>{conversationSync.hide();mode="cloud";$("local-tab").setAttribute("aria-pressed","false");$("cloud-tab").setAttribute("aria-pressed","true");await sessions();});
function drawer(open){$("rail").classList.toggle("open",open);$("menu").setAttribute("aria-expanded",String(open));document.querySelector("main").inert=open;$("rail-backdrop").hidden=!open;if(open)$("rail-close").focus();else if(matchMedia("(max-width:640px)").matches)$("menu").focus();}
$("menu").onclick=()=>drawer(true);$("rail-close").onclick=()=>drawer(false);$("rail-backdrop").onclick=()=>drawer(false);
for(const button of document.querySelectorAll("[data-prompt]"))button.onclick=()=>{$("prompt").value=button.dataset.prompt;$("prompt").focus();};
document.addEventListener("keydown",event=>{if(event.key==="Escape")drawer(false);if(event.key==="Tab"&&$("rail").classList.contains("open")){const items=[...$("rail").querySelectorAll("button:not(:disabled),a[href]")].filter(el=>el.offsetParent);const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
matchMedia("(max-width:640px)").addEventListener("change",()=>drawer(false));
if(location.origin===hostedOrigin){runtimeConnection=await connectHosted();capability=runtimeConnection.capability;}
if(runtimeConnection){
  if(runtimeConnection.kind==="cloud"){$("local-tab").textContent="این فضای کار";$("save-state").textContent="در فضای کار ابری";}
  const draftKey="paastacode-draft:"+(runtimeConnection.kind==="cloud"?runtimeConnection.owner+":"+runtimeConnection.id:runtimeConnection.origin);
  try{$("prompt").value=sessionStorage.getItem(draftKey)||"";sessionStorage.removeItem(draftKey);resizePrompt();}catch{/* Browser storage is optional. */}
  window.addEventListener("paastacode:workspace-switch",()=>{try{sessionStorage.setItem(draftKey,$("prompt").value);}catch{/* Keep switching available. */}});
}
window.addEventListener("paastacode:account-changed",clearAccountView);
loadState().catch(error=>notice(error.message,true));setInterval(refresh,1800);
