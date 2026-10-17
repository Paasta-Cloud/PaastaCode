import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {CloudProjects} from '../cloud/projects.mjs';
import {cloudGateway} from '../cloud/gateway.mjs';

test('cloud projects retain legacy files, isolate stale tabs, drain work, reject busy switches and recover restart failures',async()=>{
  const root=await mkdtemp(join(tmpdir(),'paastacode-projects-'));await mkdir(join(root,'workspace'));await writeFile(join(root,'workspace','keep.txt'),'legacy');
  let busy=false,fail=false,active=0;const seen=[];
  const createBroker=async workspace=>{
    if(fail){fail=false;throw Error('synthetic startup failure');}active++;assert.equal(active,1,'only one engine at once');
    const capability=randomBytes(32).toString('base64url');
    const server=createServer((req,res)=>{assert.equal(req.headers.authorization,'Bearer '+capability);seen.push([workspace,req.url]);res.writeHead(req.url==='/api/update/prepare'&&busy?409:200,{'Content-Type':'application/json'});res.end(JSON.stringify({workspace}));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    return {url:'http://127.0.0.1:'+server.address().port,capability,close:async()=>{active--;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
  };
  let manager=await new CloudProjects({root,createBroker}).start(),gateway;
  try{
    const project={id:randomUUID(),name:'پروژهٔ دوم'};
    await Promise.all([manager.create(project),manager.create(project)]);assert.equal(manager.list().projects.length,2);assert.equal(await readFile(join(root,'workspace','keep.txt'),'utf8'),'legacy');
    await assert.rejects(manager.create({...project,name:'different'}));await assert.rejects(manager.create({id:'../escape',name:'bad'}));
    busy=true;await assert.rejects(manager.select(project.id));assert.equal(manager.list().activeProject,'default');assert.equal(active,1);busy=false;
    let release;const inFlight=manager.use('default',()=>new Promise(resolve=>{release=resolve;}));await Promise.resolve();const selecting=manager.select(project.id);await Promise.resolve();assert.throws(()=>manager.use('default',()=>{}));release();await inFlight;await selecting;
    assert.equal(manager.list().activeProject,project.id);assert.throws(()=>manager.use('default',()=>assert.fail('stale request forwarded')),error=>error.projectChanged);
    await writeFile(join(root,'projects',project.id,'new.txt'),'second');
    fail=true;await assert.rejects(manager.select('default'));assert.equal(manager.list().activeProject,project.id);assert.equal(active,1);
    await manager.close();manager=await new CloudProjects({root,createBroker}).start();assert.equal(manager.list().activeProject,project.id);assert.equal(await readFile(join(root,'projects',project.id,'new.txt'),'utf8'),'second');
    const secret=randomBytes(32).toString('base64url');gateway=await cloudGateway({projects:manager,secret,host:'127.0.0.1',port:0});const url='http://127.0.0.1:'+gateway.port,headers={'X-PaastaCode-Cloud-Token':secret};
    assert.equal((await fetch(url+'/api/projects')).status,401);
    assert.equal((await (await fetch(url+'/api/projects',{headers})).json()).projects.length,2);
    const stale=await fetch(url+'/api/prompt',{method:'POST',headers,body:'{}'});assert.equal(stale.status,409);assert.equal((await stale.json()).projectChanged,true);
    const before=seen.length;assert.equal((await fetch(url+'/api/state',{headers:{...headers,'X-PaastaCode-Project':project.id}})).status,200);assert.equal(seen.length,before+1);
    assert.equal((await fetch(url+'/api/projects/select',{method:'POST',headers,body:JSON.stringify({id:'default'})})).status,200);
    assert.equal(await readFile(join(root,'workspace','keep.txt'),'utf8'),'legacy');
    const escape=randomUUID();await mkdir(join(root,'projects',escape));await rm(join(root,'projects',escape),{recursive:true});await symlink(join(root,'workspace'),join(root,'projects',escape),'junction');await assert.rejects(manager.create({id:escape,name:'link'}));
  }finally{await gateway?.close();await manager.close();await rm(root,{recursive:true,force:true});}
});
