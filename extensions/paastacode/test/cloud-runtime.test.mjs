import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer,request} from "node:http";
import {randomBytes} from "node:crypto";
import {cloudGateway} from "../cloud/gateway.mjs";

test("private cloud gateway rejects direct callers and forwards only bounded authenticated workspace calls",async()=>{
  const secret=randomBytes(32).toString("base64url"),capability=randomBytes(32).toString("base64url"),calls=[];
  const broker=createServer(async(req,res)=>{let body="";for await(const chunk of req)body+=chunk;calls.push({url:req.url,headers:req.headers,body});res.writeHead(200,{"Content-Type":"application/json","Set-Cookie":"never=forward"});res.end(JSON.stringify({connected:false}));});
  await new Promise(done=>broker.listen(0,"127.0.0.1",done));
  const target={url:"http://127.0.0.1:"+broker.address().port,capability};
  await assert.rejects(cloudGateway({broker:target,secret:"weak",port:0}));
  await assert.rejects(cloudGateway({broker:{...target,url:"https://example.test"},secret,port:0}));
  const gateway=await cloudGateway({broker:target,secret,port:0,host:"127.0.0.1"}),url="http://127.0.0.1:"+gateway.port,headers={Authorization:"Bearer "+secret};
  try{
    assert.equal((await fetch(url+"/health")).status,200);
    assert.equal((await fetch(url+"/api/state")).status,401);
    assert.equal((await fetch(url+"/api/state",{headers:{Authorization:"Bearer "+capability}})).status,401);
    for(const path of ["/api/shutdown","/api/update/prepare","/api/mcp","/api/../api/state","/api/%2e%2e/private","/src/account.mjs"]){
      assert.equal((await fetch(url+path,{method:"POST",headers})).status,404);
    }
    assert.equal((await fetch(url+"/api/state",{headers:{...headers,Origin:"https://code.paasta.cloud"}})).status,403);
    assert.equal(calls.length,0);
    const malformed=await new Promise((done,fail)=>{const req=request({hostname:"127.0.0.1",port:gateway.port,path:"//[",headers},res=>{res.resume();res.once("end",()=>done(res.statusCode));});req.once("error",fail);req.end();});
    assert.equal(malformed,400);
    const result=await fetch(url+"/api/state",{headers:{...headers,Cookie:"paasta_session=must-not-leak"}});
    assert.deepEqual(await result.json(),{connected:false});assert.equal(result.headers.get("set-cookie"),null);
    assert.equal(result.headers.get("x-paastacode-runtime"),"1");
    assert.equal(calls[0].headers.authorization,"Bearer "+capability);assert.equal(calls[0].headers.cookie,undefined);
    await fetch(url+"/api/prompt",{method:"POST",headers:{...headers,"X-PaastaCode-Account":"7"},body:'{"text":"تست"}'});
    assert.equal(calls[1].headers["x-paastacode-account"],"7");assert.equal(JSON.parse(calls[1].body).text,"تست");
    const tooLarge=await fetch(url+"/api/prompt",{method:"POST",headers,body:"x".repeat(1_100_001)});
    assert.equal(tooLarge.status,413);assert.equal(calls.length,2);
    for(const [method,path,body] of [["GET","/api/workflow?session=synthetic"],["POST","/api/import/preview",'{"source":"codex"}'],["POST","/api/import",'{"token":"synthetic"}']]){
      assert.equal((await fetch(url+path,{method,headers,body})).status,200);
      assert.equal(calls.at(-1).url,path);
    }
    for(const [method,path] of [["POST","/api/workflow"],["GET","/api/import"],["DELETE","/api/import/preview"]])assert.equal((await fetch(url+path,{method,headers})).status,404);
    assert.equal(calls.length,5);
    assert.equal((await fetch(url+"/api/state",{headers:{"X-PaastaCode-Cloud-Token":secret,Authorization:"Bearer synthetic-kubernetes-auth"}})).status,200);
    assert.equal(calls.at(-1).headers.authorization,"Bearer "+capability);assert.equal(calls.at(-1).headers["x-paastacode-cloud-token"],undefined);
    assert.equal((await fetch(url+"/api/state",{headers:{...headers,"X-PaastaCode-Cloud-Token":"wrong"}})).status,401);
  }finally{await gateway.close();broker.closeAllConnections();await new Promise(done=>broker.close(done));}
});
