import test from "node:test";
import assert from "node:assert/strict";
import {ConversationSync} from "../src/conversation-sync.mjs";

function fixture(){
  let binding={key:"https://paasta.test:tenant:user",token:"synthetic-private-token"},clock=10000,busy=false,loseRead=false;
  const records={},cloud=new Map(),calls=[];
  let content={title:"گفتگوی آزمایشی",snapshot:{version:1,messages:[{role:"user",text:"متن محلی"}]}};
  const service=new ConversationSync({records,identity:()=>binding,build:async()=>busy?null:structuredClone(content),persist:async()=>{},now:()=>clock,
    request:async(path,options={})=>{
      calls.push({path,...options});assert.equal(options.token,"synthetic-private-token");
      if(options.method==="PUT"){
        const body=options.body,previous=cloud.get(body.id),serialized=JSON.stringify(body);
        if(previous?.request===serialized)return {id:body.id,revision:previous.revision};
        if((previous?.revision||0)!==body.revision)throw Object.assign(new Error("conflict"),{status:409});
        cloud.set(body.id,{...structuredClone(body),revision:body.revision+1,request:serialized});return {id:body.id,revision:body.revision+1};
      }
      if(loseRead){loseRead=false;throw new Error("synthetic network failure after accepted write");}
      return cloud.get(path.split("?id=")[1]);
    }});
  return {service,records,cloud,calls,setBinding:value=>binding=value,change:text=>content.snapshot.messages[0].text=text,busy:value=>busy=value,loseRead:()=>loseRead=true,advance:()=>clock+=30001};
}
const id="ses_syncSynthetic";
test("background upload needs explicit opt-in and idle runtime; unchanged text has no extra writes",async()=>{
  const f=fixture();await f.service.tick();assert.equal(f.calls.length,0);
  await f.service.enable(id,true);f.busy(true);await f.service.tick();assert.equal(f.calls.length,0);
  f.busy(false);await f.service.tick();assert.equal(f.calls.length,2);assert.equal(f.service.state(id).revision,1);
  await f.service.tick();assert.equal(f.calls.length,2);
  f.change("متن تازه");await f.service.tick();assert.equal(f.service.state(id).revision,2);
  await f.service.enable(id,false);f.change("فقط روی دستگاه");await f.service.tick();assert.equal(f.calls.length,4);
  assert(!JSON.stringify(f.records).includes("synthetic-private-token"));
});
test("simultaneous manual uploads are serialized and a lost acknowledgement retries the same ID",async()=>{
  const f=fixture();await Promise.all([f.service.save(id),f.service.save(id)]);assert.equal(f.cloud.size,1);assert.equal(f.service.state(id).revision,2);
  await f.service.enable(id,true);f.change("درخواست پذیرفته‌شده");f.loseRead();await f.service.tick();
  assert.equal(f.service.state(id).reason,"network");assert.equal(f.service.state(id).revision,2);const writes=f.calls.filter(c=>c.method==="PUT").length;
  await f.service.tick();assert.equal(f.calls.filter(c=>c.method==="PUT").length,writes);
  f.advance();await f.service.tick();assert.equal(f.service.state(id).revision,3);assert.equal(f.cloud.size,1);
});
test("external edits and deletions pause sync; a reviewed independent copy preserves both versions",async()=>{
  const f=fixture();await f.service.enable(id,true);await f.service.tick();const oldId=f.service.state(id).cloudId;
  f.cloud.get(oldId).revision=2;f.cloud.get(oldId).snapshot.messages[0].text="متن دستگاه دیگر";f.change("متن این دستگاه");
  await f.service.tick();assert.equal(f.service.state(id).paused,true);assert.equal(f.service.state(id).reason,"conflict");const count=f.calls.length;
  await f.service.tick();await assert.rejects(f.service.save(id),error=>error.status===409);assert.equal(f.calls.length,count);
  await f.service.enable(id,true);assert.equal(f.service.state(id).paused,true,"turning opt-in on must not consent to overwrite a conflict");
  await f.service.save(id,{copy:true});assert.notEqual(f.service.state(id).cloudId,oldId);assert.equal(f.cloud.get(oldId).snapshot.messages[0].text,"متن دستگاه دیگر");assert.equal(f.cloud.size,2);
  f.cloud.delete(f.service.state(id).cloudId);f.change("پس از حذف نسخهٔ حساب");await f.service.tick();assert.equal(f.service.state(id).reason,"conflict");assert.equal(f.cloud.size,1,"remote deletion must never resurrect automatically");
});
test("account switches reject queued work and work already building a snapshot",async()=>{
  const f=fixture();const pending=f.service.save(id);f.setBinding({key:"https://paasta.test:other:user",token:"other-private-token"});await assert.rejects(pending);assert.equal(f.calls.length,0);
  f.setBinding({key:"https://paasta.test:tenant:user",token:"synthetic-private-token"});
  f.service.build=async()=>{f.setBinding(null);return {title:"قدیمی",snapshot:{version:1,messages:[]}};};await assert.rejects(f.service.save(id));assert.equal(f.calls.length,0);
});

test("invalid acknowledgements and bounded-content failures preserve the previous local revision",async()=>{
  const f=fixture();await f.service.enable(id,true);
  f.service.request=async()=>({id:"wrong-remote-id",revision:1});await f.service.tick();assert.equal(f.service.state(id).revision,0);assert.equal(f.service.state(id).reason,"network");
  f.advance();f.service.request=async()=>{throw Object.assign(new Error("snapshot exceeds quota"),{status:413});};await f.service.tick();assert.equal(f.service.state(id).paused,true);assert.equal(f.service.state(id).reason,"content");assert.equal(f.service.state(id).revision,0);
  const unavailable=fixture();unavailable.busy(true);await assert.rejects(unavailable.service.save(id));assert.equal(unavailable.calls.length,0,"an unavailable local snapshot must never return empty success or upload");
});
