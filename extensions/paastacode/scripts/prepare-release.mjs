import {readdir,mkdir,readFile,writeFile,copyFile} from "node:fs/promises";
import {resolve,join,basename} from "node:path";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
const yaml=createRequire(import.meta.url)("js-yaml");
const input=resolve(process.argv[2]),output=resolve(process.argv[3]);
await mkdir(output,{recursive:true});const metadata=new Map(),hashes=new Map();
for(const directory of await readdir(input)){
  if(!/^paastacode-(win32|linux|darwin)-(x64|arm64)$/.test(directory))continue;
  for(const name of await readdir(join(input,directory))){
    if(name!==basename(name)||!(/^(PaastaCode-|SHA256SUMS-|release-manifest-)/.test(name)||/^(beta|alpha|latest)(-[a-z0-9]+)*\.yml$/.test(name)))continue;
    const bytes=await readFile(join(input,directory,name));
    if(name.endsWith(".yml")){
      const value=yaml.load(bytes.toString(),{schema:yaml.JSON_SCHEMA}),previous=metadata.get(name);
      if(previous&&previous.version!==value.version)throw new Error("Mixed update versions");
      metadata.set(name,previous?{...previous,files:[...previous.files,...value.files]}:value);continue;
    }
    const hash=createHash("sha256").update(bytes).digest("hex");if(hashes.has(name)&&hashes.get(name)!==hash)throw new Error("Conflicting artifact "+name);
    hashes.set(name,hash);await copyFile(join(input,directory,name),join(output,name));
  }
}
for(const [name,value] of metadata){
  value.files=[...new Map(value.files.map(file=>[file.url,file])).values()];
  for(const file of value.files){
    if(file.url!==basename(file.url)||!hashes.has(file.url))throw new Error("Update metadata references an absent artifact");
    const bytes=await readFile(join(output,file.url));if(createHash("sha512").update(bytes).digest("base64")!==file.sha512||file.size!==undefined&&file.size!==bytes.length)throw new Error("Update artifact digest mismatch");
  }
  await writeFile(join(output,name),yaml.dump(value));
}
if(!metadata.size)throw new Error("No auto-update metadata produced");
console.log("Customer artifacts and per-architecture updater metadata verified and assembled.");
