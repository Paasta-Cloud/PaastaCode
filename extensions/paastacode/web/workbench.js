import './task-state.js';
import {icon} from './components.js';
// Keep the reading position and expanded tool reports stable during streaming.
export function workbench(){
  const $=id=>document.getElementById(id),viewport=$("conversation"),messages=$("messages");
  let lastReview=false,following=true,started=0,lastBusy=false,latest=[],blocked=false,lastWidth=viewport.clientWidth,lastHeight=viewport.clientHeight;
  const bottom=()=>viewport.scrollHeight-viewport.scrollTop-viewport.clientHeight<80;
  viewport.addEventListener("scroll",()=>{if(!latest.length){following=true;$("follow-output").hidden=true;return;}if(lastWidth!==viewport.clientWidth||lastHeight!==viewport.clientHeight){lastWidth=viewport.clientWidth;lastHeight=viewport.clientHeight;if(following)follow();return;}following=bottom();$("follow-output").hidden=following;},{passive:true});
  const follow=()=>{following=true;$("follow-output").hidden=true;viewport.scrollTop=latest.length?viewport.scrollHeight:0;};
  $("follow-output").onclick=follow;
  $('recap-review').prepend(icon('code'));$('recap-output').prepend(icon('search'));
  $('recap-review').onclick=()=>$('git-open').click();
  $('recap-output').onclick=()=>{
    const start=latest.findLastIndex(message=>message.info?.role==='user');
    const ids=new Set(latest.flatMap((message,index)=>index>start&&message.info?.role==='assistant'?[message.info.id||String(index)]:[]));
    const articles=[...messages.children].filter(article=>ids.has(article.dataset.message));
    const target=articles.flatMap(article=>[...article.querySelectorAll('.message-error,.tool[data-status=error]')]).at(-1)||articles.flatMap(article=>[...article.querySelectorAll('.tool')]).at(-1)||articles.at(-1);
    if(!target)return;following=false;
    if(target.matches('details'))target.open=true;
    target.scrollIntoView({block:'center'});const focus=target.querySelector('summary')||target;focus.tabIndex=0;focus.focus({preventScroll:true});
  };
  function recap(busy,review){
    const summary=globalThis.PaastaTasks.recap(latest),panel=$('run-recap');
    panel.hidden=busy||!summary;
    if(panel.hidden)return;
    const signature=JSON.stringify([summary,review]);if(panel.dataset.signature===signature)return;panel.dataset.signature=signature;
    panel.dataset.outcome=summary.errors||summary.unfinished?'attention':'settled';
    $('recap-title').textContent=summary.title;
    $('recap-counts').textContent=[summary.completed.toLocaleString('fa-IR')+' ابزار انجام‌شده',summary.commands.toLocaleString('fa-IR')+' دستور',summary.files.length.toLocaleString('fa-IR')+' فایل ویرایش‌شده با ابزارها',...(summary.errors?[summary.errors.toLocaleString('fa-IR')+' خطا']:[])].join(' · ');
    $('recap-detail').textContent=summary.detail;$('recap-review').hidden=!review;
    if(following)follow();
  }
  new ResizeObserver(()=>{lastWidth=viewport.clientWidth;lastHeight=viewport.clientHeight;if(following)follow();}).observe(viewport);
  const labels={read:"خواندن فایل",glob:"جست‌وجوی فایل‌ها",grep:"جست‌وجو در کد",bash:"اجرای دستور",write:"ساخت فایل",edit:"ویرایش فایل",apply_patch:"اعمال تغییرات",task:"بررسی پروژه",webfetch:"خواندن صفحه",todowrite:"به‌روزرسانی برنامه",todoread:"بررسی برنامه"};
  function inline(parent,text){for(const token of text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g)){if(token.startsWith("`")&&token.endsWith("`")){const code=document.createElement("code");code.textContent=token.slice(1,-1);parent.append(code);}else if(token.startsWith("**")&&token.endsWith("**")){const strong=document.createElement("strong");strong.textContent=token.slice(2,-2);parent.append(strong);}else parent.append(document.createTextNode(token));}}
  function content(parent,text){for(const section of text.split(/(```[\s\S]*?```)/g)){
    if(!section.trim())continue;
    if(section.startsWith("```")){const node=document.createElement("pre");node.dir="ltr";node.textContent=section.replace(/^```[^\n]*\n?/,"").replace(/```$/,"");parent.append(node);continue;}
    for(const block of section.split(/\n{2,}/)){if(!block.trim())continue;const lines=block.trim().split("\n");
      if(lines.every(line=>/^\s*[-*] /.test(line))){const list=document.createElement("ul");for(const line of lines){const item=document.createElement("li");inline(item,line.replace(/^\s*[-*] /,""));list.append(item);}parent.append(list);}
      else {const heading=/^#{1,4} /.test(block.trim()),node=document.createElement(heading?"h3":"p");inline(node,heading?block.trim().replace(/^#{1,4} /,""):block);parent.append(node);}
    }
  }}
  function render(list){
    latest=list;const shouldFollow=following;
    const existing=new Map([...messages.children].map(el=>[el.dataset.message,el])),keep=new Set();
    $("empty").hidden=list.some(m=>m.parts.some(p=>p.type==="tool"||(p.type==="text"&&!p.synthetic&&p.text?.trim())));
    for(const [index,message] of list.entries()){
      const parts=message.parts.filter(p=>p.type==="file"||p.type==="tool"||(p.type==="text"&&!p.synthetic&&p.text?.trim())||(p.type==="reasoning"&&p.text?.trim()));
      if(!parts.length&&!message.info.error)continue;
      const id=message.info.id||String(index),serialized=JSON.stringify(message);keep.add(id);
      let article=existing.get(id);
      if(!article){article=document.createElement("article");article.dataset.message=id;messages.append(article);}
      if(article.dataset.rendered===serialized)continue;
      const expanded=new Set([...article.querySelectorAll("details[open]")].map(el=>el.dataset.tool));
      article.replaceChildren();article.dataset.rendered=serialized;article.className="message "+message.info.role;
      const header=document.createElement("header");header.textContent=message.info.role==="user"?"شما":"پاستاکد";article.append(header);
      for(const [partIndex,part] of parts.entries()){
        if(part.type==="text")content(article,part.text);
        else if(part.type==="file"){const item=document.createElement("div");item.className="message-attachment";const name=document.createElement("bdi");name.dir="auto";name.textContent=part.filename||"فایل پیوست";if(/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(part.url||"")){const image=document.createElement("img");image.src=part.url;image.alt=part.filename||"تصویر پیوست";item.append(image);}item.append(name);article.append(item);}
        else {
          const details=document.createElement("details"),summary=document.createElement("summary"),key=part.callID||part.id||String(partIndex);
          details.dataset.tool=key;details.className="tool";details.open=expanded.has(key);
          const status=part.state?.status||"completed";details.dataset.status=status;
          const icon=document.createElement("span");icon.className="tool-indicator";icon.setAttribute("aria-hidden","true");icon.textContent=status==="completed"?"✓":status==="error"?"!":"";
          const name=document.createElement("span");name.className="tool-title";name.textContent=part.type==="reasoning"?"روند بررسی":labels[part.tool]||part.tool;
          const target=document.createElement("bdi");target.className="tool-target";target.dir="ltr";const path=part.state?.input?.filePath||part.state?.input?.path;target.textContent=path?String(path).replaceAll("\\","/").split("/").slice(-3).join("/"):part.state?.input?.command||part.state?.title||"";target.title=path||target.textContent;
          const badge=document.createElement("span");badge.className="tool-status";badge.textContent={completed:"انجام شد",running:"در حال اجرا",pending:"در انتظار",error:"ناموفق"}[status]||status;
          summary.append(icon,name,target,badge);
          const pre=document.createElement("pre");pre.dir="ltr";pre.textContent=part.type==="reasoning"?part.text:String(part.state?.metadata?.diff||part.state?.output||part.state?.metadata?.output||part.state?.error||(["running","pending"].includes(status)?"هنوز خروجی‌ای دریافت نشده است.":JSON.stringify(part.state?.input||{},null,2)));
          if(status==="running"&&Number.isFinite(part.state?.time?.start))details.dataset.started=String(part.state.time.start);
          details.append(summary,pre);article.append(details);
        }
      }
      if(message.info.error){const error=document.createElement("p");error.className="message-error";error.textContent=message.info.error.data?.message||"پاسخ کامل نشد؛ درخواست را بررسی کنید.";article.append(error);}
    }
    for(const [id,element] of existing)if(!keep.has(id))element.remove();
    if(shouldFollow)follow();else $("follow-output").hidden=false;
  }
  function activity(busy,{approval=false,status,review=lastReview}={}){
    blocked=approval;if(busy&&!lastBusy)started=Date.now();lastBusy=busy;
    $("activity").hidden=!busy&&!approval;$("activity").classList.toggle("waiting",approval);$("activity").setAttribute("aria-busy",String(busy&&!approval));
    const tool=latest.flatMap(m=>m.parts).findLast(p=>p.type==="tool"&&["running","pending"].includes(p.state?.status));
    $("activity-label").textContent=approval?"در انتظار تأیید شما":status?.type==="retry"?"تلاش دوباره برای اتصال":tool?labels[tool.tool]||"اجرای ابزار":"پاستاکد روی درخواست کار می‌کند";
    $("activity-detail").textContent=approval?"درخواست دسترسی را در گفتگو بررسی کنید.":status?.type==="retry"?"پاسخ هنوز آماده نیست؛ می‌توانید اجرا را متوقف کنید.":tool?.state?.title||"خروجی جدید همین‌جا نمایش داده می‌شود.";
    $("connection-state").textContent=approval?"نیاز به تأیید":busy?"در حال کار":"آماده";
    $("thread-state").textContent=approval?"نیاز به تأیید":busy?"در حال کار":"آماده";$("thread-state").dataset.busy=String(busy||approval);
    $("stop").hidden=!busy;$("send").disabled=busy;
    lastReview=review;recap(busy||approval,review);
    if(following&&busy)follow();
  }
  setInterval(()=>{$("activity-time").textContent=lastBusy&&!blocked?Math.floor((Date.now()-started)/1000).toLocaleString("fa-IR")+" ثانیه":"";for(const tool of messages.querySelectorAll('.tool[data-started]')){const seconds=Math.max(0,Math.floor((Date.now()-Number(tool.dataset.started))/1000));tool.querySelector('.tool-status').textContent="در حال اجرا · "+seconds.toLocaleString("fa-IR")+" ثانیه";}},1000);
  return {render,activity,follow,reset(){lastReview=false;latest=[];lastBusy=false;started=0;messages.replaceChildren();activity(false);follow();}};
}
