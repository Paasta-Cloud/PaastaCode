import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
process.env.PAASTACODE_HOME=resolve('.artifacts/project-ready-'+process.pid);
const {CodeRuntime,providerConfig}=await import('../src/runtime.mjs');
test('engine readiness waits for project plugin initialization before accepting work',{timeout:90000},async()=>{
 const workspace=await mkdtemp(join(tmpdir(),'paastacode-ready-')),marker=join(workspace,'ready.txt'),plugin=join(workspace,'fixture.mjs'),runtime=new CodeRuntime(workspace);
 try{
  await writeFile(plugin,`import {writeFile} from 'node:fs/promises';export default async()=>{await new Promise(r=>setTimeout(r,250));await writeFile(${JSON.stringify(marker)},'ready');return {};};`);
  const config=providerConfig([{id:'synthetic',supported_parameters:['tools'],input_toman_per_million:1,output_toman_per_million:1}],'synthetic','http://127.0.0.1:1');config.plugin=[pathToFileURL(plugin).href];
  await runtime.start(config);assert.equal(await readFile(marker,'utf8'),'ready','listening alone must not report a usable project');
 }finally{await runtime.stop();await rm(workspace,{recursive:true,force:true});}
});
