const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const sourceFile = path.resolve(__dirname, '../extension.js');
const realRequire = createRequire(sourceFile);
const source = fs.readFileSync(sourceFile, 'utf8');
let applied, dirty, text, created, confirm;
const uri = fsPath => ({ scheme: 'file', fsPath, toString: () => fsPath });
const vscode = {
  TreeItem: class {}, TreeItemCollapsibleState: { None: 0 }, Position: class {}, Range: class {},
  WorkspaceEdit: class { createFile() {} insert() {} replace() {} },
  Uri: { joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)), file: uri },
  commands: { executeCommand: async () => {} },
  window: {
    showQuickPick: async items => items,
    showWarningMessage: async () => confirm,
    showTextDocument: async () => {}, showInformationMessage: () => {},
  },
  workspace: {
    textDocuments: [],
    getConfiguration: () => ({ get: (_key, fallback) => fallback }),
    fs: { createDirectory: async () => {}, writeFile: async () => {}, stat: async () => { if (!created) throw Object.assign(new Error('missing'), { code: 'FileNotFound' }); return {}; } },
    openTextDocument: async () => ({ isDirty: dirty, getText: () => text, positionAt: value => value }),
    applyEdit: async () => { applied++; return true; }, saveAll: async () => true,
  },
};
const loaded = { exports: {} };
new Function('require', 'module', 'exports', 'fetch', source + '\nmodule.exports.reviewAndApply = reviewAndApply; module.exports.collectWorkspaceFiles = collectWorkspaceFiles;')(name => name === 'vscode' ? vscode : name === './hosted-startup' ? {} : name === './publish-git' ? { publishGit() {} } : name === './open-project' ? { openProject() {} } : name === './import-project' ? { importProject() {} } : realRequire(name), loaded, loaded.exports, async () => Response.json({}));
const context = { globalStorageUri: uri('/preview'), secrets: { get: async key => key === 'paasta.apiToken' ? 'fixture' : undefined } };
const folder = { uri: uri('/project') };
function reset() { applied = 0; dirty = false; text = 'before'; created = false; confirm = 'اعمال فایل‌های انتخاب‌شده'; }
async function run(before = { 'app.js': 'before' }) { return loaded.exports.reviewAndApply(context, { id: 'fixture' }, 'request', folder, before, { 'app.js': 'after' }); }
(async () => {
  reset(); text = 'user-edited'; await assert.rejects(run(), /تغییر کرده/); assert.equal(applied, 0);
  reset(); dirty = true; await assert.rejects(run(), /تغییر کرده/); assert.equal(applied, 0);
  reset(); created = true; await assert.rejects(run({}), /قبلاً ساخته/); assert.equal(applied, 0);
  reset(); confirm = undefined; await run(); assert.equal(applied, 0);
  reset(); await run(); assert.equal(applied, 1);
  vscode.RelativePattern = class {};
  vscode.workspace.workspaceFolders = [folder]; vscode.workspace.isTrusted = true;
  vscode.workspace.getWorkspaceFolder = () => folder;
  vscode.workspace.asRelativePath = value => value.fsPath.replace('/project/', '');
  const candidates = Array.from({ length: 300 }, (_, index) => uri(`/project/file-${index}.js`));
  candidates.push(uri('/project/z-open.js'), uri('/project/z-request.js'), uri('/project/package.json'), uri('/project/.env'));
  vscode.workspace.findFiles = async (_pattern, _ignore, limit) => { assert.equal(limit, 2000); return [...candidates]; };
  vscode.workspace.fs.readFile = async () => Buffer.from('\uFEFFfixture');
  vscode.window.activeTextEditor = { document: { uri: uri('/project/z-open.js') } };
  const collected = await loaded.exports.collectWorkspaceFiles('change z-request.js');
  assert('z-open.js' in collected.files); assert('z-request.js' in collected.files); assert('package.json' in collected.files);
  assert(!('.env' in collected.files)); assert(Object.keys(collected.files).length <= 80); assert.equal(collected.files['z-open.js'], 'fixture');
  vscode.workspace.textDocuments = [{ isDirty: true, uri: uri('/project/z-open.js') }];
  await assert.rejects(loaded.exports.collectWorkspaceFiles(), /ذخیره/);
  console.log('AI file review: human edits, unsaved buffers, newly-created files and cancellation preserve source.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
