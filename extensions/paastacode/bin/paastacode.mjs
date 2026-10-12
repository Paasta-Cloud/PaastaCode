#!/usr/bin/env node
import {spawn} from "node:child_process";
import {join,resolve} from "node:path";
import {realpath,readFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";
import {createInterface} from "node:readline/promises";
import {PaastaAccount,stateHome,readPrivate} from "../src/account.mjs";
import {startServer} from "../src/server.mjs";
import {engineCommand,workspaceKey} from "../src/runtime.mjs";
import {PaastaDeployment} from "../src/deployment.mjs";

export function openBrowser(url){
  // PowerShell argument binding prevents URL metacharacters from becoming shell syntax.
  if(process.platform==="win32"){
    const child=spawn("powershell.exe",["-NoProfile","-NonInteractive","-Command","$u=[Console]::In.ReadToEnd(); Start-Process -FilePath $u"],{windowsHide:true,stdio:["pipe","ignore","ignore"]});child.stdin.end(url);child.on("error",()=>{});
  }else {const child=spawn(process.platform==="darwin"?"open":"xdg-open",[url],{stdio:"ignore"});child.on("error",()=>{});child.unref();}
}
async function main(){
  const args=process.argv.slice(2),command=args[0]||"web";
  const version=JSON.parse(await readFile(new URL("../package.json",import.meta.url),"utf8")).version;
  if(["version","--version","-v"].includes(command)){console.log("PaastaCode "+version);return;}
  if(command==="mcp"){await import("./mcp.mjs");return;}
  if(["help","--help","-h"].includes(command)){
    console.log("PaastaCode "+version+" / پاستاکد\nPowered by OpenCode · MIT\nOpen-source fork: https://github.com/Paasta-Cloud/PaastaCode\n\n  paastacode web [--workspace=PATH] [--hosted] [--no-open]\n  paastacode login [--daily-limit=TOMAN]\n  paastacode cli [--workspace=PATH]\n  paastacode models\n  paastacode deploy-login\n  paastacode deploy [--name=NAME] [--plan=ID] [--region=ID]\n  paastacode mcp [--workspace=PATH]\n  paastacode logout\n  paastacode --version\n\nورود و مدل‌ها از حساب پاستا؛ وب و CLI برای پوشهٔ یکسان یک موتور مشترک دارند.");return;
  }
  const workspace=await realpath(resolve(args.find(a=>a.startsWith("--workspace="))?.slice(12)||process.cwd()));
  const account=await new PaastaAccount().load();
  if(command==="login"){
    const budgetArg=args.find(a=>a.startsWith("--daily-limit="));
    const budget=budgetArg?Number(budgetArg.slice(14)):null;
    if(budgetArg&&(!Number.isInteger(budget)||budget<1||budget>1000000))throw new Error("سقف روزانه باید عددی بین ۱ و ۱٬۰۰۰٬۰۰۰ تومان باشد.");
    const device=await account.begin();console.log("کد ورود: "+device.code+"\n"+device.url);openBrowser(device.url);
    while((await account.poll()).pending)await new Promise(r=>setTimeout(r,3000));
    if(budgetArg){await account.connect(budget);console.log("ورود انجام شد. سقف روزانه: "+budget.toLocaleString("fa-IR")+" تومان. برای شروع paastacode cli را اجرا کنید.");}
    else console.log("ورود انجام شد. برای انتخاب مدل و تأیید سقف مصرف، paastacode web را اجرا کنید.");return;
  }
  if(command==="logout"){await account.logout();console.log("دسترسی دستگاه لغو شد.");return;}
  if(command==="models"){
    const context=await account.context();
    for(const model of context.models)console.log(model.id+" · "+model.name+" · "+Number(model.input_toman_per_million).toLocaleString("fa-IR")+" / "+Number(model.output_toman_per_million).toLocaleString("fa-IR")+" تومان برای هر میلیون توکن ورودی / خروجی");return;
  }
  if(command==="deploy-login"){
    if(!account.credentials)throw new Error("ابتدا با paastacode login وارد حساب پاستا شوید.");
    const controller=new PaastaDeployment({workspace,account});const device=await controller.begin();
    console.log("اتصال جداگانهٔ انتشار، با مجوز مشاهدهٔ پروژه، لاگ و انتشار.\nکد ورود: "+device.code+"\n"+device.url);openBrowser(device.url);
    while((await controller.poll()).pending)await new Promise(r=>setTimeout(r,3000));console.log("اتصال انتشار به همان حساب پاستاکد تأیید شد.");return;
  }
  if(command==="deploy"){
    const controller=new PaastaDeployment({workspace,account});
    const values=Object.fromEntries(["name","plan","region","billing"].map(key=>[key,args.find(arg=>arg.startsWith("--"+key+"="))?.slice(key.length+3)]).filter(([,value])=>value!==undefined));
    const job=await controller.request("paasta.deploy_source",values);
    console.log("پروژه: "+job.project+"\nپلن: "+job.plan.name+"\nمحل میزبانی: "+job.region.name+"\n"+(job.billing==="monthly"?"پرداخت ماهانهٔ پیشاپیش: "+Number(job.plan.monthly_price_toman).toLocaleString("fa-IR"):"هزینهٔ ساعتیِ سرویس: "+Number(job.plan.hourly_price_toman).toLocaleString("fa-IR"))+" تومان\n"+job.source.files.length.toLocaleString("fa-IR")+" فایل برای انتشار\nفایل‌های محیطی و کلیدها خودکار وارد نمی‌شوند.\n"+job.source.files.map(file=>file.path).join("\n"));
    if(!process.stdin.isTTY){await controller.reject(job.id);throw new Error("تأیید انسانی لازم است. دیپلوی را در ترمینال تعاملی یا رابط پاستاکد بررسی کنید.");}
    const terminal=createInterface({input:process.stdin,output:process.stdout});let answer;
    try{answer=await terminal.question("برای تأیید هزینه و انتشار، «انتشار» را بنویسید: ");}finally{terminal.close();}
    if(answer.trim()!=="انتشار"){await controller.reject(job.id);console.log("انتشار لغو شد.");return;}
    await controller.approve(job.id);let status;
    do{await new Promise(r=>setTimeout(r,2000));status=await controller.status(job.id);}while(status.status==="deploying");
    if(status.status!=="ready")throw new Error(status.error||"انتشار کامل نشد. وضعیت پروژه را در پاستا بررسی کنید.");
    console.log("پروژه آماده است: "+status.result.domain);return;
  }
  const saved=await readPrivate(join(stateHome,"workspace-"+workspaceKey(workspace)+".json"));
  let running;
  if(saved){
    try{const response=await fetch(saved.url+"/api/state",{headers:{Authorization:"Bearer "+saved.capability},signal:AbortSignal.timeout(1500)});if(response.ok)running=saved;}catch{}
  }
  if(command==="cli"){
    let owned;
    if(!running){
      if(!account.credentials?.aiKey)throw new Error("ابتدا paastacode login --daily-limit=50000 را اجرا کنید یا سقف مصرف را در رابط وب تأیید کنید.");
      owned=await startServer({workspace,account});
      try{await owned.ensureReady();running={engineUrl:owned.runtime.url,enginePassword:owned.runtime.password};}catch(error){await owned.close();throw error;}
    }
    if(!running.engineUrl){if(owned)await owned.close();throw new Error("ابتدا مدل و سقف مصرف را در رابط وب تأیید کنید.");}
    const child=engineCommand(["attach",running.engineUrl,"--dir",workspace],{stdio:"inherit",env:{...process.env,OPENCODE_SERVER_PASSWORD:running.enginePassword}});
    child.on("exit",async code=>{if(owned)await owned.close();process.exitCode=code||0;});
    child.on("error",async()=>{if(owned)await owned.close();console.error("اجرای موتور کدنویسی ممکن نشد.");process.exitCode=1;});return;
  }
  if(command!=="web")throw new Error("دستور ناشناخته است. paastacode help را اجرا کنید.");
  const hosted=args.includes("--hosted");
  const launchUrl=app=>hosted?"https://code.paasta.cloud/#local="+encodeURIComponent(app.url)+"&cap="+app.capability:app.url+"/#cap="+app.capability;
  if(running){if(hosted&&!running.hosted)throw new Error("اجرای محلی فعلی را ببندید و paastacode web --hosted را اجرا کنید.");console.log("پاستاکد برای این پوشه باز است.");if(!args.includes("--no-open"))openBrowser(launchUrl(running));return;}
  const app=await startServer({workspace,account,hosted});
  if(hosted&&app.reused&&!app.hosted)throw new Error("اجرای محلی فعلی را ببندید و paastacode web --hosted را اجرا کنید.");
  console.log("پاستاکد: "+app.url+"\nبرای CLI مشترک: paastacode cli");
  if(!args.includes("--no-open"))openBrowser(launchUrl(app));
  for(const signal of ["SIGINT","SIGTERM"])process.once(signal,()=>void app.close().then(()=>process.exit()));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
