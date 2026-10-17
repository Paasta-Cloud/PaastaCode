import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';

export function proxySettings(input,previous={}){
  if(typeof input?.enabled!=='boolean')throw new Error('وضعیت پراکسی معتبر نیست.');
  let url;try{url=new URL(input.url||'http://127.0.0.1:2080');}catch{throw new Error('نشانی پراکسی را همراه http:// یا socks5:// وارد کنید.');}
  if(!['http:','https:','socks5:','socks5h:'].includes(url.protocol)||!url.hostname||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname)||url.href.length>2048)throw new Error('پراکسی HTTP، HTTPS یا SOCKS5 وارد کنید؛ نام کاربری و رمز را در کادرهای جدا بنویسید.');
  const username=input.username??previous.username??'',password=input.password??previous.password??'';
  if([username,password].some(value=>typeof value!=='string'||value.length>255||/[\r\n\0]/.test(value)))throw new Error('اطلاعات ورود پراکسی معتبر نیست.');
  return {enabled:input.enabled,url:url.href,username,password};
}

// The pinned engine speaks HTTP proxies. Keep SOCKS translation outside the engine
// and protect the loopback listener with a fresh capability for each runtime.
export async function startOutboundProxy(settings,providerUrl){
  if(!settings?.enabled)return null;
  const require=createRequire(import.meta.url);
  const bundled=fileURLToPath(new URL('../vendor/network.cjs',import.meta.url)).replace(/app\.asar([\\/])/,'app.asar.unpacked$1');
  const entry=existsSync(bundled)?bundled:require.resolve('proxy-chain');
  const module=await import(pathToFileURL(entry).href),Server=module.Server||module.default.Server;
  const secret=randomBytes(32).toString('base64url'),upstream=new URL(settings.url);
  upstream.username=settings.username;upstream.password=settings.password;
  const provider=providerUrl?new URL(providerUrl).hostname:null;
  const direct=new Set(['localhost','127.0.0.1','::1','[::1]',...(provider?[provider]:[])]);
  const server=new Server({host:'127.0.0.1',port:0,verbose:false,
    prepareRequestFunction:({username,password,hostname})=>({requestAuthentication:username!=='paastacode'||password!==secret,upstreamProxyUrl:direct.has(hostname)?null:upstream.href}),
  });
  // Error payloads can include URLs or proxy credentials. Never log them.
  server.on('requestFailed',()=>{});server.on('error',()=>{});
  try{await server.listen();}catch{await server.close(true).catch(()=>{});throw new Error('پراکسی محلی شروع نشد. تنظیمات اتصال را بررسی کنید.');}
  const address=`http://paastacode:${secret}@127.0.0.1:${server.port}`,bypass=[...direct].join(',');
  return {env:{HTTP_PROXY:address,HTTPS_PROXY:address,ALL_PROXY:address,http_proxy:address,https_proxy:address,all_proxy:address,NO_PROXY:bypass,no_proxy:bypass},close:()=>server.close(true)};
}
