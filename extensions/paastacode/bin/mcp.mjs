#!/usr/bin/env node
import {createInterface} from "node:readline";
import {realpath} from "node:fs/promises";
import {join,resolve} from "node:path";
import {stateHome,readPrivate} from "../src/account.mjs";
import {workspaceKey} from "../src/runtime.mjs";
const workspace=await realpath(resolve(process.argv.find(arg=>arg.startsWith("--workspace="))?.slice(12)||process.cwd()));
async function call(message){
  const state=await readPrivate(join(stateHome,"workspace-"+workspaceKey(workspace)+".json"));
  if(!state)throw new Error("ابتدا پاستاکد را برای همین پروژه اجرا کنید.");
  const url=new URL(state.url);
  if(url.protocol!=="http:"||url.hostname!=="127.0.0.1"||!/^[A-Za-z0-9_-]{43}$/.test(state.capability))throw new Error("اتصال محلی MCP معتبر نیست.");
  const response=await fetch(url.origin+"/api/mcp",{method:"POST",headers:{Authorization:"Bearer "+state.capability,"Content-Type":"application/json"},body:JSON.stringify(message),signal:AbortSignal.timeout(20000)});
  if(response.status===202)return null;
  const value=await response.json();if(!response.ok)throw new Error(value.error||"درخواست MCP پاستا انجام نشد.");return value;
}
const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
// Only JSON-RPC travels on stdout; tokens and engine diagnostics never do.
for await(const line of lines){
  let message;
  try{
    if(Buffer.byteLength(line)>65536)throw new Error("درخواست MCP بیش از حد بزرگ است.");
    message=JSON.parse(line);const result=await call(message);if(result)process.stdout.write(JSON.stringify(result)+"\n");
  }catch(error){if(message?.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:message.id,error:{code:-32000,message:error.message}})+"\n");}
}
