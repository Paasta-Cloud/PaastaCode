import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
process.env.PAASTACODE_HOME=resolve('.artifacts/engine-integrations-test-'+process.pid);
const {CodeRuntime,providerConfig}=await import('../src/runtime.mjs');
const {WorkspaceIntegrations}=await import('../src/integrations.mjs');
const {sessionPermissions}=await import('../src/access.mjs');
test('real pinned engine discovers installed skills and the bundled browser without reading a project config',{timeout:90000},async()=>{
  const workspace=await realpath(await mkdtemp(join(tmpdir(),'paastacode-engine-tools-'))),runtime=new CodeRuntime(workspace);
  let target,referenceSeen=false;
  const provider=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw);assert(!raw.includes('private-outside-skill-sentinel'));
    const finished=input.messages.some(m=>m.role==='tool');if(finished&&raw.includes('keyboard-reference-sentinel'))referenceSeen=true;
    const delta=finished?{content:'Synthetic reference check finished.'}:{tool_calls:[{index:0,id:'call_read_reference',type:'function',function:{name:'read',arguments:JSON.stringify({filePath:target})}}]};
    if(!input.stream){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'synthetic'},finish_reason:'stop'}]}));return;}
    res.setHeader('Content-Type','text/event-stream');for(const [part,reason] of [[{role:'assistant',...delta},null],[{},finished?'stop':'tool_calls']])res.write('data: '+JSON.stringify({id:'synthetic',object:'chat.completion.chunk',created:1,model:'synthetic',choices:[{index:0,delta:part,finish_reason:reason}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}})+'\n\n');res.end('data: [DONE]\n\n');});await new Promise(r=>provider.listen(0,'127.0.0.1',r));
  try{
    const integrations=new WorkspaceIntegrations(workspace,'synthetic-engine-tools');
    await integrations.update({kind:'skill',name:'review-ui',action:'save',description:'Review UI changes',instructions:'Check keyboard navigation and report actual tests.',files:[{path:'references/check.md',data:Buffer.from('keyboard-reference-sentinel').toString('base64')}]});await integrations.update({kind:'browser',enabled:true});
    const config=await integrations.config();await runtime.start({...providerConfig([{id:'synthetic',input_toman_per_million:1,output_toman_per_million:1,supported_parameters:['tools']}],'synthetic','http://127.0.0.1:'+provider.address().port),...config});
    const status=await runtime.call('/mcp');assert.equal(status.browser?.status,'connected');
    const skills=await runtime.call('/skill');assert(skills.some(s=>s.name==='review-ui'&&s.content.includes('Check keyboard navigation')));
    const run=async(path)=>{target=path;const session=await runtime.call('/session',{method:'POST',body:{permission:sessionPermissions('review','build',config.skills.paths)}});await runtime.call('/session/'+session.id+'/prompt_async',{method:'POST',body:{model:{providerID:'paasta',modelID:'synthetic'},parts:[{type:'text',text:'Read the synthetic reference.'}]}});for(let n=0;n<100;n++){const messages=await runtime.call('/session/'+session.id+'/message');if(messages.some(m=>m.parts.some(p=>p.type==='text'&&p.text==='Synthetic reference check finished.')))return messages;await new Promise(r=>setTimeout(r,100));}throw Error('Reference tool did not finish');};
    await run(join(config.skills.paths[0],'review-ui/references/check.md'));assert(referenceSeen,'Managed skill references must be readable without granting the private account directory');
    const outside=join(integrations.root,'private-fixture.txt');await writeFile(outside,'private-outside-skill-sentinel');const denied=await run(outside);assert(denied.some(m=>m.parts.some(p=>p.type==='tool'&&p.state?.status==='error')));assert(!(await runtime.call('/permission')).length);
  }finally{await runtime.stop();provider.closeAllConnections();await new Promise(r=>provider.close(r));assert(workspace.startsWith(join(await realpath(tmpdir()),'paastacode-engine-tools-')));await rm(workspace,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
