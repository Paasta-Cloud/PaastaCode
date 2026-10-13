import {readdir} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {join} from "node:path";
for(const directory of ["src","bin","web","desktop","scripts","vscode","cloud"]){
  for(const file of await readdir(directory))if(/\.(mjs|cjs|js)$/.test(file)){
    const checked=spawnSync(process.execPath,["--check",join(directory,file)],{stdio:"inherit"});
    if(checked.status!==0)process.exit(checked.status||1);
  }
}
console.log("PaastaCode JavaScript syntax checks passed");
