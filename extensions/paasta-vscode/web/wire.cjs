const maximum=32*1024**2;
// VS Code commands JSON-serialize ordinary Uint8Array values between extension hosts.
function encode(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length>maximum)throw Error('این فایل برای ویرایش مستقیم بزرگ است؛ ZIP پروژه را دریافت کنید.');
 let text='';for(let offset=0;offset<bytes.length;offset+=8192)text+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
 return {bytesBase64:btoa(text)};
}
function decode(value){
 const encoded=value?.bytesBase64;
 if(typeof encoded!=='string'||encoded.length>4*Math.ceil(maximum/3)||encoded.length%4!==0||/[^A-Za-z0-9+/=]/.test(encoded))throw Error('محتوای فایل معتبر نیست.');
 const padding=encoded.indexOf('=');if(padding!==-1&&(padding<encoded.length-2||!/^={1,2}$/.test(encoded.slice(padding))))throw Error('محتوای فایل معتبر نیست.');
 const text=atob(encoded);if(text.length>maximum)throw Error('فایل بزرگ‌تر از حد مجاز است.');
 return Uint8Array.from(text,character=>character.charCodeAt(0));
}
module.exports={encode,decode,maximum};
