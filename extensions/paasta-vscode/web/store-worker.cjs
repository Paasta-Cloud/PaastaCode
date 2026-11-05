const {WorkspaceService}=require('./workspace-service.cjs');
let service,locked=false,sourceSequence=0,modelSequence=0;const sources=new Map(),models=new Map();
const requestModel=(project,request)=>new Promise((resolve,reject)=>{
 if(locked){reject(Error('نشست محیط پایان یافته است.'));return;}
 const id=++modelSequence,timeout=setTimeout(()=>{models.delete(id);self.postMessage({modelCancel:request.runId});reject(Error('نتیجهٔ مدل به‌موقع دریافت نشد؛ مصرف حساب را پیش از تکرار بررسی کنید.'));},360000);
 models.set(id,{resolve,reject,timeout,runId:request.runId});self.postMessage({modelRequest:id,project,request});
});
requestModel.cancel=runId=>{for(const [id,item] of models)if(item.runId===runId){clearTimeout(item.timeout);models.delete(id);item.reject(Error('درخواست متوقف شد.'));}self.postMessage({modelCancel:runId});};
self.onmessage=async({data})=>{
 if(Number.isSafeInteger(data?.modelResult)){const waiting=models.get(data.modelResult);if(!waiting)return;models.delete(data.modelResult);clearTimeout(waiting.timeout);locked||data.error?waiting.reject(Error(data.error||'نشست محیط پایان یافته است.')):waiting.resolve(data.result);return;}
 if(Number.isSafeInteger(data?.sourceResult)){
  const waiting=sources.get(data.sourceResult);if(!waiting)return;sources.delete(data.sourceResult);clearTimeout(waiting.timeout);
  if(locked||data.error)waiting.reject(Error(data.error||'نشست محیط پایان یافته است.'));else waiting.resolve(data.source);return;
 }
 const {id,method,args}=data||{};
 try{
  if(method==='init'){
   if(service)throw Error('محیط قبلاً باز شده است.');
   service=new WorkspaceService(args,project=>new Promise((resolve,reject)=>{
    if(locked){reject(Error('برای دریافت سورس دوباره وارد حساب شوید.'));return;}
    const request=++sourceSequence,timeout=setTimeout(()=>{sources.delete(request);reject(Error('دریافت سورس به‌موقع کامل نشد.'));},185000);
    sources.set(request,{resolve,reject,timeout});self.postMessage({sourceRequest:request,project});
   }),requestModel,project=>self.postMessage({projectReady:project}));
   self.postMessage({id,result:true});return;
  }
  if(method==='lock'){locked=true;service?.agent.lock();for(const waiting of sources.values()){clearTimeout(waiting.timeout);waiting.reject(Error('نشست محیط پایان یافته است.'));}sources.clear();self.postMessage({id,result:true});return;}
  if(method==='unlock'){locked=false;self.postMessage({id,result:true});return;}
  if(!service||locked)throw Error('نشست محیط پایان یافته است. تغییرات باز را پیش از خروج ذخیره کنید.');
  const result=await service.invoke(method,args);
  self.postMessage({id,result},result instanceof Uint8Array?[result.buffer]:[]);
 }catch(error){self.postMessage({id,error:error.message||'عملیات کامل نشد.'});}
};
