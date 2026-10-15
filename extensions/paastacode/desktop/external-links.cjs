function allowedExternal(value,consoleOrigin){
  let target,consoleUrl;try{target=new URL(value);consoleUrl=new URL(consoleOrigin);}catch{return false;}
  if(target.username||target.password)return false;
  if(target.origin===consoleUrl.origin)return ['/cli/authorize','/paastacode','/api/paastacode/web/billing.html'].includes(target.pathname);
  return target.protocol==='https:';
}
module.exports={allowedExternal};
