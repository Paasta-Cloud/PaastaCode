import {createServer} from "node:http";
import {randomBytes,timingSafeEqual,createHash} from "node:crypto";
import {readFile,mkdir,rm,realpath,open,stat} from "node:fs/promises";
import {basename,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {PaastaAccount,stateHome,readPrivate,writePrivate} from "./account.mjs";
import {CodeRuntime,providerConfig,workspaceKey,normalizedPath,paastaMcpConfig} from "./runtime.mjs";
import {codingModels} from "./models.mjs";
import {PaastaDeployment} from "./deployment.mjs";
import {ConversationSync} from "./conversation-sync.mjs";
import {accessModes,sessionPermissions} from "./access.mjs";
import {WorkspaceGit} from "./git.mjs";
import {previewImport} from "./project-import.mjs";

const here=fileURLToPath(new URL("../",import.meta.url));
const assets=new Map([["/","index.html"],["/app.js","app.js"],["/workbench.js","workbench.js"],["/updates.js","updates.js"],["/git-ui.js","git-ui.js"],["/components.js","components.js"],["/deployment.js","deployment.js"],["/hosted.js","hosted.js"],["/cloud-actions.js","cloud-actions.js"],["/devices.js","devices.js"],["/sync.js","sync.js"],["/style.css","style.css"],["/fonts/Vazirmatn.woff2","fonts/Vazirmatn.woff2"]]);
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".woff2":"font/woff2"};
export function validCapability(value,secret){
  return typeof value==="string"&&Buffer.byteLength(value)===Buffer.byteLength(secret)&&timingSafeEqual(Buffer.from(value),Buffer.from(secret));
}
async function body(request){
  let raw="";for await(const chunk of request){raw+=chunk;if(Buffer.byteLength(raw)>1_100_000)throw new Error("حجم درخواست بیش از حد مجاز است.");}
  return raw?JSON.parse(raw):{};
}
export async function startServer({workspace=process.cwd(),account,runtime,deployment,port=0,hosted=false,daemon=false,onClosed}={}){
  const version=JSON.parse(await readFile(join(here,"package.json"),"utf8")).version;
  workspace=await realpath(resolve(workspace));
  const key=workspaceKey(workspace),statePath=join(stateHome,"workspace-"+key+".json");
  await mkdir(stateHome,{recursive:true,mode:0o700});
  const lockPath=statePath+".lock";
  let lock;
  if(!runtime){
    for(let attempt=0;attempt<30;attempt++){
      try{lock=await open(lockPath,"wx",0o600);await lock.writeFile(String(process.pid));break;}
      catch(error){
        if(error.code!=="EEXIST")throw error;
        const saved=await readPrivate(statePath);
        if(saved)try{
          const url=new URL(saved.url);
          if(url.hostname==="127.0.0.1"&&url.protocol==="http:"){
            const response=await fetch(url.origin+"/api/state",{headers:{Authorization:"Bearer "+saved.capability},signal:AbortSignal.timeout(1000)});
            if(response.ok){if(hosted&&!saved.hosted)return {...saved,hosted:false,reused:true,close:async()=>{}};return {...saved,launchUrl:saved.url+"/#cap="+saved.capability,reused:true,close:async()=>{}};}
          }
        }catch{}
        const pid=Number(await readFile(lockPath,"utf8").catch(()=>""));
        if(pid)try{process.kill(pid,0);}catch(error){if(error.code==="ESRCH"){await rm(lockPath,{force:true});continue;}}
        await new Promise(r=>setTimeout(r,150));
      }
    }
    if(!lock)throw new Error("پاستاکد برای این پوشه در حال شروع است؛ چند لحظه بعد دوباره تلاش کنید.");
  }
  account=account||await new PaastaAccount().load();
  runtime=runtime||new CodeRuntime(workspace);
  deployment=deployment||new PaastaDeployment({workspace,account});
  const capability=randomBytes(32).toString("base64url");
  let origin,context=null,starting=null,loginPolling=null,closed=false,accountChanging=false,updating=false;
  const syncPath=join(stateHome,"sync-"+key+".json");
  let sync=await readPrivate(syncPath)||{};
  const accessPath=join(stateHome,"access-"+key+".json"),access=await readPrivate(accessPath)||{};
  const accessMode=()=>context&&access[accountIdentity()]||"review";
  const workflowsPath=join(stateHome,"workflows-"+key+".json"),workflows=await readPrivate(workflowsPath)||{};
  const workflow=id=>workflows[accountIdentity()+":"+id]||{phase:"build"};
  const rules=(id,mode=accessMode())=>sessionPermissions(mode,workflow(id).phase);
  const fullAccess=id=>accessMode()==="full"&&workflow(id).phase!=="plan";
  const importPreviews=new Map();
  const git=new WorkspaceGit(workspace);
  let accessChanges=Promise.resolve(),permissionPolling=false;
  const appliedAccess=new Map();
  let syncWrites=Promise.resolve();
  const persistSync=()=>{const result=syncWrites.then(()=>writePrivate(syncPath,sync));syncWrites=result.catch(()=>{});return result;};
  const ready=async()=>{
    if(runtime.url)return;
    if(starting)return starting;
    if(!account.credentials?.aiKey)throw new Error("ابتدا با پاستا وارد شوید و سقف مصرف را تأیید کنید.");
    starting=(async()=>{context=await account.context();runtime.identity=createHash("sha256").update(accountIdentity()).digest("hex");const config=providerConfig(context.models,account.credentials.aiKey,account.origin);if((await deployment.state()).connected)config.mcp={paasta:paastaMcpConfig(workspace)};await runtime.start(config);appliedAccess.clear();
      await writePrivate(statePath,{url:origin,capability,pid:process.pid,workspace,hosted,daemon,runtimeRoot:here,version,engineUrl:runtime.url,enginePassword:runtime.password});
    })();
    try{await starting;}finally{starting=null;}
  };
  const accountIdentity=()=>account.origin+":"+context.account.tenantId+":"+context.account.id;
  const restoreKey=id=>"restore:"+accountIdentity()+":"+id;
  const transcript=messages=>messages.map(m=>({info:{role:m.role},parts:[{type:"text",text:m.text}]}));
  const owned=async id=>{
    if(!/^ses_[a-zA-Z0-9]+$/.test(id||""))throw new Error("گفتگو معتبر نیست.");
    const session=await runtime.call("/session/"+id);
    if(normalizedPath(session.directory)!==normalizedPath(workspace))throw new Error("این گفتگو مربوط به فضای کاری بازشده نیست.");
    return session;
  };
  const syncManager=new ConversationSync({records:sync,
    identity:()=>!accountChanging&&account.credentials?.token&&context?{key:accountIdentity(),token:account.credentials.token}:null,
    request:(path,options)=>account.request(path,options),persist:persistSync,
    build:async(id,{idleOnly})=>{
      if(!runtime.url)return null;
      const session=await owned(id);
      if(idleOnly){const status=await runtime.call("/session/status");if(status[id]&&status[id].type!=="idle")return null;}
      const messages=[...transcript(sync[restoreKey(id)]?.messages||[]),...await runtime.call("/session/"+id+"/message")];
      const snapshot={version:1,messages:messages.filter(m=>["user","assistant"].includes(m.info.role)).map(m=>({role:m.info.role,text:m.parts.filter(p=>p.type==="text"&&!p.synthetic).map(p=>p.text).join("\n")})).filter(m=>m.text)};
      if(idleOnly&&!snapshot.messages.length)return null;
      return {title:session.title.slice(0,160),snapshot};
    }});
  const credentialStamp=async()=>account.path?stat(account.path).then(value=>value.mtimeMs+":"+value.size).catch(error=>{if(error.code==="ENOENT")return "missing";throw error;}):null;
  let accountMutations=Promise.resolve(),accountRevision=1;
  const mutateAccount=(work,expected)=>{const result=accountMutations.then(async()=>{
    if(expected!==undefined&&String(accountRevision)!==expected){const error=new Error("حساب این پنجره تغییر کرده است؛ دوباره آن را بررسی کنید.");error.status=409;error.accountChanged=true;throw error;}
    const before=account.credentials?.token+":"+account.credentials?.aiKey;accountChanging=true;
    try{await syncManager.barrier();if(starting)await starting.catch(()=>{});return await work();}
    finally{if(before!==account.credentials?.token+":"+account.credentials?.aiKey)accountRevision++;accountChanging=false;}
  });accountMutations=result.catch(()=>{});return result;};
  let lastCredentialStamp=await credentialStamp(),accountReloading=null;
  const reloadAccount=async(force=false)=>{
    if(!account.load||!account.path)return;
    const stamp=await credentialStamp();if(!force&&stamp===lastCredentialStamp)return;
    if(accountReloading)return accountReloading;
    accountReloading=mutateAccount(async()=>{
      const before=account.credentials?.token+":"+account.credentials?.aiKey;
      await account.load();if(before!==account.credentials?.token+":"+account.credentials?.aiKey){await runtime.stop();context=null;await writePrivate(statePath,{url:origin,capability,pid:process.pid,workspace,hosted,daemon,runtimeRoot:here,version});}lastCredentialStamp=stamp;
    }).finally(()=>{accountReloading=null;});
    return accountReloading;
  };
  const json=(response,data,status=200)=>{response.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});response.end(JSON.stringify(data));};
  async function api(request,response,url){
    if(!validCapability(request.headers.authorization?.replace(/^Bearer /,""),capability)){json(response,{error:"دسترسی مجاز نیست."},401);return;}
    if(request.headers.origin&&request.headers.origin!==origin&&!(hosted&&request.headers.origin==="https://code.paasta.cloud")){json(response,{error:"مبدأ درخواست معتبر نیست."},403);return;}
    const route=request.method+" "+url.pathname;
    if(route==="POST /api/update/prepare"){
      if(starting||accountChanging||git.busy)throw new Error("پروژه هنوز در حال کار است؛ پس از پایان اجرا، به‌روزرسانی را نصب کنید.");
      if(runtime.url&&Object.values(await runtime.call("/session/status")).some(value=>value.type!=="idle"))throw new Error("پروژه هنوز در حال کار است؛ پس از پایان اجرا، به‌روزرسانی را نصب کنید.");
      updating=true;return json(response,{ok:true});
    }
    if(route==="POST /api/update/cancel"){updating=false;return json(response,{ok:true});}
    if(updating&&request.method!=="GET"&&!url.pathname.endsWith("/shutdown"))throw new Error("برنامه برای به‌روزرسانی آماده می‌شود. پس از نصب، پروژه را دوباره باز کنید.");
    if(route==="POST /api/account/reload"){await reloadAccount(true);return json(response,{ok:true});}
    if(daemon)await reloadAccount();
    await accountMutations;
    const expectedAccount=request.headers["x-paastacode-account"];
    if(request.method!=="GET"&&expectedAccount!==undefined&&String(accountRevision)!==expectedAccount)return json(response,{error:"حساب این پنجره تغییر کرده است؛ دوباره آن را بررسی کنید.",accountChanged:true},409);
    if(route==="POST /api/ready"){await ready();return json(response,{ok:true});}
    if(route==="POST /api/shutdown"){
      response.once("finish",()=>void close());return json(response,{ok:true});
    }
    if(route==="GET /api/state"){
      let error=null;
      if(account.credentials&&!context)try{context=await account.context();}catch(caught){error=caught.message;}
      return json(response,{version,workspace:basename(workspace),connected:!!account.credentials,configured:!!account.credentials?.aiKey,
        account:context?.account,models:codingModels(context?.models||[]),dailyLimitToman:account.credentials?.dailyLimitToman,error,accountRevision,accessMode:accessMode(),features:{conditionalDelete:true,deviceManagement:true,backgroundSync:true,independentRuntime:daemon,workspaceAccess:true,git:true,modelWorkflow:true,projectImport:true}});
    }
    if(route==="POST /api/login")return json(response,await mutateAccount(()=>account.begin(),expectedAccount));
    if(route==="POST /api/login/poll"){
      if(!loginPolling)loginPolling=mutateAccount(async()=>{const previous=account.credentials?.token,result=await account.poll();if(!result.pending){if(previous!==account.credentials?.token){await runtime.stop();context=null;}context=await account.context();}return result;},expectedAccount).finally(()=>{loginPolling=null;});
      return json(response,await loginPolling);
    }
    if(route==="POST /api/connect"){const input=await body(request);return json(response,await mutateAccount(async()=>{const previous=account.credentials?.aiKey,result=await account.connect(Number(input.dailyLimitToman));if(previous!==account.credentials?.aiKey){await runtime.stop();context=null;}await ready();return result;},expectedAccount));}
    if(route==="POST /api/logout"){
      return json(response,await mutateAccount(async()=>{await deployment.disconnect();await account.logout();await runtime.stop();context=null;await writePrivate(statePath,{url:origin,capability,pid:process.pid,workspace,hosted,daemon,runtimeRoot:here,version});return {ok:true};},expectedAccount));
    }
    if(route==="GET /api/devices")return json(response,await account.request("/api/paastacode/devices"));
    if(route==="DELETE /api/devices"){
      const id=url.searchParams.get("id");
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id||""))throw new Error("اتصال معتبر نیست.");
      return json(response,await mutateAccount(async()=>{
      const result=await account.request("/api/paastacode/devices?id="+encodeURIComponent(id),{method:"DELETE"});
      if(result.current){
        await runtime.stop();
        // Remote revocation already committed. Preserve a failed deployment disconnect for retry.
        try{await deployment.disconnect();}catch{result.warning="اتصال اصلی قطع شد؛ قطع مجوز انتشار کامل نشد. پس از ورود دوباره آن را از اتصال‌های حساب قطع کنید.";}
        // The server already revoked this token. Clear locally without a second network request.
        await account.forget();context=null;
        await writePrivate(statePath,{url:origin,capability,pid:process.pid,workspace,hosted,daemon,runtimeRoot:here,version});
      }
      return result;},expectedAccount));
    }
    if(route==="GET /api/deployment/state")return json(response,await deployment.state());
    if(route==="POST /api/deployment/login")return json(response,await deployment.begin());
    if(route==="POST /api/deployment/login/poll"){const result=await deployment.poll();if(!result.pending&&runtime.url)await runtime.call("/mcp",{method:"POST",body:{name:"paasta",config:paastaMcpConfig(workspace)}});return json(response,result);}
    if(route==="POST /api/deployment/disconnect"){await deployment.disconnect();return json(response,{ok:true});}
    if(route==="GET /api/deployment/context")return json(response,await deployment.context());
    if(route==="POST /api/deployment/request"){const input=await body(request);return json(response,await deployment.request(input.name,input.arguments));}
    if(route==="POST /api/deployment/approve"){const input=await body(request);return json(response,await deployment.approve(input.id));}
    if(route==="POST /api/deployment/reject"){const input=await body(request);return json(response,await deployment.reject(input.id));}
    if(route==="GET /api/deployment/job")return json(response,await deployment.status(url.searchParams.get("id")));
    if(route==="POST /api/mcp"){
      const rpc=await body(request);
      if(rpc.jsonrpc!=="2.0"||typeof rpc.method!=="string")throw new Error("درخواست MCP معتبر نیست.");
      if(rpc.method.startsWith("notifications/")){response.writeHead(202);response.end();return;}
      let result;
      if(rpc.method==="initialize")result={protocolVersion:"2025-11-25",capabilities:{tools:{}},serverInfo:{name:"PaastaCode Paasta MCP",version:"0.2.0"},instructions:"Mutations create a PaastaCode review request. They cannot upload source or incur cost until the human approves the preview."};
      else if(rpc.method==="ping")result={};
      else if(rpc.method==="tools/list")result={tools:await deployment.tools()};
      else if(rpc.method==="tools/call"){
        let resultValue=await deployment.request(rpc.params?.name,rpc.params?.arguments);
        if(resultValue?.source)resultValue={...resultValue,requiresHumanApproval:resultValue.status==="review",source:{...resultValue.source,fileCount:resultValue.source.files.length,files:resultValue.source.files.slice(0,20)}};
        result=resultValue?.content?resultValue:{content:[{type:"text",text:JSON.stringify(resultValue)}],structuredContent:resultValue,isError:false};
      }else throw new Error("روش MCP پشتیبانی نمی‌شود.");
      return json(response,{jsonrpc:"2.0",id:rpc.id??null,result});
    }
    if(route==="GET /api/cloud")return json(response,await account.request("/api/paastacode/sessions"));
    if(route==="GET /api/cloud/session")return json(response,await account.request("/api/paastacode/sessions?id="+encodeURIComponent(url.searchParams.get("id"))));
    if(route==="DELETE /api/cloud/session"){
      const revision=url.searchParams.get("revision");
      if(revision!==null&&!/^[1-9]\d{0,14}$/.test(revision))throw new Error("نسخهٔ گفتگو معتبر نیست؛ آن را دوباره از حساب باز کنید.");
      const id=url.searchParams.get("id");
      const result=await account.request("/api/paastacode/sessions?id="+encodeURIComponent(id)+(revision===null?"":"&revision="+revision),{method:"DELETE"});
      if(result.ok&&context){
        const prefix=accountIdentity()+":";
        for(const [name,record] of Object.entries(sync))if(name.startsWith(prefix)&&record.id===id)delete sync[name];
        await persistSync();
      }
      return json(response,result);
    }
    await ready();
    if(url.pathname.startsWith("/api/git")||route==="POST /api/access")if(!account.credentials?.token||!account.credentials?.aiKey)throw new Error("برای دسترسی به پروژه، با پاستا وارد شوید.");
    if(route==="GET /api/git")return json(response,await git.status());
    if(route==="GET /api/git/diff")return json(response,await git.diff(url.searchParams.get("path")));
    if(route==="POST /api/git"){const input=await body(request);return json(response,await mutateAccount(()=>git.action(input),expectedAccount));}
    if(route==="POST /api/access"){
      const input=await body(request);if(!accessModes.includes(input.mode))throw new Error("حالت دسترسی معتبر نیست.");
      const identity=accountIdentity(),previous=accessMode();let changed=[];
      const change=accessChanges.then(()=>mutateAccount(async()=>{
        if(accountIdentity()!==identity)throw new Error("حساب تغییر کرده است؛ پروژه را دوباره بررسی کنید.");
        try{
          const sessions=await runtime.call("/session");
          for(const session of sessions)if(normalizedPath(session.directory)===normalizedPath(workspace)){await runtime.call("/session/"+session.id,{method:"PATCH",body:{permission:rules(session.id,input.mode)}});changed.push(session.id);appliedAccess.set(session.id,input.mode+":"+workflow(session.id).phase);}
          access[identity]=input.mode;await writePrivate(accessPath,access);
          return {mode:input.mode};
        }catch(error){access[identity]=previous;appliedAccess.clear();for(const id of changed)try{await runtime.call("/session/"+id,{method:"PATCH",body:{permission:rules(id,previous)}});}catch{await runtime.stop();}throw error;}
      },expectedAccount));accessChanges=change.catch(()=>{});return json(response,await change);
    }
    if(route==="GET /api/sessions"){
      const sessions=await runtime.call("/session");
      return json(response,sessions.filter(s=>normalizedPath(s.directory)===normalizedPath(workspace)));
    }
    if(route==="POST /api/sessions")return json(response,await runtime.call("/session",{method:"POST",body:{title:"گفتگوی جدید",permission:sessionPermissions(accessMode())}}));
    if(route==="GET /api/messages"){const id=url.searchParams.get("id");await owned(id);return json(response,[...transcript(sync[restoreKey(id)]?.messages||[]),...await runtime.call("/session/"+id+"/message")]);}
    if(route==="GET /api/permissions"){
      const permissions=await runtime.call("/permission");
      const result=[];for(const permission of permissions)try{await owned(permission.sessionID);if(fullAccess(permission.sessionID))await runtime.call("/permission/"+encodeURIComponent(permission.id)+"/reply",{method:"POST",body:{reply:"once"}});else if(workflow(permission.sessionID).phase==="plan")await runtime.call("/permission/"+encodeURIComponent(permission.id)+"/reply",{method:"POST",body:{reply:"reject"}});else result.push(permission);}catch{/* Permissions from other workspaces are never exposed. */}
      return json(response,result);
    }
    if(route==="POST /api/permission"){
      const input=await body(request);if(!["once","reject"].includes(input.reply))throw new Error("پاسخ دسترسی معتبر نیست.");
      const pending=(await runtime.call("/permission")).find(p=>p.id===input.id);if(!pending)throw new Error("درخواست دسترسی دیگر فعال نیست.");
      await owned(pending.sessionID);if(workflow(pending.sessionID).phase==="plan"&&input.reply!=="reject")throw new Error("مرحلهٔ برنامه‌ریزی فقط‌خواندنی است.");return json(response,await runtime.call("/permission/"+encodeURIComponent(input.id)+"/reply",{method:"POST",body:{reply:input.reply}}));
    }
    if(route==="GET /api/workflow"){const id=url.searchParams.get("id");await owned(id);return json(response,workflow(id));}
    if(route==="POST /api/import/preview"){
      const input=await body(request),identity=accountIdentity();
      const preview=await previewImport(workspace,input);
      if(identity!==accountIdentity())throw new Error("حساب تغییر کرده است؛ دوباره بررسی کنید.");
      const token=randomBytes(24).toString("base64url");
      for(const [key,value] of importPreviews)if(value.expires<Date.now())importPreviews.delete(key);
      if(importPreviews.size>=10)importPreviews.delete(importPreviews.keys().next().value);
      importPreviews.set(token,{identity,preview,expires:Date.now()+600000});
      return json(response,{...preview,token});
    }
    if(route==="POST /api/import"){
      const input=await body(request);
      return json(response,await mutateAccount(async()=>{
        const pending=importPreviews.get(input.token);
        if(!pending||pending.identity!==accountIdentity()||pending.expires<Date.now())throw new Error("پیش‌نمایش ورود منقضی شده؛ دوباره بررسی کنید.");
        const {preview}=pending,importKey="import:"+accountIdentity()+":"+preview.digest;
        if(sync[importKey])return {session:await owned(sync[importKey]),reused:true};
        const session=await runtime.call("/session",{method:"POST",body:{title:preview.title,permission:sessionPermissions(accessMode())}});
        sync[restoreKey(session.id)]={messages:preview.messages,sent:false};sync[importKey]=session.id;await persistSync();
        return {session};
      },expectedAccount));
    }
    if(route==="POST /api/prompt"){
      const input=await body(request);
      const change=accessChanges.then(()=>mutateAccount(async()=>{
      await owned(input.id);
      if(typeof input.text!=="string"||!input.text.trim()||input.text.length>50000)throw new Error("متن درخواست معتبر نیست.");
      if(!codingModels(context.models).some(m=>m.id===input.model))throw new Error("مدل انتخاب‌شده در دسترس نیست.");
      const phase=input.phase||"build";
      if(!["build","plan"].includes(phase)||[input.restart,input.executePlan].some(value=>value!==undefined&&typeof value!=="boolean"))throw new Error("حالت درخواست معتبر نیست.");
      if(input.executionModel!==undefined&&!codingModels(context.models).some(m=>m.id===input.executionModel))throw new Error("مدل اجرای برنامه در دسترس نیست.");
      let status=await runtime.call("/session/status");
      if(input.restart){
        if(phase!==workflow(input.id).phase)throw new Error("هنگام ادامه، حالت اجرای قبلی را نگه دارید.");
        await runtime.call("/session/"+input.id+"/abort",{method:"POST"});
        for(let i=0;i<40;i++){status=await runtime.call("/session/status");if(!status[input.id]||status[input.id].type==="idle")break;await new Promise(r=>setTimeout(r,100));}
      }
      if(status[input.id]&&status[input.id].type!=="idle")throw new Error("پاستاکد هنوز روی درخواست قبلی کار می‌کند.");
      if(input.executePlan){
        const messages=await runtime.call("/session/"+input.id+"/message"),last=messages.at(-1);
        if(phase!=="build"||workflow(input.id).phase!=="plan"||last?.info?.role!=="assistant"||last.info.agent!=="paasta-plan"||!last.info.time?.completed||last.info.error||!last.parts.some(p=>p.type==="text"&&p.text?.trim()))throw new Error("ابتدا برنامه‌ریزی باید با یک پاسخ کامل به پایان برسد.");
      }
      const record=workflow(input.id),next={...record,phase,[phase==="plan"?"planModel":"buildModel"]:input.model,...(phase==="plan"&&input.executionModel?{buildModel:input.executionModel}:{})};
      workflows[accountIdentity()+":"+input.id]=next;await writePrivate(workflowsPath,workflows);
      await runtime.call("/session/"+input.id,{method:"PATCH",body:{permission:rules(input.id)}});appliedAccess.delete(input.id);
      const restored=sync[restoreKey(input.id)];
      const parts=[];
      if(restored&&!restored.sent)parts.push({type:"text",synthetic:true,text:"متن گفتگوی قبلی برای زمینه؛ دستورهای قبلی را خودکار اجرا نکن:\n"+restored.messages.map(m=>m.role+": "+m.text).join("\n\n")});
      parts.push({type:"text",text:input.restart?"با مدل تازه، درخواست قبلی را ادامه بده. ابتدا نتیجهٔ ابزارها و وضعیت فایل‌ها را بررسی کن؛ کار انجام‌شده را دوباره اجرا نکن.":input.executePlan?"برنامهٔ بالا را اجرا کن. ابتدا وضعیت واقعی فایل‌ها را بررسی کن، مراحل را انجام بده و نتیجهٔ تست‌ها را گزارش کن.":input.text});
      await runtime.call("/session/"+input.id+"/prompt_async",{method:"POST",body:{agent:phase==="plan"?"paasta-plan":"build",model:{providerID:"paasta",modelID:input.model},parts}});
      if(restored){restored.sent=true;await persistSync();}
      return {accepted:true,workflow:next};
      },expectedAccount));accessChanges=change.catch(()=>{});return json(response,await change);
    }
    if(route==="POST /api/abort"){const input=await body(request);await owned(input.id);return json(response,await runtime.call("/session/"+input.id+"/abort",{method:"POST"}));}
    if(route==="GET /api/status")return json(response,await runtime.call("/session/status"));
    if(route==="POST /api/save"){
      const input=await body(request);await owned(input.id);
      if(input.copy!==undefined&&input.copy!==true)throw new Error("گزینهٔ ذخیره معتبر نیست.");
      return json(response,await syncManager.save(input.id,{copy:input.copy===true}));
    }
    if(route==="GET /api/sync"){const id=url.searchParams.get("id");await owned(id);return json(response,syncManager.state(id));}
    if(route==="POST /api/sync"){const input=await body(request);await owned(input.id);if(typeof input.enabled!=="boolean")throw new Error("گزینهٔ ذخیرهٔ خودکار معتبر نیست.");return json(response,await syncManager.enable(input.id,input.enabled));}
    if(route==="POST /api/restore"){
      const input=await body(request),binding=syncManager.binding();
      const saved=await account.request("/api/paastacode/sessions?id="+encodeURIComponent(input.id),{token:binding.token});syncManager.guard(binding);
      if(saved.snapshot.messages.reduce((n,m)=>n+m.text.length,0)>90000)throw new Error("این گفتگو برای بازیابی در نسخهٔ اولیه طولانی است؛ نسخهٔ ذخیره‌شده در حساب حفظ می‌شود.");
      // A restored conversation is a new local branch; no old tools or shell commands are replayed.
      const session=await runtime.call("/session",{method:"POST",body:{title:saved.title}});
      syncManager.guard(binding);
      sync[restoreKey(session.id)]={messages:saved.snapshot.messages,sent:false};
      // Keep the cloud revision so continuations on another device conflict instead of overwriting.
      sync[binding.key+":"+session.id]={id:saved.id,revision:saved.revision,enabled:false,lastDigest:createHash("sha256").update(JSON.stringify({title:saved.title,snapshot:saved.snapshot})).digest("hex"),lastSavedAt:Number.isFinite(Date.parse(saved.updated_at))?Date.parse(saved.updated_at):null};
      await persistSync();
      return json(response,{session});
    }
    json(response,{error:"مسیر پیدا نشد."},404);
  }
  const server=createServer(async(request,response)=>{
    try {
      if(request.headers.host!==new URL(origin).host){json(response,{error:"Host معتبر نیست."},403);return;}
      const url=new URL(request.url,origin);
      if(hosted&&url.pathname.startsWith("/api/")&&request.headers.origin==="https://code.paasta.cloud"){
        response.setHeader("Access-Control-Allow-Origin","https://code.paasta.cloud");response.setHeader("Vary","Origin");
        if(request.method==="OPTIONS"){
          const method=request.headers["access-control-request-method"],headers=String(request.headers["access-control-request-headers"]||"").toLowerCase().split(",").map(h=>h.trim()).filter(Boolean);
          if(!["GET","POST","DELETE"].includes(method)||headers.some(h=>!["authorization","content-type","x-paastacode-account"].includes(h))){json(response,{error:"درخواست مجاز نیست."},403);return;}
          response.writeHead(204,{"Access-Control-Allow-Methods":"GET, POST, DELETE","Access-Control-Allow-Headers":"Authorization, Content-Type, X-PaastaCode-Account","Access-Control-Allow-Private-Network":"true","Access-Control-Max-Age":"300"});response.end();return;
        }
      }
      if(url.pathname.startsWith("/api/")){await api(request,response,url);return;}
      if(request.method!=="GET"){json(response,{error:"روش مجاز نیست."},405);return;}
      let data,type;
      // VS Code adds an opaque ancestor. Only a capability-bearing embed URL
      // can omit the ordinary page's ancestor restriction.
      const embed=url.pathname==="/embed/"+capability;
      if(embed||assets.has(url.pathname)){
        const file=embed?"index.html":assets.get(url.pathname);data=await readFile(join(here,"web",file));type=mime["."+file.split(".").at(-1)];
      }else if(url.pathname==="/fonts/YekanBakh.ttf"){
        try{data=await readFile(process.env.PAASTACODE_YEKAN_FONT||join(here,"web/fonts/YekanBakh.ttf"));}
        catch(error){if(error.code!=="ENOENT")throw error;try{data=await readFile(join(here,"../../public/fonts/yekan-bakh/yekan-bakh-variable.ttf"));}catch(fallback){if(fallback.code!=="ENOENT")throw fallback;json(response,{error:"پیدا نشد."},404);return;}}
        type="font/ttf";
      }else if(url.pathname==="/brand.png"){data=await readFile(join(here,"web/brand.png"));type="image/png";}
      else{json(response,{error:"پیدا نشد."},404);return;}
      response.writeHead(200,{"Content-Type":type,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff",
        "Content-Security-Policy":"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; "+(embed?"":"frame-ancestors 'self'; ")+"base-uri 'none'; form-action 'none'",
        "Referrer-Policy":"no-referrer"});response.end(data);
    }catch(error){json(response,{error:error.message||"عملیات ناموفق بود.",...(error.accountChanged?{accountChanged:true}:{})},error.status||400);}
  });
  await new Promise((resolveListen,reject)=>{server.once("error",reject);server.listen(port,"127.0.0.1",resolveListen);});
  origin="http://127.0.0.1:"+server.address().port;
  await mkdir(stateHome,{recursive:true,mode:0o700});
  await writePrivate(statePath,{url:origin,capability,pid:process.pid,workspace,hosted,daemon,runtimeRoot:here,version});
  syncManager.start();
  const accountTimer=daemon?setInterval(()=>reloadAccount().catch(()=>{}),5000):null;accountTimer?.unref();
  const permissionTimer=setInterval(()=>{
    if(closed||updating||accountChanging||!runtime.url||!context||permissionPolling)return;permissionPolling=true;
    const work=accessChanges.then(async()=>{
      if(closed||updating||accountChanging||!runtime.url||!context)return;
      const mode=accessMode();
      for(const session of await runtime.call("/session"))if(normalizedPath(session.directory)===normalizedPath(workspace)&&appliedAccess.get(session.id)!==mode+":"+workflow(session.id).phase){await runtime.call("/session/"+session.id,{method:"PATCH",body:{permission:rules(session.id)}});appliedAccess.set(session.id,mode+":"+workflow(session.id).phase);}
      if(mode!=="full")return;
      for(const permission of await runtime.call("/permission")){try{await owned(permission.sessionID);await runtime.call("/permission/"+encodeURIComponent(permission.id)+"/reply",{method:"POST",body:{reply:fullAccess(permission.sessionID)?"once":"reject"}});}catch{/* Other workspaces and already answered requests are excluded. */}}
    });accessChanges=work.catch(()=>{}).finally(()=>{permissionPolling=false;});
  },1000);permissionTimer.unref();
  const close=async()=>{if(closed)return;closed=true;clearInterval(accountTimer);clearInterval(permissionTimer);await accessChanges;if(accountReloading)await accountReloading;await syncManager.stop();await runtime.stop();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(statePath,{force:true});if(lock){await lock.close();await rm(lockPath,{force:true});}onClosed?.();};
  return {url:origin,capability,runtime,close,server,ensureReady:ready,launchUrl:origin+"/#cap="+capability};
}
