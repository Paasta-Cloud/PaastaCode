import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,realpath,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
process.env.PAASTACODE_HOME=resolve('.artifacts/knowledge-'+process.pid);
const {ProjectKnowledge}=await import('../src/project-knowledge.mjs');
const {startServer}=await import('../src/server.mjs');

test('knowledge survives reopening, isolates project/account and rejects concurrent overwrites',async()=>{
  const home=await realpath(await mkdtemp(join(tmpdir(),'paastacode-knowledge-')));
  try{
    const a=new ProjectKnowledge('/project-a','account-a',home),empty=await a.read();
    const saved=await a.save({content:'## Tests\nnpm test',revision:empty.revision});
    assert.deepEqual(await new ProjectKnowledge('/project-a','account-a',home).read(),saved);
    assert.equal((await new ProjectKnowledge('/project-b','account-a',home).read()).content,'');
    assert.equal((await new ProjectKnowledge('/project-a','account-b',home).read()).content,'');
    const writes=await Promise.allSettled([a.save({content:'one',revision:saved.revision}),new ProjectKnowledge('/project-a','account-a',home).save({content:'two',revision:saved.revision})]);
    assert.equal(writes.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(writes.filter(r=>r.status==='rejected').length,1);
    const current=await a.read();assert.equal(current.content,'one');
    await assert.rejects(a.save({content:'x'.repeat(16385),revision:current.revision}));
    await assert.rejects(a.save({content:'bad\0value',revision:current.revision}));
    const path=await a.instruction();assert.equal(await readFile(path,'utf8'),'one');
    if(process.platform!=='win32')assert.equal((await stat(path)).mode&0o777,0o600);
    const cleared=await a.save({content:'',revision:current.revision});assert.equal(cleared.content,'');
    await writeFile(path,'x'.repeat(16385));await assert.rejects(a.read());
  }finally{assert(home.startsWith(join(await realpath(tmpdir()),'paastacode-knowledge-')));await rm(home,{recursive:true,force:true});}
});

test('knowledge API retains capability/account boundaries and exposes the same instructions to every engine client',async()=>{
  let config,stops=0;
  const account={origin:'https://synthetic.test',credentials:{token:'synthetic',aiKey:'synthetic'},async context(){return {account:{id:'synthetic-user',tenantId:'synthetic-tenant'},models:[{id:'paasta/deepseek-v4-flash',supported_parameters:['tools'],input_toman_per_million:1,output_toman_per_million:1}]};}};
  const runtime={url:null,async start(value){config=value;this.url='http://127.0.0.1:1';},async stop(){stops++;this.url=null;},async call(path){return path==='/session/status'?{}:[];}};
  const app=await startServer({account,runtime});
  const call=async(path,body,revision)=>{const r=await fetch(app.url+'/api/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+app.capability,'Content-Type':'application/json',...(revision===undefined?{}:{'X-PaastaCode-Account':String(revision)})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
  try{
    assert.equal((await fetch(app.url+'/api/knowledge')).status,401);
    const state=await call('state');assert.equal(state.body.features.projectKnowledge,true);
    const initial=await call('knowledge');assert.equal(initial.status,200,JSON.stringify(initial.body));
    const saved=await call('knowledge',{content:'## Build\nnpm run build',revision:initial.body.revision},state.body.accountRevision);
    assert.equal(saved.status,200);assert.equal((await call('knowledge')).body.content,saved.body.content);
    assert.equal(await readFile(config.instructions[0],'utf8'),saved.body.content);
    assert.notEqual((await call('knowledge',{content:'stale',revision:initial.body.revision},state.body.accountRevision)).status,200);
    assert.equal((await call('knowledge',{content:'wrong account',revision:saved.body.revision},9999)).status,409);
    assert.equal((await call('knowledge')).body.content,saved.body.content);
    assert.equal(stops,0,'Saving knowledge must not interrupt the running engine');
    const inputPath=join(process.env.PAASTACODE_HOME,'cli-input.md'),exportPath=join(process.env.PAASTACODE_HOME,'cli-export.md');
    await writeFile(inputPath,'Synthetic CLI project knowledge');
    const cli=extra=>new Promise((done,fail)=>{const child=spawn(process.execPath,[fileURLToPath(new URL('../bin/paastacode.mjs',import.meta.url)),'knowledge','--workspace='+process.cwd(),...extra],{windowsHide:true,env:{...process.env},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';const timer=setTimeout(()=>{child.kill();fail(new Error('CLI fixture timed out'));},20000);child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.once('error',fail);child.once('close',code=>{clearTimeout(timer);done({code,stdout,stderr});});});
    const imported=await cli(['--file='+inputPath]);assert.equal(imported.code,0,imported.stderr);assert.equal((await call('knowledge')).body.content,'Synthetic CLI project knowledge');
    const exported=await cli(['--export='+exportPath]);assert.equal(exported.code,0,exported.stderr);assert.equal(await readFile(exportPath,'utf8'),'Synthetic CLI project knowledge');
    assert.equal((await cli(['--export='+exportPath])).code,1,'CLI never replaces an existing backup');

  }finally{await app.close();}
});
