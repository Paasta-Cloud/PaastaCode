import {spawn} from "node:child_process";
import {createRequire} from "node:module";
import {existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {join,resolve,dirname} from "node:path";
import {mkdir,realpath} from "node:fs/promises";
import {randomBytes,createHash} from "node:crypto";
import {stateHome} from "./account.mjs";
import {codingModels} from "./models.mjs";

const require=createRequire(import.meta.url);
export function engineCommand(args,options={}){
  const packaged=fileURLToPath(new URL("../engine/opencode"+(process.platform==="win32"?".exe":""),import.meta.url)).replace(/app\.asar([\\/])/,'app.asar.unpacked$1');
  if(existsSync(packaged))return spawn(packaged,args,{windowsHide:true,...options});
  const metadata=require("opencode-ai/package.json");
  const bin=resolve(dirname(require.resolve("opencode-ai/package.json")),metadata.bin.opencode);
  return spawn(bin,args,{windowsHide:true,...options});
}
export function providerConfig(models,key,origin){
  const eligible=codingModels(models);
  if(!eligible.length)throw new Error("مدل مناسب کدنویسی در کاتالوگ فعال پاستا پیدا نشد.");
  return {enabled_providers:["paasta"],model:"paasta/"+eligible[0].id,small_model:"paasta/"+eligible[0].id,
    provider:{paasta:{npm:"@ai-sdk/openai-compatible",name:"پاستا",options:{baseURL:origin+"/api/ai/v1",apiKey:key},
      models:Object.fromEntries(eligible.map(m=>[m.id,{name:m.name||m.id,toolcall:true,attachment:m.input_modalities?.some(v=>v==="image"||v==="file")||false,modalities:{input:["text",...(m.input_modalities||[]).filter(v=>["image","pdf"].includes(v)||v==="file").map(v=>v==="file"?"pdf":v)],output:["text"]},
        limit:{context:Number(m.context_length)||32000,output:Number(m.max_output_tokens)||4096}}]))}},
    share:"disabled",autoupdate:false,plugin:[],permission:{"*":"ask",read:{"*":"allow","*.env":"deny","*.env.*":"deny","*.pem":"deny","*.key":"deny"},glob:"allow",grep:"allow",external_directory:"deny",question:"deny"},
    agent:{build:{prompt:"با کاربر فارسی صحبت کن. کد، مسیرها، شناسه‌ها و دستورها را با زبان و قالب اصلی نگه دار. پیش از تغییر، پروژه را بررسی کن. نتیجهٔ واقعی و محدودیت‌ها را شفاف بگو."},
      "paasta-plan":{mode:"primary",description:"برنامه‌ریزی فقط‌خواندنی",permission:{"*":"deny",read:"allow",glob:"allow",grep:"allow"},prompt:"با کاربر فارسی صحبت کن. پروژه را فقط با خواندن و جستجو بررسی کن. هیچ فایل، دستور، عامل دیگر یا ابزار MCP اجرا نکن. یک برنامهٔ کوتاه شامل مراحل، فایل‌های مرتبط، معیار پذیرش و تست‌ها بنویس. اگر درخواست صرفاً پرسش است، پاسخ آن را مشخص کن و تغییر فایل پیشنهاد نده. مرحلهٔ بعد به مدل کدنویسی سپرده می‌شود."}}};
}
export class CodeRuntime{
  constructor(workspace){this.workspace=resolve(workspace);this.process=null;this.url=null;this.password=randomBytes(32).toString("base64url");}
  async start(config){
    this.workspace=await realpath(this.workspace);
    const home=join(stateHome,"engine",this.identity||"local");await mkdir(home,{recursive:true,mode:0o700});
    this.process=engineCommand(["serve","--hostname","127.0.0.1","--port","0"],{detached:process.platform!=="win32",cwd:this.workspace,stdio:["ignore","pipe","pipe"],env:{
      ...process.env,XDG_CONFIG_HOME:join(home,"config"),XDG_DATA_HOME:join(home,"data"),XDG_CACHE_HOME:join(home,"cache"),
      OPENCODE_SERVER_PASSWORD:this.password,OPENCODE_CONFIG_CONTENT:JSON.stringify(config),
      OPENCODE_DISABLE_PROJECT_CONFIG:"true",OPENCODE_DISABLE_CLAUDE_CODE:"true",OPENCODE_DISABLE_AUTOUPDATE:"true"}});
    const engineProcess=this.process;
    await new Promise((resolveReady,reject)=>{
      const timeout=setTimeout(()=>reject(new Error("موتور کدنویسی شروع نشد. دوباره تلاش کنید.")),45000);
      const done=(error)=>{clearTimeout(timeout);error?reject(error):resolveReady();};
      let buffer="";
      this.process.stdout.on("data",chunk=>{
        buffer=(buffer+chunk).slice(-4096);
        const match=buffer.match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if(match){this.url=match[0];done();}
      });
      this.process.stderr.resume(); // Never copy engine diagnostics, prompts or credentials to the console.
      engineProcess.once("error",done);engineProcess.once("exit",()=>{if(this.process===engineProcess)this.url=null;done(new Error("موتور کدنویسی متوقف شد."));});
    }).catch(error=>{this.stop();throw error;});
    await this.call("/global/health");
    return this;
  }
  async call(path,{method="GET",body,timeout=20000}={}){
    if(!this.url)throw new Error("موتور کدنویسی هنوز آماده نیست.");
    const url=new URL(this.url+path);url.searchParams.set("directory",this.workspace);
    const response=await fetch(url,{method,headers:{Authorization:"Basic "+Buffer.from("opencode:"+this.password).toString("base64"),"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeout)});
    if(!response.ok)throw new Error("درخواست موتور کدنویسی ناموفق بود ("+response.status+").");
    return response.status===204?null:response.json();
  }
  async stop(){
    const child=this.process;this.process=null;this.url=null;
    if(child&&child.exitCode===null)await new Promise(resolveStop=>{
      const kill=signal=>{try{if(process.platform!=="win32"&&child.pid)process.kill(-child.pid,signal);else child.kill(signal);}catch(error){if(error.code!=="ESRCH")throw error;}};
      const timer=setTimeout(()=>{kill("SIGKILL");resolveStop();},3000);child.once("exit",()=>{clearTimeout(timer);if(process.platform!=="win32")kill("SIGKILL");resolveStop();});kill("SIGTERM");
    });
  }
}
export const normalizedPath=workspace=>process.platform==="win32"?resolve(workspace).toLowerCase():resolve(workspace);
export const workspaceKey=workspace=>createHash("sha256").update(normalizedPath(workspace)).digest("hex").slice(0,24);
export function paastaMcpConfig(workspace){
  const bridge=fileURLToPath(new URL("../bin/mcp.mjs",import.meta.url)).replace(/app\.asar([\\/])/,'app.asar.unpacked$1');
  return {type:"local",command:[process.execPath,bridge,"--workspace="+workspace],environment:{ELECTRON_RUN_AS_NODE:"1",PAASTACODE_HOME:stateHome},enabled:true};
}
