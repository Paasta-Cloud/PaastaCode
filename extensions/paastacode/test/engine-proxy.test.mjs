import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
process.env.PAASTACODE_HOME=resolve('.artifacts/engine-proxy-'+process.pid);
const {CodeRuntime}=await import('../src/runtime.mjs');

test('pinned engine uses proxy for MCP transport and OAuth discovery, preserves loopback health and closes listener',{timeout:90000},async()=>{
  const workspace=await realpath(await mkdtemp(join(tmpdir(),'paastacode-engine-proxy-'))),runtime=new CodeRuntime(workspace),seen=[];
  const proxy=createServer(async(req,res)=>{
    seen.push(req.url);const url=new URL(req.url);res.setHeader('Content-Type','application/json');
    if(url.pathname.includes('/.well-known/'))return res.end(JSON.stringify(url.pathname.includes('oauth-protected-resource')?{resource:'http://mcp.fixture.invalid/mcp',authorization_servers:['http://auth.fixture.invalid']}:{issuer:'http://auth.fixture.invalid',authorization_endpoint:'https://auth.fixture.invalid/authorize',token_endpoint:'http://auth.fixture.invalid/token',registration_endpoint:'http://auth.fixture.invalid/register',response_types_supported:['code'],code_challenge_methods_supported:['S256']}));
    if(url.pathname==='/register'){res.statusCode=201;return res.end(JSON.stringify({client_id:'fixture-client',redirect_uris:['http://localhost:19876/mcp/oauth/callback'],token_endpoint_auth_method:'none'}));}
    res.statusCode=401;res.setHeader('WWW-Authenticate','Bearer resource_metadata="http://mcp.fixture.invalid/.well-known/oauth-protected-resource"');res.end('{}');
  });await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
  try{
    // HTTP is only a synthetic transport fixture; customer remote configs still require HTTPS.
    await runtime.start({autoupdate:false,share:'disabled',mcp:{fixture:{type:'remote',url:'http://mcp.fixture.invalid/mcp'}}},{proxy:{enabled:true,url:'http://127.0.0.1:'+proxy.address().port,username:'',password:''}});
    const auth=await runtime.call('/mcp/fixture/auth',{method:'POST',timeout:30000});assert.match(auth.authorizationUrl,/^https:\/\/auth.fixture.invalid\/authorize/);assert(auth.oauthState);
    assert(seen.some(url=>url==='http://mcp.fixture.invalid/mcp'),'MCP request must reach the selected proxy');
    assert(seen.some(url=>url.includes('/.well-known/')),'OAuth discovery must use the same proxy');
    assert(!seen.some(url=>url.includes('127.0.0.1')),'Engine health must bypass proxy');
    await runtime.stop();assert.equal(runtime.proxy,null);
  }finally{await runtime.stop();proxy.closeAllConnections();await new Promise(r=>proxy.close(r));assert(workspace.startsWith(join(await realpath(tmpdir()),'paastacode-engine-proxy-')));await rm(workspace,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
