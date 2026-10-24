import {spawn} from "node:child_process";
import {resolve,relative,isAbsolute} from "node:path";
import {open,realpath,lstat} from 'node:fs/promises';

export class WorkspaceGit {
  constructor(workspace){this.workspace=resolve(workspace);this.queue=Promise.resolve();}
  async call(args,{allowFailure=false}={}){
    return new Promise((done,fail)=>{
      const child=spawn("git",["-c","core.quotepath=false",...args],{cwd:this.workspace,windowsHide:true,stdio:["ignore","pipe","pipe"],env:{...process.env,GIT_TERMINAL_PROMPT:"0",GCM_INTERACTIVE:"never",GIT_SSH_COMMAND:"ssh -o BatchMode=yes"}});
      let output="",size=0,finished=false;
      const timer=setTimeout(()=>{finished=true;child.kill();fail(new Error("عملیات گیت طول کشید؛ اتصال و دسترسی مخزن را بررسی کنید."));},45000);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data",chunk=>{size+=Buffer.byteLength(chunk);if(size>1_000_000){finished=true;child.kill();clearTimeout(timer);fail(new Error("خروجی بزرگ است؛ فایل کوچک‌تری انتخاب کنید."));}else output+=chunk;});
      child.stderr.resume(); // Remote URLs, credential helpers and hooks may print secrets.
      child.once("error",()=>{clearTimeout(timer);if(!finished)fail(new Error("گیت در دسترس نیست؛ Git را نصب و دوباره تلاش کنید."));});
      child.once("close",code=>{clearTimeout(timer);if(finished)return;if(code&&!allowFailure)fail(new Error("عملیات گیت کامل نشد. تغییرات محلی را نگه دارید و دسترسی مخزن یا تعارض فایل‌ها را بررسی کنید."));else done({code,output});});
    });
  }
  async root(){const r=await this.call(["rev-parse","--show-toplevel"],{allowFailure:true});if(r.code)return false;const normalize=p=>process.platform==="win32"?resolve(p).toLowerCase():resolve(p);if(normalize(r.output.trim())!==normalize(this.workspace))throw new Error("پوشهٔ بازشده ریشهٔ مخزن نیست؛ پوشهٔ اصلی مخزن را باز کنید.");return true;}
  async status(){
    if(!await this.root())return {repository:false,files:[]};
    const raw=(await this.call(["status","--porcelain=v1","-z","--untracked-files=all"])).output.split("\0"),files=[];
    for(let i=0;i<raw.length;i++){const entry=raw[i];if(!entry)continue;const status=entry.slice(0,2),path=entry.slice(3);const previous=/[RC]/.test(status)?raw[++i]:undefined;files.push({path,status,previous});}
    const branch=(await this.call(["symbolic-ref","--quiet","--short","HEAD"],{allowFailure:true})).output.trim()||"HEAD";
    const upstream=(await this.call(["rev-parse","--abbrev-ref","--symbolic-full-name","@{u}"],{allowFailure:true})).output.trim();
    const count=upstream?(await this.call(["rev-list","--left-right","--count","HEAD...@{u}"],{allowFailure:true})).output.trim().split(/\s+/).map(Number):[0,0];
    const remotes=(await this.call(["remote"])).output.trim().split("\n").filter(Boolean);
    return {repository:true,branch,upstream,ahead:count[0]||0,behind:count[1]||0,remotes,files};
  }
  async diff(path){
    const state=await this.status(),file=state.files.find(f=>f.path===path);
    if(!file||/(^|\/)(\.env(?:\..*)?|[^/]+\.(pem|key))$/i.test(path))throw new Error('فایل تغییرکردهٔ مجاز را از فهرست انتخاب کنید.');
    const paths=file.previous?[file.previous,path]:[path];
    const worktree=(await this.call(['diff','--no-ext-diff','--no-textconv','--',...paths])).output;
    const staged=(await this.call(['diff','--cached','--no-ext-diff','--no-textconv','--',...paths])).output;
    let untracked='';
    if(file.status==='??'){
      const target=resolve(this.workspace,path),info=await lstat(target),within=relative(await realpath(this.workspace),await realpath(target));
      if(info.isSymbolicLink()||!info.isFile()||within.startsWith('..')||isAbsolute(within))throw new Error('پیش‌نمایش این مسیر در دسترس نیست.');
      if(info.size>256000)untracked='فایل برای پیش‌نمایش بزرگ است؛ آن را در ویرایشگر باز کنید.';
      else{const handle=await open(target,'r');try{const bytes=Buffer.alloc(256001),{bytesRead}=await handle.read(bytes,0,bytes.length,0);if(bytesRead>256000)throw new Error('فایل برای پیش‌نمایش بزرگ است.');const content=bytes.subarray(0,bytesRead);untracked=content.includes(0)?'پیش‌نمایش فایل باینری در دسترس نیست.':'--- /dev/null\n+++ '+path+'\n@@ -0,0 +1,'+content.toString('utf8').split('\n').length+' @@\n'+content.toString('utf8').split('\n').map(line=>'+'+line).join('\n');}finally{await handle.close();}}
    }
    return {path,worktree,staged,untracked,text:[worktree,staged,untracked].filter(Boolean).join('\n')||'تفاوت متنی ثبت نشده است.'};
  }
  action(input){const work=this.queue.then(async()=>{this.busy=true;try{return await this.perform(input);}finally{this.busy=false;}});this.queue=work.catch(()=>{});return work;}
  async perform(input){
    const {action}=input;
    if(action==="init"){if(await this.root())throw new Error("این پروژه مخزن گیت دارد.");await this.call(["init","--initial-branch=main"]);return this.status();}
    const state=await this.status();if(!state.repository)throw new Error("ابتدا مخزن گیت بسازید.");
    if(action==="commit"){
      if(typeof input.message!=="string"||!input.message.trim()||input.message.length>2000)throw new Error("پیام کامیت را بنویسید.");
      if(!Array.isArray(input.paths)||!input.paths.length||input.paths.length>500||input.paths.some(p=>typeof p!=="string"||!state.files.some(f=>f.path===p)||/(^|\/)(\.env(?:\..*)?|[^/]+\.(pem|key))$/i.test(p)))throw new Error("فایل‌های کامیت را انتخاب کنید؛ فایل‌های کلید و محیطی را جداگانه مدیریت کنید.");
      const paths=[...new Set(input.paths.flatMap(path=>{const file=state.files.find(f=>f.path===path);return file.status.includes("R")&&file.previous?[path,file.previous]:[path];}))];
      await this.call(["add","--",...input.paths]);await this.call(["commit","--only","-m",input.message,"--",...paths]);
    }else if(action==="branch"){
      if(typeof input.branch!=="string"||input.branch.length>150||input.branch.startsWith("-"))throw new Error("نام شاخه معتبر نیست.");
      await this.call(["check-ref-format","--branch",input.branch]);await this.call(["switch",...(input.create?["-c"]:[]),input.branch]);
    }else if(action==="remote"){
      const url=input.url;if(typeof url!=="string"||url.length>1000||!(/^[\w.-]+@[\w.-]+:[\w./-]+$/.test(url)||(()=>{try{const u=new URL(url);return ["https:","ssh:"].includes(u.protocol)&&!u.password&&(u.protocol!=="https:"||!u.username)&&!!u.hostname;}catch{return false;}})()))throw new Error("نشانی HTTPS یا SSH مخزن را بدون رمز یا توکن وارد کنید.");
      await this.call(["remote",state.remotes.includes("origin")?"set-url":"add","origin",url]);
    }else if(action==="fetch")await this.call(["fetch","origin"]);
    else if(action==="pull")await this.call(["pull","--ff-only"]);
    else if(action==="push"){if(state.branch==="HEAD")throw new Error("برای ارسال، یک شاخه باز کنید.");await this.call(["push","--set-upstream","origin",state.branch]);}
    else throw new Error("عملیات گیت معتبر نیست.");
    return this.status();
  }
}
