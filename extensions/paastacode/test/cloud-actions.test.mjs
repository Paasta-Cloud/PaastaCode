import test from "node:test";
import assert from "node:assert/strict";
import {conversationExport} from "../web/cloud-actions.js";
test("conversation export contains only selected text and title, never connection or tool metadata",()=>{
  const saved={id:"12345678-1234-1234-1234-123456789012",title:"گفتگوی آزمایشی",token:"synthetic-secret",tenant_id:"private",snapshot:{version:1,messages:[{role:"user",text:"متن",credentials:"synthetic-secret",tool:{output:"synthetic-secret"}}]}};
  assert.deepEqual(JSON.parse(conversationExport(saved)),{version:1,title:saved.title,messages:[{role:"user",text:"متن"}]});
  assert(!conversationExport(saved).includes("synthetic-secret"));assert.throws(()=>conversationExport({...saved,id:"../../file"}));
});
