export const untitledSession=title=>!title||/^(?:گفت[‌ ]?و?گوی جدید|New session(?: - .*)?|New chat)$/i.test(title.trim());
export function promptTitle(text){
  const clean=String(text||"").replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g," ").replace(/\s+/g," ").trim();
  const chars=Array.from(clean);return chars.length>72?chars.slice(0,71).join("")+"…":clean;
}
export function firstRequestTitle(messages){
  for(const message of messages||[])if(message.info?.role==="user"){
    const text=(message.parts||[]).filter(part=>part.type==="text"&&!part.synthetic).map(part=>part.text||"").join(" ");
    if(text.trim())return promptTitle(text);
  }
  return "";
}
