import {startServer} from "../src/server.mjs";
const workspace=process.argv.find(arg=>arg.startsWith("--workspace="))?.slice(12);
if(!workspace)throw new Error("پوشهٔ پروژه مشخص نشده است.");
const service=await startServer({workspace,hosted:process.argv.includes("--hosted"),daemon:true});
if(!service.reused){for(const signal of ["SIGINT","SIGTERM"])process.once(signal,()=>void service.close().then(()=>process.exit()));}
