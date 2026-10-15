import assert from "node:assert/strict";
import {test} from "node:test";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import {assetLinks,validateLinks} from "../scripts/android-release.mjs";
import {submitWithEnter} from "../web/pwa.js";

const fingerprint=Array.from({length:32},(_,i)=>i.toString(16).padStart(2,"0")).join(":").toUpperCase();
test("release associations include Bazaar validation and preserve other apps",()=>{
  const other={relation:["other"],target:{namespace:"android_app",package_name:"other.app"}};
  const links=assetLinks([fingerprint.toLowerCase(),fingerprint],[other]);
  assert.equal(links.length,3);assert.deepEqual(links[0],other);validateLinks(links,[fingerprint]);
  assert.deepEqual(assetLinks([fingerprint],links),links);
  assert.throws(()=>assetLinks([]));assert.throws(()=>assetLinks(["SHA_1"]));
  assert.throws(()=>validateLinks(links.slice(0,2),[fingerprint]));
  assert.throws(()=>validateLinks(links,[fingerprint.replace(/^00/,"FF")]));
});
test("touch keyboard Enter inserts a newline and composition never submits",()=>{
  assert.equal(submitWithEnter({key:"Enter"},true),false);
  assert.equal(submitWithEnter({key:"Enter"},false),true);
  assert.equal(submitWithEnter({key:"Enter",isComposing:true},false),false);
  assert.equal(submitWithEnter({key:"Enter",shiftKey:true},false),false);
});
test("offline worker never handles APIs, downloads or mutations",async()=>{
  const handlers={},cached=[];
  runInNewContext(await readFile(new URL("../web/sw.js",import.meta.url),"utf8"),{
    URL,self:{location:{origin:"https://code.paasta.cloud"},addEventListener:(name,handler)=>{handlers[name]=handler;}},
    fetch:async()=>{throw new Error("offline");},
    caches:{open:async()=>({addAll:async assets=>cached.push(...assets)}),match:async path=>path}
  });
  await new Promise(resolve=>handlers.install({waitUntil:promise=>promise.then(resolve)}));
  assert(!cached.some(path=>path.includes("api")||path==="/"));
  for(const [path,method,mode] of [["/api/paastacode/workspaces","GET","cors"],["/api/paastacode/workspaces/x/export","GET","navigate"],["/","POST","navigate"],["/app.js","GET","cors"]]) {
    let intercepted=false;handlers.fetch({request:{url:"https://code.paasta.cloud"+path,method,mode},respondWith:()=>{intercepted=true;}});assert.equal(intercepted,false,path);
  }
  let result;handlers.fetch({request:{url:"https://code.paasta.cloud/?platform=android",method:"GET",mode:"navigate"},respondWith:promise=>{result=promise;}});
  assert.equal(await result,"/offline.html");
});
