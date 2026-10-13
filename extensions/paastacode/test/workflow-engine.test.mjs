import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdtemp,readFile,rm,realpath} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
process.env.PAASTACODE_HOME=resolve(".artifacts/workflow-engine-"+process.pid);
const {startServer}=await import("../src/server.mjs");
test("real engine denies plan writes under Full Access and executes the same plan with a cheaper model",{timeout:90000},async()=>{
  const workspace=await realpath(await mkdtemp(join(tmpdir(),"paastacode-workflow-"))),requests=[];
  const provider=createServer(async(req,res)=>{
    let raw="";for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw);
    if(!input.stream){res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({choices:[{message:{role:"assistant",content:"Synthetic"},finish_reason:"stop"}]}));return;}
    requests.push(input);
    const finished=input.messages.slice(input.messages.findLastIndex(m=>m.role==="user")).some(m=>m.role==="tool");
    // Deliberately emit a forbidden write even if it is absent from the tool catalogue.
    const delta=finished?{content:input.model==="professional"?"PLAN: create hello.txt and verify content.":"Executed plan."}:{tool_calls:[{index:0,id:"call_fixture",type:"function",function:{name:"write",arguments:JSON.stringify({filePath:join(workspace,"hello.txt"),content:"verified execution"})}}]};
    res.writeHead(200,{"Content-Type":"text/event-stream"});
    for(const chunk of [{role:"assistant",...delta},{}])res.write("data: "+JSON.stringify({id:"fixture",object:"chat.completion.chunk",created:1,model:input.model,choices:[{index:0,delta:chunk,finish_reason:Object.keys(chunk).length?null:finished?"stop":"tool_calls"}]})+"\n\n");res.end("data: [DONE]\n\n");
  });await new Promise(r=>provider.listen(0,"127.0.0.1",r));
  const account={origin:"http://127.0.0.1:"+provider.address().port,credentials:{token:"synthetic",aiKey:"synthetic"},async context(){return {account:{id:"synthetic",tenantId:"synthetic"},models:["professional","economy"].map(id=>({id,name:id==="professional"?"Kimi K3":"GLM-5.3-Flash",input_toman_per_million:id==="professional"?100:10,output_toman_per_million:id==="professional"?300:30,supported_parameters:["tools"],context_length:32000,max_output_tokens:4096}))};}};
  const app=await startServer({workspace,account}),headers={Authorization:"Bearer "+app.capability,"Content-Type":"application/json"};
  const api=async(path,body)=>{const result=await fetch(app.url+"/api/"+path,{method:body?"POST":"GET",headers,body:body?JSON.stringify(body):undefined});const value=await result.json();assert.equal(result.status,200,JSON.stringify(value));return value;};
  const wait=async work=>{for(let i=0;i<160;i++){const result=await work();if(result)return result;await new Promise(r=>setTimeout(r,200));}throw new Error("Workflow engine timeout");};
  try{
    await api("state");await api("access",{mode:"full"});const session=await api("sessions",{});
    await api("prompt",{id:session.id,text:"Plan the change",phase:"plan",model:"professional",executionModel:"economy"});
    await wait(async()=>{const list=await api("messages?id="+session.id);return list.at(-1)?.info.time?.completed&&list.at(-1).parts.some(p=>p.type==="text"&&p.text.includes("PLAN:"));});
    await wait(async()=>!(await api("status"))[session.id]);
    await assert.rejects(readFile(join(workspace,"hello.txt")),error=>error.code==="ENOENT");
    assert.equal((await api("permissions")).length,0);
    const planTools=requests.filter(r=>r.model==="professional").flatMap(r=>r.tools?.map(t=>t.function.name)||[]);
    assert(!planTools.some(t=>["write","edit","bash","task"].includes(t)),"Planning tools must remain read-only even with workspace Full Access");
    await api("prompt",{id:session.id,text:"Execute",phase:"build",model:"economy",executePlan:true});
    await wait(async()=>{try{return(await readFile(join(workspace,"hello.txt"),"utf8"))==="verified execution";}catch{return false;}});
    assert(requests.some(r=>r.model==="economy"&&JSON.stringify(r.messages).includes("PLAN: create hello.txt")),"Executor must receive the professional plan in the same session");
    await wait(async()=>!(await api("status"))[session.id]);
    await rm(join(workspace,"hello.txt"));const automatic=await api("sessions",{});
    await api("prompt",{id:automatic.id,text:"Create hello.txt following a reviewed plan",phase:"plan",model:"professional",executionModel:"economy",autoExecute:true});
    await wait(async()=>{try{return(await readFile(join(workspace,"hello.txt"),"utf8"))==="verified execution";}catch{return false;}});
    assert.equal((await api("workflow?id="+automatic.id)).phase,"build","Broker automatically transitions without another client prompt");
  }finally{await app.close();provider.closeAllConnections();await new Promise(r=>provider.close(r));assert(workspace.startsWith(join(await realpath(tmpdir()),"paastacode-workflow-")));await rm(workspace,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
});
