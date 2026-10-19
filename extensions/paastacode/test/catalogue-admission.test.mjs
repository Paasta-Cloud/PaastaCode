import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
process.env.PAASTACODE_HOME=resolve('.artifacts/catalogue-admission-'+process.pid);
const {startServer}=await import('../src/server.mjs');

test('catalogue reordering and unrelated changes cannot block a prompt behind another approval',async()=>{
  const model=id=>({id,name:id,supported_parameters:['tools'],input_modalities:['text','image'],input_toman_per_million:10,output_toman_per_million:30,context_length:32000,max_output_tokens:4096});
  let models=[model('selected'),model('other')],busy=true,starts=0,stops=0,submitted=[];
  const session={id:'ses_fixture',title:'Fixture',directory:process.cwd()};
  const runtime={url:null,async start(){starts++;this.url='http://127.0.0.1:1';},async stop(){stops++;this.url=null;},async call(path,options){
    if(path==='/session/status')return busy?{ses_approval:{type:'busy'}}:{};
    if(path==='/session')return [session];if(path==='/permission')return [];
    if(path.endsWith('/message'))return [];
    if(path.endsWith('/prompt_async')){submitted.push(options.body);return null;}return session;
  }};
  const account={origin:'https://synthetic.test',credentials:{token:'synthetic',aiKey:'synthetic'},async context(){return {account:{id:'user',tenantId:'tenant'},models};}};
  const app=await startServer({account,runtime}),headers={Authorization:'Bearer '+app.capability,'Content-Type':'application/json'};
  const api=(path,input)=>fetch(app.url+'/api/'+path,{method:input?'POST':'GET',headers,body:input?JSON.stringify(input):undefined});
  const prompt=(extra={})=>api('prompt',{id:session.id,text:'Continue safely',model:'selected',...extra});
  try{
    await api('state');await api('ready',{});
    models.reverse();await api('state');
    const reordered=await prompt();assert.equal(reordered.status,200,JSON.stringify(await reordered.json()));
    models=[{...model('new')}, {...model('selected'),name:'New display label',input_modalities:['image','text','image']}];await api('state');
    assert.equal((await prompt()).status,200,'Unrelated additions/removals, names and modality order leave active work untouched');
    assert.equal(stops,0);assert.equal(starts,1);assert.equal(submitted.length,2);
    assert.equal((await prompt({model:'new'})).status,400,'A newly selected model still requires safe engine refresh');
    assert.equal((await prompt({phase:'plan',executionModel:'new',autoExecute:true})).status,400,'Both models must be ready before automatic planning starts');
    models=[{...model('selected'),input_modalities:['text','image','file']}];await api('state');
    assert.equal((await prompt()).status,400,'A genuine selected-model capability change must not interrupt another session');
    assert.equal(stops,0);assert.equal(submitted.length,2);
    busy=false;assert.equal((await prompt()).status,200);assert.equal(stops,1);assert.equal(starts,2);
    models=[];await api('state');assert.equal((await prompt()).status,400,'Removed models cannot bypass the live catalogue');
    assert.equal(submitted.length,3);
  }finally{await app.close();}
});
