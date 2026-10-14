import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
process.env.PAASTACODE_HOME=resolve('.artifacts/engine-output-test');
const {CodeRuntime,providerConfig}=await import('../src/runtime.mjs');
test('real engine exposes partial shell stdout before completion',{timeout:90000},async()=>{
  const workspace=await realpath(await mkdtemp(join(tmpdir(),'paastacode-output-'))),runtime=new CodeRuntime(workspace);
  const provider=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw),finished=input.messages.some(m=>m.role==='tool');
    const delta=finished?{content:'Finished'}:{tool_calls:[{index:0,id:'call_stdout',type:'function',function:{name:'bash',arguments:JSON.stringify({command:`node -e "console.log('first-line');setTimeout(()=>console.log('last-line'),4000)"`,description:'Synthetic output probe'})}}]};
    res.writeHead(200,{'Content-Type':'text/event-stream'});for(const choice of [{delta:{role:'assistant',...delta},finish_reason:null},{delta:{},finish_reason:finished?'stop':'tool_calls'}])res.write('data: '+JSON.stringify({id:'synthetic',object:'chat.completion.chunk',choices:[{index:0,...choice}]})+'\n\n');res.end('data: [DONE]\n\n');
  });await new Promise(r=>provider.listen(0,'127.0.0.1',r));
  try{
    const config=providerConfig([{id:'synthetic',name:'Synthetic',input_toman_per_million:100,output_toman_per_million:300,supported_parameters:['tools']}],'synthetic','http://127.0.0.1:'+provider.address().port);config.permission.bash='allow';await runtime.start(config);
    const session=await runtime.call('/session',{method:'POST',body:{}});await runtime.call('/session/'+session.id+'/prompt_async',{method:'POST',body:{model:{providerID:'paasta',modelID:'synthetic'},parts:[{type:'text',text:'Run the synthetic probe'}]}});
    let partial=false,complete=false;for(let i=0;i<180;i++){const messages=await runtime.call('/session/'+session.id+'/message');const part=messages.flatMap(m=>m.parts).find(p=>p.type==='tool'&&p.tool==='bash');if(part?.state.status==='running'&&part.state.metadata?.output?.includes('first-line'))partial=true;if(part?.state.status==='completed'){assert.match(part.state.output,/last-line/);complete=true;break;}await new Promise(r=>setTimeout(r,200));}
    assert(partial,'Running shell stdout must arrive in metadata.output before exit');assert(complete,'Command must finish');
  }finally{await runtime.stop();await new Promise(r=>provider.close(r));assert(workspace.startsWith(await realpath(tmpdir()))&&workspace.includes('paastacode-output-'));await rm(workspace,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
