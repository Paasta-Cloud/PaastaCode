import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath,symlink} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {previewImport} from "../src/project-import.mjs";

test("project imports preserve source, preview scoped rules and omit tool records and credentials",async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),"paastacode-import-")));
  try{
    await writeFile(join(root,"AGENTS.md"),"Use tests");await writeFile(join(root,"AGENTS.override.md"),"Use override");
    await writeFile(join(root,"CLAUDE.md"),"Claude project rules");await mkdir(join(root,".cursor/rules"),{recursive:true});
    await writeFile(join(root,".cursor/rules/frontend.mdc"),"---\nglobs: src/**\nalwaysApply: false\n---\nKeep RTL");
    await writeFile(join(root,".cursor/mcp.json"),'DO NOT IMPORT');await writeFile(join(root,".env"),"SYNTHETIC_SECRET=keep");
    const codex=await previewImport(root,{source:"codex",format:"jsonl",text:[{type:"session_meta",payload:{secret:"ignored"}},{type:"response_item",payload:{type:"message",role:"user",content:[{type:"input_text",text:"finish project"}]}},{type:"response_item",payload:{type:"function_call",name:"exec",arguments:"ignored"}}].map(JSON.stringify).join("\n")});
    assert.deepEqual(codex.files,["AGENTS.override.md"]);assert.equal(codex.messages.length,2);assert(!JSON.stringify(codex).includes("ignored"));
    const claude=await previewImport(root,{source:"claude",format:"jsonl",text:JSON.stringify({type:"assistant",message:{role:"assistant",content:[{type:"text",text:"Plan"},{type:"tool_use",input:{command:"ignored"}}]}})});
    assert.equal(claude.messages.at(-1).text,"Plan");
    const cursor=await previewImport(root,{source:"cursor"});assert.deepEqual(cursor.files,[".cursor/rules/frontend.mdc"]);assert.match(cursor.messages[0].text,/alwaysApply: false/);
    assert(!JSON.stringify(cursor).includes("DO NOT IMPORT"));assert.equal(await readFile(join(root,".env"),"utf8"),"SYNTHETIC_SECRET=keep");
    assert.equal((await previewImport(root,{source:"cursor"})).digest,cursor.digest);
    await assert.rejects(previewImport(root,{source:"../secret"}));
    await assert.rejects(previewImport(root,{source:"codex",rules:false,format:"jsonl",text:"invalid"}));
    await assert.rejects(previewImport(root,{source:"cursor",rules:false,text:"a".repeat(91000)}));
    await rm(join(root,".cursor/rules"),{recursive:true});await symlink(join(root,".."),join(root,".cursor/rules"),process.platform==="win32"?"junction":"dir");
    await assert.rejects(previewImport(root,{source:"cursor"}),/داخل پروژه/);
  }finally{assert(root.startsWith(join(await realpath(tmpdir()),"paastacode-import-")));await rm(root,{recursive:true,force:true});}
});
