import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";

test("export API pins the workspace/account, blocks writes while downloading and cancels on logout",async()=>{
  const root=await mkdtemp(join(tmpdir(),"paastacode-export-api-"));process.env.PAASTACODE_HOME=join(root,"account");
  const {startServer}=await import("../src/server.mjs");
  const account={origin:"https://example.test",credentials:{token:"synthetic"},context:async()=>({account:{id:"user-a",tenantId:"tenant-a"},models:[]}),logout:async()=>{account.credentials=null;}};
  let job=null,started=0,running=false,closed=0;
  const exporter={get busy(){return !!job;},start(owner){started++;job={id:"synthetic-job",owner};return {id:job.id};},read(id,owner,offset){assert.equal(id,job.id);assert.equal(owner,job.owner);assert.equal(offset,0);return {offset:0,nextOffset:0,data:"",done:true};},cancel(id,owner){assert.equal(id,job.id);assert.equal(owner,job.owner);job=null;return {ok:true};},close(){closed++;job=null;}};
  const runtime={url:null,stop:async()=>{},call:async()=>running?{ses_one:{type:"busy"}}:{}};
  const app=await startServer({workspace:root,account,runtime,exporter,deployment:{disconnect:async()=>{}}});
  const call=(path,method="GET",body,headers={})=>fetch(app.url+"/api/"+path,{method,headers:{Authorization:"Bearer "+app.capability,"Content-Type":"application/json",...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  try{
    assert.equal((await fetch(app.url+"/api/export",{method:"POST"})).status,401);
    assert.equal((await call("export","POST",{},{Origin:"https://foreign.test"})).status,403);
    assert.equal((await call("export","POST",{},{"X-PaastaCode-Account":"999"})).status,409);
    assert.equal((await call("export","POST",{path:"../private"})).status,400);assert.equal(started,0);
    runtime.url="http://127.0.0.1:1";running=true;assert.equal((await call("export","POST",{})).status,400);assert.equal(started,0);
    running=false;assert.equal((await call("export","POST",{})).status,200);assert.equal(started,1);
    for(const path of ["prompt","git","access","permission","deployment/approve","sessions"]){assert.equal((await call(path,"POST",{})).status,400);}
    assert.equal((await call("export","POST",{})).status,400);
    assert.equal((await call("export?id=synthetic-job&offset=-1")).status,400);
    assert.equal((await call("export?id=synthetic-job&offset=0")).status,200);
    assert.equal((await call("export?id=synthetic-job","DELETE")).status,200);
    assert.equal((await call("export","POST",{})).status,200);
    assert.equal((await call("logout","POST",{})).status,200);assert.equal(job,null);assert(closed>0);
    assert.equal((await call("export?id=synthetic-job&offset=0")).status,400);
  }finally{await app.close();assert(root.startsWith(join(tmpdir(),"paastacode-export-api-")));await rm(root,{recursive:true,force:true});}
});
