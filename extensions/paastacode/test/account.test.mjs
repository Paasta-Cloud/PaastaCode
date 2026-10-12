import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {PaastaAccount} from "../src/account.mjs";

test("account errors explain undeployed endpoints and refuse legacy device grants",async()=>{
  let mode="missing",requests=0;
  const server=createServer((_request,response)=>{
    requests++;
    if(mode==="missing"){response.writeHead(404,{"Content-Type":"text/html"});response.end("<html>not deployed</html>");return;}
    if(mode==="html"){response.writeHead(200,{"Content-Type":"text/html"});response.end("<html>not an API</html>");return;}
    response.setHeader("Content-Type","application/json");
    if(mode==="denied"){response.writeHead(403);response.end(JSON.stringify({error:"access_denied",message:"درخواست ورود قابل استفاده نیست."}));return;}
    if(mode==="pending"){response.writeHead(202);response.end(JSON.stringify({error:"authorization_pending"}));return;}
    response.end(JSON.stringify({...(mode==="current"?{clientId:"paastacode"}:{}),deviceCode:"synthetic",userCode:"TEST-TEST",expiresIn:600,verificationUriComplete:"http://127.0.0.1:"+server.address().port+"/cli/authorize?code=TEST-TEST"}));
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const account=new PaastaAccount("http://127.0.0.1:"+server.address().port);
  try{
    await assert.rejects(account.context(),error=>error.status===404&&error.message.includes("هنوز فعال نیست"));
    mode="html";await assert.rejects(account.context(),/پاسخ سرور پاستا معتبر نیست/);
    mode="denied";await assert.rejects(account.context(),error=>error.status===403&&error.message==="درخواست ورود قابل استفاده نیست.");
    mode="legacy";await assert.rejects(account.begin(),/ورود اختصاصی پاستاکد/);
    assert.equal(account.device,null);assert.equal(account.credentials,null);
    mode="current";assert.equal((await account.begin()).code,"TEST-TEST");
    mode="pending";assert.deepEqual(await account.poll(),{pending:true});
    assert.equal(account.credentials,null);assert.equal(requests,6);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  await assert.rejects(account.context(),/اتصال به پاستا برقرار نشد/);
});
