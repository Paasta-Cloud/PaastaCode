import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
process.env.PAASTACODE_HOME=resolve('.artifacts/project-ready-'+process.pid);
const {CodeRuntime,providerConfig}=await import('../src/runtime.mjs');
test('budgeted engine initializes offline without adding npm plugins and closes its relay',{timeout:90000},async()=>{
 const workspace=await mkdtemp(join(tmpdir(),'paastacode-ready-')),runtime=new CodeRuntime(workspace);
 try{
  const config=providerConfig([{id:'synthetic',supported_parameters:['tools'],input_toman_per_million:1,output_toman_per_million:1}],'synthetic','http://127.0.0.1:1');
  runtime.budgetBridge={url:'http://127.0.0.1:2/budget',capability:'synthetic'};
  await runtime.start(config);assert.deepEqual(config.plugin,[]);assert(await runtime.call('/path'));const relay=runtime.budgetRelay;assert(relay.baseURL.startsWith('http://127.0.0.1:'));await runtime.stop();assert.equal(runtime.budgetRelay,null);await assert.rejects(fetch(relay.baseURL));
 }finally{await runtime.stop();await rm(workspace,{recursive:true,force:true});}
});
