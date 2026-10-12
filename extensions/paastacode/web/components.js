// Native adaptation of VibeFarsi's PromptInput and FarsiUI's RTL dialog patterns.
// Sources and MIT notices: ../THIRD_PARTY_NOTICES.md and ../licenses/.
export function promptInput(textarea){
  const resize=()=>{textarea.style.height="auto";textarea.style.height=Math.min(textarea.scrollHeight,260)+"px";};
  textarea.addEventListener("input",resize);
  resize();return resize;
}
export function labelDialog(dialog){
  // Escape must never reuse consent from a previous submission of this dialog.
  dialog.addEventListener("cancel",()=>{dialog.returnValue="cancel";});
  const title=dialog.querySelector("h2"),description=dialog.querySelector("p");
  if(title){title.id=dialog.id+"-title";dialog.setAttribute("aria-labelledby",title.id);}
  if(description){description.id=dialog.id+"-description";dialog.setAttribute("aria-describedby",description.id);}
  dialog.addEventListener("click",event=>{
    if(event.target!==dialog)return;
    const r=dialog.getBoundingClientRect();
    if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close("cancel");
  });
}
