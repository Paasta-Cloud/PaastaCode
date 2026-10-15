#!/usr/bin/env node
import {spawn} from "node:child_process";
import {resolve,join,dirname,basename} from "node:path";
import {realpath,readFile,stat,readdir,lstat} from "node:fs/promises";
import {pathToFileURL,fileURLToPath} from "node:url";
import {createInterface} from "node:readline/promises";
import {PaastaAccount,billingUrl} from "../src/account.mjs";
import {connectWorkspace,stopWorkspace,refreshAccounts} from "../src/workspace-service.mjs";
import {engineCommand} from "../src/runtime.mjs";
import {codingModels} from "../src/models.mjs";
import {PaastaDeployment} from "../src/deployment.mjs";
import {parseSkillMarkdown} from '../src/integrations.mjs';
import {checkUpdate,downloadUpdate,installPortable,portableTarget,currentPackage} from "../src/updates.mjs";

export function openBrowser(url){
  // PowerShell argument binding prevents URL metacharacters from becoming shell syntax.
  if(process.platform==="win32"){
    const child=spawn("powershell.exe",["-NoProfile","-NonInteractive","-Command","$u=[Console]::In.ReadToEnd(); Start-Process -FilePath $u"],{windowsHide:true,stdio:["pipe","ignore","ignore"]});child.stdin.end(url);child.on("error",()=>{});
  }else {const child=spawn(process.platform==="darwin"?"open":"xdg-open",[url],{stdio:"ignore"});child.on("error",()=>{});child.unref();}
}
async function main(){
  const args=process.argv.slice(2),command=args[0]||"web";
  const target=await portableTarget(currentPackage);
  if(target){const child=spawn(join(target.path,"runtime",process.platform==="win32"?"node.exe":"node"),[join(target.path,"client/bin/paastacode.mjs"),...args],{stdio:"inherit",windowsHide:true,env:{...process.env,PAASTACODE_INSTALL_ROOT:target.installation}});child.on("error",()=>{console.error("اجرای نسخهٔ جدید ممکن نشد؛ نصب قبلی باقی مانده است.");process.exitCode=1;});child.on("exit",code=>{process.exitCode=code||0;});return;}
  const version=JSON.parse(await readFile(new URL("../package.json",import.meta.url),"utf8")).version;
  if(command==="update"){
    const release=await checkUpdate(version);if(!release){console.log("پاستاکد به‌روز است: "+version);return;}
    console.log("نسخهٔ جدید: "+release.tag_name);if(args.includes("--check"))return;
    const installation=process.env.PAASTACODE_INSTALL_ROOT||dirname(currentPackage.replace(/[\\/]$/,""));
    await realpath(join(installation,"runtime",process.platform==="win32"?"node.exe":"node")).catch(()=>{throw new Error("برای به‌روزرسانی، این فرمان را از بستهٔ قابل‌نصب CLI اجرا کنید.");});
    console.log("در حال دریافت و بررسی بسته…");const download=await downloadUpdate(release);await installPortable(download,installation);console.log("به‌روزرسانی آماده است. اجرای بعدی پاستاکد از نسخهٔ "+download.version+" استفاده می‌کند. کارهای جاری و فایل‌ها باقی مانده‌اند.");return;
  }
  if(["version","--version","-v"].includes(command)){console.log("PaastaCode "+version);return;}
  if(command==="mcp"){await import("./mcp.mjs");return;}
  if(["help","--help","-h"].includes(command)){
    console.log("PaastaCode "+version+" / پاستاکد\nPowered by OpenCode · MIT\nOpen-source fork: https://github.com/Paasta-Cloud/PaastaCode\n\n  paastacode web [--workspace=PATH] [--hosted] [--no-open]\n  paastacode login [--daily-limit=TOMAN]\n  paastacode cli [--workspace=PATH]\n  paastacode models\n  paastacode tools [--file=PATH|--skill=DIR|--browser=on|off|--auth=NAME|--install-browser]\n  paastacode billing [--check]\n  paastacode ask --model=ID --text=TEXT [--phase=plan] [--auto] [--execution-model=ID] [--session=ID] [--restart|--execute-plan]\n  paastacode import --source=codex|claude|cursor [--file=PATH] [--no-rules] [--apply] [--workspace=PATH]\n  paastacode deploy-login\n  paastacode deploy [--name=NAME] [--plan=ID] [--region=ID]\n  paastacode mcp [--workspace=PATH]\n  paastacode stop [--workspace=PATH]\n  paastacode logout\n  paastacode update [--check]\n  paastacode --version\n\nورود و مدل‌ها از حساب پاستا؛ وب و CLI برای پوشهٔ یکسان یک موتور مشترک دارند.");return;
  }
  const workspace=await realpath(resolve(args.find(a=>a.startsWith("--workspace="))?.slice(12)||process.cwd()));
  const account=await new PaastaAccount().load();
  if(command==='tools'){
    if(args.includes('--install-browser')){const launcher=fileURLToPath(new URL('./browser-mcp.cjs',import.meta.url)).replace(/app\.asar([\\/])/,'app.asar.unpacked$1');const child=spawn(process.execPath,[launcher,'--install'],{stdio:'inherit',windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_PATH:join(dirname(launcher),'../vendor/browser')}});const code=await new Promise((done,fail)=>{child.once('error',fail);child.once('exit',done);});if(code!==0)throw new Error('دریافت مرورگر انجام نشد؛ اتصال اینترنت و نیازمندی‌های مرورگر را بررسی کنید.');return;}
    const value=name=>args.find(arg=>arg.startsWith('--'+name+'='))?.slice(name.length+3),service=await connectWorkspace({workspace});
    let revision;
    const call=async(path,body)=>{const response=await fetch(service.url+'/api/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+service.capability,'Content-Type':'application/json',...(revision===undefined?{}:{'X-PaastaCode-Account':String(revision)})},body:body?JSON.stringify(body):undefined});const result=await response.json();if(!response.ok)throw new Error(result.error||'عملیات ابزارها انجام نشد.');return result;};
    revision=(await call('state')).accountRevision;
    if(value('file')){const file=value('file');if((await stat(file)).size>1000000)throw new Error('فایل تنظیمات بیش از حد بزرگ است.');await call('integrations',JSON.parse(await readFile(file,'utf8')));}
    else if(value('skill')){
      const directory=await realpath(resolve(value('skill'))),main=join(directory,'SKILL.md');if((await stat(main)).size>128000)throw new Error('فایل مهارت بیش از حد بزرگ است.');const skill=parseSkillMarkdown(await readFile(main,'utf8'));let bytes=Buffer.byteLength(skill.instructions);
      const walk=async(folder,prefix='')=>{for(const entry of await readdir(folder,{withFileTypes:true})){if(entry.isSymbolicLink())throw new Error('پیوند نمادین را از پوشهٔ مهارت حذف کنید.');const relative=prefix+entry.name,target=join(folder,entry.name);if(entry.isDirectory())await walk(target,relative+'/');else if(relative!=='SKILL.md'){const info=await lstat(target);bytes+=info.size;if(!info.isFile()||bytes>750000||skill.files.length>=64)throw new Error('مهارت بیش از حد بزرگ است؛ حداکثر ۷۵۰ کیلوبایت و ۶۴ فایل همراه.');skill.files.push({path:relative,data:(await readFile(target)).toString('base64')});}}};await walk(directory);await call('integrations',{kind:'skill',action:'save',...skill});
    }else if(value('browser')){if(!['on','off'].includes(value('browser')))throw new Error('برای مرورگر on یا off وارد کنید.');await call('integrations',{kind:'browser',enabled:value('browser')==='on'});}
    else if(value('auth')){const result=await call('integrations/auth',{name:value('auth'),...(value('callback')?{callback:value('callback')}:{})});if(result.url){console.log('تأیید اتصال را در مرورگر انجام دهید. اگر بازگشت کامل نشد، همین فرمان را با --callback=URL تکرار کنید.');openBrowser(result.url);}}
    const result=await call('integrations');console.log(JSON.stringify(result,null,2));return;
  }
  if(command==="ask"||command==="import"){
    const value=name=>args.find(arg=>arg.startsWith("--"+name+"="))?.slice(name.length+3);
    const service=await connectWorkspace({workspace});
    const api=async(path,body)=>{const response=await fetch(service.url+"/api/"+path,{method:body?"POST":"GET",headers:{Authorization:"Bearer "+service.capability,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});const result=await response.json();if(!response.ok)throw new Error(result.error||"عملیات ناموفق بود.");return result;};
    if(command==="import"){
      let text;const file=value("file");if(file){if((await stat(file)).size>900000)throw new Error("فایل گفتگو بیش از حد بزرگ است.");text=await readFile(file,"utf8");}
      const preview=await api("import/preview",{source:value("source"),rules:!args.includes("--no-rules"),text,format:file?.toLowerCase().endsWith(".jsonl")?"jsonl":"text"});
      console.log(preview.messages.map(m=>m.text).join("\n\n"));
      if(!args.includes("--apply")){console.log("فقط پیش‌نمایش؛ برای ورود همین متن، دستور را با --apply اجرا کنید.");return;}
      const result=await api("import",{token:preview.token});console.log("گفتگو وارد شد: "+result.session.id);return;
    }
    const paths=args.filter(arg=>arg.startsWith("--attach=")).map(arg=>arg.slice(9)),attachments=[];
    if(paths.length>8)throw new Error("حداکثر ۸ فایل پیوست کنید.");
    if(paths.length&&!(await api("state")).features?.promptAttachments)throw new Error("برای پیوست فایل، اجرای پاستاکد این پروژه را به‌روز کنید.");
    let attachmentBytes=0;
    for(const path of paths){const info=await stat(path);attachmentBytes+=info.size;if(!info.isFile()||info.size>4*1024*1024||attachmentBytes>6*1024*1024)throw new Error("هر فایل حداکثر ۴ مگابایت و مجموع پیوست‌ها حداکثر ۶ مگابایت است.");attachments.push({name:basename(path),data:(await readFile(path)).toString("base64")});}
    if(!value("model")||(!value("text")&&!attachments.length&&!args.includes("--restart")&&!args.includes("--execute-plan")))throw new Error("مدل و متن درخواست را مشخص کنید؛ paastacode help را ببینید.");
    const id=value("session")||(await api("sessions",{})).id;
    const result=await api("prompt",{id,text:value("text")||(attachments.length?"پیوست‌ها را بررسی کن.":"ادامهٔ درخواست"),attachments,model:value("model"),phase:args.includes("--auto")?"plan":value("phase")||"build",executionModel:value("execution-model"),autoExecute:args.includes("--auto"),restart:args.includes("--restart"),executePlan:args.includes("--execute-plan")});
    console.log("درخواست پذیرفته شد: "+id+" · "+result.workflow.phase+"\nبرای مشاهدهٔ خروجی: paastacode cli یا paastacode web");return;
  }
  if(command==="login"){
    const budgetArg=args.find(a=>a.startsWith("--daily-limit="));
    const budget=budgetArg?Number(budgetArg.slice(14)):null;
    if(budgetArg&&(!Number.isInteger(budget)||budget<1||budget>1000000))throw new Error("سقف روزانه باید عددی بین ۱ و ۱٬۰۰۰٬۰۰۰ تومان باشد.");
    const device=await account.begin();console.log("کد ورود: "+device.code+"\n"+device.url);openBrowser(device.url);
    while((await account.poll()).pending)await new Promise(r=>setTimeout(r,3000));
    if(budgetArg){await account.connect(budget);console.log("ورود انجام شد. سقف روزانه: "+budget.toLocaleString("fa-IR")+" تومان. برای شروع paastacode cli را اجرا کنید.");}
    else console.log("ورود انجام شد. برای انتخاب مدل و تأیید سقف مصرف، paastacode web را اجرا کنید.");await refreshAccounts();return;
  }
  if(command==="logout"){await account.logout();await refreshAccounts();console.log("دسترسی دستگاه لغو شد.");return;}
  if(command==="stop"){const result=await stopWorkspace(workspace);console.log(result.stopped?"اجرای مشترک این پروژه متوقف شد. فایل‌ها و گفتگوها باقی می‌مانند.":"این پروژه اجرای فعالی ندارد.");return;}
  if(command==="billing"){
    const context=await account.context(),url=billingUrl(account.origin,context.account);if(!url)throw new Error("برای مدیریت مصرف با حساب پاستا وارد شوید.");
    if(args.includes('--check')){const status=await account.request('/api/paastacode/subscription');console.log('روش مصرف: '+({subscription:'اشتراک',payg:'کیف پول',paused:'متوقف'}[status.mode]||status.mode));if(status.current)console.log('باقی‌ماندهٔ هفته: '+status.current.quotas.week.remainingToman.toLocaleString('fa-IR')+' تومان');if(status.paygBudget?.configured)console.log('باقی‌ماندهٔ سقف مشترک کیف پول: '+status.paygBudget.remainingToman.toLocaleString('fa-IR')+' تومان');console.log('مدیریت حساب: '+url);}
    else{console.log('مدیریت اشتراک و مصرف در مرورگر حساب پاستا باز می‌شود:\n'+url);openBrowser(url);}return;
  }
  if(command==="models"){
    const context=await account.context();
    for(const model of codingModels(context.models))console.log(model.id+" · "+model.name+" · "+Number(model.input_toman_per_million).toLocaleString("fa-IR")+" / "+Number(model.output_toman_per_million).toLocaleString("fa-IR")+" تومان برای هر میلیون توکن ورودی / خروجی");return;
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
  if(command==="cli"){
    const service=await connectWorkspace({workspace}),engine=await service.ensureReady();
    const child=engineCommand(["attach",engine.url,"--dir",workspace],{stdio:"inherit",env:{...process.env,OPENCODE_SERVER_PASSWORD:engine.password}});
    child.on("exit",code=>{process.exitCode=code||0;});
    child.on("error",()=>{console.error("اجرای موتور کدنویسی ممکن نشد.");process.exitCode=1;});return;
  }
  if(command!=="web")throw new Error("دستور ناشناخته است. paastacode help را اجرا کنید.");
  const hosted=args.includes("--hosted");
  const launchUrl=app=>hosted?"https://code.paasta.cloud/#local="+encodeURIComponent(app.url)+"&cap="+app.capability:app.url+"/#cap="+app.capability;
  const app=await connectWorkspace({workspace,hosted});
  console.log("پاستاکد: "+app.url+"\nاجرای پروژه مستقل از این پنجره ادامه دارد.\nبرای CLI مشترک: paastacode cli\nبرای توقف اجرای محلی: paastacode stop");
  if(!args.includes("--no-open"))openBrowser(launchUrl(app));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
