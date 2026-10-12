import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import {readFileSync} from "node:fs";
const bin=fileURLToPath(new URL("../bin/paastacode.mjs",import.meta.url));
const packageVersion=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8")).version;
test("CLI version/help run without login and invalid budgets fail before device authorization",()=>{
  const run=args=>spawnSync(process.execPath,[bin,...args],{encoding:"utf8",timeout:15000,env:{...process.env,PAASTACODE_HOME:resolve(".artifacts/cli-test-state")}});
  const version=run(["--version"]);assert.equal(version.status,0);assert.equal(version.stdout.trim(),"PaastaCode "+packageVersion);
  const help=run(["help"]);assert.equal(help.status,0);assert.match(help.stdout,/Powered by OpenCode/);
  for(const budget of ["0","NaN","1.5","1000001"]){const invalid=run(["login","--daily-limit="+budget]);assert.equal(invalid.status,1);assert.match(invalid.stderr,/سقف روزانه/);assert(!invalid.stdout.includes("کد ورود"));}
});
