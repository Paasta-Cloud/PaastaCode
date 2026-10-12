import {readdir,readFile,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {join} from "node:path";
const pkg=JSON.parse(await readFile("package.json","utf8")),files=[];
for(const name of await readdir("dist")){
  if(!name.includes(pkg.version)||!/^PaastaCode-(?:Setup-|Portable-|0)/.test(name)||!/(?:\.exe|\.zip|\.tar\.gz|\.dmg|\.AppImage|\.deb|\.vsix)$/.test(name))continue;
  if(name.endsWith(".exe")&&!/^PaastaCode-(?:Setup|Portable)-/.test(name))continue;
  const bytes=await readFile(join("dist",name));files.push({name,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")});
}
if(!files.length)throw new Error("No customer artifacts found");
await writeFile("dist/release-manifest-"+process.platform+"-"+process.arch+".json",JSON.stringify({version:pkg.version,platform:process.platform,arch:process.arch,signed:process.env.PAASTACODE_SIGNED_RELEASE==="true",files},null,2)+"\n");
await writeFile("dist/SHA256SUMS-"+process.platform+"-"+process.arch+".txt",files.map(file=>file.sha256+"  "+file.name).join("\n")+"\n");
console.log(JSON.stringify({version:pkg.version,platform:process.platform,arch:process.arch,artifacts:files.length}));
