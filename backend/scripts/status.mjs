import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { labels, domain, localDir, run } from './runtime.mjs';
import { loadConfig } from '../src/config.mjs';
const config = loadConfig();
for (const [name, label] of Object.entries(labels)) {
  try {
    const info = run('/bin/launchctl', ['print', `${domain}/${label}`]);
    console.log(`${name}: ${info.match(/state = ([^\n]+)/)?.[1] || 'loaded'}; pid=${info.match(/pid = (\d+)/)?.[1] || '-'} (login auto-start)`);
    if (name === 'backup') console.log(`backup last exit: ${info.match(/last exit code = (\d+)/)?.[1] || 'not yet run'}`);
  } catch { console.log(`${name}: not loaded`); }
}
try { console.log('API health:', await (await fetch(`http://127.0.0.1:${config.apiPort}/api/health`)).text()); }
catch { console.log('API health: unavailable'); }
if (existsSync(join(localDir, 'run/tailscaled.sock'))) {
  try {
    const status = JSON.parse(run('/opt/homebrew/bin/tailscale', [`--socket=${join(localDir, 'run/tailscaled.sock')}`, 'status', '--json']));
    console.log(`Tailscale: ${status.BackendState}; DNS name: ${status.Self?.DNSName || 'not assigned'}; authorization expiry: ${status.Self?.KeyExpiry || 'not reported'}`);
    console.log(run('/opt/homebrew/bin/tailscale', [`--socket=${join(localDir, 'run/tailscaled.sock')}`, 'funnel', 'status']));
  } catch { console.log('Tailscale: unavailable'); }
}
