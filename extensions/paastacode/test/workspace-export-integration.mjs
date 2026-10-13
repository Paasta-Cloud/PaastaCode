import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from "node:fs/promises";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {createHash,randomBytes} from "node:crypto";
import {WorkspaceExport} from "../src/workspace-export.mjs";

const pkg=JSON.parse(await readFile("package.json","utf8"));
const command=process.env.PAASTACODE_EXPORT_TEST_CLI||resolve(`.artifacts/package/PaastaCode-${pkg.version}-${process.platform}-${process.arch}/client/engine/paasta${process.platform==="win32"?".exe":""}`);
const temp=await realpath(tmpdir()),root=await mkdtemp(join(temp,"paastacode-export-native-")),privateRoot=join(root,"account"),workspace=join(root,"project");
await mkdir(workspace);await mkdir(privateRoot);
await mkdir(join(workspace,".git"));await writeFile(join(workspace,".git","config"),"[core]\n");await writeFile(join(workspace,".env"),"SYNTHETIC_PROJECT_ENV=yes");
await writeFile(join(workspace,"فایل.txt"),"متن پروژه\n".repeat(20000));
await writeFile(join(workspace,"binary.dat"),randomBytes(3100000));
await writeFile(join(privateRoot,"credentials.json"),"synthetic-account-secret");
const exporter=new WorkspaceExport({workspace,privateRoot,command:()=>command,chunkSize:1024});
try{
  const expected=(await promisify(execFile)(command,["workspace-export",workspace,"--private-root",privateRoot],{encoding:"buffer",maxBuffer:20_000_000,windowsHide:true,env:{...process.env,NO_COLOR:"1"}})).stdout;
  const job=exporter.start("synthetic-owner"),parts=[];let offset=0;
  for(;;){const part=await exporter.read(job.id,"synthetic-owner",offset);assert.deepEqual(await exporter.read(job.id,"synthetic-owner",offset),part);const bytes=Buffer.from(part.data,"base64");assert.equal(createHash("sha256").update(bytes).digest("hex"),part.sha256);parts.push(bytes);offset=part.nextOffset;if(part.done)break;}
  assert.deepEqual(Buffer.concat(parts),expected);assert.equal(expected.readUInt32LE(0),0x04034b50);assert.equal(expected.readUInt32LE(expected.length-22),0x06054b50);
  assert.equal(await readFile(join(workspace,".env"),"utf8"),"SYNTHETIC_PROJECT_ENV=yes");
  console.log("Native workspace ZIP equals broker chunks byte-for-byte; retry, digest, Persian files, Git and project environment passed.");
}finally{exporter.close();assert(root.startsWith(join(temp,"paastacode-export-native-")));await rm(root,{recursive:true,force:true});}
