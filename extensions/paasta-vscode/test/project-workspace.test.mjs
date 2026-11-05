import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { projectFolder, rememberEditor } = require('../project-workspace');
const before = { ...process.env }, scratch = await mkdtemp(path.join(process.env.PAASTA_TEST_TMP || tmpdir(), 'paasta-project-context-'));
const uri = fsPath => ({ scheme: 'file', fsPath, toString: () => fsPath });
try {
  const root = path.join(scratch, 'projects');
  for (const name of ['github-project', 'gitlab-project', 'upload-project']) {
    const folder = path.join(root, name);
    await mkdir(path.join(folder, '.paasta'), { recursive: true });
    await mkdir(path.join(folder, 'src'));
    await writeFile(path.join(folder, 'src', 'app.js'), 'preserve source');
    await writeFile(path.join(folder, '.paasta', 'workspace.json'), JSON.stringify({ project: name }));
  }
  process.env.PAASTA_EDITOR_SESSION_FILE = path.join(scratch, 'session');
  process.env.PAASTA_EDITOR_PROJECTS_ROOT = root;
  const vscode = { Uri: { file: uri }, window: {}, workspace: { workspaceFolders: [{ name: 'projects', uri: uri(root) }] } };
  assert.equal(projectFolder(vscode), undefined, 'All-projects root must never be an agent workspace');
  for (const name of ['github-project', 'gitlab-project', 'upload-project']) {
    const editor = { document: { uri: uri(path.join(root, name, 'src', 'app.js')) } };
    vscode.window.activeTextEditor = editor;
    rememberEditor(editor);
    assert.equal(projectFolder(vscode).name, name);
    editor.document.uri.scheme='vscode-remote';assert.equal(projectFolder(vscode).name,name,'Remote VS Code file URIs resolve to the same project');
    vscode.window.activeTextEditor = undefined;
    assert.equal(projectFolder(vscode).name, name, 'Webview focus preserves the selected project');
  }
  const outside = path.join(scratch, 'outside'); await mkdir(outside); await writeFile(path.join(outside, 'private.txt'), 'private');
  vscode.window.activeTextEditor = { document: { uri: uri(path.join(outside, 'private.txt')) } };
  assert.equal(projectFolder(vscode), undefined, 'An outside file must not silently use the last project');
  if (process.platform !== 'win32') {
    await symlink(outside, path.join(root, 'linked'));
    vscode.window.activeTextEditor.document.uri = uri(path.join(root, 'linked', 'private.txt'));
    assert.equal(projectFolder(vscode), undefined, 'Symlink escape rejected');
  }
  delete process.env.PAASTA_EDITOR_SESSION_FILE;
  vscode.workspace.getWorkspaceFolder = () => ({ name: 'desktop', uri: uri(outside) });
  assert.equal(projectFolder(vscode).name, 'desktop', 'Desktop retains native workspace selection');
  console.log('Project context: active nested files, webview focus, GitHub/GitLab/upload switching, root/outside/symlink rejection and desktop compatibility passed.');
} finally {
  for (const key of ['PAASTA_EDITOR_SESSION_FILE', 'PAASTA_EDITOR_PROJECTS_ROOT']) if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key];
  await rm(scratch, { recursive: true, force: true });
}
