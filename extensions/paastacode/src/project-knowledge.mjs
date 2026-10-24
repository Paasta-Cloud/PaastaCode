import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,rename,rm,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {stateHome} from './account.mjs';
import {workspaceKey} from './runtime.mjs';

const queues=new Map(),limit=16*1024;
const digest=text=>createHash('sha256').update(text).digest('hex');
export class ProjectKnowledge {
  constructor(workspace,identity,home=stateHome){
    this.directory=join(home,'knowledge',workspaceKey(workspace),digest(identity));
    this.path=join(this.directory,'PROJECT.md');
  }
  async read(){
    let content='';
    try{
      const info=await lstat(this.path);
      if(!info.isFile()||info.isSymbolicLink()||info.size>limit)throw new Error('فایل دانش پروژه معتبر نیست.');
      const file=await open(this.path,'r');
      try{const bytes=Buffer.alloc(limit+1),{bytesRead}=await file.read(bytes,0,bytes.length,0);if(bytesRead>limit)throw new Error('دانش پروژه بیش از حد طولانی است.');content=bytes.subarray(0,bytesRead).toString('utf8');}finally{await file.close();}
    }catch(error){if(error.code!=='ENOENT')throw error;}
    return {content,revision:digest(content),limit};
  }
  async instruction(){
    await mkdir(this.directory,{recursive:true,mode:0o700});
    try{const file=await open(this.path,'wx',0o600);await file.close();}catch(error){if(error.code!=='EEXIST')throw error;}
    await this.read();return this.path;
  }
  save(input){
    const previous=queues.get(this.path)||Promise.resolve();
    const result=previous.then(async()=>{
      if(typeof input?.content!=='string'||Buffer.byteLength(input.content)>limit||input.content.includes('\0'))throw new Error('متن دانش پروژه معتبر نیست؛ حداکثر ۱۶ کیلوبایت بنویسید.');
      const current=await this.read();
      if(input.revision!==current.revision)throw new Error('دانش پروژه در پنجرهٔ دیگری تغییر کرده است. متن خود را نگه دارید و نسخهٔ تازه را دریافت کنید.');
      await mkdir(this.directory,{recursive:true,mode:0o700});
      const temp=join(this.directory,randomUUID()+'.tmp');
      try{const file=await open(temp,'wx',0o600);try{await file.writeFile(input.content,'utf8');}finally{await file.close();}await rename(temp,this.path);}finally{await rm(temp,{force:true});}
      return this.read();
    });
    const settled=result.catch(()=>{});queues.set(this.path,settled);settled.finally(()=>{if(queues.get(this.path)===settled)queues.delete(this.path);});return result;
  }
}
