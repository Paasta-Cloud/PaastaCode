import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {PaastaAccount,readPrivate,writePrivate} from "../src/account.mjs";
import {PaastaDeployment} from "../src/deployment.mjs";

const owner={id:"00000000-0000-4000-8000-000000000011",tenantId:"00000000-0000-4000-8000-000000000012"};
test("cloud account rejects foreign grants before saving or replacing credentials, including restored and deployment accounts",async()=>{
  const home=await mkdtemp(join(tmpdir(),"paastacode-owner-")),token="paasta_"+"a".repeat(43),calls=[];
  let identity=owner,identityStatus=200;
  const server=createServer((req,res)=>{
    calls.push({path:req.url,authorization:req.headers.authorization});res.setHeader("Content-Type","application/json");
    if(req.url==="/api/paastacode/identity"){res.statusCode=identityStatus;res.end(JSON.stringify(identity));return;}
    if(req.url==="/api/cli/device/token"){res.end(JSON.stringify({token}));return;}
    res.statusCode=404;res.end("{}");
  });
  await new Promise(done=>server.listen(0,"127.0.0.1",done));
  const origin="http://127.0.0.1:"+server.address().port;
  const begin=account=>{account.device={code:"synthetic",expires:Date.now()+60000,nextPoll:0};};
  try{
    const account=await new PaastaAccount(origin,home,{owner}).load();
    for(const foreign of [{...owner,id:"00000000-0000-4000-8000-000000000099"},{...owner,tenantId:"00000000-0000-4000-8000-000000000099"}]){
      identity=foreign;begin(account);await assert.rejects(account.poll(),/صاحب این فضای کار/);
      assert.equal(account.credentials,null);assert.equal(account.device,null);assert.equal(await readPrivate(account.path),null);
    }
    identity=owner;begin(account);assert.deepEqual(await account.poll(),{pending:false});
    assert.equal((await readPrivate(account.path)).token,token);
    assert.equal(calls.find(c=>c.path==="/api/paastacode/identity").authorization,"Bearer "+token);
    const original=await readPrivate(account.path);
    identity={...owner,id:"00000000-0000-4000-8000-000000000099"};begin(account);
    await assert.rejects(account.poll(),/صاحب این فضای کار/);
    assert.deepEqual(account.credentials,original);assert.deepEqual(await readPrivate(account.path),original);
    const restored=new PaastaAccount(origin,home,{owner});await assert.rejects(restored.load(),/صاحب این فضای کار/);assert.equal(restored.credentials,null);
    const deployment=new PaastaDeployment({workspace:home,account});
    deployment.connection.path=join(home,"deployment-account.json");
    await writePrivate(deployment.connection.path,original);
    await assert.rejects(deployment.load(),/صاحب این فضای کار/);assert.equal(deployment.connection.credentials,null);
    identity=owner;identityStatus=503;begin(account);await assert.rejects(account.poll());
    assert.deepEqual(await readPrivate(account.path),original);
    identityStatus=200;assert.equal((await new PaastaAccount(origin,home,{owner}).load()).credentials.token,token);
  }finally{server.closeAllConnections();await new Promise(done=>server.close(done));await rm(home,{recursive:true,force:true});}
});

test("cloud account owner must be a fixed valid user and tenant",()=>{
  for(const invalid of [null,{},"owner",{...owner,id:""},{...owner,tenantId:"other"}])assert.throws(()=>new PaastaAccount(undefined,undefined,{owner:invalid}));
  const supplied={...owner},account=new PaastaAccount(undefined,undefined,{owner:supplied});
  supplied.id="other";assert.deepEqual(account.owner,owner);assert(Object.isFrozen(account.owner));
});

test("canceling login during cloud ownership verification cannot persist its token",async()=>{
  const home=await mkdtemp(join(tmpdir(),"paastacode-owner-race-"));
  let respond,started;
  const checking=new Promise(done=>{started=done;});
  const account=new PaastaAccount(undefined,home,{owner});
  account.request=async path=>{
    if(path==="/api/cli/device/token")return {token:"paasta_"+"b".repeat(43)};
    assert.equal(path,"/api/paastacode/identity");started();return new Promise(done=>{respond=done;});
  };
  try{
    account.device={code:"synthetic",expires:Date.now()+60000,nextPoll:0};
    const poll=account.poll();await checking;await account.forget();respond(owner);
    await assert.rejects(poll,/لغو شده/);assert.equal(account.credentials,null);assert.equal(await readPrivate(account.path),null);
  }finally{await rm(home,{recursive:true,force:true});}
});
