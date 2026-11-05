const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const run = promisify(execFile);
const MAX_BYTES = 50 * 1024 * 1024;
const excluded = /(^|\/)(?:\.git|\.ssh|\.aws|\.kube|\.docker|\.paasta|\.config|\.local|\.cache|\.vscode-server|\.netrc|\.git-credentials|\.bash_history|\.zsh_history|node_modules|vendor|\.venv|\.next|dist|build|coverage|\.env(?:\..*)?|\.npmrc|\.pypirc|id_rsa|id_ed25519|credentials\.json|[^/]+\.(?:pem|key|p12|pfx|sqlite3?|db))($|\/)/i;
const example = /(^|\/)\.env\.(?:example|sample|template)$/i;
const secret = /-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|paasta_[A-Za-z0-9_-]{32,}|npm_[A-Za-z0-9]{30,}|(?:AKIA|ASIA)[A-Z0-9]{16}|sk_live_[A-Za-z0-9]{16,}|sk-(?:proj-)?[A-Za-z0-9_-]{24,})\b/;
const containsKnownSecret = value => secret.test(value);

function destination(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['github.com', 'gitlab.com'].includes(url.hostname) || url.username || url.password || url.port || url.search || url.hash) throw new Error('نشانی یک مخزن HTTPS در GitHub یا GitLab را وارد کنید؛ Token نباید در نشانی باشد.');
  const repository = url.pathname.replace(/\.git$/, '').replace(/^\//, '');
  if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)+$/.test(repository) || repository.split('/').some(p => ['.', '..'].includes(p)) || (url.hostname === 'github.com' && repository.split('/').length !== 2)) throw new Error('مسیر مخزن معتبر نیست.');
  return `https://${url.hostname}/${repository}.git`;
}

function safePath(name) {
  return !!name && !/[\\:\x00-\x1f\x7f]/.test(name) && !name.startsWith('"') && !path.posix.isAbsolute(name) && !name.split('/').some(p => !p || p === '..' || p === '.' || p.endsWith('.') || p.endsWith(' ')) && (!excluded.test(name) || example.test(name));
}

async function git(folder, args, extra = {}) {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) if (/^GIT_/i.test(key) || ['NODE_OPTIONS', 'NODE_PATH'].includes(key)) delete environment[key];
  // Never execute project hooks, credential helpers or replacement objects during export.
  return (await run('git', ['-c', `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`, '-c', 'core.fsmonitor=false', '-c', 'credential.helper=', '-c', 'protocol.file.allow=never', ...args], {
    cwd: folder, timeout: 120000, maxBuffer: MAX_BYTES, encoding: 'utf8', windowsHide: true,
    ...extra, env: { ...environment, LC_ALL: 'C', GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0', ...extra.env },
  })).stdout;
}

async function inspect(folder) {
  const root = await fs.realpath(folder);
  const home = await fs.realpath(os.homedir());
  const relativeHome = path.relative(root, home);
  if (!relativeHome || (!relativeHome.startsWith('..' + path.sep) && relativeHome !== '..' && !path.isAbsolute(relativeHome))) throw new Error('پوشهٔ مستقل برنامه را باز کنید؛ پوشهٔ خانه و مسیرهای بالاتر برای انتقال سورس مناسب نیستند.');
  let repository = false;
  try {
    const top = (await git(root, ['rev-parse', '--show-toplevel'])).trim();
    if (await fs.realpath(top) !== root) throw new Error('پوشه بخشی از یک مخزن بزرگ‌تر است؛ ریشهٔ همان مخزن را باز کنید.');
    repository = true;
  } catch (error) {
    if (!error.stderr?.includes('not a git repository')) throw error;
  }
  let files;
  if (repository) {
    const status = await git(root, ['status', '--porcelain']);
    if (status.trim()) throw new Error('ابتدا تغییرات پروژه را با Git بازبینی و کامیت کنید؛ انتقال، تغییرات کامیت‌نشده را بازنویسی نمی‌کند.');
    const revisions = (await git(root, ['rev-list', '--max-count=201', 'HEAD'])).trim().split('\n');
    if (revisions.length > 200) throw new Error('بازبینی خودکار بیش از ۲۰۰ کامیت پشتیبانی نمی‌شود؛ تاریخچه را پیش از انتشار جداگانه بررسی کنید.');
    // Check every reachable blob, including deleted files and historical secrets.
    const objects = (await git(root, ['-c', 'core.quotePath=false', 'rev-list', '--objects', 'HEAD'])).trim().split('\n');
    if (objects.length > 5000) throw new Error('تعداد اشیای تاریخچه از سقف بازبینی این نسخه بیشتر است.');
    let bytes = 0;
    for (const line of objects) {
      const [id, ...parts] = line.split(' '); const name = parts.join(' ');
      if (!name) continue;
      if (!safePath(name)) throw new Error('تاریخچه شامل مسیر حساس یا خروجی تولیدشده است؛ انتقال متوقف شد.');
      if ((await git(root, ['cat-file', '-t', id])).trim() !== 'blob') continue;
      bytes += Number((await git(root, ['cat-file', '-s', id])).trim());
      if (bytes > MAX_BYTES) throw new Error('حجم تاریخچه از سقف ۵۰ مگابایت این نسخه بیشتر است.');
      if (secret.test(await git(root, ['cat-file', 'blob', id]))) throw new Error('در تاریخچه نشانهٔ کلید محرمانه پیدا شد؛ بدون حذف خودکار تاریخچه، انتقال متوقف شد.');
    }
    files = (await git(root, ['ls-files', '-z'])).split('\0').filter(Boolean);
  } else {
    files = []; let bytes = 0;
    async function visit(directory, prefix = '') {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const name = prefix + entry.name;
        if (!safePath(name)) continue;
        if (entry.isSymbolicLink()) throw new Error('برای انتقال اولیه، پیوندهای نمادین را جداگانه بررسی کنید.');
        if (entry.isDirectory()) await visit(path.join(directory, entry.name), name + '/');
        else if (entry.isFile()) {
          const content = await fs.readFile(path.join(root, name)); bytes += content.length;
          if (bytes > MAX_BYTES || files.length >= 2000) throw new Error('سورس از سقف ۲۰۰۰ فایل یا ۵۰ مگابایت این نسخه بیشتر است.');
          if (secret.test(content.toString('utf8'))) throw new Error('نشانهٔ کلید محرمانه در سورس پیدا شد؛ پیش از انتقال آن را بررسی کنید.');
          files.push(name);
        }
      }
    }
    await visit(root);
  }
  if (!files.length) throw new Error('فایلی برای انتقال پیدا نشد.');
  return { root, repository, files: files.sort() };
}

async function prepare(plan, identity) {
  // Reinspect after confirmation: the user may have changed files while reviewing.
  const current = await inspect(plan.root);
  if (current.repository !== plan.repository || JSON.stringify(current.files) !== JSON.stringify(plan.files)) throw new Error('فهرست فایل‌ها تغییر کرده؛ انتقال را دوباره شروع کنید.');
  if (!current.repository) {
    if (!identity?.name || !identity?.email || /[\r\n\0]/.test(identity.name + identity.email)) throw new Error('نام و ایمیل نویسندهٔ کامیت لازم است.');
    await git(plan.root, ['init', '--initial-branch=main']);
    const ignore = path.join(plan.root, '.gitignore');
    await fs.appendFile(ignore, '\n# Private files and generated output\n.env\n.env.*\n!.env.example\n!.env.sample\n!.env.template\n.npmrc\n.pypirc\n.ssh/\n.aws/\n.kube/\n.docker/\n.paasta/\n.config/\n.local/\n.cache/\n.vscode-server/\n.netrc\n.git-credentials\n.bash_history\n.zsh_history\ncredentials.json\n*.pem\n*.key\n*.p12\n*.pfx\n*.db\n*.sqlite\n*.sqlite3\nid_rsa\nid_ed25519\nnode_modules/\nvendor/\n.venv/\n.next/\ndist/\nbuild/\ncoverage/\n');
    // Let native Git honor custom ignores, then validate exactly what reached its index.
    await git(plan.root, ['add', '--all', '--', '.']);
    const reviewed = new Set([...plan.files, '.gitignore']);
    let stagedBytes = 0;
    for (const entry of (await git(plan.root, ['ls-files', '--stage', '-z'])).split('\0').filter(Boolean)) {
      const split = entry.indexOf('\t'); const name = entry.slice(split + 1);
      const [mode, object, stage] = entry.slice(0, split).split(' ');
      if (!reviewed.has(name) || !safePath(name) || !['100644', '100755'].includes(mode) || stage !== '0') throw new Error('فهرست فایل‌های آمادهٔ کامیت با بازبینی هم‌خوان نیست؛ انتقال متوقف شد.');
      stagedBytes += Number((await git(plan.root, ['cat-file', '-s', object])).trim());
      if (stagedBytes > MAX_BYTES || secret.test(await git(plan.root, ['cat-file', 'blob', object]))) throw new Error('محتوای آمادهٔ کامیت نیاز به بازبینی امنیتی دارد؛ کامیت و انتقال انجام نشد.');
    }
    await git(plan.root, ['-c', `user.name=${identity.name}`, '-c', `user.email=${identity.email}`, '-c', 'commit.gpgSign=false', 'commit', '-m', 'Initial project export from Paasta']);
  }
  const verified = await inspect(plan.root);
  return { ...verified, commit: (await git(plan.root, ['rev-parse', 'HEAD'])).trim() };
}

async function publish(plan, input, token, fetchRemote = fetch) {
  const url = destination(input);
  if (!token || /[\r\n\0]/.test(token)) throw new Error('Token محدود به مخزن مقصد لازم است.');
  try {
    const keys = (await git(plan.root, ['config', '--local', '--includes', '--name-only', '--list'])).trim().toLowerCase().split(/\r?\n/).filter(Boolean);
    const ordinary = new Set(['core.repositoryformatversion', 'core.filemode', 'core.bare', 'core.logallrefupdates', 'core.ignorecase', 'core.precomposeunicode', 'core.symlinks', 'core.autocrlf', 'core.eol', 'core.safecrlf', 'core.protectntfs', 'core.protecthfs', 'user.name', 'user.email']);
    // Reject unknown executable/network configuration (including included files), rather than trying to enumerate every Git hook.
    if (keys.some(key => !ordinary.has(key) && !/^remote\.[^.]+\.(url|fetch)$/.test(key) && !/^branch\..+\.(remote|merge)$/.test(key))) throw new Error('تنظیمات سفارشی انتقال یا اعتبارنامهٔ Git باید پیش از این انتقال جداگانه بررسی شوند.');
  } catch (error) { if (error.code !== 1) throw error; }
  const destinationUrl = new URL(url);
  const repository = destinationUrl.pathname.slice(1).replace(/\.git$/, '');
  const metadataUrl = destinationUrl.hostname === 'github.com'
    ? `https://api.github.com/repos/${repository}`
    : `https://gitlab.com/api/v4/projects/${encodeURIComponent(repository)}`;
  let metadata;
  try {
    const response = await fetchRemote(metadataUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'Paasta/1.0' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('metadata unavailable');
    metadata = await response.json();
  } catch { throw new Error('خصوصی‌بودن و دسترسی مخزن تأیید نشد؛ مجوز خواندن اطلاعات مخزن را بررسی کنید.'); }
  if (destinationUrl.hostname === 'github.com' ? metadata.private !== true : metadata.visibility !== 'private') throw new Error('این نسخه فقط به مخزن خصوصی منتقل می‌کند؛ ابتدا مخزن مقصد را Private کنید.');
  // A temporary askpass contains no token; credentials exist only for these Git children.
  // Git executes askpass directly (not a shell command). Use private executable home storage,
  // because the hardened workspace deliberately mounts /tmp with noexec.
  const temporary = await fs.mkdtemp(path.join(os.homedir(), '.paasta-git-'));
  try {
    const askpass = path.join(temporary, 'askpass.cjs');
    await fs.writeFile(askpass, "process.stdout.write(/username/i.test(process.argv[2]||'')?'oauth2':process.env.PAASTA_GIT_TOKEN)", { mode: 0o600 });
    const askpassCommand = path.join(temporary, process.platform === 'win32' ? 'askpass.cmd' : 'askpass');
    await fs.writeFile(askpassCommand, process.platform === 'win32' ? `@"${process.execPath}" "${askpass}" %*\r\n` : `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${askpass.replaceAll("'", "'\\''")}' "$@"\n`, { mode: 0o700 });
    const env = { GIT_ASKPASS: askpassCommand, PAASTA_GIT_TOKEN: token, ELECTRON_RUN_AS_NODE: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
    const options = ['-c', 'http.followRedirects=false', '-c', 'http.extraHeader='];
    const refs = (await git(plan.root, [...options, 'ls-remote', '--refs', url], { env })).trim();
    if (refs && refs !== `${plan.commit}\trefs/heads/main`) throw new Error('مخزن مقصد خالی نیست؛ هیچ تغییری ارسال نشد.');
    if ((await git(plan.root, ['rev-parse', 'HEAD'])).trim() !== plan.commit || (await git(plan.root, ['status', '--porcelain'])).trim()) throw new Error('پروژه بعد از بازبینی تغییر کرده؛ انتقال را دوباره شروع کنید.');
    await git(plan.root, [...options, 'push', '--no-verify', '--no-follow-tags', '--recurse-submodules=no', url, `${plan.commit}:refs/heads/main`], { env });
    const verified = (await git(plan.root, [...options, 'ls-remote', '--refs', url], { env })).trim();
    if (verified !== `${plan.commit}\trefs/heads/main`) throw new Error('تأیید کامیت مقصد کامل نشد؛ دوباره بررسی کنید.');
    const remotes = (await git(plan.root, ['remote'])).trim().split(/\r?\n/);
    if (!remotes.includes('origin')) {
      await git(plan.root, ['remote', 'add', 'origin', url]);
      await git(plan.root, ['update-ref', 'refs/remotes/origin/main', plan.commit]);
      if ((await git(plan.root, ['branch', '--show-current'])).trim() === 'main') await git(plan.root, ['branch', '--set-upstream-to=origin/main', 'main']);
    }
    return { url, commit: plan.commit };
  } catch (error) {
    if (error.code) throw new Error('ارتباط Git ناموفق بود؛ دسترسی Token و وضعیت مخزن را بررسی کنید. سورس محلی حفظ شده و تکرار همین انتقال امن است.');
    throw error;
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

module.exports = { destination, safePath, containsKnownSecret, inspect, prepare, publish };
