import {test} from "node:test";
import assert from "node:assert/strict";
import {resolve} from "node:path";
process.env.PAASTACODE_HOME=resolve(".artifacts/automatic-workflow-"+process.pid);
const {startServer}=await import("../src/server.mjs");
const {writePrivate,readPrivate}=await import("../src/account.mjs");
const {workspaceKey}=await import("../src/runtime.mjs");
test("broker hands off once without a renderer, rejects free models, and never advances aborted or failed plans",{timeout:60000},async()=>{
  const histories=new Map(),calls=[];let revoked=false,available=true,contextGate=null,contextWaiting=false,patchGate=null,patchWaiting=false;
  const sessions=["normal","abort","failed","revoked","stale","free","race","patchrace","ambiguous","unavailable"].map(id=>({id:"ses_"+id,title:id,directory:process.cwd()}));
  const runtime={url:null,async start(){this.url="http://127.0.0.1:1";},async stop(){this.url=null;},async call(path,options={}){
    if(path==="/session")return structuredClone(sessions);if(path==="/session/status")return {};if(path==="/permission")return [];
    const id=path.split("/")[2];if(path.endsWith("/message"))return histories.get(id)||[];
    if(path.endsWith("/prompt_async")){calls.push({id,...options.body});histories.set(id,[{info:{id:"msg_user"+calls.length,role:"user",time:{created:Date.now()}},parts:options.body.parts}]);if(id==="ses_ambiguous"&&options.body.agent==="build")throw new Error("Acknowledgement lost");return null;}
    if(path.endsWith("/abort"))return true;
    if(id==="ses_patchrace"&&options.method==="PATCH"&&patchGate){patchWaiting=true;await patchGate;}
    return structuredClone(sessions.find(s=>s.id===id));
  }};
  const account={origin:"https://synthetic.test",credentials:{token:"synthetic",aiKey:"synthetic"},async context(){if(contextGate){contextWaiting=true;await contextGate;}if(revoked)throw new Error("Revoked fixture");return {account:{id:"user",tenantId:"tenant"},models:[{id:"professional",supported_parameters:["tools"],input_toman_per_million:100,output_toman_per_million:300},...(available?[{id:"economy",supported_parameters:["tools"],input_toman_per_million:10,output_toman_per_million:30}]:[]),{id:"vendor/unstable:free",customer_free:true,supported_parameters:["tools"],input_toman_per_million:0,output_toman_per_million:0}]};}};
  const app=await startServer({account,runtime}),headers={Authorization:"Bearer "+app.capability,"Content-Type":"application/json"};
  const api=async(path,input)=>{const response=await fetch(app.url+"/api/"+path,{method:input?"POST":"GET",headers,body:input?JSON.stringify(input):undefined});return {status:response.status,value:await response.json()};};
  const start=id=>api("prompt",{id:"ses_"+id,text:"Implement the requested change",phase:"plan",model:"professional",executionModel:"economy",autoExecute:true});
  const finish=(id,extra={})=>histories.set("ses_"+id,[{info:{id:"msg_answer_"+id,role:"assistant",agent:"paasta-plan",time:{created:Date.now(),completed:Date.now()},...extra},parts:[{type:"text",text:"A verified plan"}]}]);
  const wait=async predicate=>{for(let i=0;i<100;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,100));}throw new Error("Handoff timeout");};
  try{
    const state=await api("state");assert.equal(state.value.models.length,2);
    assert.equal((await api("prompt",{id:"ses_free",text:"no",model:"vendor/unstable:free"})).status,400);
    assert.equal((await api("prompt",{id:"ses_free",text:"no",phase:"plan",model:"professional",executionModel:"vendor/unstable:free",autoExecute:true})).status,400);
    assert.equal((await start("normal")).status,200);finish("normal");
    // No UI/status poll is responsible for starting the executor.
    await wait(()=>calls.some(c=>c.id==="ses_normal"&&c.agent==="build"));
    assert.equal(calls.find(c=>c.agent==="build").model.modelID,"economy");
    await new Promise(r=>setTimeout(r,2100));assert.equal(calls.filter(c=>c.agent==="build").length,1);
    await start("abort");await api("abort",{id:"ses_abort"});finish("abort");
    await start("failed");finish("failed",{error:{name:"ProviderError"}});
    await wait(async()=>(await api("workflow?id=ses_failed")).value.automatic.state==="failed");
    await start("stale");finish("stale",{time:{created:1,completed:2}});await new Promise(r=>setTimeout(r,1200));await api("abort",{id:"ses_stale"});
    await start("revoked");revoked=true;finish("revoked");
    await wait(async()=>(await api("workflow?id=ses_revoked")).value.automatic.state==="failed");revoked=false;
    assert.equal(calls.filter(c=>c.agent==="build").length,1,"abort, failed provider, stale answer and revoked account must not execute");
    assert.equal((await api("workflow?id=ses_abort")).value.automatic.state,"cancelled");
    await start("race");let release;contextGate=new Promise(r=>{release=r;});finish("race");await wait(()=>contextWaiting);
    const stopping=api("abort",{id:"ses_race"});await new Promise(r=>setTimeout(r,100));release();await stopping;contextGate=null;
    assert.equal(calls.filter(c=>c.id==="ses_race"&&c.agent==="build").length,0,"Stop while checking the grant must win before paid execution");
    await start("patchrace");let releasePatch;patchGate=new Promise(r=>{releasePatch=r;});finish("patchrace");await wait(()=>patchWaiting);
    const patchStop=api("abort",{id:"ses_patchrace"});await new Promise(r=>setTimeout(r,100));releasePatch();await patchStop;patchGate=null;
    assert.equal(calls.filter(c=>c.id==="ses_patchrace"&&c.agent==="build").length,0,"Stop during persisted handoff and delayed permission PATCH must prevent submission");
    await start("unavailable");available=false;finish("unavailable");await wait(async()=>(await api("workflow?id=ses_unavailable")).value.automatic.state==="failed");available=true;
    await start("ambiguous");finish("ambiguous");await wait(async()=>(await api("workflow?id=ses_ambiguous")).value.automatic.state==="failed");
    await new Promise(r=>setTimeout(r,2200));assert.equal(calls.filter(c=>c.id==="ses_ambiguous"&&c.agent==="build").length,1,"An accepted submit with a lost acknowledgement is never retried automatically");
  }finally{await app.close();}
  const file=resolve(process.env.PAASTACODE_HOME,"workflows-"+workspaceKey(process.cwd())+".json"),records=await readPrivate(file);
  records[account.origin+":tenant:user:ses_normal"].phase="plan";
  records[account.origin+":tenant:user:ses_normal"].automatic.state="handoff";
  await writePrivate(file,records);
  const recovered=await startServer({account,runtime}),before=calls.length;
  try{
    const headers={Authorization:"Bearer "+recovered.capability,"Content-Type":"application/json"};
    await fetch(recovered.url+"/api/state",{headers});
    const state=await (await fetch(recovered.url+"/api/workflow?id=ses_normal",{headers})).json();
    assert.equal(state.automatic.state,"interrupted","A crash during submit must surface a reviewable recovery state");
    await new Promise(r=>setTimeout(r,2200));assert.equal(calls.length,before,"Uncertain handoff must never replay after restart");
    const result=await fetch(recovered.url+"/api/prompt",{method:"POST",headers,body:JSON.stringify({id:"ses_normal",text:"Review and continue",model:"professional",phase:"plan",executionModel:"economy",restart:true,autoExecute:true})});
    assert.equal(result.status,200,"An explicit restart reviews the actual files before continuing");
    assert.equal(calls.at(-1).agent,"paasta-plan");
  }finally{await recovered.close();}
});
