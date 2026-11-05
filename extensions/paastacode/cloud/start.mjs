import {mkdir,readFile,realpath} from "node:fs/promises";
import {isAbsolute,join} from "node:path";

const data=process.env.PAASTACODE_CLOUD_DATA,secretFile=process.env.PAASTACODE_CLOUD_SECRET_FILE;
if(!data||!isAbsolute(data)||!secretFile||!isAbsolute(secretFile))throw new Error("Persistent cloud data and control-plane secret mounts are required");
const secret=(await readFile(secretFile,"utf8")).trim();
if(!/^[-_A-Za-z0-9]{43}$/.test(secret))throw new Error("Invalid control-plane secret");
await mkdir(data,{recursive:true,mode:0o700});
const root=await realpath(data),workspace=join(root,"workspace");
await mkdir(workspace,{recursive:true,mode:0o700});
process.env.PAASTACODE_HOME=join(root,"account");
process.env.HOME=join(root,"home");await mkdir(process.env.HOME,{recursive:true,mode:0o700});
delete process.env.PAASTACODE_CLOUD_SECRET_FILE;
const {startServer}=await import("../src/server.mjs");
const {PaastaAccount}=await import("../src/account.mjs");
const {cloudGateway}=await import("./gateway.mjs");
const {CloudProjects}=await import('./projects.mjs');
const account=new PaastaAccount(undefined,undefined,{owner:{id:process.env.PAASTACODE_CLOUD_USER_ID,tenantId:process.env.PAASTACODE_CLOUD_TENANT_ID}});
try{await account.load();}
catch{console.warn("Saved cloud login could not be verified; sign-in remains available and stored data is retained.");}
const projects=await new CloudProjects({root,createBroker:workspace=>startServer({workspace,account,cloud:true})}).start();
let gateway;
try{gateway=await cloudGateway({projects,secret,port:8080});}
catch(error){await projects.close();throw error;}
let closing=false;
for(const signal of ["SIGINT","SIGTERM"])process.once(signal,async()=>{
  if(closing)return;closing=true;
  const timeout=setTimeout(()=>process.exit(1),30_000);timeout.unref();
  await gateway.close();await projects.close();clearTimeout(timeout);process.exit(0);
});
console.log("PaastaCode private cloud runtime ready");
