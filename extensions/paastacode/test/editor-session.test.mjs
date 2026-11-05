import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';

test('editor uses its live console grant and preserves desktop credentials; expired, foreign and missing grants fail closed',async()=>{
  const home=await mkdtemp(join(process.env.PAASTA_TEST_TMP||tmpdir(),'paasta-editor-account-'));
  const file=join(home,'grant.json'),oldFetch=globalThis.fetch;
  process.env.PAASTA_EDITOR_SESSION_FILE=file;process.env.PAASTA_EDITOR_WORKSPACE_ID=randomUUID();
  const token='paasta_'+'a'.repeat(43),grant={token,server:'https://console.paasta.cloud',workspaceId:process.env.PAASTA_EDITOR_WORKSPACE_ID,expiresAt:new Date(Date.now()+60000).toISOString()};
  const desktop='existing desktop account remains untouched';
  let requests=0;
  globalThis.fetch=async(url,options)=>{
    requests++;assert(url.startsWith(grant.server+'/api/'));
    assert.equal(options.headers.Authorization,'Bearer '+(url.endsWith('/api/coding/usage')?'paasta_ai_'+'b'.repeat(43):token));
    return Response.json(options.method==='POST'?{key:'paasta_ai_'+'b'.repeat(43),dailyLimitToman:1000}:{account:{id:'synthetic'}});
  };
  try{
    await writeFile(join(home,'account.json'),desktop);await writeFile(file,JSON.stringify(grant));
    const {PaastaAccount}=await import('../src/account.mjs');
    const account=await new PaastaAccount(undefined,home).load();
    assert.equal(account.credentials.token,token);assert.equal(account.credentialSource,file);
    await account.context();await account.connect(1000);assert(account.credentials.aiKey);
    await account.request('/api/coding/usage',{token:account.credentials.aiKey});
    const beforeUnknown=requests;await assert.rejects(account.request('/api/coding/usage',{token:'paasta_ai_'+'c'.repeat(43)}),/نشست محیط/);assert.equal(requests,beforeUnknown);
    assert.equal((await new PaastaAccount(undefined,home).load()).credentials.aiKey,account.credentials.aiKey);
    await assert.rejects(account.begin(),/کنسول/);await assert.rejects(account.logout(),/کنسول/);
    assert.equal(await readFile(join(home,'account.json'),'utf8'),desktop);
    for(const invalid of [{...grant,expiresAt:'bad'},{...grant,expiresAt:new Date(0).toISOString()},{...grant,workspaceId:randomUUID()},{...grant,server:'https://foreign.example'}]){
      await writeFile(file,JSON.stringify(invalid));const before=requests;
      await assert.rejects(account.context(),/دسترسی محیط/);assert.equal(account.credentials,null);assert.equal(requests,before);
    }
    await rm(file);await assert.rejects(account.context(),/دسترسی محیط/);
    assert.equal(await readFile(join(home,'account.json'),'utf8'),desktop);
  }finally{globalThis.fetch=oldFetch;delete process.env.PAASTA_EDITOR_SESSION_FILE;delete process.env.PAASTA_EDITOR_WORKSPACE_ID;await rm(home,{recursive:true,force:true});}
});
