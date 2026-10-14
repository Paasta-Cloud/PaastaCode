import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const workflow=readFileSync(new URL("../../../.github/workflows/paastacode-upgrade-acceptance.yml",import.meta.url),"utf8");
const smoke=readFileSync(new URL("../scripts/smoke-desktop.mjs",import.meta.url),"utf8");

test("installed upgrade gate verifies published bytes, same-path versions and retained profile",()=>{
  for(const value of ["asset[0].digest","Get-FileHash","asset[0].size","/D=$install","PAASTACODE_SMOKE_BINARY","PAASTACODE_SMOKE_ROOT","upgrade-marker","PAASTACODE_EXPECT_VERSION = $fromVersion","PAASTACODE_EXPECT_VERSION = $toVersion"])assert(workflow.includes(value),"Missing installed upgrade boundary: "+value);
  assert(smoke.includes('process.env.PAASTACODE_SMOKE_BINARY?[process.env.PAASTACODE_SMOKE_BINARY]'));
  assert(smoke.includes('process.env.PAASTACODE_SMOKE_ROOT||'));
  assert(smoke.includes('process.env.PAASTACODE_SMOKE_OUTPUT||'));
});
