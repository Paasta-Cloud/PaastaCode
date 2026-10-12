import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,realpath} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
process.env.PAASTACODE_HOME=resolve(".artifacts/server-state");
const {startServer}=await import("../src/server.mjs");
const {PaastaAccount}=await import("../src/account.mjs");

test("expired credentials can be cleared while transport failures retain retry state",async()=>{
  const account=new PaastaAccount("https://example.test",resolve(".artifacts/expired-account"));
  account.credentials={token:"synthetic"};account.request=async()=>{const error=new Error("expired");error.status=401;throw error;};
  await account.logout();assert.equal(account.credentials,null);
  account.credentials={token:"synthetic"};account.request=async()=>{throw new Error("network unavailable");};
  await assert.rejects(account.logout());assert.equal(account.credentials.token,"synthetic");
});

test("device broker rejects malformed IDs and only stops execution after current-grant revocation",async()=>{
  const peer="00000000-0000-4000-8000-000000000001",current="00000000-0000-4000-8000-000000000002";
  const requests=[];let stops=0,disconnects=0;
  const account={credentials:{token:"synthetic",aiKey:"synthetic"},
    context:async()=>({account:{id:"synthetic",tenantId:"synthetic"},models:[]}),
    request:async(path,{method}={})=>{requests.push({path,method});return method==="DELETE"?{ok:true,revoked:true,current:path.endsWith(current)}:{devices:[]};},
    async logout(){throw new Error("revoked credentials must not require another network request");},async forget(){this.credentials=null;}};
  const runtime={url:"http://127.0.0.1:1",async stop(){stops++;this.url=null;}},deployment={async disconnect(){disconnects++;throw new Error("synthetic network failure");}};
  const app=await startServer({account,runtime,deployment});
  const headers={Authorization:"Bearer "+app.capability};
  try{
    assert.equal((await fetch(app.url+"/api/devices")).status,401);
    assert.equal((await (await fetch(app.url+"/api/state",{headers})).json()).features.deviceManagement,true);
    assert.deepEqual(await (await fetch(app.url+"/api/devices",{headers})).json(),{devices:[]});
    assert.equal((await fetch(app.url+"/api/devices?id=malformed",{method:"DELETE",headers})).status,400);
    assert.equal(requests.length,1,"malformed IDs must not reach the account API");
    await fetch(app.url+"/api/devices?id="+peer,{method:"DELETE",headers});assert.equal(stops,0);assert(account.credentials);
    const result=await (await fetch(app.url+"/api/devices?id="+current,{method:"DELETE",headers})).json();
    assert.equal(result.current,true);assert(result.warning);assert.equal(stops,1);assert.equal(disconnects,1);assert.equal(account.credentials,null);
    assert.equal((await (await fetch(app.url+"/api/state",{headers})).json()).connected,false);
  }finally{await app.close();}
});

test("web and desktop share one authenticated service for the same directory",async()=>{
  const workspace=await realpath(await mkdtemp(join(tmpdir(),"paastacode-server-")));
  const account={credentials:null};let services=[];
  try{
    services=await Promise.all([startServer({workspace,account}),startServer({workspace,account})]);
    assert.equal(services[0].url,services[1].url);
    assert.equal(services.filter(s=>s.reused).length,1);
    const owner=services.find(s=>!s.reused),shared=services.find(s=>s.reused);
    assert.equal((await fetch(owner.url+"/api/state")).status,401);
    assert.match((await fetch(owner.url)).headers.get("Content-Security-Policy"),/frame-ancestors 'self'/);
    assert.equal((await fetch(owner.url+"/embed/wrong")).status,404);
    const embed=await fetch(owner.url+"/embed/"+owner.capability);
    assert.equal(embed.status,200);assert(!embed.headers.get("Content-Security-Policy").includes("frame-ancestors"));
    assert.equal((await fetch(owner.url+"/api/state",{headers:{Authorization:"Bearer "+owner.capability,Origin:"https://other.test"}})).status,403);
    await shared.close();
    assert.equal((await fetch(owner.url+"/api/state",{headers:{Authorization:"Bearer "+owner.capability}})).status,200,"closing a reused client must not stop its owner");
    const stopped=new Promise(resolveStop=>owner.server.once("close",resolveStop));
    assert.equal((await fetch(owner.url+"/api/shutdown",{method:"POST",headers:{Authorization:"Bearer "+owner.capability}})).status,200);
    await stopped;
    await assert.rejects(fetch(owner.url+"/api/state"));
  }finally{for(const service of services)await service.close();assert(workspace.startsWith(join(await realpath(tmpdir()),"paastacode-server-")));await rm(workspace,{recursive:true,force:true});}
});
