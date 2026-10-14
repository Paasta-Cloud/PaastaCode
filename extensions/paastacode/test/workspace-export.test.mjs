import test from "node:test";
import assert from "node:assert/strict";
import {PassThrough} from "node:stream";
import {EventEmitter} from "node:events";
import {createHash} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import {WorkspaceExport} from "../src/workspace-export.mjs";
import {spawn} from 'node:child_process';

function processFixture(bytes,{code=0,...options}={}){
  let child;
  const exporter=new WorkspaceExport({workspace:"/project",privateRoot:"/account",command:()=>"fixed-cli",chunkSize:8,...options,spawnChild:(command,args,settings)=>{
    assert.equal(command,"fixed-cli");assert.deepEqual(args,["workspace-export","/project","--private-root","/account"]);assert.equal(settings.windowsHide,true);assert.equal(settings.env.PAASTA_RUNTIME_TOKEN,"");
    child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.killed=false;child.kill=()=>{child.killed=true;child.emit("close",null);};
    child.stdout.once("end",()=>queueMicrotask(()=>child.emit("close",code)));
    queueMicrotask(()=>child.stdout.end(bytes));return child;
  }});
  return {exporter,child:()=>child};
}

test('a real fast producer retains bytes when download starts after process exit',async()=>{
  const bytes=Buffer.alloc(120000,0x61);
  const exporter=new WorkspaceExport({workspace:process.cwd(),command:()=>process.execPath,spawnChild:(command,_args,settings)=>spawn(command,['-e',"process.stdout.end(Buffer.alloc(120000,0x61))"],settings)});
  try{const job=exporter.start('owner');assert(await exporter.job.finished);await delay(50);const result=await exporter.read(job.id,'owner',0);assert(result.done);assert.deepEqual(Buffer.from(result.data,'base64'),bytes);}finally{exporter.close();}
});
test('successful exit with no archive bytes cannot report an empty download',async()=>{
  const {exporter}=processFixture(Buffer.alloc(0));const job=exporter.start('owner');await assert.rejects(exporter.read(job.id,'owner',0));assert.equal(exporter.job,null);
});

test("export chunks bind owner, retain one retry, bound reads and never repeat bytes",async()=>{
  const bytes=Buffer.from("0123456789abcdefghijklmnop"),{exporter,child}=processFixture(bytes);
  try{
    const job=exporter.start("owner-a");assert.equal(exporter.busy,true);assert.throws(()=>exporter.start("owner-a"));
    await assert.rejects(exporter.read(job.id,"owner-b",0));await assert.rejects(exporter.read(job.id,"owner-a",-1));await assert.rejects(exporter.read(job.id,"owner-a",2));
    const [first,retry]=await Promise.all([exporter.read(job.id,"owner-a",0),exporter.read(job.id,"owner-a",0)]);assert.deepEqual(first,retry);
    const parts=[Buffer.from(first.data,"base64")];let chunk=first;
    while(!chunk.done){chunk=await exporter.read(job.id,"owner-a",chunk.nextOffset);const part=Buffer.from(chunk.data,"base64");assert(part.length<=8);assert.equal(chunk.sha256,createHash("sha256").update(part).digest("hex"));parts.push(part);}
    assert.deepEqual(Buffer.concat(parts),bytes);assert.equal(exporter.busy,false);
    assert.deepEqual(await exporter.read(job.id,"owner-a",chunk.offset),chunk);
    await assert.rejects(exporter.read(job.id,"owner-a",0));assert.throws(()=>exporter.cancel(job.id,"owner-b"));
    exporter.cancel(job.id,"owner-a");assert(child().killed);await assert.rejects(exporter.read(job.id,"owner-a",chunk.offset));
  }finally{exporter.close();}
});

test("failed or abandoned archive cannot be reported complete and releases the worker",async()=>{
  const failed=processFixture(Buffer.from("partial"),{code:1});const job=failed.exporter.start("owner");
  await assert.rejects(failed.exporter.read(job.id,"owner",0),/کامل نشد/);assert(failed.child().killed);assert.equal(failed.exporter.busy,false);
  const abandoned=processFixture(Buffer.alloc(100),{idleMs:25});const other=abandoned.exporter.start("owner");
  await delay(60);assert(abandoned.child().killed);await assert.rejects(abandoned.exporter.read(other.id,"owner",0));
});
