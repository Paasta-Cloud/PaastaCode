const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const upgrade=new RegExp('^/api/remote/workspaces/('+uuid+')/upgrade$');
const runtime=new RegExp('^/api/remote/workspaces/('+uuid+')/runtime/([a-z]+(?:/[a-z]+)*)$');
export async function relayCloud({account,url,method,headers,body}){
  const list=url.pathname==='/api/remote/workspaces'&&method==='GET',match=url.pathname.match(runtime);
  if(!list&&!(upgrade.test(url.pathname)&&method==='POST')&&(!match||!['GET','POST','DELETE'].includes(method)))return {status:404,data:{error:'مسیر درخواست مجاز نیست.'}};
  const token=account.credentials?.token;if(!token)return {status:401,data:{error:'ابتدا با حساب پاستا وارد شوید.'}};
  const context=await account.context(),owner=context.account.id+':'+context.account.tenantId;
  if(token!==account.credentials?.token||!list&&headers['x-paastacode-owner']!==owner)return {status:409,data:{error:'حساب فعال تغییر کرده است؛ فضای کار را دوباره انتخاب کنید.',accountChanged:true}};
  const output={'Authorization':'Bearer '+token,'Content-Type':'application/json','X-PaastaCode-Owner':owner};
  for(const name of ['x-paastacode-project','x-paastacode-account'])if(typeof headers[name]==='string')output[name]=headers[name];
  const response=await fetch(account.origin+url.pathname.replace('/api/remote/','/api/paastacode/')+url.search,{method,headers:output,...(method!=='GET'?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(65000)});
  const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>16_000_000)throw Error('پاسخ فضای کار بیش از حد بزرگ است.');chunks.push(chunk);}
  if(token!==account.credentials?.token)return {status:409,data:{error:'حساب فعال تغییر کرده است.',accountChanged:true}};
  let data;try{data=JSON.parse(Buffer.concat(chunks).toString());}catch{throw Error('پاسخ فضای کار کامل دریافت نشد؛ دوباره تلاش کنید.');}
  return {status:response.status,data};
}
