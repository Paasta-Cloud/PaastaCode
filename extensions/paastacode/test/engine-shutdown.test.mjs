import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {EventEmitter} from 'node:events';
import {CodeRuntime} from '../src/runtime.mjs';
test('shutdown ends an owned engine even when graceful termination is ignored',{timeout:10000},async()=>{
  const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"],{detached:process.platform!=='win32',stdio:['ignore','pipe','ignore'],windowsHide:true});
  try{await once(child.stdout,'data');const exited=once(child,'exit'),runtime=new CodeRuntime(process.cwd());runtime.process=child;runtime.url='http://127.0.0.1:1';await runtime.stop();await exited;assert.equal(runtime.process,null);assert.equal(runtime.url,null);if(process.platform!=='win32')assert.equal(child.signalCode,'SIGKILL');}
  finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
});

test('shutdown tolerates a denied group signal only after the owned child exited',{skip:process.platform==='win32'},async t=>{
  const child=new EventEmitter();Object.assign(child,{pid:123456789,exitCode:null,signalCode:null});
  t.mock.method(process,'kill',(pid,signal)=>{assert.equal(pid,-child.pid);if(signal==='SIGTERM'){child.exitCode=0;child.emit('exit',0);return true;}throw Object.assign(new Error('kill EPERM'),{code:'EPERM'});});
  const runtime=new CodeRuntime(process.cwd());runtime.process=child;runtime.url='http://127.0.0.1:1';
  await runtime.stop();assert.equal(runtime.process,null);assert.equal(runtime.url,null);
});

test('shutdown rejects a denied signal to a live engine and removes its timer and exit listener',{skip:process.platform==='win32'},async t=>{
  const child=new EventEmitter();Object.assign(child,{pid:123456789,exitCode:null,signalCode:null});
  t.mock.method(process,'kill',()=>{throw Object.assign(new Error('kill EPERM'),{code:'EPERM'});});
  const runtime=new CodeRuntime(process.cwd());runtime.process=child;
  await assert.rejects(runtime.stop(),{code:'EPERM'});assert.equal(child.listenerCount('exit'),0);
});
