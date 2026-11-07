const wire=require('./wire.cjs');
const {BrowserAgent}=require('./agent.cjs');
const hash=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
class HostedAgent {
 constructor(service,request){this.service=service;this.store=service.store;this.request=request;this.runs=new Map();this.active=null;this.initialized=new Set();this.serial=Promise.resolve();this.locked=false;this.cached=new Map();this.reads=new Map();this.source=null;}
 async remote(project,operation){
  if(this.locked)throw Error('نشست محیط پایان یافته است.');
  const value=await this.request(project,operation),key=project+':'+operation.request?.path;
  if(value?.__paastaSleeping){
   if(operation.request?.path?.split('?')[0]==='poll'){const previous=this.cached.get(key)?.value;return [previous?.[0]||[],{},[],previous?.[3]||{}];}
   if(operation.request?.path==='status')return {};
   if(operation.request?.path==='permissions')return [];
   const previous=this.cached.get(key)?.value;
   if(previous!==undefined)return operation.request.path==='state'?{...previous,engineSleeping:true}:previous;
   if(operation.request?.path==='sessions')return [];
   throw Error('موتور در حالت خواب است؛ با ارسال پیام دوباره شروع می‌شود.');
  }
  if(operation.action==='route'&&operation.request?.method==='GET'){
   const size=new TextEncoder().encode(JSON.stringify(value)).length;
   if(size<=1024*1024){this.cached.delete(key);this.cached.set(key,{value,size});while(this.cached.size>32||[...this.cached.values()].reduce((sum,item)=>sum+item.size,0)>8*1024*1024)this.cached.delete(this.cached.keys().next().value);}
  }
  return value;
 }
 async recover(project,record,snapshot){
  if(record.sharedRuntimeRevision===snapshot.sourceRevision)return record;
  const matches=async current=>{
   if(current.files.size!==Object.keys(snapshot.base).length)return false;
   for(const [name,file] of current.files)if(await hash(file.data)!==snapshot.base[name])return false;
   return true;
  };
  if(!await matches(record))throw Error('نسخهٔ محیط مشترک با پیش‌نویس این مرورگر فرق دارد؛ هر دو نسخه حفظ شدند. پیش از ادامه خروجی بگیرید.');
  await this.store.update(project,async next=>{if(!await matches(next))throw Error('فایل هنگام بازیابی اتصال تغییر کرد؛ هر دو نسخه حفظ شدند.');next.sharedRuntimeRevision=snapshot.sourceRevision;});
  return this.store.open(project);
 }
 async synchronize(project,previousSnapshot){
  await this.remote(project,{action:'flush'});
  const snapshot=previousSnapshot||await this.snapshot(project),remote=new Map(snapshot.files.map(file=>[file.path,{...file,data:typeof file.data==='string'?wire.decode({bytesBase64:file.data}):undefined}]));let changed=false;
  const record=await this.recover(project,await this.store.open(project),snapshot),names=new Set([...Object.keys(snapshot.base),...remote.keys()]);
  const updates=[];
  for(const name of names){
   const file=remote.get(name),before=snapshot.base[name]||null;
   if((file?.hash||null)===before)continue;
   if(file&&!file.data)throw Error('فایل هنگام دریافت تغییر کرد؛ بدون بازنویسی دوباره تلاش کنید.');
   const local=record.files.get(name),current=local?await hash(local.data):null;
   if(current!==(file?.hash||null)&&current!==before)throw Error('فایل «'+name+'» هم در مرورگر و هم در موتور تغییر کرده است؛ هر دو نسخه حفظ شدند. پیش از ادامه خروجی بگیرید.');
   updates.push([name,file,current]);
  }
  if(updates.length){await this.store.update(project,async next=>{
   for(const [name,file,expected] of updates){const local=next.files.get(name),current=local?await hash(local.data):null;if(current!==expected)throw Error('فایل هنگام دریافت نتیجه تغییر کرد؛ نسخهٔ مرورگر حفظ شد.');if(file)next.files.set(name,{data:file.data,mode:file.mode});else next.files.delete(name);}changed=true;
  });}
  const accepted=await this.remote(project,{action:'accept',revision:snapshot.revision,expectedRevision:snapshot.sourceRevision});
  if(accepted.revision!==record.sharedRuntimeRevision)await this.store.update(project,next=>{next.sharedRuntimeRevision=accepted.revision;});
  this.source={project,revision:accepted.revision,patch:snapshot.partialSource===true,files:Object.fromEntries([...remote].map(([name,file])=>[name,file.hash]))};
  if(changed)this.request.changed?.(project);
 }
 async snapshot(project,manifest){
  const current=manifest||await this.remote(project,{action:'manifest'});
  if(current.base&&Array.isArray(current.files)&&current.workspaceRevision){
   const paths=current.files.filter(file=>file.hash!==current.base[file.path]).map(file=>file.path);
   if(paths.length)return this.remote(project,{action:'snapshot',paths});
   return {base:current.base,files:current.files,sourceRevision:current.revision,revision:current.workspaceRevision,partialSource:current.partialSource===true};
  }
  return this.remote(project,{action:'snapshot'});
 }
 async upload(project){
  await this.remote(project,{action:'flush'});
  const record=await this.store.open(project);let size=0;
  if(record.files.size>5000)throw Error('تعداد فایل‌های پروژه برای اجرای مشترک بیش از حد مجاز است.');
  // An old worker treats omitted files as removals, so negotiate patches.
  const baseline=this.source?.patch&&this.source.project===project&&this.source.revision===record.sharedRuntimeRevision?this.source.files:null,files=[];
  for(const [path,file] of record.files){size+=file.data.length;if(size>16*1024*1024)throw Error('سقف انتقال اجرای مشترک فعلاً ۱۶ مگابایت است؛ پروژهٔ مرورگری محفوظ می‌ماند.');if(!baseline||baseline[path]!==await hash(file.data))files.push({path,mode:file.mode,data:wire.encode(file.data).bytesBase64});}
  const removed=baseline?Object.keys(baseline).filter(name=>!record.files.has(name)):[];
  if(baseline&&!files.length&&!removed.length){this.initialized.add(project);return;}
  const result=await this.remote(project,{action:'sync',files,...baseline?{patch:true,removed}:{},expectedRevision:record.sharedRuntimeRevision||null});
  await this.store.update(project,next=>{next.sharedRuntimeRevision=result.revision;});this.initialized.add(project);
 }
 async select(project){
  if(this.active&&this.active!==project){
   const status=await this.remote(this.active,{action:'route',request:{method:'GET',path:'status'}});
   if(Object.values(status).some(item=>item.type!=='idle'))throw Error('ابتدا اجرای پاستاکد در پروژهٔ قبلی را متوقف کنید.');
   await this.synchronize(this.active);await this.remote(this.active,{action:'stop'});this.initialized.delete(this.active);this.runs.delete(this.active);
  }
  this.active=project;
  if(!this.initialized.has(project)){
   let record=await this.store.open(project);const manifest=await this.remote(project,{action:'manifest'});
   if(manifest.revision){
    if(record.sharedRuntimeRevision!==manifest.revision){
     if(manifest.busy)throw Error('نسخهٔ محیط مشترک با این مرورگر فرق دارد؛ نسخهٔ قبلی حفظ شد. برای ادامه از مرورگر قبلی استفاده کنید.');
     // A completed import may lose its acknowledgement during reload. Adopt
     // only an exactly matching source base; never replace different drafts.
     const snapshot=await this.snapshot(project,manifest);record=await this.recover(project,record,snapshot);
     await this.synchronize(project,snapshot);
    }else{
     if(manifest.busy){this.initialized.add(project);this.runs.set(project,{seenBusy:true});return;}
     await this.synchronize(project,await this.snapshot(project,manifest));
    }
   }
   await this.upload(project);
  }
 }
 invoke(project,request){
  const key=request.method==='GET'?project+':'+request.path:null;
  if(key&&this.reads.has(key))return this.reads.get(key);
  const work=this.serial.catch(()=>{}).then(()=>this.perform(project,request));this.serial=work;
  if(key){this.reads.set(key,work);const clear=()=>{if(this.reads.get(key)===work)this.reads.delete(key);};work.then(clear,clear);}
  return work;
 }
 async perform(project,request){
  const preview=()=>new BrowserAgent(this.service,async()=>{throw Error('Hosted engine is required');}).state(project);
  if(request.path==='state'&&!this.store.cache.has(project)){
   // Restored editors can render cached Monaco models before any filesystem read.
   // Open persisted source before deciding whether this project has source files.
   try{await this.store.open(project);}catch(error){if(!error.message?.startsWith('[FileNotFound]'))throw error;}
  }
  if(request.path==='state'&&(!this.store.cache.has(project)||!this.service.catalog.codingReady))return {...await preview(),engine:'shared-paastacode'};
  if(this.locked)throw Error('نشست محیط پایان یافته است.');
  if(request.path==='abort'){const result=await this.remote(project,{action:'route',request});const run=this.runs.get(project);if(run)run.aborted=true;return result;}
  if(request.path==='git'&&request.method==='GET')return {files:await this.store.changes(project)};
  await this.select(project);
  let nextRun;
  if(request.path==='prompt'){
   if(this.runs.has(project))throw Error('درخواست قبلی هنوز تمام نشده است؛ ابتدا نتیجه را بررسی یا آن را متوقف کنید.');
   await this.synchronize(project);await this.upload(project);
   const previous=await this.remote(project,{action:'route',request:{method:'GET',path:'messages?id='+encodeURIComponent(request.body.id)}});
   nextRun={id:request.body.id,previous:new Set(previous.filter(message=>message.info?.role==='assistant').map(message=>message.info.id)),seenBusy:false};
   const background=this.cached.get(project+':state')?.value.defaultModel;
   if(background)request={...request,body:{...request.body,backgroundModel:background}};
  }
  const result=await this.remote(project,{action:'route',request});
  if(nextRun)this.runs.set(project,nextRun);
  if(['status','poll'].includes(request.path.split('?')[0])&&this.runs.has(project)){
   const run=this.runs.get(project),active=Object.values(request.path.startsWith('poll')?result[1]:result).some(item=>item.type!=='idle');
   if(active)run.seenBusy=true;
   else{
    let complete=run.aborted||!run.id&&run.seenBusy;
    if(run.id&&!complete){
     const messages=request.path==='poll?id='+run.id?result[0]:await this.remote(project,{action:'route',request:{method:'GET',path:'messages?id='+encodeURIComponent(run.id)}});
     const latest=messages.filter(message=>message.info?.role==='assistant').at(-1);
     complete=!!latest&&!run.previous.has(latest.info.id)&&!!latest.info.time?.completed&&latest.info.finish!=='tool-calls';
    }
    if(complete)try{await this.synchronize(project);this.runs.delete(project);}catch(error){if(error.message!=='ابتدا اجرای فعال و درخواست‌های دسترسی را تمام یا متوقف کنید.')throw error;}
   }
   if(this.runs.has(project)&&run.id){const status=request.path.startsWith('poll')?result[1]:result;if(!status[run.id]||status[run.id].type==='idle')status[run.id]={type:'busy'};}
  }
  if(request.path==='state')return {...result,workflowModels:{...result.workflowModels,planModel:''},workspace:project,workspaceId:project,engine:'shared-paastacode',features:{...result.features,separatePlanning:true,managedLogin:true,backgroundSync:false,deviceManagement:false,projectImport:false,independentRuntime:false}};
  if(request.path==='permission')return {result,applied:false};
  return result;
 }
 lock(){this.locked=true;this.runs.clear();this.cached.clear();this.source=null;}
 unlock(){this.locked=false;}
}
module.exports={HostedAgent};
