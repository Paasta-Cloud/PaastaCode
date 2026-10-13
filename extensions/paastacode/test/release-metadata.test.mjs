import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {spawnSync} from "node:child_process";
const yaml=createRequire(import.meta.url)("js-yaml");
test("release assembly retains both macOS architectures and rejects mismatched update hashes",async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),"paastacode-feed-"))),input=join(root,"input"),output=join(root,"output");
  try{
    for(const arch of ["x64","arm64"]){const dir=join(input,"paastacode-darwin-"+arch);await mkdir(dir,{recursive:true});const name="PaastaCode-0.2.0-beta.5-mac-"+arch+".zip",bytes=Buffer.from("synthetic "+arch);await writeFile(join(dir,name),bytes);await writeFile(join(dir,"beta-mac.yml"),yaml.dump({version:"0.2.0-beta.5",files:[{url:name,size:bytes.length,sha512:createHash("sha512").update(bytes).digest("base64")}]}));}
    const run=()=>spawnSync(process.execPath,[resolve("scripts/prepare-release.mjs"),input,output],{encoding:"utf8",timeout:10000});
    const valid=run();assert.equal(valid.status,0,valid.stderr);const feed=yaml.load(await readFile(join(output,"beta-mac.yml"),"utf8"));assert.equal(feed.files.length,2);assert(feed.files.some(file=>file.url.includes("arm64")));assert(feed.files.some(file=>file.url.includes("x64")));
    await writeFile(join(input,"paastacode-darwin-x64","PaastaCode-0.2.0-beta.5-mac-x64.zip"),"modified");assert.notEqual(run().status,0);
  }finally{assert(root.startsWith(join(await realpath(tmpdir()),"paastacode-feed-")));await rm(root,{recursive:true,force:true});}
});
