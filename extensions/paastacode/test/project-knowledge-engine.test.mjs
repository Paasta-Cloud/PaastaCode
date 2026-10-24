import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,rm,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
process.env.PAASTACODE_HOME=resolve('.artifacts/knowledge-engine-'+process.pid);
const {ProjectKnowledge}=await import('../src/project-knowledge.mjs');
const {CodeRuntime,providerConfig}=await import('../src/runtime.mjs');
await import('../web/task-state.js');

test('real engine applies edited project knowledge on the next request without restart or paid provider calls',{timeout:90000},async()=>{
  const workspace=await realpath(await mkdtemp(join(tmpdir(),'paastacode-knowledge-engine-'))),knowledge=new ProjectKnowledge(workspace,'synthetic');
  const requests=[],provider=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const input=JSON.parse(raw);requests.push(input);
    const start=input.messages.findLastIndex(message=>message.role==='user'),runCheck=JSON.stringify(input.messages[start]).includes('RUN_SYNTHETIC_CHECK'),finished=input.messages.slice(start+1).some(message=>message.role==='tool'),bash=input.tools?.find(tool=>tool.function.name==='bash');
    const delta=runCheck&&!finished&&bash?{tool_calls:[{index:0,id:'call_synthetic_check',type:'function',function:{name:bash.function.name,arguments:JSON.stringify({command:'node --test synthetic.test.mjs',description:'Run synthetic fixture tests'})}}]}:{role:'assistant',content:'Synthetic answer'};
    if(input.stream){res.writeHead(200,{'Content-Type':'text/event-stream'});for(const [chunk,finish] of [[delta,null],[{},delta.tool_calls?'tool_calls':'stop']])res.write('data: '+JSON.stringify({id:'synthetic',object:'chat.completion.chunk',created:1,model:'synthetic',choices:[{index:0,delta:chunk,finish_reason:finish}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}})+'\n\n');res.end('data: [DONE]\n\n');}
    else{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'Synthetic answer'},finish_reason:'stop'}]}));}
  });
  await new Promise(done=>provider.listen(0,'127.0.0.1',done));
  const runtime=new CodeRuntime(workspace),wait=async check=>{for(let i=0;i<200;i++){if(await check())return;await new Promise(done=>setTimeout(done,150));}throw new Error('Synthetic engine request timed out');};
  try{
    const initial=await knowledge.read();await knowledge.save({content:'SYNTHETIC_PROJECT_RULE_ALPHA',revision:initial.revision});
    const config=providerConfig([{id:'synthetic',input_toman_per_million:1,output_toman_per_million:1,supported_parameters:['tools'],context_length:32000,max_output_tokens:1024}],'synthetic','http://127.0.0.1:'+provider.address().port);
    config.permission.bash='allow';config.instructions=[await knowledge.instruction()];
    const testContext=process.env.NODE_TEST_CONTEXT;delete process.env.NODE_TEST_CONTEXT;
    try{await runtime.start(config);}finally{if(testContext!==undefined)process.env.NODE_TEST_CONTEXT=testContext;}

    const session=await runtime.call('/session',{method:'POST',body:{title:'Synthetic knowledge test'}}),body={agent:'build',model:{providerID:'paasta',modelID:'synthetic'},parts:[{type:'text',text:'Answer briefly. Do not call tools.'}]};
    await runtime.call('/session/'+session.id+'/prompt_async',{method:'POST',body});
    await wait(async()=>requests.length>0&&!(await runtime.call('/session/status'))[session.id]);
    const system=()=>requests.at(-1).messages.filter(message=>message.role==='system').map(message=>message.content).join('\n');
    assert.match(system(),/SYNTHETIC_PROJECT_RULE_ALPHA/);
    const current=await knowledge.read();await knowledge.save({content:'SYNTHETIC_PROJECT_RULE_BETA',revision:current.revision});
    const count=requests.length;
    await runtime.call('/session/'+session.id+'/prompt_async',{method:'POST',body});
    await wait(async()=>requests.length>count&&!(await runtime.call('/session/status'))[session.id]);
    assert.match(system(),/SYNTHETIC_PROJECT_RULE_BETA/);assert.doesNotMatch(system(),/SYNTHETIC_PROJECT_RULE_ALPHA/);
    const fixture=join(workspace,'synthetic.test.mjs');
    await writeFile(fixture,"import test from 'node:test';import assert from 'node:assert/strict';test('synthetic',()=>assert.equal(1,2));");
    const verify=async()=>{const count=requests.length;await runtime.call('/session/'+session.id+'/prompt_async',{method:'POST',body:{...body,parts:[{type:'text',text:'RUN_SYNTHETIC_CHECK: call bash to run node --test synthetic.test.mjs once.'}]}});await wait(async()=>requests.length>count&&!(await runtime.call('/session/status'))[session.id]);return globalThis.PaastaTasks.recap(await runtime.call('/session/'+session.id+'/message'));};
    const failed=await verify();assert.equal(failed.checks.at(-1)?.status,'failed',JSON.stringify(failed.checks));assert.equal(failed.checks.at(-1)?.exit,1);
    await writeFile(fixture,"import test from 'node:test';test('synthetic',()=>{});");
    const passed=await verify();assert.equal(passed.checks.length,1);assert.equal(passed.checks[0].status,'passed');assert.equal(passed.checks[0].exit,0);

  }finally{await runtime.stop();provider.closeAllConnections();await new Promise(done=>provider.close(done));assert(workspace.startsWith(join(await realpath(tmpdir()),'paastacode-knowledge-engine-')));await rm(workspace,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
