import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createServer} from "node:http";
import {mkdtemp,realpath,writeFile,readFile,rm} from "node:fs/promises";
import {join,resolve,sep} from "node:path";
import {tmpdir} from "node:os";
process.env.PAASTACODE_HOME=resolve(".artifacts/daemon-state-"+process.pid);
const {writePrivate,stateHome}=await import("../src/account.mjs");
const {connectWorkspace,stopWorkspace}=await import("../src/workspace-service.mjs");

test("the launching client can exit while the shared real engine and session remain usable",{timeout:90000},async()=>{
  const workspace=await realpath(await mkdtemp(join(tmpdir(),"pc-daemon-test-")));
  const upstream=createServer((req,res)=>{
    if(req.url!=="/api/paastacode/connection"){res.writeHead(404);res.end('{}');return;}
    res.setHeader("Content-Type","application/json");res.end(JSON.stringify({account:{id:"synthetic-user",tenantId:"synthetic-tenant",name:"آزمایشی",balanceToman:0},models:[{id:"synthetic",name:"آزمایشی",input_toman_per_million:100,output_toman_per_million:300,supported_parameters:["tools"],context_length:4096,max_output_tokens:512}]}));
  });
  await new Promise(r=>upstream.listen(0,"127.0.0.1",r));const origin="http://127.0.0.1:"+upstream.address().port;process.env.PAASTACODE_CONSOLE=origin;
  let service;
  try{
    await writeFile(join(workspace,"keep.txt"),"preserved local work");
    await writePrivate(join(stateHome,"account.json"),{origin,token:"paasta_"+"s".repeat(43),aiKey:"paasta_ai_"+"s".repeat(43),dailyLimitToman:100});
    const launcher=spawn(process.execPath,[resolve("bin/paastacode.mjs"),"web","--no-open","--workspace="+workspace],{env:process.env,stdio:["ignore","ignore","pipe"],windowsHide:true});let diagnostic="";launcher.stderr.on("data",chunk=>diagnostic+=chunk);
    const exit=await new Promise((r,reject)=>{launcher.once("error",reject);launcher.once("exit",r);});assert.equal(exit,0,diagnostic);
    service=await connectWorkspace({workspace});assert.equal(service.daemon,true);assert.notEqual(service.pid,launcher.pid);
    const engine=await service.ensureReady();assert(engine.url);assert(engine.password);
    const headers={Authorization:"Bearer "+service.capability,"Content-Type":"application/json"};
    const session=await (await fetch(service.url+"/api/sessions",{method:"POST",headers,body:"{}"})).json();assert.match(session.id,/^ses_/);
    await service.close();const second=await connectWorkspace({workspace});assert.equal(second.url,service.url);assert.equal(second.pid,service.pid);
    const listed=await (await fetch(second.url+"/api/sessions",{headers})).json();assert(listed.some(item=>item.id===session.id),"reopening another client must retain the real engine session");
    await second.close();assert.equal((await fetch(service.url+"/api/state",{headers})).status,200,"closing another client cannot stop shared execution");
    await rm(join(stateHome,"account.json"),{force:true});
    const disconnected=await (await fetch(service.url+"/api/state",{headers})).json();assert.equal(disconnected.connected,false);assert.equal(disconnected.configured,false,"external CLI logout must invalidate every client using the broker");
    assert.equal((await fetch(service.url+"/api/shutdown",{method:"POST"})).status,401,"explicit stop still requires the private capability");
    await assert.rejects(connectWorkspace({workspace,hosted:true}),/--hosted/);
    assert.equal((await stopWorkspace(workspace)).stopped,true);
    assert.throws(()=>process.kill(service.pid,0),error=>error.code==="ESRCH","explicit stop must finish the broker process before releasing its workspace directory");
    for(let i=0;i<50;i++){try{await fetch(service.url+"/api/state",{headers,signal:AbortSignal.timeout(500)});}catch{break;}await new Promise(r=>setTimeout(r,100));}
    await assert.rejects(fetch(service.url+"/api/state",{headers}));
    assert.equal(await readFile(join(workspace,"keep.txt"),"utf8"),"preserved local work");
  }finally{
    await stopWorkspace(workspace).catch(()=>{});upstream.closeAllConnections();await new Promise(r=>upstream.close(r));
    assert(workspace.startsWith((await realpath(tmpdir()))+sep+"pc-daemon-test-"));await rm(workspace,{recursive:true,force:true});
  }
});
