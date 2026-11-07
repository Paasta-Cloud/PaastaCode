const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const file = path.resolve(__dirname, '../extension.js');
const realRequire = createRequire(file);
let globalServer, issuer, calls = 0, execution, login;
const values = {};
const vscode = {
  TreeItem: class {}, TreeItemCollapsibleState: {},
  ProgressLocation: {}, TaskScope: {}, TaskRevealKind: {}, TaskPanelKind: {},
  Task: class { constructor(...args) { this.execution = args[4]; } },
  ProcessExecution: class { constructor(command, args) { this.command = command; this.args = args; } },
  tasks: { executeTask: async task => { execution = task.execution; } },
  window: { withProgress: async (_options, fn) => fn(), showWarningMessage: async () => 'ادامه از گیت' },
  workspace: { isTrusted: true, workspaceFolders: [{ uri: { fsPath: '/project' } }],
    getConfiguration: () => ({ inspect: key => ({ globalValue: key === 'server' ? globalServer : '/trusted/paasta', workspaceValue: 'https://malicious.invalid' }) }) },
};
const context = { secrets: { get: async key => key === 'paasta.apiTokenServer' ? issuer : 'synthetic-key' }, workspaceState: { get: key => values[key] } };
const loaded = { exports: {} };
new Function('require', 'module', 'exports', 'fetch', fs.readFileSync(file, 'utf8') + '\nObject.assign(module.exports, {server, api, runCli, collectWorkspaceFiles});')(
  name => name === 'vscode' ? vscode : ['./hosted-startup', 'position-unused', './publish-git', './import-project', './open-project'].includes(name) ? {} : name === 'node:child_process' ? { execFile: (_command, args, options, callback) => { login = { args, options }; callback(null, '', ''); } } : realRequire(name),
  loaded, loaded.exports, async (url, options) => { calls++; assert.equal(url, 'https://paasta.cloud/test'); assert.equal(options.headers.Authorization, 'Bearer synthetic-key'); assert.equal(options.redirect, 'error'); return Response.json({ ok: true }); });
(async () => {
  assert.equal(loaded.exports.server(), 'https://paasta.cloud', 'workspace server override ignored');
  await loaded.exports.api(context, '/test'); assert.equal(calls, 1);
  globalServer = 'https://other.invalid'; await assert.rejects(loaded.exports.api(context, '/test'), /ورود/); assert.equal(calls, 1);
  globalServer = 'https://paasta.cloud'; issuer = 'https://other.invalid'; await assert.rejects(loaded.exports.api(context, '/test'), /ورود/);
  issuer = 'https://paasta.cloud'; vscode.workspace.isTrusted = false; await assert.rejects(loaded.exports.runCli(context, 'deploy'), /مورداعتماد/); assert.equal(login, undefined);
  vscode.workspace.isTrusted = true; values['paasta.importedSource'] = { project: 'existing-project' };
  await loaded.exports.runCli(context, 'deploy'); assert.equal(execution.command, '/trusted/paasta'); assert.deepEqual(execution.args, ['deploy', '/project', '--name', 'existing-project']);
  assert.deepEqual(login.args, ['login', '--api-key', '--server', 'https://paasta.cloud']);
  values['paasta.gitBinding'] = { project: 'existing-project', repository: 'https://github.com/test/repo.git', connectionId: 'fixture', root: 'apps/api' };
  await loaded.exports.runCli(context, 'deploy'); assert.deepEqual(execution.args, ['deploy', '--name', 'existing-project', '--git', 'https://github.com/test/repo.git', '--connection', 'fixture', '--ref', 'main', '--root', 'apps/api']);
  globalServer = 'http://remote.invalid'; assert.throws(loaded.exports.server, /HTTPS/);
  const previousFile = process.env.PAASTA_EDITOR_SESSION_FILE, previousRoot = process.env.PAASTA_EDITOR_PROJECTS_ROOT;
  process.env.PAASTA_EDITOR_SESSION_FILE = '/synthetic/session.json'; process.env.PAASTA_EDITOR_PROJECTS_ROOT = '/project';
  try {
    const before = calls;
    await assert.rejects(loaded.exports.runCli(context, 'deploy'), /پوشهٔ همهٔ پروژه‌ها/);
    await assert.rejects(loaded.exports.collectWorkspaceFiles(), /فقط سورس همان پروژه/);
    assert.equal(calls, before, 'The personal projects root must never be submitted to AI or deployment');
  } finally {
    if (previousFile === undefined) delete process.env.PAASTA_EDITOR_SESSION_FILE; else process.env.PAASTA_EDITOR_SESSION_FILE = previousFile;
    if (previousRoot === undefined) delete process.env.PAASTA_EDITOR_PROJECTS_ROOT; else process.env.PAASTA_EDITOR_PROJECTS_ROOT = previousRoot;
  }
  console.log('Credential issuer, workspace trust, managed project selection and deployment target tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
