import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve,sep,basename} from "node:path";
import {spawnSync} from "node:child_process";

const workflow=readFileSync(new URL("../../../.github/workflows/paastacode-promote.yml",import.meta.url),"utf8");
const block=workflow.match(/node --input-type=module <<'NODE'\r?\n([\s\S]*?)\r?\n          NODE/);
assert(block,"Publication workflow must execute its source verification");
const script=block[1].replace(/^          /gm,"");
const sha="a".repeat(40),repository="test/PaastaCode";
function fixture(){
  const platforms=["windows-latest, win32, x64","ubuntu-latest, linux, x64","ubuntu-24.04-arm, linux, arm64","macos-15-intel, darwin, x64","macos-latest, darwin, arm64"];
  const run=(id,path)=>({id,repository:{full_name:repository},path,head_sha:sha,status:"completed",conclusion:"success"});
  const jobs=prefix=>({jobs:platforms.map(platform=>({name:`${prefix} (${platform})`,conclusion:"success"}))});
  return {package:run(1,".github/workflows/paastacode-release.yml"),acceptance:run(2,".github/workflows/paastacode-vscode-acceptance.yml"),"package-jobs":jobs("package"),"acceptance-jobs":jobs("installed-extension"),ancestry:{status:"ahead"},logs:Array.from({length:5},()=>`PACKAGE_RUN: 1\nPACKAGE_SHA: ${sha}`).join("\n")};
}
function verify(change=()=>{}){
  const data=fixture();change(data);
  const root=mkdtempSync(join(tmpdir(),"paastacode-publication-test-"));
  try {
    for(const [key,value] of Object.entries(data))writeFileSync(join(root,key==="logs"?"acceptance.log":key+".json"),key==="logs"?value:JSON.stringify(value));
    writeFileSync(join(root,"verify.mjs"),script);
    return spawnSync(process.execPath,["verify.mjs"],{cwd:root,encoding:"utf8",env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,GITHUB_REPOSITORY:repository,PACKAGE_RUN:"1",ACCEPTANCE_RUN:"2",PACKAGE_SHA:sha}});
  } finally {
    assert(resolve(root).startsWith(resolve(tmpdir())+sep)&&basename(root).startsWith("paastacode-publication-test-"));
    rmSync(root,{recursive:true,force:true});
  }
}
test("publication accepts the exact five native and installed package results",()=>{
  const result=verify();assert.equal(result.status,0,result.stderr);
});
for(const [name,change] of [
  ["foreign repository",data=>{data.package.repository.full_name="other/repo";}],
  ["different package source",data=>{data.package.head_sha="b".repeat(40);}],
  ["different installed source",data=>{data.acceptance.head_sha="b".repeat(40);}],
  ["different workflow",data=>{data.acceptance.path=".github/workflows/other.yml";}],
  ["failed installed run",data=>{data.acceptance.conclusion="failure";}],
  ["failed native platform",data=>{data["package-jobs"].jobs[0].conclusion="failure";}],
  ["missing installed platform",data=>{data["acceptance-jobs"].jobs.pop();}],
  ["duplicated platform",data=>{data["package-jobs"].jobs[0].name=data["package-jobs"].jobs[1].name;}],
  ["source outside dev history",data=>{data.ancestry.status="diverged";}],
  ["installed checks used another package run",data=>{data.logs=data.logs.replace("PACKAGE_RUN: 1","PACKAGE_RUN: 3");}],
  ["missing installed source evidence",data=>{data.logs=data.logs.replace(`PACKAGE_SHA: ${sha}`,"missing");}],
])test("publication rejects "+name,()=>assert.notEqual(verify(change).status,0));
