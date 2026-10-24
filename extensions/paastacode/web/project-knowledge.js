globalThis.PaastaKnowledgeUI=({api,button,exportText})=>{
  const dialog=document.createElement('dialog');dialog.className='knowledge-dialog';dialog.setAttribute('aria-label','دانش پروژه');
  const heading=document.createElement('div');heading.className='dialog-heading';
  const title=document.createElement('h2');title.textContent='دانش پروژه';
  const close=document.createElement('button');close.type='button';close.textContent='بستن';heading.append(title,close);
  const intro=document.createElement('p');intro.className='muted';intro.textContent='تصمیم‌های پروژه و دستورهای تست را بنویسید؛ در درخواست‌های بعدی همین پروژه به مدل داده می‌شوند. رمز یا کلید دسترسی ننویسید.';
  const scope=document.createElement('p');scope.className='knowledge-scope';scope.textContent='خصوصی برای این حساب و پروژه · خارج از Git · حداکثر ۱۶ کیلوبایت';
  const form=document.createElement('form'),label=document.createElement('label'),editor=document.createElement('textarea');
  editor.id='knowledge-content';editor.dir='auto';editor.rows=14;editor.maxLength=16384;editor.placeholder='## ساختار پروژه\n\n## تصمیم‌ها و محدودیت‌ها\n\n## دستورهای تست';label.htmlFor=editor.id;label.textContent='یادداشت‌های پروژه';
  const status=document.createElement('p');status.role='status';status.id='knowledge-status';
  const remote=document.createElement('details'),remoteTitle=document.createElement('summary'),remoteText=document.createElement('pre');remote.hidden=true;remoteTitle.textContent='نسخهٔ ذخیره‌شدهٔ تازه';remoteText.dir='auto';remote.append(remoteTitle,remoteText);
  const actions=document.createElement('div');actions.className='knowledge-actions';
  const save=document.createElement('button'),reload=document.createElement('button'),download=document.createElement('button');
  save.type='submit';save.textContent='ذخیرهٔ دانش پروژه';save.className='primary';reload.type=download.type='button';reload.textContent='دریافت نسخهٔ تازه';download.textContent='خروجی Markdown';actions.append(save,reload,download);
  form.append(label,editor,remote,status,actions);dialog.append(heading,intro,scope,form);document.body.append(dialog);
  let snapshot=null,epoch=0,busy=false;
  const message=(text,error=false)=>{status.textContent=text;status.classList.toggle('message-error',error);};
  const lock=value=>{busy=value;for(const node of [save,reload,download])node.disabled=value||!snapshot;};
  async function load(){const generation=epoch,original=editor.value,wasDirty=snapshot&&editor.value!==snapshot.content;lock(true);message('در حال دریافت دانش پروژه…');try{const value=await api('knowledge');if(generation!==epoch)return;snapshot=value;if(wasDirty||editor.value!==original){remoteText.textContent=value.content;remote.hidden=false;message('نسخهٔ تازه دریافت شد؛ متن شما حفظ شده است. تغییرات را ادغام کنید و سپس ذخیره کنید.');}else{editor.value=value.content;remote.hidden=true;message(value.content?'دانش ذخیره‌شده آماده است.':'هنوز یادداشتی ندارید؛ نکته‌های قابل استفاده در کارهای بعدی را بنویسید.');}}catch(error){if(generation===epoch)message(error.message,true);}finally{if(generation===epoch)lock(false);}}
  button.onclick=()=>{dialog.showModal();void load();};
  close.onclick=()=>dialog.close();reload.onclick=()=>void load();
  form.onsubmit=async event=>{event.preventDefault();if(busy||!snapshot)return;const generation=epoch;lock(true);message('در حال ذخیره…');try{const value=await api('knowledge','POST',{content:editor.value,revision:snapshot.revision});if(generation!==epoch)return;snapshot=value;remote.hidden=true;message(editor.value===value.content?'ذخیره شد؛ از درخواست بعدی استفاده می‌شود. اجرای فعلی ادامه دارد.':'نسخهٔ ارسال‌شده ذخیره شد؛ ویرایش تازهٔ متن هنوز ذخیره نشده است.');}catch(error){if(generation===epoch)message(error.message,true);}finally{if(generation===epoch)lock(false);}};
  download.onclick=async()=>{try{if(exportText)await exportText(editor.value);else{const url=URL.createObjectURL(new Blob([editor.value],{type:'text/markdown;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='PROJECT-KNOWLEDGE.md';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}catch(error){message(error.message,true);}};
  return {clear(){epoch++;snapshot=null;editor.value='';remoteText.textContent='';remote.hidden=true;dialog.close();message('');lock(false);}};
};
