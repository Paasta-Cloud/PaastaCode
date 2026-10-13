import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,readFile,copyFile,link,rm,realpath} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";

test("portable update installs beside the original and a newer executable never redirects back",{timeout:120000},async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),"paastacode-upgrade-"))),home=join(root,"profile");
  process.env.PAASTACODE_HOME=home;
  const {installPortable,portableTarget}=await import("../src/updates.mjs");
  const installation=join(root,"original"),staging=join(home,"updates/fixture"),version="0.2.0-beta.6",prefix=`PaastaCode-${version}-${process.platform}-${process.arch}`,bundle=join(root,"source",prefix),node=process.platform==="win32"?"node.exe":"node";
  try{
    for(const path of [join(installation,"client"),join(installation,"runtime"),join(bundle,"client/bin"),join(bundle,"runtime"),staging])await mkdir(path,{recursive:true});
    await copyFile(process.execPath,join(installation,"runtime",node));await link(join(installation,"runtime",node),join(bundle,"runtime",node));
    await writeFile(join(installation,"client/package.json"),JSON.stringify({version:"0.2.0-beta.5"}));await writeFile(join(installation,"retained.txt"),"customer files remain");
    await writeFile(join(bundle,"client/package.json"),JSON.stringify({version}));await writeFile(join(bundle,"client/bin/paastacode.mjs"),`console.log('PaastaCode ${version}');`);
    const archive=join(staging,"fixture.tar");assert.equal(spawnSync("tar",["-cf",archive,"-C",join(root,"source"),prefix],{windowsHide:true}).status,0);
    const target=await installPortable({path:archive,directory:staging,version},installation);
    assert.equal((await portableTarget(join(installation,"client"))).path,target);
    process.env.PAASTACODE_INSTALL_ROOT=installation;
    assert.equal(await portableTarget(join(target,"client")),null,"The new version must not loop through the original launcher");
    assert.equal(await readFile(join(installation,"retained.txt"),"utf8"),"customer files remain");
    await writeFile(join(installation,"update-target.json"),"broken pointer");assert.equal(await portableTarget(join(installation,"client")),null,"Corrupt update state preserves the original launch path");
  }finally{delete process.env.PAASTACODE_INSTALL_ROOT;assert(root.startsWith(join(await realpath(tmpdir()),"paastacode-upgrade-")));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
