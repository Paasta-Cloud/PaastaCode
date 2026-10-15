import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
export async function smokeBrowser(binary,client,cwd){
  const child=spawn(binary,[join(client,'bin/browser-mcp.cjs')],{cwd,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_PATH:join(client,'vendor/browser')}});child.stderr.resume();let buffer='';
  try{await new Promise((done,fail)=>{const timer=setTimeout(()=>fail(Error('Bundled browser MCP did not start')),20000),finish=error=>{clearTimeout(timer);error?fail(error):done();};child.once('error',finish);child.once('exit',code=>{if(code!==null)finish(Error('Bundled browser MCP exited before acceptance'));});
    child.stdout.on('data',chunk=>{buffer+=chunk;let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(!line.trim())continue;try{const result=JSON.parse(line);if(result.error)return finish(Error('Bundled browser MCP rejected initialization'));if(result.id===1){child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'})+'\n');}if(result.id===2){assert(result.result.tools.some(t=>t.name==='browser_navigate'));assert(result.result.tools.some(t=>t.name==='browser_take_screenshot'));finish();}}catch(error){finish(error);}}});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'PaastaCode installed acceptance',version:'1'}}})+'\n');
  });}finally{child.stdin.end();if(child.exitCode===null){child.kill();await new Promise(r=>{child.once('exit',r);setTimeout(r,3000).unref();});}}
}
