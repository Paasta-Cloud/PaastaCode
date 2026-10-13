import {test} from "node:test";
import assert from "node:assert/strict";
import {resolve} from "node:path";
process.env.PAASTACODE_HOME=resolve(".artifacts/workflow-test-"+process.pid);
const {startServer}=await import("../src/server.mjs");
const {sessionPermissions}=await import("../src/access.mjs");
test("workflow changes serialize, retain models, protect plan under Full Access, and isolate imports",async()=>{
  const sessions=[{id:"ses_owned",directory:process.cwd()},{id:"ses_foreign",directory:resolve("../foreign")}],calls=[];
  let busy=false,messages=[];
  const runtime={url:null,async start(){this.url="http://127.0.0.1:1";},async stop(){this.url=null;},async call(path,options={}){
    calls.push({path,...options});
    if(path==="/session"){if(options.method==="POST"){const s={id:"ses_import"+sessions.length,directory:process.cwd(),title:options.body.title};sessions.push(s);return s;}return sessions;}
    if(path==="/session/status")return busy?{ses_owned:{type:"busy"}}:{};
    if(path==="/permission")return [];
    if(path.endsWith("/abort")){busy=false;return true;}
    if(path.endsWith("/prompt_async")){busy=true;return null;}
    if(path.endsWith("/message"))return messages;
    const s=sessions.find(s=>path==="/session/"+s.id);if(s)return s;
    throw new Error("Unexpected route");
  }};
  const account={origin:"https://synthetic.test",credentials:{token:"synthetic",aiKey:"synthetic"},async context(){return {account:{id:"user",tenantId:"tenant"},models:["professional","economy"].map(id=>({id,input_toman_per_million:100,output_toman_per_million:300,supported_parameters:["tools"]}))};}};
  const app=await startServer({account,runtime}),headers={Authorization:"Bearer "+app.capability,"Content-Type":"application/json"};
  const api=(path,data,extra={})=>fetch(app.url+"/api/"+path,{method:data?"POST":"GET",headers:{...headers,...extra},body:data?JSON.stringify(data):undefined});
  try{
    assert.equal((await fetch(app.url+"/api/import/preview",{method:"POST",body:"{}"})).status,401);
    await api("state");assert.equal((await api("access",{mode:"full"})).status,200);
    assert.equal((await api("prompt",{id:"ses_foreign",model:"professional",text:"no"})).status,400);
    assert.equal((await api("prompt",{id:"ses_owned",model:"missing",text:"no"})).status,400);
    assert.equal((await api("prompt",{id:"ses_owned",phase:"plan",model:"professional",executionModel:"economy",text:"plan"})).status,200);
    assert.deepEqual(calls.findLast(c=>c.method==="PATCH").body.permission,sessionPermissions("full","plan"));
    assert.equal(calls.findLast(c=>c.path.endsWith("prompt_async")).body.agent,"paasta-plan");
    assert.equal((await api("prompt",{id:"ses_owned",model:"economy",text:"concurrent"})).status,400);
    await api("access",{mode:"review"});await api("access",{mode:"full"});await new Promise(r=>setTimeout(r,1100));
    assert.deepEqual(calls.findLast(c=>c.method==="PATCH"&&c.path.endsWith("ses_owned")).body.permission,sessionPermissions("full","plan"));
    assert.equal((await api("prompt",{id:"ses_owned",phase:"build",model:"economy",text:"switch",restart:true})).status,400);
    assert.equal((await api("prompt",{id:"ses_owned",phase:"plan",model:"economy",text:"switch",restart:true})).status,200);
    assert.equal(calls.filter(c=>c.path.endsWith("/abort")).length,1);
    busy=false;assert.equal((await api("prompt",{id:"ses_owned",model:"economy",text:"execute",executePlan:true})).status,400);
    messages=[{info:{role:"assistant",agent:"paasta-plan",time:{completed:1}},parts:[{type:"text",text:"Complete plan"}]}];
    assert.equal((await api("prompt",{id:"ses_owned",model:"economy",text:"execute",executePlan:true})).status,200);
    assert.deepEqual((await (await api("workflow?id=ses_owned")).json()),{phase:"build",planModel:"economy",buildModel:"economy"});
    assert.equal((await api("import/preview",{source:"codex",rules:false,text:"<script>plain text</script>"},{"X-PaastaCode-Account":"999"})).status,409);
    const preview=await (await api("import/preview",{source:"codex",rules:false,text:"<script>plain text</script>"})).json();
    const imported=await (await api("import",{token:preview.token})).json();const again=await (await api("import",{token:preview.token})).json();assert.equal(again.session.id,imported.session.id);assert.equal(again.reused,true);
    assert.equal((await api("import",{token:"forged"})).status,400);
  }finally{await app.close();}
});
