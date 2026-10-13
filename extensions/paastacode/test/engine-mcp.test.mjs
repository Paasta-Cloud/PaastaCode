import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdtemp,rm,realpath} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
process.env.PAASTACODE_HOME=resolve(".artifacts/engine-mcp-test");
const {CodeRuntime,providerConfig,paastaMcpConfig}=await import("../src/runtime.mjs");
const {startServer}=await import("../src/server.mjs");
const {sourceTool}=await import("../src/deployment.mjs");
test("real OpenCode discovers Paasta MCP and a permitted tool still creates only a human review",{timeout:90000},async()=>{
  const workspace=await realpath(await mkdtemp(join(tmpdir(),"paastacode-mcp-engine-")));
  const runtime=new CodeRuntime(workspace);let requests=0,uploads=0,toolName;
  const deployment={async tools(){return [sourceTool];},async request(){requests++;return {id:"synthetic-review",project:"fixture",status:"review",requiresHumanApproval:true};},async approve(){uploads++;},async disconnect(){}};
  const service=await startServer({workspace,account:{credentials:null},runtime,deployment});
  const provider=createServer(async(req,res)=>{
    let raw="";for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw);
    toolName=input.tools?.find(tool=>tool.function.name.includes('deploy_source'))?.function.name;
    const finished=input.messages.some(message=>message.role==='tool');
    const delta=finished||!toolName?{content:finished?'منتظر تأیید پیش‌نمایش در پاستاکد است.':'MCP missing.'}:{tool_calls:[{index:0,id:"call_deploy_fixture",type:"function",function:{name:toolName,arguments:JSON.stringify({name:'fixture'})}}]};
    if(input.stream){res.writeHead(200,{"Content-Type":"text/event-stream"});res.write('data: '+JSON.stringify({id:'synthetic',object:'chat.completion.chunk',created:1,model:'synthetic',choices:[{index:0,delta:{role:'assistant',...delta},finish_reason:null}]})+'\n\n');res.write('data: '+JSON.stringify({id:'synthetic',object:'chat.completion.chunk',created:1,model:'synthetic',choices:[{index:0,delta:{},finish_reason:finished?'stop':'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}})+'\n\n');res.end('data: [DONE]\n\n');}
    else{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'synthetic'},finish_reason:'stop'}]}));}
  });await new Promise(r=>provider.listen(0,'127.0.0.1',r));
  const wait=async fn=>{for(let i=0;i<150;i++){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,200));}throw Error('MCP engine operation timed out');};
  try{
    const config=providerConfig([{id:'synthetic',name:'Synthetic',input_toman_per_million:100,output_toman_per_million:300,supported_parameters:['tools'],context_length:32000,max_output_tokens:4096}],'synthetic','http://127.0.0.1:'+provider.address().port);config.mcp={paasta:paastaMcpConfig(workspace)};
    await runtime.start({...config,mcp:{}});
    await runtime.call('/mcp',{method:'POST',body:{name:'paasta',config:paastaMcpConfig(workspace)}});
    await wait(async()=>{const status=await runtime.call('/mcp');return status.paasta?.status==='connected';});
    await runtime.stop();await runtime.start(config);await wait(async()=>{const status=await runtime.call('/mcp');return status.paasta?.status==='connected';});
    const session=await runtime.call('/session',{method:'POST',body:{title:'Synthetic MCP test'}});
    await runtime.call('/session/'+session.id+'/prompt_async',{method:'POST',body:{model:{providerID:'paasta',modelID:'synthetic'},parts:[{type:'text',text:'Request deployment review for fixture; do not upload without human approval.'}]}});
    const permission=await wait(async()=> (await runtime.call('/permission')).find(item=>item.sessionID===session.id));assert(toolName);assert.equal(requests,0);assert.equal(uploads,0);
    await runtime.call('/permission/'+permission.id+'/reply',{method:'POST',body:{reply:'once'}});
    await wait(async()=>requests===1);assert.equal(uploads,0,'Engine tool approval does not authorize deployment cost');
  }finally{await service.close();await new Promise(r=>provider.close(r));assert(workspace.startsWith(join(await realpath(tmpdir()),'paastacode-mcp-engine-')));await rm(workspace,{recursive:true,force:true});}
});
