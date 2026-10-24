import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {createServer as tcpServer,connect} from 'node:net';
import {once} from 'node:events';
import {startOutboundProxy,proxySettings} from '../src/outbound-proxy.mjs';

function through(url,target,auth=true){
  const proxy=new URL(url);
  return new Promise((resolve,reject)=>{
    const req=request({host:proxy.hostname,port:proxy.port,path:target,headers:auth?{'Proxy-Authorization':'Basic '+Buffer.from(proxy.username+':'+proxy.password).toString('base64')}:{},timeout:5000},res=>{let text='';res.on('data',data=>text+=data);res.on('end',()=>resolve({status:res.statusCode,text}));});
    req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('timeout')));req.end();
  });
}
test('proxy boundary validates schemes and keeps credentials out of URLs',()=>{
  assert.equal(proxySettings({enabled:true}).url,'http://127.0.0.1:2080/');
  for(const url of ['file:///secret','socks4://localhost:1','http://name:secret@localhost','http://localhost/?secret=x','http://localhost/path'])assert.throws(()=>proxySettings({enabled:true,url}));
  assert.throws(()=>proxySettings({enabled:'true'}));
  assert.equal(proxySettings({enabled:false},{password:'sentinel'}).password,'sentinel');
  assert.equal(proxySettings({enabled:true,password:''},{password:'sentinel'}).password,'');
});
test('HTTP proxy forwards through the selected upstream, requires capability, never falls back, and closes',{timeout:20000},async()=>{
  let count=0,authorization;
  const upstream=createServer((req,res)=>{count++;authorization=req.headers['proxy-authorization'];res.end('upstream-only');});await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
  let proxy;
  try{proxy=await startOutboundProxy(proxySettings({enabled:true,url:'http://127.0.0.1:'+upstream.address().port,username:'fixture',password:'synthetic'}),'https://paasta.example/api');
    assert.equal((await through(proxy.env.HTTP_PROXY,'http://does-not-exist.invalid/')).text,'upstream-only');assert.equal(count,1);assert.equal(authorization,'Basic '+Buffer.from('fixture:synthetic').toString('base64'));
    assert.equal((await through(proxy.env.HTTP_PROXY,'http://does-not-exist.invalid/',false)).status,407);assert.equal(count,1);
    assert.equal(proxy.env.http_proxy,proxy.env.HTTPS_PROXY);assert(proxy.env.no_proxy.includes('paasta.example'));
    upstream.closeAllConnections();await new Promise(r=>upstream.close(r));
    const failure=await through(proxy.env.HTTP_PROXY,'http://does-not-exist.invalid/');assert(failure.status>=500);assert(!failure.text.includes('synthetic'));
  }finally{await proxy?.close();upstream.closeAllConnections();upstream.close();}
  await assert.rejects(through(proxy.env.HTTP_PROXY,'http://does-not-exist.invalid/'));
  assert.equal(await startOutboundProxy({enabled:false}),null);
});
test('SOCKS5 tunnels HTTPS bytes with remote DNS and keeps local services direct',{timeout:20000},async()=>{
  let destination,connections=0;
  const socks=tcpServer(socket=>{connections++;socket.once('data',()=>{socket.write(Buffer.from([5,0]));socket.once('data',bytes=>{assert.equal(bytes[3],3);destination=bytes.subarray(5,5+bytes[4]).toString();socket.write(Buffer.from([5,0,0,1,127,0,0,1,0,1]));socket.on('data',data=>socket.write(data));});});});await new Promise(r=>socks.listen(0,'127.0.0.1',r));
  const local=createServer((req,res)=>res.end('local-direct'));await new Promise(r=>local.listen(0,'127.0.0.1',r));
  let proxy,socket;
  try{proxy=await startOutboundProxy(proxySettings({enabled:true,url:'socks5://127.0.0.1:'+socks.address().port}));
    const address=new URL(proxy.env.HTTPS_PROXY);
    socket=connect(Number(address.port),address.hostname);await once(socket,'connect');socket.write('CONNECT synthetic-mcp.invalid:443 HTTP/1.1\r\nHost: synthetic-mcp.invalid:443\r\nProxy-Authorization: Basic '+Buffer.from(address.username+':'+address.password).toString('base64')+'\r\n\r\n');
    const [reply]=await once(socket,'data');assert.match(reply.toString(),/200/);assert.equal(destination,'synthetic-mcp.invalid');
    const bytes=Buffer.from([0x16,0x03,0x01,0,2,1,0]);socket.write(bytes);const [echo]=await once(socket,'data');assert.deepEqual(echo,bytes);
    assert.equal((await through(proxy.env.HTTP_PROXY,'http://127.0.0.1:'+local.address().port)).text,'local-direct');assert.equal(connections,1);
  }finally{socket?.destroy();await proxy?.close();await new Promise(r=>socks.close(r));local.closeAllConnections();await new Promise(r=>local.close(r));}
});
