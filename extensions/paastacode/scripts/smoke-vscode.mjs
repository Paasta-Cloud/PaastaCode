import assert from "node:assert/strict";
import {mkdir,mkdtemp,readFile,writeFile,rm,realpath} from "node:fs/promises";
import {join,resolve,sep} from "node:path";
import {createServer} from "node:net";
import {createHash} from "node:crypto";
import {downloadAndUnzipVSCode,runVSCodeCommand,runTests} from "@vscode/test-electron";

const pkg=JSON.parse(await readFile(new URL("../package.json",import.meta.url),"utf8"));
const manifest=JSON.parse(await readFile(new URL("../vscode/package.json",import.meta.url),"utf8"));
const vsix=resolve(process.argv[2]||`dist/PaastaCode-${pkg.version}-${process.platform}-${process.arch}.vsix`);
const release=JSON.parse(await readFile(`dist/release-manifest-${process.platform}-${process.arch}.json`,"utf8"));
assert.equal(release.version,pkg.version);assert.equal(release.platform,process.platform);assert.equal(release.arch,process.arch);
const expected=release.files.find(file=>file.name===vsix.split(/[\\/]/).at(-1));assert(expected,"VSIX must appear in the native release manifest");
const bytes=await readFile(vsix);assert.equal(bytes.length,expected.bytes);assert.equal(createHash("sha256").update(bytes).digest("hex"),expected.sha256);
const root=await realpath(resolve(".artifacts"));
const home=await mkdtemp(join(root,"vscode-installed-")),extensions=join(home,"extensions"),profile=join(home,"profile"),workspace=join(home,"workspace"),driver=join(home,"driver");
const output=resolve(".artifacts/vscode-acceptance");
for(const dir of [extensions,profile,workspace,driver,output])await mkdir(dir,{recursive:true});
await writeFile(join(driver,"package.json"),JSON.stringify({name:"paastacode-acceptance-driver",publisher:"paasta-qa",version:"1.0.0",engines:{vscode:"^1.95.0"}}));
const profileArgs=["--user-data-dir="+profile,"--extensions-dir="+extensions];
const platform=process.platform==="win32"?"win32-"+process.arch+"-archive":process.platform==="darwin"?(process.arch==="arm64"?"darwin-arm64":"darwin"):"linux-"+process.arch;
const download={version:"1.141.0",platform,cachePath:resolve(".artifacts/vscode-cache")};
const socket=createServer();await new Promise(r=>socket.listen(0,"127.0.0.1",r));const port=socket.address().port;await new Promise(r=>socket.close(r));
try{
  const executable=await downloadAndUnzipVSCode(download);
  await runVSCodeCommand([...profileArgs,"--install-extension",vsix,"--force"],{...download,reuseMachineInstall:true,spawn:{timeout:90000,env:{...process.env,PAASTACODE_HOME:join(home,"account")}}});
  const installed=await runVSCodeCommand([...profileArgs,"--list-extensions","--show-versions"],{...download,reuseMachineInstall:true,spawn:{timeout:30000}});
  assert(installed.stdout.split(/\r?\n/).includes("paasta.paastacode@"+manifest.version),"The expected customer VSIX must be installed");
  const log=await import("node:fs");const stream=log.createWriteStream(join(output,"vscode.log"));
  try{
    await runTests({vscodeExecutablePath:executable,extensionDevelopmentPath:driver,extensionTestsPath:resolve("test/vscode-smoke.cjs"),
      launchArgs:[workspace,...profileArgs,"--remote-debugging-port="+port,"--disable-gpu"],stdout:stream,stderr:stream,
      extensionTestsEnv:{PAASTACODE_HOME:join(home,"account"),PAASTACODE_TEST_CDP:String(port),PAASTACODE_INSTALLED_ROOT:extensions,PAASTACODE_EXPECT_EXTENSION_VERSION:manifest.version,PAASTACODE_VSCODE_OUTPUT:output}});
  }finally{await new Promise(r=>stream.end(r));}
  const result=JSON.parse(await readFile(join(output,"vscode-result.json"),"utf8"));assert.equal(result.installed,true);assert.equal(result.version,manifest.version);
  console.log(`Installed VS Code ${process.platform}/${process.arch} acceptance passed: VSIX ${result.version}, bundled runtime, RTL and Vazirmatn`);
}finally{
  assert((await realpath(home)).startsWith(root+sep+"vscode-installed-"));
  await rm(home,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
