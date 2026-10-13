import {createServer} from "node:http";
import {validCapability} from "../src/server.mjs";

// This listener is private to the Paasta control plane. Browser identity and
// tenant/workspace ownership must be checked there before each forwarded call.
const routes=new Set([
  ...["state","devices","deployment/state","deployment/context","deployment/job","cloud","cloud/session","git","git/diff","sessions","messages","permissions","status","sync","workflow"].map(path=>"GET /api/"+path),
  ...["ready","login","login/poll","connect","logout","deployment/login","deployment/login/poll","deployment/disconnect","deployment/request","deployment/approve","deployment/reject","git","access","sessions","permission","prompt","abort","save","sync","restore","import/preview","import"].map(path=>"POST /api/"+path),
  "DELETE /api/devices","DELETE /api/cloud/session",
]);
const maxBody=1_100_000,maxResponse=16_000_000;
export async function cloudGateway({broker,secret,port=8080,host="0.0.0.0"}){
  const target=new URL(broker.url);
  if(target.protocol!=="http:"||target.hostname!=="127.0.0.1"||!target.port||target.username||target.password||target.pathname!=="/"||target.search||target.hash||!/^[-_A-Za-z0-9]{43}$/.test(secret||""))throw new Error("Cloud runtime configuration is invalid");
  const json=(response,status,value)=>{response.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});response.end(JSON.stringify(value));};
  const server=createServer(async(request,response)=>{
    if(request.method==="GET"&&request.url==="/health"){json(response,200,{ready:true});return;}
    if(!validCapability(request.headers.authorization?.replace(/^Bearer /,""),secret)){request.resume();json(response,401,{error:"دسترسی مجاز نیست."});return;}
    let url;
    try{url=new URL(request.url,"http://runtime.invalid");}catch{request.resume();json(response,400,{error:"مسیر درخواست معتبر نیست."});return;}
    if(!routes.has(request.method+" "+url.pathname)||!request.url.startsWith("/api/")||request.url.includes("\\")||/%(?:2f|5c|2e)/i.test(url.pathname)){request.resume();json(response,404,{error:"پیدا نشد."});return;}
    if(request.headers.origin){request.resume();json(response,403,{error:"اتصال مستقیم مرورگر مجاز نیست."});return;}
    const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),60_000);response.once("close",()=>abort.abort());
    try{
      const chunks=[];let size=0;
      for await(const chunk of request){size+=chunk.length;if(size>maxBody){request.resume();json(response,413,{error:"حجم درخواست بیش از حد مجاز است."});return;}chunks.push(chunk);}
      const headers={Authorization:"Bearer "+broker.capability,"Content-Type":"application/json"};
      const revision=request.headers["x-paastacode-account"];
      if(typeof revision==="string"&&/^\d{1,15}$/.test(revision))headers["X-PaastaCode-Account"]=revision;
      const result=await fetch(target.origin+url.pathname+url.search,{method:request.method,headers,...(request.method!=="GET"?{body:Buffer.concat(chunks)}:{}),redirect:"error",signal:abort.signal});
      const output=[];let bytes=0;
      for await(const chunk of result.body){bytes+=chunk.length;if(bytes>maxResponse)throw new Error("Response too large");output.push(chunk);}
      // Do not forward credentials, cookies, CORS grants or navigation headers.
      response.writeHead(result.status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});response.end(Buffer.concat(output));
    }catch{if(!response.headersSent)json(response,502,{error:"اجرای ابری پاسخ نداد. کارهای ذخیره‌شده باقی مانده‌اند؛ دوباره تلاش کنید."});}
    finally{clearTimeout(timer);}
  });
  server.requestTimeout=65_000;server.headersTimeout=10_000;
  await new Promise((done,fail)=>{server.once("error",fail);server.listen(port,host,done);});
  return {port:server.address().port,close:async()=>{server.closeAllConnections();await new Promise(done=>server.close(done));}};
}
