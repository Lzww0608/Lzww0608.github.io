import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { localDir, labels, privateDir, installAgent, waitUntil } from './runtime.mjs';
const command = process.argv[2] || 'status';
const socket = join(localDir, 'run/tailscaled.sock');
if (command === 'setup') {
  for (const folder of [localDir, join(localDir, 'logs'), join(localDir, 'run'), join(localDir, 'tailscale')]) privateDir(folder);
  await installAgent(labels.tunnel, ['/opt/homebrew/bin/tailscaled', '--tun=userspace-networking', `--state=${join(localDir, 'tailscale/state.json')}`, `--socket=${socket}`]);
  await waitUntil(() => existsSync(socket));
  console.log('Tailscale is running with login auto-start and crash restart. Existing account and Funnel settings are preserved.');
} else {
  const args = command === 'login' ? ['up', '--hostname=ancient-history', '--accept-dns=false', '--accept-routes=false', '--timeout=5m']
    : command === 'enable' ? ['funnel', '--bg', '--https=443', 'http://127.0.0.1:8787']
    : command === 'off' ? ['funnel', '--https=443', 'off']
    : command === 'status' ? ['funnel', 'status'] : null;
  if (!args) throw new Error('Use setup, login, enable, status, or off.');
  const child = spawn('/opt/homebrew/bin/tailscale', [`--socket=${socket}`, ...args], { stdio: 'inherit' });
  child.on('exit', code => { process.exitCode = code || 0; });
}
