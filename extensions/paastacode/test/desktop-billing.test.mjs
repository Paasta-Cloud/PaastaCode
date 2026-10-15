import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {allowedExternal}=createRequire(import.meta.url)('../desktop/external-links.cjs');
test('desktop opens owned subscription links in the browser without allowing console APIs or unsafe schemes',()=>{
  const origin='https://console.paasta.cloud';
  assert(allowedExternal(origin+'/paastacode?owner=synthetic',origin));
  assert(allowedExternal(origin+'/cli/authorize?code=synthetic',origin));
  assert(allowedExternal('https://github.com/Paasta-Cloud/PaastaCode',origin));
  assert(allowedExternal('http://127.0.0.1:3000/api/paastacode/web/billing.html#owner=synthetic','http://127.0.0.1:3000'));
  for(const value of ['javascript:alert(1)','file:///etc/passwd','http://example.test',origin+'/api/tokens',origin+'/api/admin',origin+'/paastacode/../api/tokens','https://user:secret@console.paasta.cloud/paastacode'])assert.equal(allowedExternal(value,origin),false,value);
});
