import test from "node:test";
import assert from "node:assert/strict";
import {resolve} from "node:path";
import {untitledSession,promptTitle,firstRequestTitle} from "../src/session-title.mjs";
process.env.PAASTACODE_HOME=resolve(".artifacts/title-test-"+process.pid);
const {startServer}=await import(process.env.PAASTACODE_SERVER_UNDER_TEST||"../src/server.mjs");
test("request titles preserve explicit names, repair legacy display, persist first requests and isolate workspaces",async()=>{
  assert(untitledSession("گفتگوی جدید"));assert(untitledSession("گفت‌وگوی جدید"));assert(!untitledSession("گفتگوی جدید دربارهٔ ورود"));
  assert.equal(promptTitle("  رفع\n خطای\u202e ورود  "),"رفع خطای ورود");assert.equal(Array.from(promptTitle("آ".repeat(100))).length,72);
  assert.equal(firstRequestTitle([{info:{role:"user"},parts:[{type:"text",synthetic:true,text:"private restore metadata"},{type:"text",text:"درخواست اصلی"}]}]),"درخواست اصلی");
  const sessions=[{id:"ses_legacy",title:"گفتگوی جدید",directory:process.cwd()},{id:"ses_new",title:"گفتگوی جدید",directory:process.cwd()},{id:"ses_named",title:"نام انتخابی من",directory:process.cwd()},{id:"ses_foreign",title:"گفتگوی جدید",directory:resolve("../foreign")}];
  const histories={ses_legacy:[{info:{role:"user"},parts:[{type:"text",text:"رفع خطای ورود کاربران"}]}],ses_new:[],ses_named:[]};let writes=0,historyReads=0;
  const runtime={url:null,async start(){this.url="http://127.0.0.1:1";},async stop(){this.url=null;},async call(path,options={}){
    if(path==="/session")return structuredClone(sessions);
    if(path==="/session/status")return {};
    if(path==="/permission")return [];
    if(path.endsWith("/message")){const id=path.split("/")[2];assert.notEqual(id,"ses_foreign");historyReads++;return histories[id];}
    if(path.endsWith("/prompt_async")){histories[path.split("/")[2]].push({info:{role:"user"},parts:options.body.parts});return null;}
    const item=sessions.find(s=>path==="/session/"+s.id);if(item){if(options.method==="PATCH"){writes++;Object.assign(item,options.body);}return structuredClone(item);}
    throw new Error("Unexpected route "+path);
  }};
  const account={origin:"https://synthetic.test",credentials:{token:"synthetic",aiKey:"synthetic"},async context(){return {account:{id:"user",tenantId:"tenant"},models:[{id:"model",input_toman_per_million:100,output_toman_per_million:300,supported_parameters:["tools"]}]};}};
  const app=await startServer({account,runtime});
  const api=(path,body)=>fetch(app.url+"/api/"+path,{method:body?"POST":"GET",headers:{Authorization:"Bearer "+app.capability,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});
  try{
    await api("state");const list=await (await api("sessions")).json();
    assert.equal(list.length,3);assert.equal(list[0].title,"رفع خطای ورود کاربران");assert.equal(list[2].title,"نام انتخابی من");assert.equal(sessions[0].title,"گفتگوی جدید","GET repairs display without mutating stored data");
    const readCount=historyReads;await api("sessions");assert.equal(historyReads,readCount+1,"only an empty untitled session needs another history read");
    let before=writes;assert.equal((await api("prompt",{id:"ses_foreign",text:"no",model:"model"})).status,400);assert.equal(writes,before);
    assert.equal((await api("prompt",{id:"ses_new",text:"ساخت صفحهٔ تنظیمات",model:"model"})).status,200);assert.equal(sessions[1].title,"ساخت صفحهٔ تنظیمات");
    assert.equal((await api("prompt",{id:"ses_new",text:"تغییر بعدی",model:"model"})).status,200);assert.equal(sessions[1].title,"ساخت صفحهٔ تنظیمات");
    await api("prompt",{id:"ses_legacy",text:"ادامه",model:"model"});assert.equal(sessions[0].title,"رفع خطای ورود کاربران");
    await api("prompt",{id:"ses_named",text:"درخواست دیگر",model:"model"});assert.equal(sessions[2].title,"نام انتخابی من");
  }finally{await app.close();}
});
