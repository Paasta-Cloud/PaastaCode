import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const workflow=readFileSync(new URL("../../../.github/workflows/paastacode-release.yml",import.meta.url),"utf8");
const keys=["CSC_LINK","CSC_KEY_PASSWORD","APPLE_ID","APPLE_APP_SPECIFIC_PASSWORD","APPLE_TEAM_ID"];
function environment(os,signed,values={}){
  const reads=[],secrets=new Proxy(values,{get:(target,key)=>{reads.push(key);return target[key]||"";}}),result={};
  const platform={Windows:"win32",macOS:"darwin",Linux:"linux"}[os];
  for(const key of keys){
    const expression=workflow.match(new RegExp("^      "+key+": \\$\\{\\{ (.+) \\}\\}$","m"))?.[1];assert(expression,"Missing signing environment "+key);
    assert(/^[A-Za-z0-9_.'()\s&|=]+$/.test(expression),"Unexpected expression syntax");
    // jobs.<job_id>.env has matrix, inputs and secrets; runner is only
    // available after the job starts. The old harness invented that context.
    assert(!/\brunner\./.test(expression),"runner context is unavailable in job-level env");
    result[key]=Function("inputs","matrix","secrets","return ("+expression+");")({signed},{platform},secrets);
  }
  return {result,reads};
}
test("unsigned and Linux package jobs cannot receive or read signing credentials",()=>{
  for(const os of ["Windows","macOS","Linux"]){const actual=environment(os,false);assert(actual.reads.length===0,os+" unsigned job accessed signing secrets");assert(Object.values(actual.result).every(value=>value===""));}
  assert.equal(environment("Linux",true).reads.length,0);
});
test("signed Windows and macOS jobs use their own certificate and password",()=>{
  const values={PAASTACODE_WINDOWS_CSC_LINK:"win-cert",PAASTACODE_WINDOWS_CSC_KEY_PASSWORD:"win-password",PAASTACODE_MAC_CSC_LINK:"mac-cert",PAASTACODE_MAC_CSC_KEY_PASSWORD:"mac-password",PAASTACODE_APPLE_ID:"apple",PAASTACODE_APPLE_APP_SPECIFIC_PASSWORD:"app-password",PAASTACODE_APPLE_TEAM_ID:"team"};
  const win=environment("Windows",true,values),mac=environment("macOS",true,values);
  assert.equal(win.result.CSC_LINK,"win-cert");assert.equal(win.result.CSC_KEY_PASSWORD,"win-password");assert(!win.reads.some(key=>key.includes("MAC_")||key.includes("APPLE_")));
  assert.equal(mac.result.CSC_LINK,"mac-cert");assert.equal(mac.result.CSC_KEY_PASSWORD,"mac-password");assert.equal(mac.result.APPLE_ID,"apple");assert(!mac.reads.some(key=>key.includes("WINDOWS_")));
  for(const os of ["Windows","macOS"]){const legacy=environment(os,true,{PAASTACODE_CSC_LINK:"legacy",PAASTACODE_CSC_KEY_PASSWORD:"legacy-password"});assert.equal(legacy.result.CSC_LINK,"legacy");assert.equal(legacy.result.CSC_KEY_PASSWORD,"legacy-password");}
});
