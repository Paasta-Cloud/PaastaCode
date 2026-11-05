const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { managedSession } = require('./managed-session');
const { importProject } = require('./import-project');
const execute = promisify(execFile);

function hostedGit(session) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^GIT_/i.test(key) || ['NODE_OPTIONS', 'NODE_PATH'].includes(key)) delete env[key];
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: `Authorization: Bearer ${session.token}` });
  return async args => execute('git', ['-c', 'credential.helper=', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'http.followRedirects=false', '-c', 'protocol.file.allow=never', ...args], { env, timeout: 180000, maxBuffer: 1024 * 1024, windowsHide: true });
}
async function configureHostedGit(target, project) {
  const session = managedSession();
  if (!session || !project.connectionId || !/^[a-f0-9]{32}$/.test(project.repositoryKey) || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(project.name)) throw new Error('اتصال Git محیط کامل نیست؛ پروژه را از کنسول دوباره باز کنید.');
  const broker = `${session.server}/api/editor/git/${project.name}/${project.repositoryKey}.git`, git = hostedGit(session);
  await git(['-C', target, 'config', `url.${broker}.insteadOf`, project.repository]);
  await git(['-C', target, 'config', 'credential.useHttpPath', 'true']);
  const helper = path.join(__dirname, 'editor-git-credential.js').replaceAll("'", "'\\''");
  await git(['-C', target, 'config', 'credential.helper', `!node '${helper}'`]);
}

async function openProject(context, api, authorizedFetch, value, options = {}) {
  if (!vscode.workspace.isTrusted) throw new Error('پیش از دریافت سورس، پوشهٔ محیط را بازبینی و مورداعتماد کنید.');
  const root = process.env.PAASTA_EDITOR_PROJECTS_ROOT;
  const session = managedSession();
  if (!root || !session) throw new Error('این فرمان از محیط آنلاینِ متصل به کنسول در دسترس است.');
  const catalog = await api(context, '/api/cli/context');
  const projects = catalog.projects.filter(row => ['git', 'upload', 'template'].includes(row.source_type));
  const requested = typeof value === 'string' ? value : value?.project?.name;
  const selected = requested ? projects.find(row => row.name === requested) : await vscode.window.showQuickPick(projects.map(row => ({ label: row.name, ...row, description: row.source_type === 'git' ? 'مخزن Git' : 'سورس نسخهٔ فعال' })), { placeHolder: 'پروژه را باز کنید؛ پوشه‌ها و تغییرات قبلی شما حفظ می‌شوند.' });
  if (!selected) { if (requested) throw new Error('سورس این پروژه قابل دریافت نیست؛ از کنسول منبع پروژه را بررسی کنید.'); return; }
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(selected.name)) throw new Error('نام پروژه معتبر نیست.');
  await fs.mkdir(root, { recursive: true });
  const target = path.join(await fs.realpath(root), selected.name);
  const info = await fs.lstat(target).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (info?.isSymbolicLink()) throw new Error('مسیر پروژه نباید پیوند نمادین باشد.');
  const metadataFile = path.join(target, '.paasta', 'workspace.json');
  if (info && (await fs.readdir(target)).length) {
    const previous = JSON.parse(await fs.readFile(metadataFile, 'utf8').catch(() => '{}'));
    if (previous.project !== selected.name) throw new Error('این پوشه فایل دارد و بازنویسی نمی‌شود. آن را از Open Folder باز کنید یا نام پوشه را تغییر دهید.');
    if (options.open !== false) await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target)); return target;
  }
  if (options.automatic) {
    const disk = await fs.statfs(root);
    if (Number(disk.bavail) * Number(disk.bsize) < 1024 ** 3) throw new Error('فضای آزاد دیسک برای دریافت سورس کافی نیست.');
  }
  let metadata;
  if (selected.source_type === 'git') {
    const project = await api(context, `/api/editor/projects/${selected.name}`);
    if (!project.repository || !project.connectionId) throw new Error('ابتدا حساب Git دارای دسترسی به این مخزن را از کنسول متصل کنید.');
    const broker = `${session.server}/api/editor/git/${selected.name}/${project.repositoryKey}.git`;
    const git = hostedGit(session);
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'دریافت مخزن با اتصال Git پاستا…' }, async () => {
        await git(['clone', ...(options.automatic && !/^[a-f0-9]{40}$/.test(project.ref) ? ['--depth', '1'] : []), ...(/^[a-f0-9]{40}$/.test(project.ref) ? [] : ['--branch', project.ref]), '--', broker, target]);
        if (/^[a-f0-9]{40}$/.test(project.ref)) await git(['-C', target, 'checkout', '--detach', project.ref]);
        await git(['-C', target, 'remote', 'set-url', 'origin', project.repository]);
        await configureHostedGit(target, { ...project, name: selected.name });
      });
    } catch { throw new Error('دریافت مخزن کامل نشد؛ اتصال Git و دسترسی شاخه را از کنسول بررسی کنید. پوشه‌های قبلی حذف نمی‌شوند.'); }
    metadata = { project: selected.name, root: project.root, gitBinding: { project: selected.name, repository: project.repository, ref: project.ref, root: project.root, connectionId: project.connectionId } };
  } else {
    await fs.mkdir(target, { recursive: true });
    metadata = await importProject(context, api, authorizedFetch, { project: selected.name, target, automatic: options.automatic });
    if (!metadata) return;
  }
  const privateDirectory = path.dirname(metadataFile);
  const existing = await fs.lstat(privateDirectory).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (existing?.isSymbolicLink()) throw new Error('پوشهٔ تنظیمات پروژه نباید پیوند نمادین باشد.');
  await fs.mkdir(privateDirectory, { recursive: true, mode: 0o700 });
  await fs.writeFile(metadataFile, JSON.stringify(metadata), { mode: 0o600, flag: 'wx' });
  if (options.open !== false) await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target));
  return target;
}
module.exports = { openProject, configureHostedGit };
