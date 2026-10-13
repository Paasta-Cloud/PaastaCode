import {spawn} from "node:child_process";
import {readdir,realpath} from "node:fs/promises";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {readPrivate,stateHome} from "./account.mjs";
import {workspaceKey} from "./runtime.mjs";

function valid(connection){
  try{const url=new URL(connection.url);return url.protocol==="http:"&&url.hostname==="127.0.0.1"&&!!url.port&&!url.username&&!url.password&&url.pathname==="/"&&!url.search&&!url.hash&&/^[A-Za-z0-9_-]{43}$/.test(connection.capability);}catch{return false;}
}
async function call(connection,path){
  const response=await fetch(connection.url+"/api/"+path,{method:"POST",headers:{Authorization:"Bearer "+connection.capability},signal:AbortSignal.timeout(55000)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||"اجرای پروژه آماده نشد.");return result;
}
async function connectionFor(workspace){
  const saved=await readPrivate(join(stateHome,"workspace-"+workspaceKey(workspace)+".json"));
  if(!valid(saved))return null;
  try{const response=await fetch(saved.url+"/api/state",{headers:{Authorization:"Bearer "+saved.capability},signal:AbortSignal.timeout(2000)});return response.ok?saved:null;}catch{return null;}
}
export async function connectWorkspace({workspace=process.cwd(),hosted=false}={}){
  workspace=await realpath(resolve(workspace));let connection=await connectionFor(workspace);
  if(!connection){
    const entry=fileURLToPath(new URL("../bin/workspace-daemon.mjs",import.meta.url)).replace(/app\.asar([\\/])/,'app.asar.unpacked$1');
    const child=spawn(process.execPath,[entry,"--workspace="+workspace,...(hosted?["--hosted"]:[])],{cwd:workspace,detached:true,windowsHide:true,stdio:"ignore",env:{...process.env,ELECTRON_RUN_AS_NODE:"1",PAASTACODE_HOME:stateHome}});
    let launchError;child.on("error",error=>{launchError=error;});child.unref();
    const deadline=Date.now()+60000;
    while(Date.now()<deadline&&!connection){if(launchError)throw new Error("اجرای مشترک پروژه شروع نشد.");await new Promise(r=>setTimeout(r,200));connection=await connectionFor(workspace);}
    if(!connection)throw new Error("اجرای مشترک پروژه آماده نشد. دوباره تلاش کنید.");
  }
  if(hosted&&!connection.hosted)throw new Error("اجرای فعلی برای اتصال وب آماده نیست. پس از پایان کار آن را با paastacode stop ببندید و با --hosted شروع کنید.");
  return {...connection,launchUrl:connection.url+"/#cap="+connection.capability,
    close:async()=>{},async ensureReady(){
      await call(connection,"ready");const saved=await readPrivate(join(stateHome,"workspace-"+workspaceKey(workspace)+".json"));
      if(!valid(saved)||saved.url!==connection.url||saved.capability!==connection.capability||!saved.engineUrl||!/^[A-Za-z0-9_-]{43}$/.test(saved.enginePassword))throw new Error("اطلاعات اجرای پروژه معتبر نیست؛ پروژه را دوباره باز کنید.");
      const engine=new URL(saved.engineUrl);if(engine.protocol!=="http:"||engine.hostname!=="127.0.0.1"||!engine.port||engine.username||engine.password||engine.pathname!=="/"||engine.search||engine.hash)throw new Error("نشانی موتور پروژه معتبر نیست.");
      return {url:saved.engineUrl,password:saved.enginePassword};
    }};
}
export async function stopWorkspace(workspace=process.cwd()){
  workspace=await realpath(resolve(workspace));const connection=await connectionFor(workspace);if(!connection)return {stopped:false};
  await call(connection,"shutdown");
  if(connection.daemon&&Number.isInteger(connection.pid)&&connection.pid>0){
    const deadline=Date.now()+20000;
    while(Date.now()<deadline){try{process.kill(connection.pid,0);}catch(error){if(error.code==="ESRCH")return {stopped:true};throw error;}await new Promise(r=>setTimeout(r,100));}
    throw new Error("توقف هنوز کامل نشده است؛ چند لحظه بعد وضعیت پروژه را دوباره بررسی کنید.");
  }
  return {stopped:true};
}
export async function refreshAccounts(){
  const files=await readdir(stateHome).catch(()=>[]);
  for(const file of files.filter(name=>/^workspace-[a-f0-9]{24}\.json$/.test(name)).slice(0,100)){
    const connection=await readPrivate(join(stateHome,file));if(valid(connection))try{await call(connection,"account/reload");}catch{/* A closed broker cannot retain access after server-side token/key revocation. */}
  }
}
