const {equal}=require('./workspace-store.cjs');
const {readArchive}=require('./archive.cjs');
const {encode}=require('./wire.cjs');
const same=(a,b)=>!a&&!b||equal(a,b);
const mode=file=>(file.mode&0o170000)===0o120000?'120000':file.mode&0o111?'100755':'100644';
const sameGit=(a,b)=>!a&&!b||!!a&&!!b&&mode(a)===mode(b)&&a.data.length===b.data.length&&a.data.every((byte,index)=>byte===b.data[index]);
const sensitive=path=>/(^|\/)(\.env(?:\.[^/]*)?|\.ssh|\.aws|\.kube|credentials)(\/|$)|\.(pem|key|p12|pfx)$/i.test(path);
async function blobSha(data,algorithm='SHA-1'){
 const header=new TextEncoder().encode('blob '+data.length+'\0'),input=new Uint8Array(header.length+data.length);input.set(header);input.set(data,header.length);
 return Array.from(new Uint8Array(await crypto.subtle.digest(algorithm,input)),byte=>byte.toString(16).padStart(2,'0')).join('');
}
class BrowserGit{
 constructor(store){this.store=store;}
 summary(pending){return {id:pending.id,state:pending.state,project:pending.project,baseRevision:pending.baseRevision,root:pending.root,rootNeedsReview:pending.rootNeedsReview,changes:pending.changes,options:pending.options||null,receipt:pending.receipt||null};}
 async prepare(project,metadata){
  const record=await this.store.open(project);if(record.gitPending)return this.summary(record.gitPending);
  if(metadata?.name!==project||!/^[a-f0-9]{64}$/.test(metadata.revision||''))throw Error('ابتدا وضعیت پروژه را از کنسول تازه کنید.');
  const exporting=metadata.sourceType!=='git';if(!exporting&&!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(record.baseRevision||''))throw Error('ابتدا «دریافت تغییرات Git» را بزنید تا مبنای کامیت همین مخزن مشخص شود.');
  const paths=[...new Set([...record.files.keys(),...exporting?[]:record.baseFiles.keys()])].filter(path=>exporting||!same(record.files.get(path),record.baseFiles.get(path))).sort();
  if(!paths.length)throw Error('تغییری برای ثبت در Git وجود ندارد.');
  if(paths.length>500)throw Error('در هر ثبت بتا حداکثر ۵۰۰ فایل قابل ارسال است؛ فعلاً از ZIP و افزونهٔ دسکتاپ استفاده کنید.');
  let bytes=0;const changes=[];
  for(const path of paths){const file=record.files.get(path),original=exporting?undefined:record.baseFiles.get(path);bytes+=file?.data.length||0;if(bytes>20*1024**2)throw Error('در هر ثبت بتا حداکثر ۲۰ مگابایت قابل ارسال است.');changes.push({path,status:!file?'deleted':!original?'added':'modified',size:file?.data.length||0,mode:mode(file||original),oldSha:original?await blobSha(original.data,record.baseRevision?.length===64?'SHA-256':'SHA-1'):null,sensitive:sensitive(path)});}
  const pending={id:crypto.randomUUID(),state:'review',project:{name:project,revision:metadata.revision,sourceType:metadata.sourceType,repository:metadata.repository,provider:metadata.provider,ref:metadata.ref,root:metadata.root||'',connectionId:metadata.connectionId,autoDeploy:metadata.autoDeploy},baseRevision:exporting?'':record.baseRevision,root:exporting?record.root||'':metadata.root||'',rootNeedsReview:exporting&&!!record.rootNeedsReview,files:new Map(record.files),changes};
  const saved=await this.store.update(project,next=>{if(next.gitPending)throw Error('بازبینی Git دیگری در انتظار است.');next.gitPending=pending;});return this.summary(saved.gitPending);
 }
 async payload(project,options){
  let record=await this.store.open(project),pending=record.gitPending;if(!pending)throw Error('ابتدا تغییرات Git را بازبینی کنید.');
  if(pending.state==='review'){
   if(!options||!Array.isArray(options.paths)||!options.paths.length)throw Error('حداقل یک فایل را برای ثبت انتخاب کنید.');
   const selected=new Set(options.paths);if(selected.size!==options.paths.length||options.paths.some(path=>!pending.changes.some(change=>change.path===path)))throw Error('فهرست تغییرات معتبر نیست.');
   if(pending.changes.some(change=>selected.has(change.path)&&change.sensitive)&&options.sensitiveAcknowledged!==true)throw Error('فایل حساس انتخاب شده است؛ محتوای آن را پیش از ارسال بررسی و تأیید کنید.');
   if(pending.project.sourceType!=='git'&&pending.rootNeedsReview&&options.rootAcknowledged!==true)throw Error('مسیر ساخت پروژهٔ بازیابی‌شده را بازبینی کنید.');
   if(typeof options.message!=='string'||!options.message.trim()||options.message.length>1000)throw Error('پیام کامیت را وارد کنید.');
   if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(options.connectionId||''))throw Error('اتصال Git خودتان را انتخاب کنید.');
   if(pending.project.sourceType!=='git'&&(typeof options.createRepository!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(options.createRepository)||/\.git$/i.test(options.createRepository)))throw Error('نام مخزن معتبر نیست؛ نام نباید با ‎.git تمام شود.');
   const root=String(options.root||'').trim().replaceAll('\\','/').replace(/^\.\//,'').replace(/\/$/,'');
   if(root.length>300||root.startsWith('/')||root&&root.split('/').some(part=>part==='.'||part==='..'||!/^[a-zA-Z0-9_.-]+$/.test(part)))throw Error('مسیر ساخت باید پوشه‌ای نسبی داخل مخزن باشد.');
   if(pending.project.autoDeploy&&options.autoDeployAcknowledged!==true)throw Error('احتمال ساخت خودکار با تعرفهٔ فعلی پروژه را پیش از Push تأیید کنید.');
   const frozen={connectionId:options.connectionId,message:options.message.trim(),paths:[...selected].sort(),root,autoDeployAcknowledged:options.autoDeployAcknowledged===true,...pending.project.sourceType!=='git'?{createRepository:options.createRepository}:{}};
   record=await this.store.update(project,next=>{if(next.gitPending?.id!==pending.id||next.gitPending.state!=='review')throw Error('بازبینی Git تغییر کرده است.');next.gitPending={...next.gitPending,state:'submitted',options:frozen};});pending=record.gitPending;
  }
  if(pending.state!=='submitted')throw Error('نتیجهٔ ثبت قبلی هنوز نیاز به دریافت سورس دارد.');
  const selected=new Set(pending.options.paths);
  return {id:pending.id,projectRevision:pending.project.revision,baseRevision:pending.baseRevision,...pending.options,paths:undefined,changes:pending.changes.filter(change=>selected.has(change.path)).map(change=>({path:change.path,oldSha:change.oldSha,mode:change.mode,content:pending.files.has(change.path)?encode(pending.files.get(change.path).data).bytesBase64:null}))};
 }
 async build(project){
  const record=await this.store.open(project);
  if(record.sourceType!=='git'||!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(record.baseRevision||''))throw Error('برای ساخت از ویرایشگر، ابتدا پروژه را در Git ثبت کنید.');
  if(record.gitPending)throw Error('ابتدا نتیجهٔ ثبت Git در انتظار را بررسی کنید؛ ساخت فقط از کامیت ثبت‌شده انجام می‌شود.');
  const uncommitted=[...new Set([...record.files.keys(),...record.baseFiles.keys()])].filter(path=>!sameGit(record.files.get(path),record.baseFiles.get(path))).length;
  return {revision:record.baseRevision,uncommitted};
 }
 async status(project){const record=await this.store.open(project);return record.gitPending?this.summary(record.gitPending):null;}
 async preview(project,path){
  const record=await this.store.open(project),pending=record.gitPending;if(!pending?.changes.some(change=>change.path===path))throw Error('فایل در این بازبینی نیست.');
  const original=pending.project.sourceType==='git'?record.baseFiles.get(path):undefined,reviewed=pending.files.get(path),limit=64*1024;
  const binary=[original,reviewed].some(file=>file?.data.subarray(0,limit).includes(0));
  return {binary,truncated:[original,reviewed].some(file=>(file?.data.length||0)>limit),before:binary?'':new TextDecoder().decode(original?.data.subarray(0,limit)||new Uint8Array()),after:binary?'':new TextDecoder().decode(reviewed?.data.subarray(0,limit)||new Uint8Array())};
 }
 async cancel(project){return this.store.update(project,next=>{if(next.gitPending?.state!=='review')throw Error('درخواست ارسال‌شده را نمی‌توان بدون بررسی نتیجه کنار گذاشت؛ فایل‌ها حفظ شده‌اند.');delete next.gitPending;});}
 async abandon(project,receipt,acknowledged){return this.store.update(project,next=>{if(!acknowledged||!next.gitPending||receipt?.id!==next.gitPending.id||!['failed','unknown'].includes(receipt.state))throw Error('ابتدا نتیجهٔ همین درخواست را در مخزن بررسی و کنارگذاشتن آن را تأیید کنید.');delete next.gitPending;});}
 async receipt(project,receipt){
  return this.store.update(project,next=>{if(!next.gitPending||next.gitPending.id!==receipt?.id||receipt.state!=='succeeded'||!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(receipt.sha))throw Error('رسید ثبت Git معتبر نیست.');next.gitPending={...next.gitPending,state:'succeeded',receipt};});
 }
 merge(next,remote,selected=new Set(),reviewedFiles=new Map()){
   const conflicts=[];
   const merged=new Map(next.files);
   for(const path of new Set([...next.baseFiles.keys(),...next.files.keys(),...remote.files.keys()])){
    const current=next.files.get(path),base=next.baseFiles.get(path),published=remote.files.get(path),reviewed=reviewedFiles.get(path);
    if(selected.has(path)){
     if(same(current,reviewed)||sameGit(current,published)){if(published)merged.set(path,published);else merged.delete(path);}
    }else if(same(current,base)||same(current,published)){if(published)merged.set(path,published);else merged.delete(path);}
    else if(!same(published,base))conflicts.push(path);
   }
   next.files=merged;next.baseFiles=remote.files;next.sourceType='git';next.rootNeedsReview=false;next.directories=[...new Set([...next.directories,...remote.directories])].filter(path=>!merged.has(path));return conflicts;
 }
 async finish(project,archive){
  const remote=readArchive(archive,{stripTop:true});let conflicts=[];
  const record=await this.store.update(project,next=>{
   const pending=next.gitPending;if(pending?.state!=='succeeded')throw Error('رسید ثبت Git هنوز تأیید نشده است.');const selected=new Set(pending.options.paths);
   for(const path of selected)if(!sameGit(remote.files.get(path),pending.files.get(path)))throw Error('فایل ثبت‌شده با بازبینی مطابقت ندارد؛ پیش‌نویس و رسید حفظ شدند.');
   if(pending.project.sourceType!=='git')next.baseFiles=new Map();
   conflicts=this.merge(next,remote,selected,pending.files);next.baseRevision=pending.receipt.sha;next.root=pending.options.root;delete next.gitPending;
  });
  return {conflicts,baseRevision:record.baseRevision};
 }
 async sync(project,archive,revision,root){
  if(!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(revision||''))throw Error('نسخهٔ دریافت‌شده از Git معتبر نیست.');const remote=readArchive(archive,{stripTop:true});let conflicts=[];
  await this.store.update(project,next=>{if(next.gitPending)throw Error('ابتدا نتیجهٔ ثبت در انتظار را بررسی کنید.');conflicts=this.merge(next,remote);next.baseRevision=revision;next.root=typeof root==='string'?root:next.root;});return {conflicts,baseRevision:revision};
 }
}
module.exports={BrowserGit,blobSha,sensitive};
