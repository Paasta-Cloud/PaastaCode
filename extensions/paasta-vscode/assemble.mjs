import {cp,copyFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

export async function assemble(destination) {
  const source=fileURLToPath(new URL('.',import.meta.url));
  const native=resolve(source,'../paastacode/vscode');
  await mkdir(destination,{recursive:true});
  await cp(source,destination,{recursive:true,filter:file=>!/(?:^|[\\/])(?:test|node_modules|\.git|__pycache__)(?:[\\/]|$)/.test(file)&&!file.endsWith('.vsix')});
  await copyFile(join(native,'extension.cjs'),join(destination,'paastacode.cjs'));
  await copyFile(join(native,'native-workbench.cjs'),join(destination,'native-workbench.cjs'));
  await cp(join(native,'media'),join(destination,'media'),{recursive:true,filter:file=>!file.endsWith('paasta-mark.svg')});
  await copyFile(resolve(native,'../LICENSE'),join(destination,'PAASTACODE_LICENSE'));
  await mkdir(join(destination,'online-runtime'),{recursive:true});
  await copyFile(resolve(source,'../../deploy/code-workspace/editor-gateway.cjs'),join(destination,'online-runtime/editor-gateway.cjs'));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await assemble(resolve(process.argv[2]));
