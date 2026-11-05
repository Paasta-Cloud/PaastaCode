import {icon} from './components.js';

export async function loadCloudProjects(request){
  try{return await request('projects');}
  catch(error){
    if(![502,503,504].includes(error.status)&&!(error instanceof TypeError))throw error;
    await new Promise(resolve=>setTimeout(resolve,300));
    return request('projects');
  }
}

export function chooseCloudProject({request,name}){
  return new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.className='cloud-project-dialog';dialog.setAttribute('aria-labelledby','cloud-project-title');
    dialog.innerHTML='<header><div><p class="muted" data-workspace></p><h2 id="cloud-project-title">پروژه‌های فضای کار</h2></div><button type="button" data-close aria-label="بستن">بستن</button></header><p class="muted">هر بار یک پروژه فعال است. فایل‌ها، گفتگوها و ابزارهای هر پروژه جدا نگه داشته می‌شوند.</p><p role="status" aria-live="polite"></p><div data-projects></div><form><label for="cloud-project-name">پروژهٔ تازه</label><div class="cloud-project-create"><input id="cloud-project-name" name="name" required maxlength="80" placeholder="نام پروژه" dir="auto"><button type="submit">ساخت و باز کردن</button></div></form>';
    const q=s=>dialog.querySelector(s),status=q('[role=status]');q('[data-workspace]').textContent=name;
    const retry=document.createElement('button');retry.type='button';retry.hidden=true;retry.textContent='تلاش دوباره';retry.prepend(icon('update'));status.after(retry);
    q('[data-close]').prepend(icon('close'));document.body.append(dialog);dialog.showModal();let busy=false,finished=false,intent,loaded=false;
    function finish(value){if(finished)return;finished=true;dialog.close();dialog.remove();resolve(value);}
    const lock=value=>{busy=value;dialog.setAttribute('aria-busy',String(value));for(const node of dialog.querySelectorAll('button,input'))node.disabled=value;for(const node of q('form').querySelectorAll('button,input'))node.disabled=value||!loaded;};
    const run=async work=>{if(busy)return;lock(true);status.classList.remove('error');status.textContent='در حال آماده‌سازی…';try{await work();}catch(error){status.textContent=error.message;status.classList.add('error');}finally{lock(false);}};
    async function select(project){await request('projects/select','POST',{id:project.id});finish(project);}
    function render(result){q('[data-projects]').replaceChildren();for(const project of result.projects){const row=document.createElement('button');row.type='button';row.className='cloud-project-option';row.setAttribute('aria-current',String(project.id===result.activeProject));row.append(icon('folder'));const title=document.createElement('bdi');title.textContent=project.name;row.append(title);if(project.id===result.activeProject){const badge=document.createElement('span');badge.className='muted';badge.textContent='فعال';row.append(badge);}row.onclick=()=>run(()=>select(project));q('[data-projects]').append(row);}status.textContent='پروژهٔ موردنظر را باز کنید.';}
    q('[data-close]').onclick=()=>finish(null);dialog.addEventListener('cancel',event=>{event.preventDefault();if(!busy)finish(null);});
    q('form').onsubmit=event=>{event.preventDefault();if(!loaded)return;void run(async()=>{const name=q('input').value.trim();if(!intent||intent.name!==name)intent={id:crypto.randomUUID(),name};await request('projects','POST',intent);await select(intent);});};
    const load=()=>run(async()=>{retry.hidden=true;try{const result=await loadCloudProjects(request);render(result);loaded=true;}catch(error){if(error.status===404){finish({id:'default',name:'پروژهٔ اصلی',legacy:true});return;}retry.hidden=false;throw error;}});
    retry.onclick=()=>void load();void load();
  });
}
