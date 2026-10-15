import {readFile,writeFile,mkdir} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {parseArgs} from "node:util";

export const androidPackage="cloud.paasta.code",androidOrigin="https://code.paasta.cloud";
export function assetLinks(fingerprints,existing=[]) {
  if(!Array.isArray(existing))throw new Error("Existing asset links must be a JSON array.");
  const normalized=[...new Set(fingerprints.map(value=>value.trim().toUpperCase()))];
  if(!normalized.length||normalized.some(value=>!/^([A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(value)))throw new Error("Supply the release certificate's SHA-256 fingerprint (32 colon-separated bytes).");
  const links=existing.filter(entry=>!(entry.target?.package_name===androidPackage&&["android_app","cafebazaar_twa"].includes(entry.target?.namespace)));
  const previous=existing.filter(entry=>entry.target?.namespace==="android_app"&&entry.target?.package_name===androidPackage).flatMap(entry=>entry.target.sha256_cert_fingerprints||[]);
  return [...links,
    {relation:["delegate_permission/common.handle_all_urls"],target:{namespace:"android_app",package_name:androidPackage,sha256_cert_fingerprints:[...new Set([...previous,...normalized])]}},
    {relation:["check_validation"],target:{namespace:"cafebazaar_twa",package_name:androidPackage}}
  ];
}
export function validateLinks(links,fingerprints) {
  const expected=assetLinks(fingerprints);
  for(const entry of expected) {
    const found=links.find(item=>item.target?.namespace===entry.target.namespace&&item.target.package_name===androidPackage&&item.relation?.includes(entry.relation[0]));
    if(!found)throw new Error("Missing asset relation: "+entry.target.namespace);
    for(const fingerprint of entry.target.sha256_cert_fingerprints||[])if(!found.target.sha256_cert_fingerprints?.includes(fingerprint))throw new Error("The published fingerprint differs from the release certificate.");
  }
}
async function main() {
  const {values}=parseArgs({options:{fingerprint:{type:"string",multiple:true},existing:{type:"string"},out:{type:"string"},verify:{type:"boolean"}}});
  const fingerprints=values.fingerprint||[];
  if(values.verify) {
    async function get(path,type) {
      const response=await fetch(androidOrigin+path,{redirect:"error",signal:AbortSignal.timeout(20000),cache:"no-store"});
      if(!response.ok||!response.headers.get("content-type")?.includes(type))throw new Error(`${path}: expected HTTP 200 and ${type}, got ${response.status}`);
      return response;
    }
    validateLinks(await (await get("/.well-known/assetlinks.json","application/json")).json(),fingerprints);
    const manifest=await (await get("/manifest.webmanifest","application/manifest+json")).json();
    if(manifest.start_url!=="/?platform=android"||manifest.display!=="standalone"||manifest.scope!=="/")throw new Error("Unexpected web manifest start URL, scope or display mode.");
    await get("/sw.js","javascript");await get("/offline.html","text/html");
    for(const icon of manifest.icons||[])await get(icon.src,"image/png");
    console.log("Live Android/Bazaar association and PWA assets passed. Signed-device login, cloud execution, export and store billing still require acceptance testing.");
    return;
  }
  const existing=values.existing?JSON.parse(await readFile(values.existing,"utf8")):[];
  const result=assetLinks(fingerprints,existing),output=resolve(values.out||"dist/android-web/.well-known/assetlinks.json");
  await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+"\n");
  console.log("Created "+output+". Deploy it to "+androidOrigin+"/.well-known/assetlinks.json without redirects; preserve other apps' existing associations.");
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
