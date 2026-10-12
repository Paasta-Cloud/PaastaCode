import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {realpath} from "node:fs/promises";
import {basename,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {randomUUID} from "node:crypto";
import {PaastaAccount,stateHome} from "./account.mjs";

const root=fileURLToPath(new URL("../",import.meta.url));
const mutationNames=new Set(["paasta.redeploy_git","paasta.restart_project","paasta.deploy_source"]);
export const sourceTool={name:"paasta.deploy_source",title:"انتشار این پروژه روی پاستا",description:"Preview and request deployment of this workspace only. PaastaCode asks the human to review the source, destination and live price. Model arguments never authorize upload or cost.",inputSchema:{type:"object",properties:{name:{type:"string"},billing:{type:"string",enum:["payg","monthly"]}},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}};
export const statusTool={name:"paasta.get_deployment_request",title:"وضعیت درخواست انتشار",description:"Observe a PaastaCode review/deployment request. Never claim deployment is complete while its status is review or deploying.",inputSchema:{type:"object",properties:{id:{type:"string"}},required:["id"],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}};
export function cliPath(){
  const packaged=join(root,"engine","paasta"+(process.platform==="win32"?".exe":"")).replace(/app\.asar([\\/])/,'app.asar.unpacked$1');
  if(existsSync(packaged))return packaged;
  const local=resolve(root,"../../public/cli/latest/paasta-"+({win32:"windows",darwin:"darwin",linux:"linux"}[process.platform])+"-"+({x64:"amd64",arm64:"arm64"}[process.arch])+(process.platform==="win32"?".exe":""));
  if(existsSync(local))return local;
  throw new Error("بستهٔ انتشار پاستا پیدا نشد. نسخهٔ کامل پاستاکد را نصب کنید.");
}
export function runCli(args,{token,origin,cwd}={}){
  return new Promise((resolveRun,reject)=>{
    const child=spawn(cliPath(),args,{cwd,windowsHide:true,stdio:["ignore","pipe","pipe"],env:{...process.env,NO_COLOR:"1",PAASTA_RUNTIME_TOKEN:token||"",PAASTA_RUNTIME_SERVER:origin||""}});
    let out="",error="",size=0;
    const timer=setTimeout(()=>{child.kill();reject(new Error("پاسخ انتشار به‌موقع نرسید. پیش از تلاش دوباره، وضعیت پروژه را بررسی کنید."));},120000);
    child.stdout.on("data",chunk=>{size+=chunk.length;if(size>2_000_000){child.kill();reject(new Error("پاسخ انتشار بیش از حد بزرگ است."));}else out+=chunk;});
    child.stderr.on("data",chunk=>{error=(error+chunk).slice(-4000);});
    child.once("error",()=>{clearTimeout(timer);reject(new Error("اجرای بستهٔ انتشار ممکن نشد."));});
    child.once("exit",code=>{
      clearTimeout(timer);
      if(code!==0){
        const message=error.includes("source changed after approval")?"فایل‌های پروژه پس از تأیید تغییر کرده‌اند. پیش‌نمایش تازه بگیرید.":error.includes("separately priced storage")?"این پروژه به دیسک با هزینهٔ جدا نیاز دارد. منابع آن را در پاستا بررسی و تنظیم کنید؛ سرویس تازه‌ای ساخته نشد.":error.includes("missing required environment variables")?"متغیرهای لازم برای اجرا تنظیم نشده‌اند. تنظیمات پروژه را در پاستا بررسی کنید؛ انتشار آغاز نشد.":"انتشار انجام نشد. تنظیمات و وضعیت پروژه را بررسی کنید؛ درخواست به‌طور خودکار تکرار نمی‌شود.";
        reject(new Error(message));return;
      }
      try{const start=out.lastIndexOf("\n{");resolveRun(JSON.parse(start>=0?out.slice(start+1):out.trim()));}
      catch{reject(new Error("نتیجهٔ انتشار روشن نیست. وضعیت پروژه را در پاستا بررسی کنید؛ درخواست تکرار نشده است."));}
    });
  });
}
const slug=value=>typeof value==="string"&&/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value);
const sameAccount=(a,b)=>a.id===b.id&&a.tenantId===b.tenantId;
export class PaastaDeployment{
  constructor({workspace,account,deploymentAccount,execute=runCli}={}){
    this.workspace=resolve(workspace);this.account=account;this.connection=deploymentAccount||new PaastaAccount(account.origin,stateHome,{deployment:true});this.execute=execute;this.jobs=new Map();this.rpcId=0;this.loaded=false;
  }
  async load(){if(!this.loaded){await this.connection.load();this.loaded=true;}}
  async identity(){
    await this.load();if(!this.connection.credentials)throw new Error("ابتدا اتصال انتشار به پاستا را تأیید کنید.");
    const [base,deploy]=await Promise.all([this.account.identity(),this.connection.identity()]);
    if(!sameAccount(base,deploy))throw new Error("حساب انتشار با حساب پاستاکد یکسان نیست. اتصال انتشار را قطع و دوباره تأیید کنید.");
    return base;
  }
  async state(){await this.load();if(!this.connection.credentials)return {connected:false,jobs:[]};try{await this.identity();return {connected:true,jobs:[...this.jobs.values()].map(job=>this.publicJob(job))};}catch(error){return {connected:false,error:error.message,jobs:[]};}}
  async begin(){if(!this.account.credentials)throw new Error("ابتدا با حساب پاستا وارد شوید.");await this.load();return this.connection.begin();}
  async poll(){const result=await this.connection.poll();if(!result.pending)try{await this.identity();}catch(error){await this.connection.logout();throw error;}return result;}
  async disconnect(){await this.load();if(this.connection.credentials)await this.connection.logout();this.jobs.clear();}
  async rpc(method,params={}){
    await this.identity();const response=await this.connection.request("/api/mcp",{method:"POST",body:{jsonrpc:"2.0",id:++this.rpcId,method,params}});
    if(response.error||response.result?.isError)throw new Error(response.error?.message||response.result?.content?.[0]?.text||"درخواست MCP پاستا انجام نشد.");
    return response.result;
  }
  async tools(){const result=await this.rpc("tools/list");return [...result.tools,sourceTool,statusTool];}
  async context(){await this.identity();return this.connection.request("/api/cli/context");}
  async request(name,args={}){
    if(!args||typeof args!=="object"||Array.isArray(args))throw new Error("درخواست انتشار معتبر نیست.");
    if(name==="paasta.get_deployment_request")return this.status(args.id);
    if(mutationNames.has(name)&&Object.keys(args).some(key=>!(name==="paasta.deploy_source"?["name","billing","plan","region"]:["project"]).includes(key)))throw new Error("آرگومان این عملیات معتبر نیست؛ مسیر و مجوز انتشار از درخواست مدل گرفته نمی‌شود.");
    const tools=await this.tools(),tool=tools.find(tool=>tool.name===name);
    if(!tool)throw new Error("این ابزار در حساب پاستا در دسترس نیست.");
    if(tool.annotations?.readOnlyHint===true)return this.rpc("tools/call",{name,arguments:args});
    if(!mutationNames.has(name))throw new Error("این عملیات از پاستاکد مجاز نیست.");
    if([...this.jobs.values()].filter(job=>["review","deploying"].includes(job.status)).length>=10)throw new Error("ابتدا درخواست‌های انتشار قبلی را بررسی کنید.");
    const identity=await this.identity();
    for(const [id,job] of this.jobs)if(this.jobs.size>=100&&!["review","deploying"].includes(job.status))this.jobs.delete(id);
    const context=await this.context();
    const project=name==="paasta.deploy_source"?(args.name||basename(this.workspace).toLowerCase().replace(/[^a-z0-9-]/g,"-").slice(0,63)):args.project;
    if(!slug(project))throw new Error("نام پروژه باید از حروف کوچک انگلیسی، عدد و خط تیره باشد.");
    const existing=context.projects.find(item=>item.name===project);
    if(name!=="paasta.deploy_source"&&!existing)throw new Error("پروژهٔ انتخاب‌شده در این حساب پیدا نشد.");
    const plan=context.plans.find(plan=>plan.id===(existing?.service_plan_id||args.plan))||(!existing&&!args.plan?context.plans[0]:null);
    const region=context.clusters.find(region=>region.id===(existing?.cluster_id||args.region))||(!existing&&!args.region?context.clusters[0]:null);
    const billing=existing?.billing_mode||args.billing||"payg";
    if(!plan||!region||!["payg","monthly"].includes(billing))throw new Error("پلن، منطقه یا روش پرداخت در دسترس نیست.");
    let source;
    if(name==="paasta.deploy_source"){
      // Never accept a model-selected path, shell flag, environment value or confirmation bit.
      source=await this.execute(["deploy",await realpath(this.workspace),"--dry-run","--json","--hash"],{cwd:this.workspace});
      if(!/^[0-9a-f]{64}$/.test(source.archiveSha256)||!Array.isArray(source.files)||source.files.length===0)throw new Error("پیش‌نمایش سورس معتبر نیست.");
    }
    const job={id:randomUUID(),name,project,plan,region,billing,source,identity,status:"review",expires:Date.now()+300000,createdAt:Date.now()};
    this.jobs.set(job.id,job);return this.publicJob(job);
  }
  publicJob(job){return {id:job.id,name:job.name,project:job.project,status:job.status,expires:job.expires,plan:job.plan,region:job.region,billing:job.billing,source:job.source,createdAt:job.createdAt,deployId:job.deployId,result:job.result,error:job.error};}
  async job(id){const job=this.jobs.get(id);if(!job)throw new Error("درخواست انتشار پیدا نشد.");if(!sameAccount(job.identity,await this.identity()))throw new Error("این درخواست متعلق به حساب فعلی نیست.");return job;}
  async approve(id){
    const job=await this.job(id);
    if(job.status!=="review")throw new Error("این درخواست قبلاً پاسخ گرفته است؛ انتشار دوباره آغاز نمی‌شود.");
    if(job.expires<Date.now()){job.status="expired";throw new Error("مهلت پیش‌نمایش تمام شده است. دوباره بررسی کنید.");}
    job.status="deploying"; // Consume consent before any awaited operation or upload.
    void this.executeJob(job);return this.publicJob(job);
  }
  async reject(id){const job=await this.job(id);if(job.status!=="review")throw new Error("درخواست دیگر در انتظار تأیید نیست.");job.status="rejected";return this.publicJob(job);}
  async executeJob(job){
    try{
      const current=await this.context();const plan=current.plans.find(plan=>plan.id===job.plan.id);
      const project=current.projects.find(project=>project.name===job.project);
      if(!plan||plan.hourly_price_toman!==job.plan.hourly_price_toman||plan.monthly_price_toman!==job.plan.monthly_price_toman||!current.clusters.some(region=>region.id===job.region.id)||
        (project&&(project.service_plan_id!==job.plan.id||project.cluster_id!==job.region.id||project.billing_mode!==job.billing)))throw new Error("مقصد یا قیمت تغییر کرده است. پیش‌نمایش تازه بگیرید.");
      if(job.name==="paasta.deploy_source"){
        const result=await this.execute(["deploy",this.workspace,"--yes","--json","--detach","--no-env","--no-addons","--name",job.project,"--plan",job.plan.id,"--region",job.region.id,"--billing",job.billing,"--source-sha256",job.source.archiveSha256],{token:this.connection.credentials.token,origin:this.connection.origin,cwd:this.workspace});
        if(typeof result.deployment!=="string"||result.status!=="queued")throw new Error("نتیجهٔ انتشار روشن نیست. وضعیت پروژه را پیش از تلاش دوباره بررسی کنید.");
        job.deployId=result.deployment;job.result=result;
      }else{
        const result=await this.rpc("tools/call",{name:job.name,arguments:{project:job.project}});
        job.result=result.structuredContent||result;
        if(job.name==="paasta.redeploy_git")job.deployId=job.result.deployment;else job.status="complete";
      }
    }catch(error){job.status="failed";job.error=error.message;}
  }
  async status(id){
    const job=await this.job(id);
    if(job.status==="deploying"&&job.deployId){
      try{
        const result=await this.connection.request("/api/projects/deploy/"+encodeURIComponent(job.deployId));
        job.result={...job.result,status:result.status,domain:result.domain,logs:String(result.logs||"").slice(-8000)};
        if(result.status==="ready")job.status="ready";
        if(["failed","canceled"].includes(result.status)){job.status="failed";job.error=result.error||"انتشار کامل نشد. گزارش پروژه را بررسی کنید.";}
      }catch(error){job.error=error.message;} // Observe only; never repeat an ambiguous deployment.
    }
    return this.publicJob(job);
  }
}
