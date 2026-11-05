const {filePath,limits,readArchive,writeArchive}=require('./archive.cjs');
const budget=5*1024**3;
const request=value=>new Promise((resolve,reject)=>{value.onsuccess=()=>resolve(value.result);value.onerror=()=>reject(value.error);});
async function database(){return new Promise((resolve,reject)=>{const open=indexedDB.open('paasta-web-ide',2);open.onupgradeneeded=()=>{for(const name of ['projects','conversations','blobs'])if(!open.result.objectStoreNames.contains(name))open.result.createObjectStore(name);};open.onsuccess=()=>{open.result.onversionchange=()=>open.result.close();resolve(open.result);};open.onerror=()=>reject(open.error);});}
async function transaction(store,mode,work){
 const db=await database(),tx=db.transaction(store,mode),done=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('ذخیره‌سازی مرورگر کامل نشد.'));});
 try{const value=await work(Array.isArray(store)?Object.fromEntries(store.map(name=>[name,tx.objectStore(name)])):tx.objectStore(store));await done;return value;}catch(error){try{tx.abort();}catch{}await done.catch(()=>{});if(error?.name==='QuotaExceededError')throw Error('فضای ذخیره‌سازی این مرورگر پر شده است؛ فایل‌های باز را نگه دارید و از تغییرات خروجی بگیرید.');throw error;}finally{db.close();}
}
function fileMaps(record){return [record.files,record.baseFiles,...record.gitPending?[record.gitPending.files]:[]];}
function bytes(record){const unique=new Set();let size=0;for(const files of fileMaps(record))for(const file of files.values())if(!unique.has(file.data)){unique.add(file.data);size+=file.data.length;}return size;}
function validate(record){
 if(record.files.size>limits.files)throw Error('تعداد فایل‌های پروژه بیشتر از حد مجاز است.');
 let size=0;for(const [name,file] of record.files){filePath(name);size+=file.data.length;if(size>limits.expanded)throw Error('حجم پروژه بیشتر از حد مجاز است.');}
 if(record.directories.length>limits.files*2)throw Error('تعداد پوشه‌ها بیشتر از حد مجاز است.');
 const directories=new Set(record.directories);
 for(const name of [...record.files.keys(),...record.directories]){filePath(name);if(directories.has(name)&&record.files.has(name))throw Error('نام فایل و پوشه با هم تداخل دارند.');const parts=name.split('/');parts.pop();while(parts.length){if(record.files.has(parts.join('/')))throw Error('نام فایل و پوشه با هم تداخل دارند.');parts.pop();}}
 record.bytes=bytes(record);return record;
}
function equal(a,b){return !!a&&!!b&&a.mode===b.mode&&a.data.length===b.data.length&&a.data.every((byte,i)=>byte===b.data[i]);}
class WorkspaceStore{
 constructor(account,loader){if(!/^[a-f0-9]{64}$/.test(account))throw Error('حساب محیط معتبر نیست.');this.account=account;this.loader=loader;this.cache=new Map();this.pending=new Map();this.writes=new Map();this.blobKeys=new WeakMap();}
 key(project){if(!/^[a-z0-9][a-z0-9-]{0,62}$/.test(project))throw Error('نام پروژه معتبر نیست.');return [this.account,project];}
 async open(project){
  this.key(project);if(this.cache.has(project))return this.cache.get(project);if(this.pending.has(project))return this.pending.get(project);
  const promise=(async()=>{
   let record=await transaction('projects','readonly',store=>request(store.get(this.key(project))));
   if(!record){
    const snapshot=await this.loader(project),decoded=snapshot.files?{files:snapshot.files,directories:snapshot.directories||[]}:readArchive(snapshot.archive,{stripTop:snapshot.sourceType==='git'}),{files,directories}=decoded;
    const initial=validate({...snapshot,archive:undefined,files,baseFiles:new Map(files),directories,fileTimes:new Map(),createdAt:Date.now(),generation:1,updatedAt:Date.now()}),encoded=await this.encode(initial);
    record=await transaction(['projects','blobs'],'readwrite',async stores=>{const existing=await request(stores.projects.get(this.key(project)));if(existing)return existing;await this.quota(stores.projects,initial.bytes);await this.blobs(stores.blobs,null,encoded);stores.projects.add(encoded.record,this.key(project));return initial;});
   }
   record=await this.decode(record);
   this.cache.set(project,record);return record;
  })();this.pending.set(project,promise);try{return await promise;}finally{this.pending.delete(project);}
 }
 async encode(record){
  const saved={...record,storageVersion:2,files:new Map(),baseFiles:new Map(),...record.gitPending?{gitPending:{...record.gitPending,files:new Map()}}:{}},data=new Map();
  const originals=fileMaps(record),destinations=fileMaps(saved);
  for(let index=0;index<originals.length;index++){
   for(const [name,file] of originals[index]){
    let hash=this.blobKeys.get(file.data);
    if(!hash){hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',file.data)),byte=>byte.toString(16).padStart(2,'0')).join('');this.blobKeys.set(file.data,hash);}
    data.set(hash,file.data);destinations[index].set(name,{blob:hash,mode:file.mode});
   }
  }
  return {record:saved,data};
 }
 hashes(record){return new Set(record?.storageVersion===2?fileMaps(record).flatMap(files=>[...files.values()].map(file=>file.blob)):[]);}
 async blobs(store,previous,encoded){
  const old=this.hashes(previous),next=this.hashes(encoded.record);
  // Count project references, retaining originals while replacing only obsolete edited bytes.
  for(const hash of next)if(!old.has(hash)){
   const key=[this.account,hash],entry=await request(store.get(key));
   if(entry){if(!Number.isSafeInteger(entry.refs)||entry.refs<1)throw Error('بررسی صحت پیش‌نویس کامل نشد.');store.put({...entry,refs:entry.refs+1},key);}else store.add({data:encoded.data.get(hash),refs:1},key);
  }
  for(const hash of old)if(!next.has(hash)){
   const key=[this.account,hash],entry=await request(store.get(key));if(!entry||entry.refs<1)throw Error('بررسی صحت پیش‌نویس کامل نشد؛ فایل‌های قبلی حفظ شدند.');
   if(entry.refs===1)store.delete(key);else store.put({...entry,refs:entry.refs-1},key);
  }
 }
 async decode(record){
  if(record.storageVersion!==2)return record;
  const hashes=[...this.hashes(record)],data=await transaction('blobs','readonly',store=>Promise.all(hashes.map(async hash=>{const entry=await request(store.get([this.account,hash]));if(!entry||!(entry.data instanceof Uint8Array))throw Error('محتوای پیش‌نویس در دسترس نیست؛ فایل‌های ذخیره‌شده بازنویسی نشدند.');this.blobKeys.set(entry.data,hash);return [hash,entry.data];}))),buffers=new Map(data),decoded={...record};
  for(const kind of ['files','baseFiles'])decoded[kind]=new Map([...record[kind]].map(([name,file])=>[name,{data:buffers.get(file.blob),mode:file.mode}]));
  if(record.gitPending)decoded.gitPending={...record.gitPending,files:new Map([...record.gitPending.files].map(([name,file])=>[name,{data:buffers.get(file.blob),mode:file.mode}]))};
  return decoded;
 }
 async quota(store,extra,previous=0){const range=IDBKeyRange.bound([this.account],[this.account,[]]),all=await request(store.getAll(range));if(all.reduce((total,item)=>total+(item.bytes||0),0)-previous+extra>budget)throw Error('فضای پیش‌نویس‌های این حساب پر شده است؛ ابتدا از تغییرات خروجی بگیرید.');}
 async update(project,change){
  const job=(this.writes.get(project)||Promise.resolve()).catch(()=>{}).then(()=>this.commit(project,change));this.writes.set(project,job);try{return await job;}finally{if(this.writes.get(project)===job)this.writes.delete(project);}
 }
 async commit(project,change){
  const current=await this.open(project),next={...current,files:new Map(current.files),directories:[...current.directories],fileTimes:new Map(current.fileTimes||[]),generation:current.generation+1,updatedAt:Date.now()};await change(next);validate(next);
  for(const name of new Set([...current.files.keys(),...next.files.keys()]))if(!equal(current.files.get(name),next.files.get(name)))next.fileTimes.set(name,next.updatedAt);
  const encoded=await this.encode(next);
  await transaction(['projects','blobs'],'readwrite',async stores=>{const persisted=await request(stores.projects.get(this.key(project)));if(!persisted||persisted.generation!==current.generation)throw Error('این پروژه در پنجرهٔ دیگری تغییر کرده است. تغییرات باز را خروجی بگیرید و پروژه را دوباره باز کنید.');await this.quota(stores.projects,next.bytes,persisted.bytes);await this.blobs(stores.blobs,persisted,encoded);stores.projects.put(encoded.record,this.key(project));});
  this.cache.set(project,next);return next;
 }
 async read(project,name,original=false){name=filePath(name);const record=await this.open(project),file=(original?record.baseFiles:record.files).get(name);if(!file)throw Error('فایل پیدا نشد.');return file.data.slice();}
 async write(project,name,data,{create=true,overwrite=true}={}){
  name=filePath(name);if(!(data instanceof Uint8Array))throw Error('محتوای فایل معتبر نیست.');
  return this.update(project,next=>{const old=next.files.get(name);if(!old&&!create||old&&!overwrite)throw Error(old?'فایل از قبل وجود دارد.':'فایل پیدا نشد.');const file={data:data.slice(),mode:old?.mode||0o100644};next.files.set(name,equal(file,next.baseFiles.get(name))?next.baseFiles.get(name):file);});
 }
 async mkdir(project,name){name=filePath(name);return this.update(project,next=>{if(next.files.has(name))throw Error('فایلی با همین نام وجود دارد.');if(!next.directories.includes(name))next.directories.push(name);});}
 async remove(project,name,recursive=false){
  name=filePath(name);return this.update(project,next=>{const children=[...next.files.keys(),...next.directories].filter(path=>path.startsWith(name+'/'));if(children.length&&!recursive)throw Error('پوشه خالی نیست.');if(!next.files.has(name)&&!children.length&&!next.directories.includes(name))throw Error('فایل یا پوشه پیدا نشد.');for(const path of next.files.keys())if(path===name||path.startsWith(name+'/'))next.files.delete(path);next.directories=next.directories.filter(path=>path!==name&&!path.startsWith(name+'/'));});
 }
 async rename(project,from,to,overwrite=false){
  from=filePath(from);to=filePath(to);if(from===to)return this.open(project);if(to.startsWith(from+'/')||from.startsWith(to+'/'))throw Error('مسیر مقصد با پوشهٔ مبدأ تداخل دارد.');
  return this.update(project,next=>{
   const moving=[...next.files.keys()].filter(name=>name===from||name.startsWith(from+'/')),folders=next.directories.filter(name=>name===from||name.startsWith(from+'/'));
   if(!moving.length&&!folders.length)throw Error('فایل یا پوشه پیدا نشد.');
   const occupied=next.files.has(to)||[...next.files.keys(),...next.directories].some(name=>name.startsWith(to+'/')||name===to);
   if(occupied&&!overwrite)throw Error('مسیر مقصد از قبل وجود دارد.');
   if(occupied){for(const name of next.files.keys())if(name===to||name.startsWith(to+'/'))next.files.delete(name);next.directories=next.directories.filter(name=>name!==to&&!name.startsWith(to+'/'));}
   for(const name of moving){const file=next.files.get(name);next.files.delete(name);next.files.set(to+name.slice(from.length),file);}
   next.directories=next.directories.map(name=>name===from||name.startsWith(from+'/')?to+name.slice(from.length):name);
  });
 }
 async changes(project){const record=await this.open(project);return [...new Set([...record.baseFiles.keys(),...record.files.keys()])].filter(name=>!equal(record.baseFiles.get(name),record.files.get(name))).map(path=>({path,status:!record.files.has(path)?'deleted':!record.baseFiles.has(path)?'added':'modified'}));}
 async export(project){const record=await this.open(project);return writeArchive(record.files,record.directories);}
 async imported(project,archive,{allowEmpty=false}={}){
  const {files,directories}=readArchive(archive);
  if(allowEmpty&&!this.cache.has(project)){
   const initial=validate({files:new Map(),baseFiles:new Map(),directories:[],fileTimes:new Map(),createdAt:Date.now(),updatedAt:Date.now(),generation:1,sourceType:'local',baseRevision:null,root:'',rootNeedsReview:true});
   const record=await transaction('projects','readwrite',async store=>{const existing=await request(store.get(this.key(project)));if(existing)return existing;await this.quota(store,0);store.add(initial,this.key(project));return initial;});this.cache.set(project,await this.decode(record));
  }
  return this.update(project,next=>{if(next.gitPending)throw Error('ابتدا نتیجهٔ ثبت Git در انتظار را بررسی یا بازبینی ارسال‌نشده را لغو کنید.');next.files=files;next.directories=directories;});
 }
 async refresh(project){this.cache.delete(project);return this.open(project);}
 async conversation(project,work){this.key(project);return transaction('conversations','readwrite',async store=>{const key=this.key(project),old=await request(store.get(key)),next=await work(old||{sessions:[],messages:{},permissions:[],workflows:{}});if(next!==undefined)store.put(next,key);return next===undefined?old:next;});}
}
module.exports={WorkspaceStore,equal,transaction};
