// Shared safe DOM rendering for the web client and VS Code's nonce-protected view.
globalThis.PaastaReview={
  fileDiff(container,result){
    container.replaceChildren();container.className='diff-collection';
    const scopes=[['تغییرات ثبت‌نشده',result.worktree],['آمادهٔ کامیت',result.staged],['فایل تازه',result.untracked]].filter(([,text])=>text);
    for(const [title,text] of scopes.length?scopes:[['پیش‌نمایش',result.text]]){
      const section=document.createElement('section'),heading=document.createElement('h3'),code=document.createElement('pre');heading.dir='rtl';heading.textContent=title;globalThis.PaastaReview.diff(code,text||'تفاوت متنی ثبت نشده است.');section.append(heading,code);container.append(section);
    }
  },
  checks(container,checks=[]){
    const signature=JSON.stringify(checks);if(container.dataset.signature===signature)return;
    const expanded=new Set(Array.from(container.querySelectorAll('details[open]')).map(row=>row.dataset.key)),focused=document.activeElement?.closest('details')?.dataset.key,scroll=container.scrollTop;
    container.replaceChildren();container.dataset.signature=signature;container.className='verification-list';
    const title=document.createElement('h3');title.textContent='بررسی‌ها و تست‌ها';container.append(title);
    if(!checks.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='هنوز نتیجهٔ قابل تأییدی برای تست، lint یا build ثبت نشده است.';container.append(empty);return;}
    const labels={passed:'موفق',failed:'ناموفق',running:'در حال اجرا',unknown:'نتیجه نامشخص'},symbols={passed:'✓',failed:'×',running:'◷',unknown:'?'};
    for(const [index,check] of checks.entries()){
      const row=document.createElement('details');row.dataset.outcome=check.status;row.dataset.key=index+':'+check.command;row.open=expanded.has(row.dataset.key);
      const summary=document.createElement('summary'),status=document.createElement('span'),command=document.createElement('bdi');
      status.className='verification-status';status.textContent=symbols[check.status]+' '+labels[check.status];command.dir='ltr';command.textContent=check.command;summary.append(status,command);
      const description=document.createElement('p');description.textContent=check.exit===null?'کد خروج ثبت نشده است؛ خروجی را بررسی کنید.':'کد خروج: '+check.exit.toLocaleString('fa-IR');
      const output=document.createElement('pre');output.dir='ltr';output.textContent=check.output||'خروجی متنی ثبت نشده است.';row.append(summary,description,output);container.append(row);if(focused===row.dataset.key)summary.focus({preventScroll:true});
    }
    container.scrollTop=scroll;
  },
  diff(container,text){
    container.replaceChildren();container.className='diff-code';container.dir='ltr';
    let before=0,after=0,inHunk=false;
    for(const line of text.split('\n')){
      if(/^(?:# |diff |index |---|\+\+\+)/.test(line))inHunk=false;
      const hunk=/^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);if(hunk){inHunk=true;before=Number(hunk[1]);after=Number(hunk[2]);}
      const kind=line.startsWith('+')&&!line.startsWith('+++')?'added':line.startsWith('-')&&!line.startsWith('---')?'removed':'context';
      const row=document.createElement('span');row.className='diff-line diff-'+kind;
      const oldNumber=document.createElement('span'),newNumber=document.createElement('span'),code=document.createElement('span');
      oldNumber.className=newNumber.className='diff-number';oldNumber.setAttribute('aria-hidden','true');newNumber.setAttribute('aria-hidden','true');
      if(!hunk&&inHunk&&(kind!=='context'||line.startsWith(' '))){if(kind!=='added')oldNumber.textContent=String(before++);if(kind!=='removed')newNumber.textContent=String(after++);}
      code.textContent=line||' ';row.append(oldNumber,newNumber,code);container.append(row);
    }
  }
};
