const path = require('node:path');
const { spawn } = require('node:child_process');
const { managedSession } = require('./managed-session');

function invocation(args) {
  const session = managedSession();
  if (!session) throw new Error('نشست محیط منقضی شده؛ از کنسول پاستا دوباره وارد محیط شوید.');
  return {
    file: path.join(__dirname, 'client', 'engine', 'paasta' + (process.platform === 'win32' ? '.exe' : '')),
    args,
    env: { ...process.env, PAASTA_RUNTIME_SERVER: session.server, PAASTA_RUNTIME_TOKEN: session.token },
  };
}

if (require.main === module) {
  try {
    const call = invocation(process.argv.slice(2));
    if (['login', 'logout'].includes(call.args[0])) {
      console.log('ورود CLI به نشست کنسول متصل است؛ ورود یا خروج را از کنسول پاستا انجام دهید.');
    } else {
      const child = spawn(call.file, call.args, { env: call.env, stdio: 'inherit', windowsHide: true });
      child.once('error', () => { console.error('اجرای CLI پاستا ممکن نشد؛ محیط را از کنسول دوباره باز کنید.'); process.exitCode = 1; });
      child.once('exit', code => { process.exitCode = code ?? 1; });
      process.once('SIGTERM', () => child.kill('SIGTERM'));
      process.once('SIGINT', () => child.kill('SIGINT'));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { invocation };
