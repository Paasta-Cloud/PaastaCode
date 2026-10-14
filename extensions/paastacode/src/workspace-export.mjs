import {spawn} from "node:child_process";
import {PassThrough} from 'node:stream';
import {createHash,randomBytes} from "node:crypto";
import {cliPath} from "./deployment.mjs";

const failed=()=>new Error("خروجی پروژه کامل نشد. پس از پایان تغییر فایل‌ها دوباره تلاش کنید.");
export class WorkspaceExport {
  constructor({workspace,privateRoot,command=cliPath,spawnChild=spawn,idleMs=120000,chunkSize=1048576}={}){
    this.workspace=workspace;this.privateRoot=privateRoot;this.command=command;this.spawnChild=spawnChild;this.idleMs=idleMs;this.chunkSize=chunkSize;this.job=null;
  }
  get busy(){return !!this.job&&!this.job.done;}
  touch(job){clearTimeout(job.timer);job.timer=setTimeout(()=>{if(this.job===job)this.close();},this.idleMs);job.timer.unref();}
  start(owner){
    if(!owner)throw new Error("ورود با حساب پاستا لازم است.");
    if(this.busy)throw new Error("یک خروجی در حال دریافت است؛ ابتدا آن را تمام یا لغو کنید.");
    this.close();
    const args=["workspace-export",this.workspace,...(this.privateRoot?["--private-root",this.privateRoot]:[])];
    const child=this.spawnChild(this.command(),args,{windowsHide:true,stdio:["ignore","pipe","pipe"],env:{...process.env,NO_COLOR:"1",PAASTA_RUNTIME_TOKEN:"",PAASTA_RUNTIME_SERVER:""}});
    // Capture immediately: ChildProcess drains unread stdout when a fast child exits.
    const output=new PassThrough({highWaterMark:this.chunkSize});child.stdout.pipe(output);
    const finished=new Promise(resolve=>{child.once("error",()=>{output.destroy();resolve(false);});child.once("close",code=>resolve(code===0));});
    child.stderr.resume();
    const job={id:randomBytes(24).toString("base64url"),owner,child,output,finished,reader:output[Symbol.asyncIterator](),offset:0,tail:Buffer.alloc(0),done:false,last:null,pending:null};
    this.job=job;this.touch(job);
    return {id:job.id,name:"PaastaCode-project.zip",chunkBytes:this.chunkSize};
  }
  owned(id,owner){
    const job=this.job;
    if(!job||id!==job.id||owner!==job.owner)throw new Error("این خروجی در دسترس نیست؛ دوباره درخواست خروجی بدهید.");
    return job;
  }
  async read(id,owner,offset){
    const job=this.owned(id,owner);
    if(!Number.isSafeInteger(offset)||offset<0)throw new Error("موقعیت دریافت معتبر نیست.");
    if(job.pending){await job.pending;return this.read(id,owner,offset);}
    if(job.last?.offset===offset){this.touch(job);return job.last;}
    if(offset!==job.offset||job.done)throw new Error("ترتیب دریافت خروجی معتبر نیست.");
    this.touch(job);
    const pending=(async()=>{
      try{
        const chunks=[];let bytes=0,ended=false;
        while(bytes<this.chunkSize){
          if(!job.tail.length){const next=await job.reader.next();if(next.done){ended=true;break;}job.tail=Buffer.from(next.value);}
          const take=Math.min(this.chunkSize-bytes,job.tail.length);chunks.push(job.tail.subarray(0,take));job.tail=job.tail.subarray(take);bytes+=take;
        }
        if(ended&&!await job.finished)throw failed();
        if(ended&&!job.offset&&!bytes)throw failed();
        if(this.job!==job)throw failed();
        const data=Buffer.concat(chunks,bytes);
        job.done=ended;job.offset+=bytes;
        job.last={offset,nextOffset:job.offset,done:ended,data:data.toString("base64"),sha256:createHash("sha256").update(data).digest("hex")};
        this.touch(job);return job.last;
      }catch{if(this.job===job)this.close();throw failed();}
    })();
    job.pending=pending;
    try{return await pending;}finally{if(job.pending===pending)job.pending=null;}
  }
  cancel(id,owner){this.owned(id,owner);this.close();return {ok:true};}
  close(){
    const job=this.job;if(!job)return;this.job=null;clearTimeout(job.timer);
    job.child.kill();job.output.destroy();job.child.stdout.destroy();job.child.stderr.destroy();
  }
}
