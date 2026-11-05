const fs = require('node:fs');
const path = require('node:path');
const { hosted, localProject } = require('./managed-session');

let previous;
function rememberEditor(editor) {
  if (editor) previous = editor.document.uri;
}
function projectFolder(vscode) {
  const uri = vscode.window.activeTextEditor?.document.uri || previous;
  if (!hosted()) return (uri && vscode.workspace.getWorkspaceFolder?.(uri)) || vscode.workspace.workspaceFolders?.[0];
  const root = process.env.PAASTA_EDITOR_PROJECTS_ROOT;
  if (!root) return undefined;
  const candidate = uri && ['file', 'vscode-remote'].includes(uri.scheme) ? uri.fsPath : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!candidate) return undefined;
  try {
    const realRoot = fs.realpathSync(root), real = fs.realpathSync(candidate);
    const relative = path.relative(realRoot, real);
    if (!relative || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) return undefined;
    const name = relative.split(path.sep)[0], folder = path.join(realRoot, name);
    if (fs.lstatSync(folder).isSymbolicLink() || localProject(folder)?.project !== name) return undefined;
    return { name, index: 0, uri: vscode.Uri.file(folder) };
  } catch { return undefined; }
}
function containsDocument(folder, document) {
  if (!folder || !['file', 'vscode-remote'].includes(document.uri.scheme)) return false;
  const relative = path.relative(folder.uri.fsPath, document.uri.fsPath);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
module.exports = { projectFolder, rememberEditor, containsDocument };
