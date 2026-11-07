import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
// Only the pinned engine's loopback requests may reach this fixed model target.
export async function startTaskBudgetRelay({upstream,apiKey,bridge}){
 const capability=randomBytes(32).toString('base64url'),target=new URL(upstream.replace(/\/$/,'')+'/chat/completions');
 const server=createServer(async(request,response)=>{
  const controller=new AbortController();response.once('close',()=>controller.abort());
  try{
   const token=request.headers.authorization?.replace(/^Bearer /,'')||'';
   if(token.length!==capability.length||!timingSafeEqual(Buffer.from(token),Buffer.from(capability))){response.writeHead(403).end();return;}
   if(request.method!=='POST'||request.url!=='/chat/completions'){response.writeHead(404).end();return;}
   const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>8*1024*1024)throw Error('Model request exceeds limit');chunks.push(chunk);}
   const id=request.headers['x-opencode-session-id'];if(typeof id!=='string'||!/^ses_[a-zA-Z0-9]+$/.test(id))throw Error('Missing engine session');
   const url=new URL(bridge.url);url.searchParams.set('id',id);
   const budgetResponse=await fetch(url,{headers:{Authorization:'Bearer '+bridge.capability},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)]),redirect:'error'});
   if(!budgetResponse.ok)throw Error('Task budget unavailable');
   const budget=await budgetResponse.json(),headers={'Content-Type':'application/json',Authorization:'Bearer '+apiKey};
   if(budget.id){headers['x-paasta-task-id']=budget.id;headers['x-paasta-task-budget']=String(budget.limitToman);}
   const result=await fetch(target,{method:'POST',headers,body:Buffer.concat(chunks),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(350000)]),redirect:'error'});
   response.writeHead(result.status,{'Content-Type':result.headers.get('content-type')||'application/json','Cache-Control':'no-store'});
   if(result.body)await pipeline(Readable.fromWeb(result.body),response);else response.end();
  }catch{
   if(response.headersSent)response.destroy();else response.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({error:{message:'بودجه یا اتصال مدل دریافت نشد؛ وضعیت اتصال را پیش از ادامه بررسی کنید.',type:'task_budget_unavailable'}}));
  }
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {baseURL:'http://127.0.0.1:'+server.address().port,apiKey:capability,async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
