import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,realpath,rm} from "node:fs/promises";
import {join,resolve,sep} from "node:path";
import {tmpdir} from "node:os";
import {randomUUID} from "node:crypto";
process.env.PAASTACODE_HOME=resolve(".artifacts/sync-devices-"+process.pid);
const {startServer}=await import("../src/server.mjs");

test("restoring on two devices continues the same cloud revision; a conflict copy preserves both",async()=>{
  const cloudId=randomUUID(),cloud=new Map([[cloudId,{id:cloudId,title:"گفتگوی مشترک",revision:1,updated_at:new Date().toISOString(),snapshot:{version:1,messages:[{role:"user",text:"زمینهٔ مشترک"}]}}]]);
  const homes=[],apps=[];
  try{
    for(let i=0;i<2;i++){
      const home=await realpath(await mkdtemp(join(tmpdir(),"pc-sync-device-")));homes.push(home);
      const id="ses_device"+i,local={id,title:"گفتگوی مشترک",directory:home};
      const account={origin:"https://paasta.test",credentials:{token:"synthetic-device-"+i,aiKey:"synthetic"},context:async()=>({account:{id:"same-user",tenantId:"same-tenant"},models:[]}),request:async(path,options={})=>{
        if(options.method==="PUT"){
          const body=options.body,previous=cloud.get(body.id);if((previous?.revision||0)!==body.revision)throw Object.assign(new Error("conflict"),{status:409});
          const next={...structuredClone(body),revision:body.revision+1};cloud.set(body.id,next);return {id:next.id,revision:next.revision};
        }
        return structuredClone(cloud.get(path.split("?id=")[1]));
      }};
      const runtime={url:"http://127.0.0.1:1",async stop(){},async call(path){
        if(path==="/session"||path==="/session/"+id)return local;
        if(path.endsWith("/message"))return [{info:{role:"assistant"},parts:[{type:"text",text:"ادامه در دستگاه "+i},{type:"tool",state:{output:"private-tool-output"}}]}];
        if(path==="/session/status")return {};throw new Error("Unexpected test route");
      }};
      apps.push(await startServer({workspace:home,account,runtime}));
    }
    const call=async(index,path,method="GET",body)=>fetch(apps[index].url+"/api/"+path,{method,headers:{Authorization:"Bearer "+apps[index].capability,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});
    for(let i=0;i<2;i++){await call(i,"state");assert.equal((await call(i,"restore","POST",{id:cloudId})).status,200);assert.equal((await (await call(i,"sync?id=ses_device"+i)).json()).cloudId,cloudId);}
    assert.equal((await call(0,"save","POST",{id:"ses_device0"})).status,200);assert.equal(cloud.get(cloudId).revision,2);
    assert.equal((await call(1,"save","POST",{id:"ses_device1"})).status,409,"the second device must reject a stale cloud revision");
    assert.equal((await (await call(1,"sync?id=ses_device1")).json()).reason,"conflict");
    assert.equal((await call(1,"save","POST",{id:"ses_device1",copy:true})).status,200);assert.equal(cloud.size,2);
    const original=cloud.get(cloudId),copy=[...cloud.values()].find(row=>row.id!==cloudId);
    assert(original.snapshot.messages.some(message=>message.text==="ادامه در دستگاه 0"));assert(copy.snapshot.messages.some(message=>message.text==="ادامه در دستگاه 1"));
    assert(!JSON.stringify([...cloud.values()]).includes("private-tool-output"));
  }finally{
    for(const app of apps)await app.close();
    for(const home of homes){assert(home.startsWith((await realpath(tmpdir()))+sep+"pc-sync-device-"));await rm(home,{recursive:true,force:true});}
  }
});
