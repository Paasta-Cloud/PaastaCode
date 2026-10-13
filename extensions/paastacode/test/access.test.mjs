import {test} from "node:test";
import assert from "node:assert/strict";
import {resolve} from "node:path";
process.env.PAASTACODE_HOME=resolve(".artifacts/access-state-"+process.pid);
const {startServer}=await import("../src/server.mjs");
const {sessionPermissions}=await import("../src/access.mjs");

test("Full Access is authenticated, account-bound and never approves another workspace",async()=>{
  let pending=true;const changes=[],replies=[];
  const sessions=[{id:"ses_local",directory:process.cwd()},{id:"ses_foreign",directory:resolve("../foreign")}];
  const account={credentials:{token:"synthetic",aiKey:"synthetic"},context:async()=>({account:{id:"synthetic",tenantId:"tenant"},models:[]})};
  const runtime={url:"http://127.0.0.1:1",async stop(){},async call(path,options={}){
    if(path==="/session")return options.method==="POST"?{...sessions[0],permission:options.body.permission}:sessions;
    if(path.startsWith("/session/")){const item=sessions.find(s=>path==="/session/"+s.id);if(!item)throw new Error("Unknown session");if(options.method==="PATCH")changes.push({id:item.id,...options.body});return item;}
    if(path==="/permission")return [{id:"per_foreign",sessionID:"ses_foreign"},...(pending?[{id:"per_local",sessionID:"ses_local"}]:[])];
    if(path.endsWith("/reply")){replies.push(path);pending=false;return true;}
    throw new Error("Unexpected engine path");
  }};
  const app=await startServer({account,runtime}),headers={Authorization:"Bearer "+app.capability,"Content-Type":"application/json"};
  const change=mode=>fetch(app.url+"/api/access",{method:"POST",headers,body:JSON.stringify({mode})});
  try{
    assert.equal((await fetch(app.url+"/api/access",{method:"POST",body:'{"mode":"full"}'})).status,401);
    assert.equal((await fetch(app.url+"/api/access",{method:"POST",headers:{...headers,Origin:"https://evil.test"},body:'{"mode":"full"}'})).status,403);
    assert.equal((await change("unknown")).status,400);
    await fetch(app.url+"/api/state",{headers});assert.equal((await change("full")).status,200);
    assert.deepEqual(changes[0],{id:"ses_local",permission:sessionPermissions("full")});assert.equal(changes.length,1);
    // No browser permission polling: the independent broker must handle approval.
    for(let i=0;i<30&&pending;i++)await new Promise(r=>setTimeout(r,100));assert.equal(pending,false);assert.deepEqual(replies,["/permission/per_local/reply"]);
    const created=await (await fetch(app.url+"/api/sessions",{method:"POST",headers})).json();assert.deepEqual(created.permission,sessionPermissions("full"));
    assert.equal((await change("review")).status,200);assert.deepEqual(changes.at(-1).permission,sessionPermissions("review"));
    pending=true;await new Promise(r=>setTimeout(r,1200));assert.equal(pending,true,"Returning to review must stop automatic approval");
    await change("full");account.context=async()=>({account:{id:"other",tenantId:"tenant"},models:[]});
  }finally{await app.close();}
  const next=await startServer({account,runtime});try{const state=await (await fetch(next.url+"/api/state",{headers:{Authorization:"Bearer "+next.capability}})).json();assert.equal(state.accessMode,"review","A different account must not inherit Full Access");}finally{await next.close();}
});
