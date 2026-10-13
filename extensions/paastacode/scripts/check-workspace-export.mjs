import {mkdir} from "node:fs/promises";
import {resolve} from "node:path";
import {spawnSync} from "node:child_process";

await mkdir(".artifacts",{recursive:true});
const cli=resolve(".artifacts/export-check"+(process.platform==="win32"?".exe":""));
for(const args of [["-C","paasta-cli","test","./..."],["-C","paasta-cli","build","-o",cli,"."]]){
  const result=spawnSync("go",args,{stdio:"inherit",windowsHide:true});
  if(result.error||result.status!==0)throw new Error("Workspace export Go checks failed");
}
const result=spawnSync(process.execPath,["test/workspace-export-integration.mjs"],{stdio:"inherit",windowsHide:true,env:{...process.env,PAASTACODE_EXPORT_TEST_CLI:cli}});
if(result.error||result.status!==0)throw new Error("Workspace export integration failed");
