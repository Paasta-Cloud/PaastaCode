import test from "node:test";
import assert from "node:assert/strict";
import {attachmentParts} from "../src/prompt-attachments.mjs";
const file=(name,value)=>({name,data:Buffer.from(value).toString("base64")});
test("attachments deliver UTF-8 source and preserve model modality boundaries",()=>{
  const parts=attachmentParts([file("ورود.ts","export const title = 'سلام';")]);assert.equal(parts.length,2);assert(parts[1].synthetic);assert(parts[1].text.includes("export const"));
  const png=file("design.png",Buffer.from("89504e470d0a1a0a000000000000","hex"));assert.throws(()=>attachmentParts([png],{input_modalities:["text"]}),/مدل/);const image=attachmentParts([png],{input_modalities:["image"]})[0];assert.equal(image.mime,"image/png");assert(image.url.startsWith("data:image/png;base64,"));
  assert.throws(()=>attachmentParts([file("guide.pdf","%PDF-1.4")],{input_modalities:["image"]}),/PDF/);
});
test("attachments reject traversal, remote data, binary bytes and excess budgets before engine calls",()=>{
  for(const input of [[file("../secret","data")],[{name:"file",data:"https://example.test"}],[file("archive.zip",Buffer.from([0,1,2]))],Array.from({length:9},()=>file("a","a")),[file("large",Buffer.alloc(4*1024*1024+1))],[file("a",Buffer.alloc(4*1024*1024,65)),file("b",Buffer.alloc(3*1024*1024,65))]])assert.throws(()=>attachmentParts(input));
  assert.deepEqual(attachmentParts(),[]);
  assert(attachmentParts([file("large.txt",Buffer.alloc(4*1024*1024,65))])[1].text.length>4*1024*1024);
});
