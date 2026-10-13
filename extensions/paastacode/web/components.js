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
// Decorative UI symbols share one grid; the adjacent Persian text is the accessible label.
export function icon(name){
  const paths={folder:"M3 7h7l2 2h9v11H3z M3 7V4h6l2 3",cloud:"M7 18h11a4 4 0 0 0 0-8 6 6 0 0 0-11-2 5 5 0 0 0 0 10",deploy:"M12 16V3m-5 5 5-5 5 5M4 14v6h16v-6",import:"M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5",devices:"M3 4h14v12H3zM7 20h6m-3-4v4M19 9h3v12h-6v-3",update:"M20 7a8 8 0 1 0 0 10M20 3v5h-5",sun:"M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",moon:"M20 15a8 8 0 0 1-11-11 8 8 0 1 0 11 11",save:"M4 3h13l3 3v15H4zM8 3v6h8V3M8 21v-8h8v8",search:"M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6",chat:"M3 4h18v13H8l-5 4z",code:"m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"};
  const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("class","ui-icon");svg.setAttribute("aria-hidden","true");svg.setAttribute("fill","none");svg.setAttribute("stroke","currentColor");svg.setAttribute("stroke-width","1.6");svg.setAttribute("stroke-linecap","round");svg.setAttribute("stroke-linejoin","round");
  const path=document.createElementNS(svg.namespaceURI,"path");path.setAttribute("d",paths[name]||paths.code);svg.append(path);return svg;
}
