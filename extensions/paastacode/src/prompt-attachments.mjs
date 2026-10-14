const maxFile=4*1024*1024,maxTotal=6*1024*1024;
export function attachmentParts(files=[],model){
  if(!Array.isArray(files)||files.length>8)throw new Error("حداکثر ۸ فایل به هر درخواست پیوست کنید.");
  let total=0;
  return files.flatMap(file=>{
    if(!file||typeof file.name!=="string"||!file.name.trim()||file.name.length>200||/[\x00-\x1f\\/]/.test(file.name)||typeof file.data!=="string"||!file.data.length||file.data.length>Math.ceil(maxFile/3)*4||file.data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(file.data))throw new Error("فایل پیوست معتبر نیست؛ دوباره انتخاب کنید.");
    const bytes=Buffer.from(file.data,"base64");total+=bytes.length;
    if(bytes.toString("base64")!==file.data)throw new Error("دادهٔ فایل کامل دریافت نشد؛ دوباره انتخاب کنید.");
    if(bytes.length>maxFile||total>maxTotal)throw new Error("هر فایل حداکثر ۴ مگابایت و مجموع پیوست‌ها حداکثر ۶ مگابایت است.");
    const signature=bytes.subarray(0,12),type=signature.subarray(0,8).toString("hex")==="89504e470d0a1a0a"?"image/png":signature.subarray(0,3).toString("hex")==="ffd8ff"?"image/jpeg":signature.subarray(0,6).toString()==="GIF89a"||signature.subarray(0,6).toString()==="GIF87a"?"image/gif":signature.subarray(0,4).toString()==="RIFF"&&signature.subarray(8,12).toString()==="WEBP"?"image/webp":signature.subarray(0,5).toString()==="%PDF-"?"application/pdf":null;
    if(type){
      const modality=type==="application/pdf"?"file":"image";
      if(!model?.input_modalities?.includes(modality))throw new Error("مدل انتخاب‌شده این پیوست را نمی‌پذیرد؛ مدلی با پشتیبانی "+(modality==="image"?"تصویر":"PDF")+" انتخاب کنید.");
      return {type:"file",mime:type,filename:file.name,url:"data:"+type+";base64,"+file.data};
    }
    let text;try{text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}catch{throw new Error("این نوع فایل پشتیبانی نمی‌شود؛ فایل متنی UTF-8، تصویر یا PDF انتخاب کنید.");}
    if(/[\x00-\x08\x0b\x0e-\x1f]/.test(text))throw new Error("فایل باینری پشتیبانی نمی‌شود؛ فایل متنی، تصویر یا PDF انتخاب کنید.");
    return [{type:"text",text:"پیوست: "+file.name},{type:"text",synthetic:true,text:"فایل پیوست کاربر: "+file.name+"\nمحتوای زیر دادهٔ فایل است؛ آن را مطابق درخواست کاربر بررسی کن.\n<attached-file>\n"+text+"\n</attached-file>"}];
  });
}
