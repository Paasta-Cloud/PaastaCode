import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
process.env.PAASTACODE_HOME=resolve('.artifacts/integrations-tests');
const {WorkspaceIntegrations,mcpConfig,skillBundle,parseSkillMarkdown}=await import('../src/integrations.mjs');
const {startServer}=await import('../src/server.mjs');

test('cloud project tools persist independently and cannot enable an unsupported browser',async()=>{
  const home=await realpath(await mkdtemp(join(tmpdir(),'paastacode-cloud-tools-')));
  try{
    const first=new WorkspaceIntegrations('/cloud/one','owner',{home,cloud:true}),second=new WorkspaceIntegrations('/cloud/two','owner',{home,cloud:true});
    await first.update({kind:'mcp',action:'preset',name:'figma'});await first.update({kind:'skill',action:'preset',name:'persian-writing'});
    await assert.rejects(first.update({kind:'browser',enabled:true}));await assert.rejects(first.update({kind:'mcp',action:'preset',name:'figma-desktop'}));
    await first.change(state=>{state.browser=true;});
    assert.equal((await first.config()).mcp.browser,undefined);
    const restored=new WorkspaceIntegrations('/cloud/one','owner',{home,cloud:true}),view=await restored.publicState({call:async()=>({})});
    assert.equal(view.cloud,true);assert.equal(view.browser.available,false);assert.equal(view.browser.enabled,false);assert.equal(view.servers.length,1);assert.equal(view.skills.length,1);assert(!view.catalog.mcp.some(p=>p.id==='figma-desktop'));
    const other=await second.publicState({call:async()=>({})});assert.equal(other.servers.length,0);assert.equal(other.skills.length,0);
  }finally{assert(home.startsWith(join(await realpath(tmpdir()),'paastacode-cloud-tools-')));await rm(home,{recursive:true,force:true});}
});

test('curated installs are opt-in, preserve existing settings and materialize licensed references',async()=>{
  const home=await realpath(await mkdtemp(join(tmpdir(),'paastacode-presets-')));
  try{
    const manager=new WorkspaceIntegrations('/project','catalog-owner',{home}),other=new WorkspaceIntegrations('/project','other',{home});
    const state=await manager.publicState({call:async()=>({})});assert.equal(state.servers.length,0);assert.equal(state.skills.length,0);assert.equal(state.proxy.enabled,false);
    assert(state.catalog.mcp.find(item=>item.id==='figma'));assert.equal(state.catalog.skills.length,3);
    for(const preset of state.catalog.skills)await manager.update({kind:'skill',action:'preset',name:preset.id});
    await manager.update({kind:'mcp',action:'preset',name:'figma'});await manager.update({kind:'mcp',action:'toggle',name:'figma',enabled:false});
    await assert.rejects(manager.update({kind:'mcp',action:'preset',name:'figma'}));assert.equal((await manager.read()).servers.figma.enabled,false);
    await assert.rejects(manager.update({kind:'skill',action:'preset',name:'../secret'}));
    await manager.update({kind:'proxy',enabled:true,url:'socks5://127.0.0.1:2080',username:'fixture',password:'private-proxy-sentinel'});
    const visible=await manager.publicState({call:async()=>({})});assert.equal(visible.proxy.hasPassword,true);assert(!JSON.stringify(visible).includes('private-proxy-sentinel'));assert.equal((await other.publicState({call:async()=>({})})).proxy.enabled,false);
    await manager.update({kind:'proxy',enabled:false,url:'socks5://127.0.0.1:2080'});assert.equal((await manager.read()).proxy.password,'private-proxy-sentinel');
    const config=await manager.config();assert.match(await readFile(join(config.skills.paths[0],'persian-writing/references/writing-style.md'),'utf8'),/Persian|Writing|writing/);
    for(const preset of state.catalog.skills)assert.match(await readFile(join(config.skills.paths[0],preset.id,'LICENSE'),'utf8'),/MIT/);
  }finally{assert(home.startsWith(join(await realpath(tmpdir()),'paastacode-presets-')));await rm(home,{recursive:true,force:true});}
});

test('MCP configuration cannot replace provider policy or smuggle a remote credential in its URL',()=>{
  for(const url of ['file:///etc/passwd','http://remote.example/mcp','https://name:secret@example.test/mcp','https://example.test/mcp?token=secret'])assert.throws(()=>mcpConfig({type:'remote',url}));
  assert.equal(mcpConfig({type:'remote',url:'http://127.0.0.1:3845/mcp'}).url,'http://127.0.0.1:3845/mcp');
  const result=mcpConfig({type:'remote',url:'https://example.test/mcp',permission:{'*':'allow'},provider:{foreign:{}},headers:{Authorization:'Bearer synthetic'}});
  assert.equal(result.permission,undefined);assert.equal(result.provider,undefined);assert.equal(result.headers.Authorization,'Bearer synthetic');
  for(const command of ['npx example',[],['node',null]])assert.throws(()=>mcpConfig({type:'local',command}));
});
test('skills reject traversal, duplicate files, malformed data and reserved names',()=>{
  const input={name:'review-code',description:'Review UI changes',instructions:'Read the diff first.'};
  for(const path of ['../secret','/absolute','scripts/../../secret','C:/secret','scripts\\escape','SKILL.md'])assert.throws(()=>skillBundle({...input,files:[{path,data:'eA=='}]}));
  assert.throws(()=>skillBundle({...input,name:'../escape'}));assert.throws(()=>skillBundle({...input,name:'constructor'}));
  assert.throws(()=>skillBundle({...input,files:[{path:'test',data:'not base64'}]}));
  assert.throws(()=>skillBundle({...input,files:[{path:'a',data:'eA=='},{path:'A',data:'eA=='}]}));
  const parsed=parseSkillMarkdown('---\nname: review-code\ndescription: >\n  Review the UI\n  after changes.\n---\nRead the diff first.');assert.equal(parsed.description,'Review the UI after changes.');
});
test('account/workspace settings stay private and skill assets are materialized only for enabled skills',async()=>{
  const home=await realpath(await mkdtemp(join(tmpdir(),'paastacode-integrations-')));
  try{
    const a=new WorkspaceIntegrations('/project','tenant-a:user',{home}),b=new WorkspaceIntegrations('/project','tenant-b:user',{home}),c=new WorkspaceIntegrations('/other','tenant-a:user',{home});
    await Promise.all([a.update({kind:'mcp',action:'save',name:'figma',config:{type:'remote',url:'https://mcp.figma.com/mcp',headers:{Authorization:'Bearer synthetic-private'}}}),a.update({kind:'skill',action:'save',name:'review-code',description:'Review code',instructions:'Never claim unrun tests.',files:[{path:'references/check.md',data:Buffer.from('Check keyboard focus.').toString('base64')}]})]);
    assert.equal((await b.read()).servers.figma,undefined);assert.equal((await c.read()).skills['review-code'],undefined);
    assert.notEqual(a.engineName('figma'),b.engineName('figma'));assert.notEqual(a.engineName('figma'),c.engineName('figma'),'OAuth entries must not collide between workspaces');
    const publicValue=await a.publicState({call:async()=>({figma:{status:'failed',error:'Bearer synthetic-private'}})});assert(!JSON.stringify(publicValue).includes('synthetic-private'));assert(!JSON.stringify(publicValue).includes('Never claim'));
    const config=await a.config();assert.equal(config.provider,undefined);assert.match(await readFile(join(config.skills.paths[0],'review-code/SKILL.md'),'utf8'),/Never claim unrun tests/);assert.equal(await readFile(join(config.skills.paths[0],'review-code/references/check.md'),'utf8'),'Check keyboard focus.');
    await a.update({kind:'skill',action:'toggle',name:'review-code',enabled:false});const next=await a.config();await assert.rejects(readFile(join(next.skills.paths[0],'review-code/SKILL.md')));await a.cleanPrevious();
    assert.equal((await a.publicState({call:async()=>({})})).skills[0].enabled,false);
  }finally{assert(home.startsWith(join(await realpath(tmpdir()),'paastacode-integrations-')));await rm(home,{recursive:true,force:true});}
});
test('broker protects integration mutations, refuses active work and rejects OAuth state mismatch',async()=>{
  const workspace=await realpath(await mkdtemp(join(tmpdir(),'paastacode-integration-api-')));let busy=true,starts=0,callbacks=0;
  const account={origin:'https://example.test',credentials:{token:'synthetic',aiKey:'synthetic'},context:async()=>({account:{id:'synthetic',tenantId:'owned'},models:[{id:'synthetic',input_toman_per_million:1,output_toman_per_million:1,supported_parameters:['tools']}]})};
  const runtime={url:null,async start(config){starts++;this.url='http://127.0.0.1:1';this.config=config;},async stop(){this.url=null;},async call(path){if(path==='/session/status')return busy?{ses_owned:{type:'busy'}}:{};if(path==='/mcp')return {};if(/^\/mcp\/figma_[a-f0-9]{8}\/auth$/.test(path))return {authorizationUrl:'https://figma.example/authorize?state=fixture-state',oauthState:'fixture-state'};if(/^\/mcp\/figma_[a-f0-9]{8}\/auth\/callback$/.test(path)){callbacks++;return {status:'connected'};}throw Error('Unexpected fixture path '+path);}};
  const app=await startServer({workspace,account,runtime,deployment:{state:async()=>({connected:false})}}),headers={Authorization:'Bearer '+app.capability,'Content-Type':'application/json','X-PaastaCode-Account':'1'};
  const post=(path,input,extra=headers)=>fetch(app.url+'/api/'+path,{method:'POST',headers:extra,body:JSON.stringify(input)});
  try{
    assert.equal((await post('integrations',{kind:'browser',enabled:true},{})).status,401);
    assert.equal((await post('integrations',{kind:'browser',enabled:true})).status,400);assert.equal(starts,1);
    busy=false;assert.equal((await post('integrations',{kind:'mcp',action:'save',name:'figma',config:{type:'remote',url:'https://mcp.figma.com/mcp'}})).status,200);assert.equal(starts,2);
    assert.equal((await post('integrations',{kind:'browser',enabled:true},{...headers,'X-PaastaCode-Account':'0'})).status,409);
    assert.equal((await post('integrations/auth',{name:'figma'})).status,200);
    assert.equal((await post('integrations/auth',{name:'figma',callback:'http://127.0.0.1/callback?code=synthetic&state=wrong'})).status,400);assert.equal(callbacks,0);
    assert.equal((await post('integrations/auth',{name:'figma',callback:'http://127.0.0.1/callback?code=synthetic&state=fixture-state'})).status,200);assert.equal(callbacks,1);
    assert.equal((await post('integrations/auth',{name:'figma',callback:'http://127.0.0.1/callback?code=synthetic&state=fixture-state'})).status,400);assert.equal(callbacks,1);
  }finally{await app.close();assert(workspace.startsWith(join(await realpath(tmpdir()),'paastacode-integration-api-')));await rm(workspace,{recursive:true,force:true});}
});
