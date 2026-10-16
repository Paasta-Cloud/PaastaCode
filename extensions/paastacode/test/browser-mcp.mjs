import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';

test('bundled browser MCP actually opens a page, fills a form and captures a screenshot in an isolated profile',{timeout:90000},async()=>{
  const workspace=await realpath(await mkdtemp(join(tmpdir(),'paastacode-browser-actions-')));
  const page=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<html><title>Paasta browser fixture</title><body><h1>Browser acceptance</h1><label>Name<input aria-label="Name"></label><button onclick="document.querySelector(\'h1\').textContent=\'Saved fixture\'">Save</button></body></html>');});await new Promise(r=>page.listen(0,'127.0.0.1',r));
  const child=spawn(process.execPath,[fileURLToPath(new URL('../bin/browser-mcp.cjs',import.meta.url))],{cwd:workspace,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,...(process.platform!=='win32'?{PAASTACODE_BROWSER_EXECUTABLE:chromium.executablePath(),PAASTACODE_CLOUD_DATA:workspace}:{})}});let buffer='',sequence=0;const pending=new Map();
  child.stderr.resume();child.stdout.on('data',chunk=>{buffer+=chunk;let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(!line.trim())continue;const response=JSON.parse(line);const item=pending.get(response.id);if(item){pending.delete(response.id);clearTimeout(item.timer);response.error?item.reject(Error(JSON.stringify(response.error))):item.resolve(response.result);}}});
  const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Browser RPC timeout: '+method));},30000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
  const call=async(name,args)=>{const result=await rpc('tools/call',{name,arguments:args});assert(!result.isError,JSON.stringify(result));return result;};
  try{
    await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'PaastaCode synthetic browser acceptance',version:'1'}});child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
    const tools=await rpc('tools/list');assert(tools.tools.some(t=>t.name==='browser_take_screenshot'));
    const navigate=await call('browser_navigate',{url:'http://127.0.0.1:'+page.address().port});assert.match(JSON.stringify(navigate),/Paasta browser fixture/);
    const snap=await call('browser_snapshot',{}),snapshot=snap.content.map(p=>p.text||'').join('\n');assert.match(snapshot,/Browser acceptance/);const ref=snapshot.match(/textbox "Name" \[ref=(\w+)\]/)?.[1];assert(ref,snapshot);
    await call('browser_type',{target:ref,text:'PaastaCode fixture'});
    const screenshot=await call('browser_take_screenshot',{type:'png',filename:'paastacode-browser-fixture.png'});assert(screenshot.content.length);
    await call('browser_close',{});
  }finally{for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('Browser test closed'));}child.stdin.end();if(child.exitCode===null){child.kill();await new Promise(r=>{child.once('exit',r);setTimeout(r,3000).unref();});}page.closeAllConnections();await new Promise(r=>page.close(r));assert(workspace.startsWith(join(await realpath(tmpdir()),'paastacode-browser-actions-')));await rm(workspace,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
