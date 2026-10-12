import {test} from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtemp,rm,realpath} from "node:fs/promises";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
process.env.PAASTACODE_HOME=resolve(".artifacts/mcp-test-state");
const {startServer}=await import("../src/server.mjs");
test("real stdio MCP bridge uses only the private workspace capability and cannot approve a deployment",async()=>{
  const workspace=await realpath(await mkdtemp(join(tmpdir(),"paastacode-mcp-")));
  let requests=0,approvals=0;
  const deployment={async tools(){return [{name:"paasta.deploy_source",inputSchema:{type:"object",additionalProperties:false}}];},
    async request(name,args){requests++;assert.equal(name,"paasta.deploy_source");assert.equal(args.name,"fixture");return {id:"synthetic-review",status:"review"};},
    async approve(){approvals++;},async disconnect(){}};
  const service=await startServer({workspace,account:{credentials:null},runtime:{async stop(){}},deployment});
  const child=spawn(process.execPath,[fileURLToPath(new URL("../bin/mcp.mjs",import.meta.url)),"--workspace="+workspace],{env:{...process.env},stdio:["pipe","pipe","pipe"],windowsHide:true});
  let output="";child.stdout.on("data",chunk=>output+=chunk);child.stderr.resume();
  try{
    const messages=[{jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-11-25"}},
      {jsonrpc:"2.0",method:"notifications/initialized"},{jsonrpc:"2.0",id:2,method:"tools/list"},
      {jsonrpc:"2.0",id:3,method:"tools/call",params:{name:"paasta.deploy_source",arguments:{name:"fixture"}}}];
    child.stdin.end(messages.map(message=>JSON.stringify(message)).join("\n")+"\n");
    const code=await new Promise((resolveExit,reject)=>{child.once("exit",resolveExit);child.once("error",reject);});assert.equal(code,0);
    const replies=output.trim().split("\n").map(line=>JSON.parse(line));assert.equal(replies.length,3);assert.equal(replies[0].result.serverInfo.name,"PaastaCode Paasta MCP");assert.equal(replies[1].result.tools[0].name,"paasta.deploy_source");assert.equal(replies[2].result.structuredContent.status,"review");assert.equal(requests,1);assert.equal(approvals,0);assert(!output.includes(service.capability));
    assert.equal((await fetch(service.url+"/api/mcp",{method:"POST",body:JSON.stringify(messages[0])})).status,401);
  }finally{if(child.exitCode===null)child.kill();await service.close();assert(workspace.startsWith(join(await realpath(tmpdir()),"paastacode-mcp-")));await rm(workspace,{recursive:true,force:true});}
});
