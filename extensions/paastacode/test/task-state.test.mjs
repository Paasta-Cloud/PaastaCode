import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../web/task-state.js';
const {status,recap}=globalThis.PaastaTasks;
const user={info:{role:'user'},parts:[{type:'text',text:'change'}]};
const assistant=parts=>({info:{role:'assistant'},parts});
const tool=(name,state)=>({type:'tool',tool:name,state});

test('approval takes priority over running; unrelated sessions do not leak state',()=>{
  const busy={a:{type:'busy'},b:{type:'retry'},c:{type:'idle'}};
  assert.equal(status('a',busy,[{sessionID:'a'}]),'waiting');
  assert.equal(status('b',busy,[{sessionID:'a'}]),'running');
  assert.equal(status('c',busy,[]),'idle');assert.equal(status('missing',busy,[]),'idle');
});
test('recap isolates the last request and counts only completed observed edits',()=>{
  const result=recap([user,assistant([tool('bash',{status:'error'})]),user,assistant([
    tool('edit',{status:'completed',input:{filePath:'src/app.ts'}}),tool('edit',{status:'completed',input:{filePath:'src/app.ts'}}),
    tool('write',{status:'running',input:{filePath:'unfinished.ts'}}),tool('bash',{status:'completed',input:{command:'false'},output:'test failed'})
  ])]);
  assert.deepEqual(result.files,['src/app.ts']);assert.equal(result.errors,0);assert.equal(result.completed,3);
  assert.equal(result.commands,1);assert.equal(result.unfinished,true);assert.equal(result.title,'اجرای ناتمام');
  assert(!result.detail.includes('موفق'),'Shell completion does not prove tests passed');
});
test('empty responses have no recap; message errors and failed tools require review',()=>{
  assert.equal(recap([user,assistant([])]),null);
  assert.equal(recap([user]),null);
  const result=recap([user,{info:{role:'assistant',error:{name:'MessageAbortedError'}},parts:[]}]);
  assert.equal(result.errors,1);assert.equal(result.title,'اجرا نیاز به بررسی دارد');
  assert.equal(recap([assistant([tool('bash',{status:'error'})])]).errors,1);
});
test('patch file evidence is deduplicated and malformed metadata is ignored',()=>{
  const result=recap([assistant([tool('apply_patch',{status:'completed',metadata:{files:[{filePath:'a'},{filePath:'a'},{filePath:'b'}]}}),tool('apply_patch',{status:'completed',metadata:{files:'unstructured'}})])]);
  assert.deepEqual(result.files,['a','b']);assert.equal(result.unfinished,false);
});

test('verification uses recorded exit codes and never infers success from output or a compound command',()=>{
  const check=(command,status,exit,output='')=>tool('bash',{status,input:{command},metadata:exit===undefined?{}:{exit},output});
  const result=recap([user,assistant([
    check('npm test','completed',0,'passed'),check('npm run build','completed',1,'Build failed'),
    check('pytest','completed',undefined,'100 passed'),check('go test ./...','running',undefined),
    check('echo npm test','completed',0),check('npm test; echo ignored','completed',0),
    check('node --test test/a.mjs','error',undefined,'terminated')
  ])]);
  assert.deepEqual(result.checks.map(c=>c.status),['passed','failed','unknown','running','failed']);
  assert.equal(result.errors,2);assert.equal(result.title,'اجرا نیاز به بررسی دارد');
  assert.equal(recap([user,assistant([check('npm test','completed',1)]),user,assistant([check('npm test','completed',0)])]).checks.length,1);
});

test('zero exit without executed tests remains unknown',()=>{assert.equal(recap([user,assistant([tool('bash',{status:'completed',input:{command:'node --test'},metadata:{exit:0},output:'# tests 0'})])]).checks[0].status,'unknown');});
