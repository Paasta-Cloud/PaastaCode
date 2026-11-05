import {readFile} from 'node:fs/promises';
export const editorSessionFile=process.env.PAASTA_EDITOR_SESSION_FILE;
export async function editorSession(){
  if(!editorSessionFile)return null;
  try{
    const value=JSON.parse(await readFile(editorSessionFile,'utf8'));
    if(!/^paasta_[A-Za-z0-9_-]{43}$/.test(value.token)||value.workspaceId!==process.env.PAASTA_EDITOR_WORKSPACE_ID
      ||!['https://console.paasta.cloud','https://paasta.cloud'].includes(value.server)
      ||!Number.isFinite(Date.parse(value.expiresAt))||Date.parse(value.expiresAt)<=Date.now())return null;
    return {origin:value.server,token:value.token};
  }catch{return null;}
}
