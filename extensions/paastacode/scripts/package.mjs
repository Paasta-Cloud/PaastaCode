import {cp,mkdir,readFile,writeFile,copyFile,chmod,realpath} from "node:fs/promises";
import {existsSync} from "node:fs";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {createRequire} from "node:module";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const require=createRequire(import.meta.url),root=resolve(fileURLToPath(new URL("../",import.meta.url)));
const pkg=JSON.parse(await readFile(join(root,"package.json"),"utf8"));
const target=process.argv[2]||"portable",arch=process.arch,platform=process.platform;
const stage=join(root,".artifacts/package"),client=join(stage,"client"),dist=join(root,"dist");
await mkdir(client,{recursive:true});await mkdir(dist,{recursive:true});
// Rebuild only our known staging files; never copy credentials, workspaces or node_modules.
const included=["bin","src","web","licenses","desktop","paasta-cli","LICENSE","OPENCODE_LICENSE","THIRD_PARTY_NOTICES.md","README.md","API.md","CHANGELOG.md"];
for(const file of included)await cp(join(root,file),join(client,file),{recursive:true});
// Commercial font stays outside the MIT source tree; licensed distributors supply it.
const yekan=process.env.PAASTACODE_YEKAN_FONT||resolve(root,"../../public/fonts/yekan-bakh/yekan-bakh-variable.ttf");
if(process.env.PAASTACODE_YEKAN_FONT&&!existsSync(yekan))throw new Error("Publisher Yekan font path is invalid; refusing a release with a missing font");
if(existsSync(yekan))await copyFile(yekan,join(client,"web/fonts/YekanBakh.ttf"));
await writeFile(join(client,"package.json"),JSON.stringify({...pkg,name:"paastacode",dependencies:{},devDependencies:{},scripts:{}},null,2));
const engineMeta=require("opencode-ai/package.json"),engineRoot=dirname(require.resolve("opencode-ai/package.json"));
let engine=join(engineRoot,engineMeta.bin.opencode);
const bytes=await readFile(engine);
if(bytes.subarray(0,2).toString()==="#!"){
  const names=Object.keys(engineMeta.optionalDependencies||{}).filter(name=>name.startsWith("opencode-"+({win32:"windows",darwin:"darwin",linux:"linux"}[platform])+"-"+arch));
  const name=names.find(name=>!name.includes("baseline")&&!name.includes("musl"));
  if(!name)throw new Error("No pinned engine for this platform");
  engine=join(dirname(require.resolve(name+"/package.json")),"bin","opencode"+(platform==="win32"?".exe":""));
}
await mkdir(join(client,"engine"),{recursive:true});
await copyFile(engine,join(client,"engine","opencode"+(platform==="win32"?".exe":"")));
if(platform!=="win32")await chmod(join(client,"engine/opencode"),0o755);
const run=(command,args,options={})=>{const result=spawnSync(command,args,{cwd:root,stdio:"inherit",...options});if(result.error)throw result.error;if(result.status!==0)throw new Error(command+" failed ("+result.status+")");};
const cliName="paasta-"+({win32:"windows",darwin:"darwin",linux:"linux"}[platform])+"-"+({x64:"amd64",arm64:"arm64"}[arch])+(platform==="win32"?".exe":"");
const cliBinary=join(client,"engine","paasta"+(platform==="win32"?".exe":""));
const localCli=resolve(root,"../../public/cli/latest",cliName);
const release=JSON.parse(await readFile(join(root,"src/paasta-cli-release.json"),"utf8"));
if(existsSync(localCli)&&createHash("sha256").update(await readFile(localCli)).digest("hex")===release.files[cliName])await copyFile(localCli,cliBinary);
else run("go",["build","-buildvcs=false","-trimpath","-ldflags=-s -w","-o",cliBinary,"."],{cwd:join(root,"paasta-cli"),env:{...process.env,CGO_ENABLED:"0",GOOS:{win32:"windows",darwin:"darwin",linux:"linux"}[platform],GOARCH:{x64:"amd64",arm64:"arm64"}[arch]}});
if(platform!=="win32")await chmod(cliBinary,0o755);
const portableName="PaastaCode-"+pkg.version+"-"+platform+"-"+arch;
const node=await realpath(process.execPath);
const license=join(dirname(node),"LICENSE");
async function bundleNode(destination){
  await mkdir(destination,{recursive:true});await copyFile(node,join(destination,platform==="win32"?"node.exe":"node"));
  if(platform!=="win32")await chmod(join(destination,"node"),0o755);
  try{await copyFile(license,join(destination,"NODE-LICENSE.txt"));}
  catch(error){
    if(error.code!=="ENOENT")throw error;
    const response=await fetch("https://raw.githubusercontent.com/nodejs/node/v"+process.versions.node+"/LICENSE");
    if(!response.ok)throw new Error("Pinned Node.js licence unavailable");
    await writeFile(join(destination,"NODE-LICENSE.txt"),await response.text());
  }
}
if(target==="desktop"){
  const {build}=await import("esbuild");
  const bundle=await build({stdin:{contents:'module.exports = require("electron-updater")',resolveDir:root,sourcefile:"updater-entry.cjs"},bundle:true,platform:"node",format:"cjs",external:["electron"],outfile:join(client,"desktop/updater-vendor.cjs"),metafile:true,legalComments:"linked"});
  const licenses=new Set();
  for(const input of Object.keys(bundle.metafile.inputs).filter(name=>name.includes("node_modules"))){
    let directory=dirname(resolve(root,input));
    while(directory!==dirname(directory)&&!existsSync(join(directory,"package.json")))directory=dirname(directory);
    if(licenses.has(directory)||!existsSync(join(directory,"package.json")))continue;licenses.add(directory);
    const metadata=JSON.parse(await readFile(join(directory,"package.json"),"utf8"));
    const destination=join(client,"licenses/desktop-update",metadata.name.replaceAll("/","_"));await mkdir(destination,{recursive:true});
    for(const name of ["LICENSE","LICENSE.txt","LICENSE.md","license","license.md"])if(existsSync(join(directory,name)))await copyFile(join(directory,name),join(destination,name));
  }
  const binary=require.resolve("electron-builder/cli.js");
  const env={...process.env};
  for(const key of ["CSC_LINK","CSC_KEY_PASSWORD","APPLE_ID","APPLE_APP_SPECIFIC_PASSWORD","APPLE_TEAM_ID"])if(!env[key])delete env[key];
  run(process.execPath,[binary,"--config","desktop/builder.cjs","--publish","never"],{env});
}else if(target==="vscode"){
  const extension=join(stage,"vscode");await mkdir(extension,{recursive:true});
  for(const file of ["extension.cjs","native-workbench.cjs","README.md","LICENSE"])await copyFile(join(root,"vscode",file),join(extension,file));
  await cp(join(root,"vscode/media"),join(extension,"media"),{recursive:true});
  // VS Code has its own numeric upgrade version; stripping beta suffixes would reuse 0.2.0 forever.
  const manifest=JSON.parse(await readFile(join(root,"vscode/package.json"),"utf8"));
  await writeFile(join(extension,"package.json"),JSON.stringify(manifest,null,2));
  await cp(client,join(extension,"client"),{recursive:true});await bundleNode(join(extension,"runtime"));
  await copyFile(join(root,"desktop/icon.png"),join(extension,"icon.png"));
  await writeFile(join(extension,".vscodeignore"),"**/.DS_Store\n**/Thumbs.db\n");
  const vsce=join(dirname(require.resolve("@vscode/vsce/package.json")),require("@vscode/vsce/package.json").bin.vsce);
  run(process.execPath,[vsce,"package","--no-dependencies","--allow-missing-repository","--target",({win32:"win32",darwin:"darwin",linux:"linux"}[platform])+"-"+arch,"--out",join(dist,portableName+".vsix")],{cwd:extension});
}else if(target==="portable"){
  const portable=join(stage,portableName);await mkdir(portable,{recursive:true});await cp(client,join(portable,"client"),{recursive:true});await bundleNode(join(portable,"runtime"));
  if(platform==="win32"){
    await writeFile(join(portable,"paastacode.cmd"),'@echo off\r\n"%~dp0runtime\\node.exe" "%~dp0client\\bin\\paastacode.mjs" %*\r\n');
    await writeFile(join(portable,"PaastaCode Web.cmd"),'@echo off\r\nset /p "PAASTACODE_FOLDER=Project folder: "\r\nif not defined PAASTACODE_FOLDER exit /b 1\r\n"%~dp0runtime\\node.exe" "%~dp0client\\bin\\paastacode.mjs" web "--workspace=%PAASTACODE_FOLDER%"\r\n');
    const archive=join(dist,portableName+".zip");
    run("powershell.exe",["-NoProfile","-NonInteractive","-Command","Compress-Archive -LiteralPath $env:PAASTACODE_PACKAGE_INPUT -DestinationPath $env:PAASTACODE_PACKAGE_OUTPUT -Force"],{env:{...process.env,PAASTACODE_PACKAGE_INPUT:portable,PAASTACODE_PACKAGE_OUTPUT:archive},windowsHide:true});
  }else{
    const launcher='#!/bin/sh\nroot=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$root/runtime/node" "$root/client/bin/paastacode.mjs" "$@"\n';
    await writeFile(join(portable,"paastacode"),launcher,{mode:0o755});run("tar",["-czf",join(dist,portableName+".tar.gz"),"-C",stage,portableName]);
  }
  const smoke=spawnSync(join(portable,"runtime",platform==="win32"?"node.exe":"node"),[join(portable,"client/bin/paastacode.mjs"),"--version"],{cwd:portable,encoding:"utf8"});
  if(smoke.status!==0||!smoke.stdout.includes(pkg.version))throw new Error("Portable version smoke failed");
}else throw new Error("Unknown package target: "+target);
console.log("PaastaCode "+target+" package ready for "+platform+"/"+arch);
