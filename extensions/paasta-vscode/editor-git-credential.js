// Git invokes this helper only for the Paasta broker, never for the provider.
const { managedSession } = require('./managed-session');
let input = '';
process.stdin.on('data', chunk => { input += chunk; if (input.length > 4096) process.exit(1); });
process.stdin.on('end', () => {
  if (process.argv[2] !== 'get') return;
  const fields = Object.fromEntries(input.trim().split('\n').map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)]; }));
  const session = managedSession();
  if (!session || fields.protocol !== 'https' || fields.host !== new URL(session.server).host || !/^api\/editor\/git\/[a-z0-9-]+\/[a-f0-9]{32}\.git$/.test(fields.path || '')) return;
  process.stdout.write('username=paasta\npassword=' + session.token + '\n\n');
});
