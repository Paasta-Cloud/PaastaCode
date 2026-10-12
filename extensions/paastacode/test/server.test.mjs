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
