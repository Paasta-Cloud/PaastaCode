import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {startServer} from "../src/server.mjs";
import {workspaceConnection,runtimeRequest} from "../web/hosted.js";

test("hosted connector accepts only loopback workspace links",()=>{
  const cap="a".repeat(43);assert.equal(workspaceConnection("http://127.0.0.1:14567/#cap="+cap).origin,"http://127.0.0.1:14567");
  for(const url of ["https://evil.test/#cap="+cap,"http://127.0.0.1.evil.test:1/#cap="+cap,"http://user@127.0.0.1:1/#cap="+cap,"http://127.0.0.1:1/path#cap="+cap,"http://127.0.0.1:1/?secret=x#cap="+cap,"http://127.0.0.1:1/#cap=x"]){assert.throws(()=>workspaceConnection(url));}
});
test("cloud transport uses same-origin session and owner pin without loopback credentials",()=>{
  const id="00000000-0000-4000-8000-000000000011",owner=id+":"+id;
  const request=runtimeRequest({kind:"cloud",id,owner},"prompt","POST",{text:"hello"},{capability:"must-not-forward",accountRevision:7});
  assert.equal(request.url,`/api/paastacode/workspaces/${id}/runtime/prompt`);
  assert.equal(request.init.credentials,"same-origin");assert.equal(request.init.headers["X-PaastaCode-Owner"],owner);
  assert.equal(request.init.headers["X-PaastaCode-Account"],"7");assert(!("Authorization" in request.init.headers));assert(!("targetAddressSpace" in request.init));
  for(const path of ["../private","//other.test/api","state#fragment","state/../../wallet"])assert.throws(()=>runtimeRequest({kind:"cloud",id,owner},path));
  assert.throws(()=>runtimeRequest({kind:"cloud",id:"../x",owner},"state"));
  assert.throws(()=>runtimeRequest({kind:"cloud",id,owner:"foreign"},"state"));
  assert.throws(()=>runtimeRequest({origin:"https://other.test",capability:"a".repeat(43)},"state"));
  const local=runtimeRequest(workspaceConnection("http://127.0.0.1:14567/#cap="+"a".repeat(43)),"state");
  assert.equal(local.init.credentials,"omit");assert.equal(local.init.targetAddressSpace,"loopback");
});
test("hosted CORS is opt-in and still requires the workspace capability",async()=>{
  const workspace=await mkdtemp(join(tmpdir(),"paastacode-hosted-"));
  const account={credentials:null},runtime={stop:async()=>{}};
  const local=await startServer({workspace,account,runtime});const hosted=await startServer({workspace,account,runtime,hosted:true});
  try{
    const origin="https://code.paasta.cloud";
    const headers={Origin:origin,Authorization:"Bearer "+hosted.capability};
    let result=await fetch(local.url+"/api/state",{headers:{Origin:origin,Authorization:"Bearer "+local.capability}});assert.equal(result.status,403);assert.equal(result.headers.get("access-control-allow-origin"),null);
    result=await fetch(hosted.url+"/api/state",{headers});assert.equal(result.status,200);assert.equal(result.headers.get("access-control-allow-origin"),origin);assert.equal(result.headers.get("access-control-allow-credentials"),null);
    result=await fetch(hosted.url+"/api/state",{headers:{Origin:origin}});assert.equal(result.status,401);
    result=await fetch(hosted.url+"/api/state",{headers:{...headers,Origin:"https://evil.test"}});assert.equal(result.status,403);assert.equal(result.headers.get("access-control-allow-origin"),null);
    result=await fetch(hosted.url+"/api/state",{method:"OPTIONS",headers:{Origin:origin,"Access-Control-Request-Method":"GET","Access-Control-Request-Headers":"authorization,content-type","Access-Control-Request-Private-Network":"true"}});assert.equal(result.status,204);assert.equal(result.headers.get("access-control-allow-private-network"),"true");
    result=await fetch(hosted.url+"/api/state",{method:"OPTIONS",headers:{Origin:origin,"Access-Control-Request-Method":"PUT"}});assert.equal(result.status,403);
  }finally{await local.close();await hosted.close();await rm(workspace,{recursive:true,force:true});}
});
