const {WorkspaceStore}=require('./workspace-store.cjs');
const {filePath}=require('./archive.cjs');
const {BrowserAgent}=require('./agent.cjs');
const {HostedAgent}=require('./hosted-agent.cjs');
const {BrowserGit}=require('./git.cjs');
const methods=new Set(['coding','catalog','stat','list','read','write','mkdir','remove','rename','changes','export','import','agent','git']);

class WorkspaceService {
 constructor(catalog,loader,requestModel=async()=>{throw Error('اتصال مدل برقرار نیست.');},onReady=()=>{},requestRuntime){
  this.catalog=catalog;this.projects=new Map(catalog.projects.map(project=>[project.name,project]));
  this.store=new WorkspaceStore(catalog.accountKey,project=>{
   if(this.projects.get(project)?.sourceAvailable===false)throw Error('[FileNotFound] سورس این پروژه موجود نیست؛ ZIP سورس اصلی را وارد کنید.');
   return loader(project);
  });
  this.agent=catalog.runtime==='shared'?new HostedAgent(this,requestRuntime):new BrowserAgent(this,requestModel);
  this.git=new BrowserGit(this.store);
  this.ready=new Set();this.onReady=onReady;
 }
 location(value){
  if(typeof value!=='string'||value.length>4096)throw Error('مسیر معتبر نیست.');
  if(value==='/projects')return {project:null,path:''};
  if(!value.startsWith('/projects/'))throw Error('مسیر بیرون از پروژه مجاز نیست.');
  const [project,...parts]=value.slice(10).split('/');
  if(!this.projects.has(project))throw Error('[FileNotFound] پروژه در دسترس نیست.');
  const path=parts.join('/');if(path)filePath(path);
  return {project,path};
 }
 async invoke(method,args={}){
  if(!methods.has(method))throw Error('عملیات مجاز نیست.');
  if(method==='catalog')return this.catalog;
  if(method==='coding'){if(args.accountKey!==this.catalog.accountKey)throw Error('حساب محیط تغییر کرده است.');if(this.agent.runs.size)throw Error('ابتدا درخواست پاستاکد را تمام یا متوقف کنید.');if(args.check)return true;this.catalog={...this.catalog,models:args.models,codingReady:args.codingReady,codingConnectionId:args.codingConnectionId,codingMode:args.codingMode,codingRevision:args.codingRevision};return true;}
  const {project,path}=this.location(args.path);
  if(method==='git'){
   if(!project||path)throw Error('پروژهٔ Git معتبر نیست.');
   const request=args.request||{};
   if(request.action==='build')return this.git.build(project);
   if(request.action==='prepare')return this.git.prepare(project,request.metadata);
   if(request.action==='payload')return this.git.payload(project,request.options);
   if(request.action==='status')return this.git.status(project);
   if(request.action==='preview')return this.git.preview(project,request.file);
   if(request.action==='cancel'){await this.git.cancel(project);return true;}
   if(request.action==='abandon'){await this.git.abandon(project,request.receipt,request.acknowledged===true);return true;}
   if(request.action==='receipt'){await this.git.receipt(project,request.receipt);return true;}
   if(request.action==='finish')return this.git.finish(project,request.archive);
   if(request.action==='sync')return this.git.sync(project,request.archive,request.revision,request.root);
   throw Error('عملیات Git مجاز نیست.');
  }
  if(!project){
   if(method==='stat')return {type:2,ctime:0,mtime:0,size:0};
   if(method==='list')return [...this.projects.keys()].map(name=>[name,2]);
   throw Error('ابتدا یک پروژه را انتخاب کنید.');
  }
  if(method==='stat'&&!path)return {type:2,ctime:0,mtime:0,size:0};
  if(method==='agent'){if(path)throw Error('پروژهٔ پاستاکد معتبر نیست.');return this.agent.invoke(project,args.request);}
  if(method==='import'){
   if(path||!(args.archive instanceof Uint8Array))throw Error('فایل ZIP پروژه معتبر نیست.');
   await this.store.imported(project,args.archive,{allowEmpty:!this.projects.get(project).sourceAvailable});return null;
  }
  const record=await this.store.open(project);
  if(!this.ready.has(project)){this.ready.add(project);this.onReady(project);}
  if(method==='changes')return this.store.changes(project);
  if(method==='export')return this.store.export(project);
  if(method==='read')return this.store.read(project,path,args.original===true);
  if(method==='write'){
   if(!(args.data instanceof Uint8Array))throw Error('محتوای فایل معتبر نیست.');
   await this.store.write(project,path,args.data,{create:args.create===true,overwrite:args.overwrite===true});return null;
  }
  if(method==='mkdir'){await this.store.mkdir(project,path);return null;}
  if(method==='remove'){await this.store.remove(project,path,args.recursive===true);return null;}
  if(method==='rename'){
   const destination=this.location(args.destination);
   if(destination.project!==project||!destination.path)throw Error('انتقال فایل بین پروژه‌ها مجاز نیست.');
   await this.store.rename(project,path,destination.path,args.overwrite===true);return null;
  }
  if(method==='stat'){
   const file=(args.original===true?record.baseFiles:record.files).get(path);
   if(file)return {type:1,ctime:record.createdAt,mtime:record.fileTimes.get(path)||record.createdAt,size:file.data.length};
   if(this.directory(record,path))return {type:2,ctime:record.createdAt,mtime:record.createdAt,size:0};
   throw Error('[FileNotFound] فایل یا پوشه پیدا نشد.');
  }
  if(method==='list'){
   if(!this.directory(record,path))throw Error('پوشه پیدا نشد.');
   const prefix=path?path+'/':'',entries=new Map(),directories=new Set(record.directories);
   for(const name of [...record.directories,...record.files.keys()]){
    if(!name.startsWith(prefix))continue;const relative=name.slice(prefix.length);if(!relative)continue;
    const [child,...rest]=relative.split('/');entries.set(child,rest.length||directories.has(name)?2:1);
   }
   return [...entries].sort((a,b)=>a[0].localeCompare(b[0]));
  }
 }
 directory(record,path){return !path||record.directories.includes(path)||[...record.files.keys(),...record.directories].some(name=>name.startsWith(path+'/'));}
}
module.exports={WorkspaceService,methods};
