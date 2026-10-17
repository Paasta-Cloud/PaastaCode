import {mkdir,lstat,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {readPrivate,writePrivate} from '../src/account.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const validProject=value=>value==='default'||typeof value==='string'&&uuid.test(value);
export class CloudProjectError extends Error{
  constructor(message,status=409,projectChanged=false){super(message);this.status=status;this.projectChanged=projectChanged;}
}
function projectName(value){
  if(typeof value!=='string'||!value.trim()||value.trim().length>80||/[\x00-\x1f\x7f]/.test(value))throw new CloudProjectError('نام پروژه باید بین ۱ تا ۸۰ نویسه باشد.',400);
  return value.trim();
}
export class CloudProjects{
  constructor({root,createBroker}){this.root=resolve(root);this.file=join(this.root,'account','cloud-projects.json');this.createBroker=createBroker;this.broker=null;this.pending=Promise.resolve();this.requests=new Set();this.switching=false;this.closed=false;}
  async directory(id){
    if(!validProject(id))throw new CloudProjectError('پروژه پیدا نشد.',404);
    const parts=id==='default'?['workspace']:['projects',id];let directory=this.root;
    for(const part of parts){directory=join(directory,part);await mkdir(directory,{recursive:true,mode:0o700});const stat=await lstat(directory);if(stat.isSymbolicLink()||!stat.isDirectory()||await realpath(directory)!==directory)throw new CloudProjectError('پوشهٔ پروژه قابل بازکردن نیست. فایل‌ها حفظ شده‌اند.',409);}
    return directory;
  }
  async start(){
    this.root=await realpath(this.root);this.file=join(this.root,'account','cloud-projects.json');
    const saved=await readPrivate(this.file);
    if(saved){
      if(saved.version!==1||!Array.isArray(saved.projects)||!saved.projects.length||saved.projects.length>32||!validProject(saved.active)||new Set(saved.projects.map(p=>p.id)).size!==saved.projects.length||!saved.projects.some(p=>p.id==='default')||!saved.projects.some(p=>p.id===saved.active))throw new Error('Invalid saved cloud project catalogue');
      for(const project of saved.projects){if(!validProject(project.id)||projectName(project.name)!==project.name)throw new Error('Invalid saved cloud project');}
      this.state={version:1,active:saved.active,projects:saved.projects.map(({id,name})=>({id,name}))};
    }else{this.state={version:1,active:'default',projects:[{id:'default',name:'پروژهٔ اصلی'}]};await writePrivate(this.file,this.state);}
    this.broker=await this.createBroker(await this.directory(this.state.active));return this;
  }
  list(){return {projects:this.state.projects.map(p=>({...p})),activeProject:this.state.active,switching:this.switching};}
  mutate(work){const result=this.pending.then(()=>{if(this.closed)throw new CloudProjectError('فضای کار در حال بسته‌شدن است.');return work();});this.pending=result.catch(()=>{});return result;}
  create(input){return this.mutate(async()=>{
    if(!uuid.test(input?.id||''))throw new CloudProjectError('شناسهٔ پروژه معتبر نیست.',400);
    const name=projectName(input.name),existing=this.state.projects.find(p=>p.id===input.id);
    if(existing){if(existing.name!==name)throw new CloudProjectError('این درخواست قبلاً با نام دیگری ثبت شده است.');return this.list();}
    if(this.state.projects.length>=32)throw new CloudProjectError('این فضای کار به سقف ۳۲ پروژه رسیده است.');
    await this.directory(input.id);
    const next={...this.state,projects:[...this.state.projects,{id:input.id,name}]};await writePrivate(this.file,next);this.state=next;return this.list();
  });}
  select(id){return this.mutate(async()=>{
    if(!validProject(id)||!this.state.projects.some(p=>p.id===id))throw new CloudProjectError('پروژه پیدا نشد.',404);
    if(id===this.state.active&&this.broker)return this.list();
    this.switching=true;const previous=this.state.active;
    try{
      // Drain accepted requests before checking the engine; stale tabs cannot switch it back.
      await Promise.allSettled([...this.requests]);
      const directory=await this.directory(id);
      if(this.broker){
        const response=await fetch(this.broker.url+'/api/update/prepare',{method:'POST',headers:{Authorization:'Bearer '+this.broker.capability},signal:AbortSignal.timeout(25000)});
        if(!response.ok)throw new CloudProjectError('پروژهٔ فعلی هنوز در حال کار است. اجرا را تمام یا متوقف کنید و دوباره پروژه را باز کنید.');
        await this.broker.close();this.broker=null;
      }
      try{
        this.broker=await this.createBroker(directory);
        const next={...this.state,active:id};await writePrivate(this.file,next);this.state=next;
      }catch(error){
        await this.broker?.close();this.broker=null;
        try{this.broker=await this.createBroker(await this.directory(previous));}catch{}
        throw error;
      }
      return this.list();
    }finally{this.switching=false;}
  });}
  use(id,work){
    if(this.closed||this.switching)throw new CloudProjectError('پروژه در حال جابه‌جایی است؛ چند لحظه بعد دوباره تلاش کنید.');
    if(!validProject(id)||id!==this.state.active)throw new CloudProjectError('پروژهٔ دیگری در این فضای کار انتخاب شده است. پروژهٔ موردنظر را دوباره باز کنید.',409,true);
    if(!this.broker)throw new CloudProjectError('اجرای پروژه آماده نیست. پروژه را دوباره باز کنید.');
    const request=Promise.resolve().then(()=>work(this.broker));this.requests.add(request);request.finally(()=>this.requests.delete(request)).catch(()=>{});return request;
  }
  async close(){this.closed=true;await this.pending;await Promise.allSettled([...this.requests]);await this.broker?.close();this.broker=null;}
}
