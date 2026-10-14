import test from 'node:test';
import assert from 'node:assert/strict';
import {billingUrl} from '../src/account.mjs';
const account={id:'00000000-0000-4000-8000-000000000001',tenantId:'00000000-0000-4000-8000-000000000002'};
test('billing links carry only the verified owner and never a device credential',()=>{
  const url=new URL(billingUrl('https://console.paasta.cloud',account));assert.equal(url.origin,'https://code.paasta.cloud');assert.equal(url.pathname,'/billing.html');assert.equal(new URLSearchParams(url.hash.slice(1)).get('owner'),account.id+':'+account.tenantId);
  assert.equal(billingUrl('https://self-hosted.example.test',account).split('#')[0],'https://self-hosted.example.test/api/paastacode/web/billing.html');
  assert.equal(billingUrl('https://console.paasta.cloud',{id:'legacy',tenantId:account.tenantId}),null);
  assert.throws(()=>billingUrl('https://user:password@example.test',account));
});
