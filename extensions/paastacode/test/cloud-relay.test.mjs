import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {relayCloud} from '../src/cloud-relay.mjs';

test('desktop cloud relay pins the owner and credential, preserves project and rejects arbitrary forwarding',async()=>{
  const calls=[],server=createServer((req,res)=>{calls.push({url:req.url,headers:req.headers});res.writeHead(409,{'Content-Type':'application/json'});res.end(JSON.stringify({projectChanged:true,error:'changed'}));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const id='11111111-1111-4111-8111-111111111111',owner=id+':'+id,account={origin:'http://127.0.0.1:'+server.address().port,credentials:{token:'synthetic'},context:async()=>({account:{id,tenantId:id}})};
  const input={account,url:new URL('http://local/api/remote/workspaces/'+id+'/runtime/prompt'),method:'POST',headers:{'x-paastacode-owner':owner,'x-paastacode-project':'default','x-paastacode-account':'9'},body:{text:'test'}};
  try{
    assert.equal((await relayCloud({...input,headers:{}})).status,409);assert.equal(calls.length,0);
    assert.equal((await relayCloud({...input,url:new URL('http://local/api/remote/workspaces/'+id+'/lifecycle')})).status,404);assert.equal(calls.length,0);
    const result=await relayCloud(input);assert.equal(result.status,409);assert.equal(result.data.projectChanged,true);assert.equal(calls[0].headers.authorization,'Bearer synthetic');assert.equal(calls[0].headers['x-paastacode-project'],'default');assert.equal(calls[0].headers['x-paastacode-account'],'9');assert.equal(calls[0].url,'/api/paastacode/workspaces/'+id+'/runtime/prompt');
    account.credentials=null;assert.equal((await relayCloud(input)).status,401);assert.equal(calls.length,1);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
