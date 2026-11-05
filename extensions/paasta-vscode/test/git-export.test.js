const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const exporter = require(process.env.PAASTA_CODE_EXPORT_MODULE || '../git-export');

async function main() {
  const scratch = await fs.mkdtemp(path.join(process.env.PAASTA_CODE_TEST_SCRATCH || os.tmpdir(), 'paasta-export-test-'));
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    assert.equal(exporter.destination('https://github.com/acme/app'), 'https://github.com/acme/app.git');
    assert.equal(exporter.destination('https://gitlab.com/team/group/app.git'), 'https://gitlab.com/team/group/app.git');
    for (const url of ['http://github.com/a/b', 'https://github.com.evil.test/a/b', 'https://user:token@github.com/a/b', 'https://github.com/a/b?token=x', 'https://github.com/a/b#x', 'https://github.com/a/b/c', 'file:///tmp/repo', 'https://127.0.0.1/a/b']) assert.throws(() => exporter.destination(url));
    for (const file of ['.env', '.env.local', '.aws/credentials', '.paasta/config.json', 'data.sqlite3', 'config/private.key', 'node_modules/a.js', '../x', '/etc/passwd', 'a\\b', 'bad\nname']) assert.equal(exporter.safePath(file), false, file);
    assert(exporter.containsKnownSecret('paasta_' + 'a'.repeat(43)));
    for (const file of ['.env.example', 'README.md', 'src/سلام.txt', 'public/logo.png']) assert.equal(exporter.safePath(file), true, file);
    const folder = path.join(scratch, 'source'); await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, 'index.js'), 'console.log("hello");\n');
    await fs.writeFile(path.join(folder, '.env'), 'PRIVATE=test-local-only\n');
    await fs.writeFile(path.join(folder, '.env.example'), 'PORT=3000\n');
    await fs.writeFile(path.join(folder, '.gitignore'), 'ignored.txt\n');
    await fs.writeFile(path.join(folder, 'ignored.txt'), 'custom ignored file');
    await fs.writeFile(path.join(folder, 'سلام.txt'), 'Persian filename');
    await fs.writeFile(path.join(folder, 'data.sqlite'), 'synthetic local database');
    await fs.mkdir(path.join(folder, '.aws')); await fs.writeFile(path.join(folder, '.aws/credentials'), 'synthetic private file');
    await fs.mkdir(path.join(folder, '.config')); await fs.writeFile(path.join(folder, '.config/token'), 'synthetic private config');
    await fs.writeFile(path.join(folder, '.netrc'), 'synthetic credentials');
    const plan = await exporter.inspect(folder);
    assert.equal(plan.repository, false); assert.deepEqual(plan.files, ['.env.example', '.gitignore', 'ignored.txt', 'index.js', 'سلام.txt']);
    const prepared = await exporter.prepare(plan, { name: 'Test Author', email: 'test@example.invalid' });
    assert.match(prepared.commit, /^[a-f0-9]{40}$/);
    assert.equal(await fs.readFile(path.join(folder, '.env'), 'utf8'), 'PRIVATE=test-local-only\n');
    assert(!git(folder, 'ls-files').split('\n').includes('.env'));
    assert(!git(folder, 'ls-files').split('\n').includes('ignored.txt'));
    assert.equal((await exporter.inspect(folder)).repository, true);
    await fs.writeFile(path.join(folder, 'index.js'), 'changed');
    await assert.rejects(exporter.inspect(folder), /کامیت/);
    git(folder, 'restore', 'index.js');
    const nested = path.join(folder, 'nested'); await fs.mkdir(nested);
    await assert.rejects(exporter.inspect(nested), /بزرگ‌تر/);
    await fs.rmdir(nested);

    // A secret removed from HEAD still blocks publication of its reachable history.
    await fs.writeFile(path.join(folder, 'leaked.txt'), 'ghp_' + 'x'.repeat(30));
    git(folder, 'add', 'leaked.txt'); git(folder, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture');
    git(folder, 'rm', 'leaked.txt'); git(folder, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'remove fixture');
    await assert.rejects(exporter.inspect(folder), /تاریخچه/);

    const clean = path.join(scratch, 'clean'); await fs.mkdir(clean); await fs.writeFile(path.join(clean, 'hello.txt'), 'ready');
    const ready = await exporter.prepare(await exporter.inspect(clean), { name: 'Test', email: 'test@example.invalid' });
    if (process.platform !== 'win32') {
      const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
      const remote = path.join(scratch, 'remote.git'); git(scratch, 'init', '--bare', remote);
      const bin = path.join(scratch, 'bin'); await fs.mkdir(bin);
      // Real Git push/ls-remote against a local bare fixture; no network or credentials leave the test.
      await fs.writeFile(path.join(bin, 'git'), `#!/usr/bin/env node\nconst {spawnSync}=require('node:child_process');if(process.env.PAASTA_GIT_TOKEN){const credential=spawnSync(${JSON.stringify(realGit)},['-c','credential.helper=','credential','fill'],{input:'protocol=https\\nhost=github.com\\n\\n',encoding:'utf8',env:process.env});if(credential.status!==0||!credential.stdout.includes('password='+process.env.PAASTA_GIT_TOKEN)){console.error('Askpass credential delivery failed');process.exit(1);}}const args=process.argv.slice(2).map(x=>x==='https://github.com/test/repo.git'&&process.argv.some(arg=>['push','ls-remote'].includes(arg))?${JSON.stringify(remote)}:x==='protocol.file.allow=never'?'protocol.file.allow=always':x);const r=spawnSync(${JSON.stringify(realGit)},args,{stdio:'inherit',env:process.env});process.exit(r.status??1);\n`, { mode: 0o755 });
      const previousPath = process.env.PATH; process.env.PATH = `${bin}:${previousPath}`;
      const privateRepository = async (url, options) => { assert.equal(url, 'https://api.github.com/repos/test/repo'); assert.equal(options.redirect, 'error'); return Response.json({ private: true }); };
      try {
        await assert.rejects(exporter.publish(ready, 'https://github.com/test/repo', 'test-only-token', async () => Response.json({ private: false })), /خصوصی/);
        assert.equal((await exporter.publish(ready, 'https://github.com/test/repo', 'test-only-token', privateRepository)).commit, ready.commit);
        assert.equal(git(clean, 'remote', 'get-url', 'origin').trim(), 'https://github.com/test/repo.git');
        assert.equal(git(clean, 'rev-parse', '--abbrev-ref', 'main@{upstream}').trim(), 'origin/main');
        assert.equal((await exporter.publish(ready, 'https://github.com/test/repo', 'test-only-token', privateRepository)).commit, ready.commit, 'replay is idempotent');
        git(scratch, '--git-dir', remote, 'update-ref', 'refs/heads/another', ready.commit);
        await assert.rejects(exporter.publish(ready, 'https://github.com/test/repo', 'test-only-token', privateRepository), /خالی نیست/);
        git(scratch, '--git-dir', remote, 'update-ref', '-d', 'refs/heads/another');
        git(clean, 'config', '--local', 'url.https://attacker.invalid/.insteadOf', 'https://github.com/');
        await assert.rejects(exporter.publish(ready, 'https://github.com/test/repo', 'test-only-token', privateRepository), /تنظیمات سفارشی/);
      } finally { process.env.PATH = previousPath; }
    }
    console.log('Git export: initial source, private files, historical secrets, conflict, push and replay checks passed.');
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
