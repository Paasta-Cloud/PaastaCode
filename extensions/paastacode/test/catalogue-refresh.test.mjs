import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdtemp,realpath,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
process.env.PAASTACODE_HOME=resolve(".artifacts/catalogue-refresh-"+process.pid);
const {startServer}=await import("../src/server.mjs");

test("running engine refreshes PDF capabilities and retains attachments through plan and execution",{timeout:90000},async()=>{
  const workspace=await realpath(await mkdtemp(join(tmpdir(),"paastacode-catalogue-"))),requests=[];
  const provider=createServer(async(req,res)=>{
    let raw="";for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw);
    if(!input.stream){res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({choices:[{message:{role:"assistant",content:"Synthetic"},finish_reason:"stop"}]}));return;}
    requests.push(input);res.writeHead(200,{"Content-Type":"text/event-stream"});
    for(const [delta,finish_reason] of [[{role:"assistant",content:"Synthetic PDF plan complete."},null],[{},"stop"]])res.write("data: "+JSON.stringify({id:"fixture",object:"chat.completion.chunk",choices:[{index:0,delta,finish_reason}]})+"\n\n");
    res.end("data: [DONE]\n\n");
  });await new Promise(r=>provider.listen(0,"127.0.0.1",r));
  let pdf=false;
  const account={origin:"http://127.0.0.1:"+provider.address().port,credentials:{token:"synthetic",aiKey:"synthetic"},async context(){return {account:{id:"user",tenantId:"tenant"},models:["planner","executor"].map(id=>({id,supported_parameters:["tools"],input_modalities:pdf?["text","file"]:["text"],input_toman_per_million:10,output_toman_per_million:30,context_length:32000,max_output_tokens:4096}))};}};
  const app=await startServer({workspace,account}),headers={Authorization:"Bearer "+app.capability,"Content-Type":"application/json"};
  const api=async(path,input)=>{const r=await fetch(app.url+"/api/"+path,{method:input?"POST":"GET",headers,body:input?JSON.stringify(input):undefined});const value=await r.json();assert.equal(r.status,200,JSON.stringify(value));return value;};
  const wait=async fn=>{for(let i=0;i<150;i++){if(await fn())return;await new Promise(r=>setTimeout(r,200));}throw Error("Synthetic engine timed out");};
  try{
    await api("state");const session=await api("sessions",{}),original=app.runtime.process.pid;
    const data=Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n").toString("base64");
    // Reproduce the installed client's old engine before the live catalogue gained PDF support.
    await app.runtime.call("/session/"+session.id+"/message",{method:"POST",timeout:60000,body:{model:{providerID:"paasta",modelID:"planner"},parts:[{type:"text",text:"Read this PDF"},{type:"file",mime:"application/pdf",filename:"fixture.pdf",url:"data:application/pdf;base64,"+data}]}});
    const hasPdf=input=>input.messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==="file"&&p.file?.file_data==="data:application/pdf;base64,"+data));
    assert(requests.length&&!requests.some(hasPdf),"Old engine reproduces the missing PDF despite retaining the attachment");requests.length=0;
    pdf=true;await api("state");
    await api("prompt",{id:session.id,text:"Read the original PDF again and plan",model:"planner",phase:"plan"});
    await wait(async()=>requests.length&&!(await api("status"))[session.id]);
    assert(requests.filter(r=>r.model==="planner").every(hasPdf),"A refreshed UI must not silently lose the PDF in the old engine");
    assert.notEqual(app.runtime.process.pid,original);
    const refreshed=app.runtime.process.pid;
    await api("prompt",{id:session.id,text:"Execute",model:"executor",phase:"build",executePlan:true});
    await wait(async()=>requests.some(r=>r.model==="executor")&&!(await api("status"))[session.id]);
    assert(requests.filter(r=>r.model==="executor").every(hasPdf),"Executor must retain the original PDF after the model switch");
    assert.equal(app.runtime.process.pid,refreshed,"An unchanged catalogue must not restart the engine");
    const messages=await api("messages?id="+session.id);assert.equal(messages.flatMap(m=>m.parts).filter(p=>p.type==="file").length,1);
    requests.length=0;const automatic=await api("sessions",{});
    await api("prompt",{id:automatic.id,text:"Read and execute",model:"planner",phase:"plan",executionModel:"executor",autoExecute:true,attachments:[{name:"fixture.pdf",data}]});
    await wait(async()=>requests.some(r=>r.model==="executor")&&!(await api("status"))[automatic.id]);
    assert(requests.every(hasPdf),"Automatic plan-to-build handoff must also retain the PDF");
  }finally{await app.close();provider.closeAllConnections();await new Promise(r=>provider.close(r));assert(workspace.startsWith(join(await realpath(tmpdir()),"paastacode-catalogue-")));await rm(workspace,{recursive:true,force:true});}
});

test("catalogue changes never interrupt another active conversation",async()=>{
  let pdf=false,busy=false,starts=0,stops=0,submissions=0;
  const session={id:"ses_fixture",title:"Fixture",directory:process.cwd()};
  const runtime={url:null,async start(){starts++;this.url="http://127.0.0.1:1";},async stop(){stops++;this.url=null;},async call(path){if(path==="/session/status")return busy?{ses_other:{type:"busy"}}:{};if(path==="/session")return [session];if(path==="/permission")return [];if(path.endsWith("/message"))return [];if(path.endsWith("/prompt_async")){submissions++;return null;}return session;}};
  const account={origin:"https://synthetic.test",credentials:{token:"synthetic",aiKey:"synthetic"},async context(){return {account:{id:"user",tenantId:"tenant"},models:[{id:"model",supported_parameters:["tools"],input_modalities:pdf?["text","file"]:["text"],input_toman_per_million:10,output_toman_per_million:30}]};}};
  const app=await startServer({account,runtime}),headers={Authorization:"Bearer "+app.capability,"Content-Type":"application/json"};
  const api=(path,input)=>fetch(app.url+"/api/"+path,{method:input?"POST":"GET",headers,body:input?JSON.stringify(input):undefined});
  try{
    await api("state");await api("ready",{});pdf=true;busy=true;await api("state");
    const input={id:session.id,text:"Continue",model:"model"};
    assert.equal((await api("prompt",input)).status,400);assert.equal(stops,0);assert.equal(submissions,0);
    busy=false;assert.equal((await api("prompt",input)).status,200);assert.equal(starts,2);assert.equal(stops,1);assert.equal(submissions,1);
  }finally{await app.close();}
});
