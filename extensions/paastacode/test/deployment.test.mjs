import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdtemp,rm,realpath} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {PaastaAccount} from "../src/account.mjs";
import {PaastaDeployment} from "../src/deployment.mjs";
test("deployment requires matching identity and one-use review; model arguments cannot authorize cost or select an external directory",async()=>{
  const workspace=await realpath(await mkdtemp(join(tmpdir(),"paastacode-deploy-")));
  let uploads=0,wrongIdentity=false,viewer=false,changedPrice=false;
  const roleScopes={primary:['paastacode:read'],deployment:['paastacode:read','projects:read','deployments:write','logs:read']};
  const plan={id:"synthetic-plan",name:"پلن آزمایشی",hourly_price_toman:"10",monthly_price_toman:"5000"};
  const server=createServer(async(req,res)=>{
    const token=req.headers.authorization?.replace('Bearer ','');
    const json=(value,status=200)=>{res.writeHead(status,{"Content-Type":"application/json"});res.end(JSON.stringify(value));};
    if(!roleScopes[token]||viewer)return json({error:"Current role rejected"},403);
    if(req.url==="/api/paastacode/identity")return json({id:wrongIdentity&&token==='deployment'?"other-user":"synthetic-user",tenantId:"synthetic-tenant"});
    if(!roleScopes[token].includes('projects:read'))return json({error:"Scope rejected"},403);
    if(req.url==="/api/cli/context")return json({plans:[{...plan,hourly_price_toman:changedPrice?"11":"10"}],clusters:[{id:"synthetic-region",name:"منطقهٔ آزمایشی"}],projects:[]});
    if(req.url.startsWith('/api/projects/deploy/'))return json({status:"ready",domain:"fixture.example.test",logs:"synthetic ready"});
    if(req.url==="/api/mcp"){
      let raw="";for await(const chunk of req)raw+=chunk;const rpc=JSON.parse(raw);
      if(rpc.method==="tools/list")return json({jsonrpc:"2.0",id:rpc.id,result:{tools:[{name:"paasta.list_projects",annotations:{readOnlyHint:true}},{name:"paasta.restart_project",annotations:{readOnlyHint:false}}]}});
      return json({jsonrpc:"2.0",id:rpc.id,result:{content:[{type:"text",text:"[]"}],structuredContent:[],isError:false}});
    }
    json({error:"Unexpected request"},404);
  });
  await new Promise(r=>server.listen(0,"127.0.0.1",r));const origin="http://127.0.0.1:"+server.address().port;
  const base=new PaastaAccount(origin,workspace);base.credentials={token:"primary"};
  const deploy=new PaastaAccount(origin,workspace,{deployment:true});deploy.credentials={token:"deployment"};deploy.load=async()=>deploy;
  const commands=[];
  const controller=new PaastaDeployment({workspace,account:base,deploymentAccount:deploy,execute:async(args,options)=>{
    commands.push({args,options});
    if(args.includes("--dry-run"))return {archiveSha256:"a".repeat(64),files:[{path:"index.html",bytes:7}],bytes:7,environmentFiles:[".env"]};
    uploads++;return {deployment:"synthetic-build",status:"queued"};
  }});
  try{
    await assert.rejects(controller.request('paasta.deploy_source',{directory:'../outside',confirm:true}),/آرگومان/);assert.equal(uploads,0);
    const first=await controller.request('paasta.deploy_source',{name:'fixture'});assert.equal(first.status,'review');assert.equal(uploads,0);
    await controller.reject(first.id);await assert.rejects(controller.approve(first.id));assert.equal(uploads,0);
    const job=await controller.request('paasta.deploy_source',{name:'fixture'});
    const results=await Promise.allSettled([controller.approve(job.id),controller.approve(job.id)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    for(let i=0;i<30&&uploads===0;i++)await new Promise(r=>setTimeout(r,20));assert.equal(uploads,1);
    const command=commands.find(c=>c.args.includes('--yes'));assert(command.args.includes('--no-env'));assert.equal(command.args[command.args.indexOf('--source-sha256')+1],'a'.repeat(64));assert.equal(command.options.token,'deployment');
    assert.equal((await controller.status(job.id)).status,'ready');
    const priceJob=await controller.request('paasta.deploy_source',{name:'fixture'});changedPrice=true;await controller.approve(priceJob.id);
    for(let i=0;i<30&&(await controller.job(priceJob.id)).status==='deploying';i++)await new Promise(r=>setTimeout(r,20));assert.equal((await controller.job(priceJob.id)).status,'failed');assert.equal(uploads,1);
    wrongIdentity=true;await assert.rejects(controller.request('paasta.list_projects'),/یکسان نیست/);assert.deepEqual((await controller.state()).jobs,[]);
    wrongIdentity=false;viewer=true;await assert.rejects(controller.request('paasta.list_projects'));assert.equal(uploads,1);
  }finally{await new Promise(r=>server.close(r));assert(workspace.startsWith(join(await realpath(tmpdir()),'paastacode-deploy-')));await rm(workspace,{recursive:true,force:true});}
});
