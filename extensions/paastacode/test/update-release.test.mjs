import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,readFile,rm,realpath} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {chooseRelease,downloadUpdate,newer} from "../src/updates.mjs";

test("update discovery respects stable/beta channels, ignores drafts and never downgrades",()=>{
  const releases=[{tag_name:"v0.2.0-beta.6",prerelease:true},{tag_name:"v0.3.0",draft:true},{tag_name:"v0.2.0"},{tag_name:"foreign"}];
  assert.equal(chooseRelease(releases,"0.2.0-beta.5").tag_name,"v0.2.0");
  assert.equal(chooseRelease(releases,"0.2.0"),null);
  assert.equal(chooseRelease(releases,"0.1.0").tag_name,"v0.2.0");
  assert(newer("paastacode-v0.2.0-beta.10","0.2.0-beta.9"));assert(!newer("0.2.0-beta.6","0.2.0"));
});
test("update downloads require the official asset URL, exact size and GitHub SHA256 digest",async()=>{
  const directory=await realpath(await mkdtemp(join(tmpdir(),"paastacode-update-"))),bytes=Buffer.from("synthetic release"),name="PaastaCode-0.2.0-beta.6-win32-x64.zip";
  const asset={name,size:bytes.length,digest:"sha256:"+createHash("sha256").update(bytes).digest("hex"),browser_download_url:"https://github.com/Paasta-Cloud/PaastaCode/releases/download/v0.2.0-beta.6/"+name};
  const release={tag_name:"v0.2.0-beta.6",assets:[asset]};let calls=0;
  const options={platform:"win32",arch:"x64",directory,fetcher:async()=>{calls++;return new Response(bytes);}};
  try{
    const result=await downloadUpdate(release,"portable",options);assert.deepEqual(await readFile(result.path),bytes);
    await assert.rejects(downloadUpdate({...release,assets:[{...asset,browser_download_url:"https://evil.test/"+name}]},"portable",options));assert.equal(calls,1);
    await assert.rejects(downloadUpdate({...release,assets:[{...asset,digest:"sha256:"+"0".repeat(64)}]},"portable",options),/صحت/);
    await assert.rejects(downloadUpdate({...release,assets:[{...asset,size:bytes.length-1}]},"portable",options),/اندازه/);
    await assert.rejects(downloadUpdate({...release,assets:[{...asset,digest:null}]},"portable",options),/معتبر/);
  }finally{assert(directory.startsWith(join(await realpath(tmpdir()),"paastacode-update-")));await rm(directory,{recursive:true,force:true});}
});
