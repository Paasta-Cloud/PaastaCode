import {createServer} from "node:http";
import {validCapability} from "../src/server.mjs";
import allowed from "./routes.json" with {type:"json"};
import {CloudProjectError,validProject} from './projects.mjs';

// This listener is private to the Paasta control plane. Browser identity and
// tenant/workspace ownership must be checked there before each forwarded call.
const routes=new Set(Object.entries(allowed).flatMap(([method,paths])=>paths.map(path=>method+" /api/"+path)));
const maxBody=1_100_000,maxResponse=16_000_000;
export async function cloudGateway({broker,projects,secret,port=8080,host="0.0.0.0"}){
  const targetFor=value=>{const target=new URL(value.url);if(target.protocol!=="http:"||target.hostname!=="127.0.0.1"||!target.port||target.username||target.password||target.pathname!=="/"||target.search||target.hash)throw new Error('Invalid cloud broker');return target;};
  if(!/^[-_A-Za-z0-9]{43}$/.test(secret||""))throw new Error("Cloud runtime configuration is invalid");
  targetFor(projects?.broker||broker);
  const outputHeaders={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","X-PaastaCode-Runtime":"1"};
  const json=(response,status,value)=>{response.writeHead(status,outputHeaders);response.end(JSON.stringify(value));};
  const server=createServer(async(request,response)=>{
    if(request.method==="GET"&&request.url==="/health"){json(response,200,{ready:true});return;}
    // Kubernetes authenticates and removes its Authorization header before pod proxying.
    const credential=request.headers["x-paastacode-cloud-token"]??request.headers.authorization?.replace(/^Bearer /,"");
    if(!validCapability(credential,secret)){request.resume();json(response,401,{error:"دسترسی مجاز نیست."});return;}
    let url;
    try{url=new URL(request.url,"http://runtime.invalid");}catch{request.resume();json(response,400,{error:"مسیر درخواست معتبر نیست."});return;}
    if(!routes.has(request.method+" "+url.pathname)||!request.url.startsWith("/api/")||request.url.includes("\\")||/%(?:2f|5c|2e)/i.test(url.pathname)){request.resume();json(response,404,{error:"پیدا نشد."});return;}
    if(request.headers.origin){request.resume();json(response,403,{error:"اتصال مستقیم مرورگر مجاز نیست."});return;}
    const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),60_000);response.once("close",()=>abort.abort());
    try{
      const chunks=[];let size=0;
      for await(const chunk of request){size+=chunk.length;if(size>(request.method==="POST"&&url.pathname==="/api/prompt"?10*1024*1024:maxBody)){request.resume();json(response,413,{error:"حجم درخواست بیش از حد مجاز است."});return;}chunks.push(chunk);}
      if(url.pathname==='/api/projects'||url.pathname==='/api/projects/select'){
        if(!projects){json(response,404,{error:'برای مدیریت پروژه‌ها، فضای کار را به‌روز کنید.'});return;}
        let input={};if(request.method==='POST'){try{if(size>20000)throw Error();input=JSON.parse(Buffer.concat(chunks).toString());}catch{json(response,400,{error:'درخواست پروژه معتبر نیست.'});return;}}
        const result=request.method==='GET'?projects.list():url.pathname.endsWith('/select')?await projects.select(input?.id):await projects.create(input);
        json(response,200,result);return;
      }
      const project=request.headers['x-paastacode-project']||'default';
      if(!validProject(project))throw new CloudProjectError('شناسهٔ پروژه معتبر نیست.',400);
      const forward=async broker=>{
      const target=targetFor(broker),headers={Authorization:"Bearer "+broker.capability,"Content-Type":"application/json"};
      const revision=request.headers["x-paastacode-account"];
      if(typeof revision==="string"&&/^\d{1,15}$/.test(revision))headers["X-PaastaCode-Account"]=revision;
      const result=await fetch(target.origin+url.pathname+url.search,{method:request.method,headers,...(request.method!=="GET"?{body:Buffer.concat(chunks)}:{}),redirect:"error",signal:abort.signal});
      const output=[];let bytes=0;
      for await(const chunk of result.body){bytes+=chunk.length;if(bytes>maxResponse)throw new Error("Response too large");output.push(chunk);}
      // Do not forward credentials, cookies, CORS grants or navigation headers.
      response.writeHead(result.status,outputHeaders);response.end(Buffer.concat(output));
      };
      if(projects)await projects.use(project,forward);
      else if(project==='default')await forward(broker);
      else throw new CloudProjectError('برای مدیریت پروژه‌ها، فضای کار را به‌روز کنید.',409,true);
    }catch(error){if(!response.headersSent)json(response,error instanceof CloudProjectError?error.status:502,{error:error instanceof CloudProjectError?error.message:"اجرای ابری پاسخ نداد. کارهای ذخیره‌شده باقی مانده‌اند؛ دوباره تلاش کنید.",...(error.projectChanged?{projectChanged:true}:{})});}
    finally{clearTimeout(timer);}
  });
  server.requestTimeout=65_000;server.headersTimeout=10_000;
  await new Promise((done,fail)=>{server.once("error",fail);server.listen(port,host,done);});
  return {port:server.address().port,close:async()=>{server.closeAllConnections();await new Promise(done=>server.close(done));}};
}
