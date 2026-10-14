import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdtemp,readFile,rm,realpath} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {attachmentParts} from "../src/prompt-attachments.mjs";
process.env.PAASTACODE_HOME=resolve(".artifacts/runtime-state");
const {CodeRuntime,providerConfig,workspaceKey}=await import("../src/runtime.mjs");
const {validCapability}=await import("../src/server.mjs");
const {sessionPermissions}=await import("../src/access.mjs");

test("local capability and provider configuration reject unsafe defaults",()=>{
  if(process.platform==="win32")assert.equal(workspaceKey("D:/Example"),workspaceKey("d:/example"));
  assert(validCapability("a".repeat(43),"a".repeat(43)));
  for(const value of [undefined,"","b".repeat(43),"a".repeat(44)])assert(!validCapability(value,"a".repeat(43)));
  assert.throws(()=>providerConfig([],"secret","https://example.test"));
  const config=providerConfig([{id:"model",input_toman_per_million:100,output_toman_per_million:300,supported_parameters:["tools"]}],"secret","https://example.test");
  assert.deepEqual(config.enabled_providers,["paasta"]);assert.equal(config.permission["*"],"ask");assert.equal(config.share,"disabled");
});
test("real pinned OpenCode runs a tool only after approval and retains its session",{timeout:90000},async()=>{
  const workspace=await realpath(await mkdtemp(join(tmpdir(),"paastacode-engine-")));
  let calls=0,toolsSeen=[],toolRequested=false,sessionId,target="hello.txt",attachmentSeen=false,sourceSeen=false,pdfSeen=false;
  const provider=createServer(async(req,res)=>{
    let raw="";for await(const chunk of req)raw+=chunk;
    const input=JSON.parse(raw);calls++;toolsSeen=input.tools?.map(t=>t.function.name)||[];attachmentSeen||=raw.includes('image_url');sourceSeen||=raw.includes('attached-source-sentinel');pdfSeen||=raw.includes('application/pdf');
    const toolResult=input.messages.slice(input.messages.findLastIndex(m=>m.role==="user")).some(m=>m.role==="tool");
    const delta=toolResult?{content:"فایل آزمایشی ساخته شد."}:{tool_calls:[{index:0,id:"call_smoke",type:"function",function:{name:"write",arguments:JSON.stringify({filePath:join(workspace,target),content:"PaastaCode smoke\n"})}}]};
    if(!toolResult)toolRequested=true;
    if(input.stream){
      res.writeHead(200,{"Content-Type":"text/event-stream"});
      const send=value=>res.write("data: "+JSON.stringify(value)+"\n\n");
      send({id:"test",object:"chat.completion.chunk",created:1,model:"synthetic",choices:[{index:0,delta:{role:"assistant",...delta},finish_reason:null}]});
      send({id:"test",object:"chat.completion.chunk",created:1,model:"synthetic",choices:[{index:0,delta:{},finish_reason:toolResult?"stop":"tool_calls"}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}});
      res.end("data: [DONE]\n\n");
    }else{res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({choices:[{message:{role:"assistant",content:"آزمون"},finish_reason:"stop"}],usage:{prompt_tokens:10,completion_tokens:10}}));}
  });
  await new Promise(r=>provider.listen(0,"127.0.0.1",r));
  const runtime=new CodeRuntime(workspace);
  const wait=async fn=>{for(let i=0;i<120;i++){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,300));}throw new Error("Engine operation timed out; tools: "+toolsSeen.join(","));};
  try{
    await runtime.start(providerConfig([{id:"synthetic",name:"Synthetic",input_modalities:["text","image","file"],input_toman_per_million:100,output_toman_per_million:300,supported_parameters:["tools"],context_length:32000,max_output_tokens:4096}],"synthetic", "http://127.0.0.1:"+provider.address().port));
    const session=await runtime.call("/session",{method:"POST",body:{title:"synthetic test"}});
    sessionId=session.id;
    const attachments=attachmentParts([{name:"source.ts",data:Buffer.from("attached-source-sentinel").toString("base64")},{name:"screen.png",data:(await readFile(new URL("../desktop/icon.png",import.meta.url))).toString("base64")},{name:"guide.pdf",data:Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n").toString("base64")}],{input_modalities:["image","file"]});
    await runtime.call("/session/"+session.id+"/prompt_async",{method:"POST",body:{model:{providerID:"paasta",modelID:"synthetic"},parts:[{type:"text",text:"Create hello.txt"},...attachments]}});
    const permission=await wait(async()=> (await runtime.call("/permission")).find(p=>p.sessionID===session.id));
    assert.match(JSON.stringify(permission.metadata),/PaastaCode smoke/,"approval must include the proposed file content");
    await assert.rejects(readFile(join(workspace,"hello.txt")),error=>error.code==="ENOENT");
    await runtime.call("/permission/"+permission.id+"/reply",{method:"POST",body:{reply:"once"}});
    await wait(async()=>{try{return(await readFile(join(workspace,"hello.txt"),"utf8"))==="PaastaCode smoke\n";}catch{return false;}});
    const messages=await wait(async()=>{const list=await runtime.call("/session/"+session.id+"/message");return list.some(m=>m.parts.some(p=>p.type==="text"&&p.text.includes("آزمایشی")))&&list;});
    assert(messages.length>=3);assert(toolRequested);assert(calls>=2);assert(attachmentSeen,"The real pinned engine must deliver the image to the provider");assert(sourceSeen,"The real pinned engine must deliver attached source text");assert(pdfSeen,"The real pinned engine must deliver the PDF to the provider");
    const denied=await fetch(runtime.url+"/session");assert.equal(denied.status,401);
    assert.equal((await runtime.call("/session/"+session.id)).id,session.id);
    target="rejected.txt";
    const rejected=await runtime.call("/session",{method:"POST",body:{title:"denial regression"}});
    await runtime.call("/session/"+rejected.id+"/prompt_async",{method:"POST",body:{model:{providerID:"paasta",modelID:"synthetic"},parts:[{type:"text",text:"Create rejected.txt"}]}});
    const deniedPermission=await wait(async()=> (await runtime.call("/permission")).find(p=>p.sessionID===rejected.id));
    await runtime.call("/permission/"+deniedPermission.id+"/reply",{method:"POST",body:{reply:"reject"}});
    await wait(async()=> (await runtime.call("/session/"+rejected.id+"/message")).some(m=>m.parts.some(p=>p.type==="tool"&&p.state?.status==="error")));
    await assert.rejects(readFile(join(workspace,target)),error=>error.code==="ENOENT");
    target="full-access.txt";
    const full=await runtime.call("/session",{method:"POST",body:{title:"Full Access",permission:sessionPermissions("full")}});
    await runtime.call("/session/"+full.id+"/prompt_async",{method:"POST",body:{model:{providerID:"paasta",modelID:"synthetic"},parts:[{type:"text",text:"Create full-access.txt"}]}});
    await wait(async()=>{try{return(await readFile(join(workspace,target),"utf8"))==="PaastaCode smoke\n";}catch{return false;}});
    assert(!(await runtime.call("/permission")).some(p=>p.sessionID===full.id),"Full Access must execute without a renderer approving it");
    await wait(async()=>!(await runtime.call("/session/status"))[full.id]);
    await runtime.call("/session/"+full.id,{method:"PATCH",body:{permission:sessionPermissions("review")}});
    target="review-again.txt";
    await runtime.call("/session/"+full.id+"/prompt_async",{method:"POST",body:{model:{providerID:"paasta",modelID:"synthetic"},parts:[{type:"text",text:"Create review-again.txt"}]}});
    const again=await wait(async()=>(await runtime.call("/permission")).find(p=>p.sessionID===full.id));
    await assert.rejects(readFile(join(workspace,target)),error=>error.code==="ENOENT");
    await runtime.call("/permission/"+again.id+"/reply",{method:"POST",body:{reply:"reject"}});
  }catch(error){console.error("Synthetic engine diagnostics",JSON.stringify({calls,toolsSeen,toolRequested, messages:sessionId?await runtime.call("/session/"+sessionId+"/message"):[]}));throw error;}
  finally{await runtime.stop();provider.closeAllConnections();await new Promise(r=>provider.close(r));assert(workspace.startsWith(join(await realpath(tmpdir()),"paastacode-engine-")));await rm(workspace,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
});
