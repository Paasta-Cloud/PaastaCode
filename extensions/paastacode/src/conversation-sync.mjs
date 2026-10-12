import {createHash,randomUUID} from "node:crypto";

// All clients use this broker-owned queue. Tokens are captured for requests, never persisted.
export class ConversationSync {
  constructor({records,identity,build,request,persist,now=Date.now}){
    Object.assign(this,{records,identity,build,request,persist,now});this.queue=Promise.resolve();this.stopped=false;this.cursor=0;
  }
  binding(){const value=this.identity();if(!value)throw new Error("برای ذخیرهٔ گفتگو دوباره وارد حساب پاستا شوید.");return value;}
  guard(binding){const current=this.identity();if(!current||current.key!==binding.key||current.token!==binding.token)throw new Error("حساب تغییر کرده است؛ نسخهٔ محلی گفتگو حفظ شد.");}
  enqueue(work){const result=this.queue.then(work);this.queue=result.catch(()=>{});return result;}
  barrier(){return this.queue;}
  state(id){const binding=this.binding(),record=this.records[binding.key+":"+id];return {enabled:record?.enabled===true,paused:record?.paused===true,reason:record?.reason||null,lastSavedAt:record?.lastSavedAt||null,cloudId:record?.id||null,revision:record?.revision||0};}
  enable(id,enabled){const binding=this.binding();return this.enqueue(async()=>{
    this.guard(binding);const name=binding.key+":"+id;
    const record=this.records[name]||{id:randomUUID(),revision:0};
    record.enabled=enabled;
    if(record.reason!=="conflict"){record.paused=false;record.reason=null;record.retryAt=0;}
    this.records[name]=record;await this.persist();this.guard(binding);return this.state(id);
  });}
  save(id,{automatic=false,copy=false}={}){const binding=this.binding();return this.enqueue(async()=>{
    this.guard(binding);const name=binding.key+":"+id;
    let record=this.records[name];
    if(automatic&&(!record?.enabled||record.paused||record.retryAt>this.now()||this.stopped))return;
    if(record?.reason==="conflict"&&!copy){const error=new Error("نسخهٔ حساب تغییر کرده است. آن را بررسی کنید یا نسخهٔ مستقلی از متن محلی ذخیره کنید.");error.status=409;throw error;}
    let content;
    try{content=await this.build(id,{idleOnly:automatic});this.guard(binding);}
    catch(error){if(record&&automatic){record.reason="runtime";record.retryAt=this.now()+30000;await this.persist();}throw error;}
    if(!content){if(automatic)return;throw new Error("خواندن متن محلی هنوز ممکن نیست. چند لحظه بعد دوباره ذخیره کنید.");}
    const digest=createHash("sha256").update(JSON.stringify(content)).digest("hex");
    if(automatic&&record.lastDigest===digest)return;
    if(!record||copy){record={id:randomUUID(),revision:0,enabled:record?.enabled===true};this.records[name]=record;await this.persist();this.guard(binding);}
    try{
      const saved=await this.request("/api/paastacode/sessions",{method:"PUT",token:binding.token,body:{id:record.id,revision:record.revision,title:content.title,snapshot:content.snapshot}});
      this.guard(binding);
      if(saved.id!==record.id||!Number.isSafeInteger(saved.revision)||saved.revision<1)throw new Error("سرویس حساب ذخیرهٔ نسخه‌دار را تأیید نکرد؛ متن محلی حفظ شد.");
      const readback=await this.request("/api/paastacode/sessions?id="+saved.id,{token:binding.token});this.guard(binding);
      if(readback.revision!==saved.revision||JSON.stringify(readback.snapshot)!==JSON.stringify(content.snapshot))throw new Error("ذخیرهٔ حساب تأیید نشد؛ متن محلی حفظ شده است.");
      Object.assign(record,{id:saved.id,revision:saved.revision,lastDigest:digest,lastSavedAt:this.now(),paused:false,reason:null,retryAt:0});
      await this.persist();return {...saved,snapshot:content.snapshot};
    }catch(error){
      // Keep the previous ID/revision after ambiguous delivery: an identical retry is idempotent.
      record.reason=error.status===409?"conflict":[401,403].includes(error.status)?"authorization":[400,413,422].includes(error.status)?"content":"network";
      record.paused=record.reason!=="network";record.retryAt=this.now()+30000;
      await this.persist();throw error;
    }
  });}
  async tick(){
    if(this.ticking||this.stopped||!this.identity())return;
    this.ticking=true;
    try{
      const binding=this.binding(),prefix=binding.key+":";
      const ids=Object.entries(this.records).filter(([name,record])=>name.startsWith(prefix)&&/^ses_[A-Za-z0-9]+$/.test(name.slice(prefix.length))&&record.enabled&&!record.paused).map(([name])=>name.slice(prefix.length));
      const batch=ids.slice(this.cursor,this.cursor+10);this.cursor=this.cursor+10>=ids.length?0:this.cursor+10;
      for(const id of batch){if(this.stopped)break;this.guard(binding);try{await this.save(id,{automatic:true});}catch{/* Status remains visible; no overwrite or automatic conflict resolution. */}}
    }finally{this.ticking=false;}
  }
  start(){if(!this.timer){this.timer=setInterval(()=>this.tick().catch(()=>{}),10000);this.timer.unref();}}
  async stop(){this.stopped=true;clearInterval(this.timer);await this.barrier();}
}
