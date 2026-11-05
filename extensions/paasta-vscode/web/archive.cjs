const {unzipSync,zipSync,strFromU8}=require('fflate');
const limits=Object.freeze({archive:100*1024**2,expanded:150*1024**2,files:15000,path:500});
const crcTable=Uint32Array.from({length:256},(_,value)=>{for(let i=0;i<8;i++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
function crc32(bytes){let value=-1;for(const byte of bytes)value=crcTable[(value^byte)&255]^(value>>>8);return (value^-1)>>>0;}
function filePath(value){
 if(typeof value!=='string'||!value||value.length>limits.path||/[\x00-\x1f\x7f\\]/.test(value)||value.startsWith('/')||/^[a-z]:/i.test(value))throw Error('مسیر فایل معتبر نیست.');
 const parts=value.replace(/\/$/,'').split('/');
 if(parts.some(part=>!part||part==='.'||part==='..'||part==='__proto__'||part.toLowerCase()==='.git'))throw Error('مسیر فایل خارج از پوشهٔ پروژه است.');
 return parts.join('/');
}
function centralDirectory(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50&&i+22+view.getUint16(i+20,true)===bytes.length){end=i;break;}
 if(end<0||view.getUint16(end+4,true)||view.getUint16(end+6,true))throw Error('ساختار ZIP پشتیبانی نمی‌شود.');
 const count=view.getUint16(end+10,true),size=view.getUint32(end+12,true);let offset=view.getUint32(end+16,true);
 if(count>limits.files*2||offset+size!==end)throw Error('فهرست فایل‌های ZIP معتبر نیست.');
 const entries=new Map();let expanded=0,files=0;
 for(let i=0;i<count;i++){
  if(offset+46>end||view.getUint32(offset,true)!==0x02014b50)throw Error('فهرست ZIP کامل نیست.');
  const flags=view.getUint16(offset+8,true),length=view.getUint16(offset+28,true),extra=view.getUint16(offset+30,true),comment=view.getUint16(offset+32,true),original=view.getUint32(offset+24,true);
  if(flags&1||offset+46+length+extra+comment>end)throw Error('فایل ZIP رمزگذاری‌شده یا ناقص است.');
  const raw=strFromU8(bytes.subarray(offset+46,offset+46+length),!(flags&2048)),name=filePath(raw);
  const directory=raw.endsWith('/');
  if(entries.has(name))throw Error('فایل تکراری در ZIP وجود دارد: '+name);
  if(!directory){
   expanded+=original;if(expanded>limits.expanded||++files>limits.files)throw Error('حجم یا تعداد فایل‌های پروژه بیشتر از حد مجاز است.');
  }else if(original)throw Error('پوشهٔ ZIP محتوای معتبر ندارد.');
   const mode=view.getUint16(offset+4,true)>>>8===3?view.getUint32(offset+38,true)>>>16:0;
   if(mode&&!(directory?[0,0o040000]:[0,0o100000,0o120000]).includes(mode&0o170000))throw Error('نوع فایل در ZIP پشتیبانی نمی‌شود.');
   entries.set(name,{raw,size:original,mode:mode||(directory?0o040755:0o100644),directory,crc:view.getUint32(offset+16,true)});
  offset+=46+length+extra+comment;
 }
 if(offset!==end)throw Error('فهرست ZIP کامل نیست.');
 return entries;
}
function readArchive(bytes,{stripTop=false}={}){
 if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>limits.archive)throw Error('حداکثر حجم بستهٔ پروژه ۱۰۰ مگابایت است.');
 const entries=centralDirectory(bytes),seen=new Set();
 const decoded=unzipSync(bytes,{filter(file){const name=filePath(file.name);if(file.name.endsWith('/'))return false;const entry=entries.get(name);if(!entry||seen.has(name)||file.originalSize!==entry.size)throw Error('اندازه یا نام فایل ZIP معتبر نیست.');seen.add(name);return true;}});
 if(seen.size!==[...entries.values()].filter(entry=>!entry.directory).length)throw Error('محتوای بستهٔ پروژه کامل نیست.');
 const prefix=stripTop&&entries.size?[...entries.keys()][0].split('/')[0]+'/':'';
 const result=new Map(),directories=[];
 for(const [name,entry] of entries){
  if(entry.directory&&prefix&&name===prefix.slice(0,-1))continue;
  if(prefix&&!name.startsWith(prefix))throw Error('ریشهٔ بستهٔ مخزن معتبر نیست.');
  const relative=filePath(prefix?name.slice(prefix.length):name),data=decoded[entry.raw];
  if(entry.directory){directories.push(relative);continue;}
  if(!data||data.length!==entry.size||crc32(data)!==entry.crc||result.has(relative))throw Error('بررسی صحت فایل ZIP کامل نشد.');
  result.set(relative,{data,mode:entry.mode});
 }
 for(const name of result.keys()){const parts=name.split('/');parts.pop();while(parts.length){if(result.has(parts.join('/')))throw Error('مسیر فایل و پوشه با هم تداخل دارند.');parts.pop();}}
 return {files:result,directories};
}
function writeArchive(files,directories=[]){
 const input=Object.create(null);let bytes=0;
 if(files.size>limits.files)throw Error('تعداد فایل‌های پروژه بیشتر از حد مجاز است.');
 for(const [name,file] of files){filePath(name);bytes+=file.data.length;if(bytes>limits.expanded)throw Error('حجم پروژه بیشتر از حد مجاز است.');input[name]=[file.data,{os:3,attrs:file.mode<<16,mtime:new Date('1980-01-01T00:00:00Z')}];}
 for(const name of directories){filePath(name);if(files.has(name))throw Error('نام فایل و پوشه با هم تداخل دارند.');input[name+'/']=[new Uint8Array(),{os:3,attrs:0o040755<<16,mtime:new Date('1980-01-01T00:00:00Z')}];}
 const zip=zipSync(input,{level:6});if(zip.length>limits.archive)throw Error('حداکثر حجم بستهٔ پروژه ۱۰۰ مگابایت است.');return zip;
}
module.exports={filePath,readArchive,writeArchive,limits};
