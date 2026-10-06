import { fileURLToPath } from 'node:url';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
export const backendDir = fileURLToPath(new URL('../', import.meta.url));
export const localDir = join(backendDir, '.local');
export const pgBin = '/opt/homebrew/opt/postgresql@17/bin';
export const labels = {
  postgres: 'com.lzww.ancient-history.postgres',
  api: 'com.lzww.ancient-history.api',
  tunnel: 'com.lzww.ancient-history.tailscaled',
  backup: 'com.lzww.ancient-history.backup',
};
export const domain = `gui/${process.getuid()}`;
export const adminDatabase = config => ({ host: config.socketDir, port: config.database.port, database: config.database.database, user: userInfo().username });
export function run(binary, args, options = {}) {
  return execFileSync(binary, args, { encoding: 'utf8', ...options });
}
export function privateDir(path) { mkdirSync(path, { recursive: true, mode: 0o700 }); chmodSync(path, 0o700); }
export function privateFile(path, contents) { writeFileSync(path, contents, { mode: 0o600 }); chmodSync(path, 0o600); }
const xml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export async function installAgent(label, args, { calendar = null } = {}) {
  const agents = join(homedir(), 'Library/LaunchAgents');
  mkdirSync(agents, { recursive: true });
  const path = join(agents, `${label}.plist`);
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key><array>${args.map(value => `<string>${xml(value)}</string>`).join('')}</array>
  <key>WorkingDirectory</key><string>${xml(backendDir)}</string>
  <key>EnvironmentVariables</key><dict><key>LC_ALL</key><string>en_US.UTF-8</string><key>LANG</key><string>en_US.UTF-8</string></dict>
  <key>RunAtLoad</key><true/>
  ${calendar ? `<key>StartCalendarInterval</key><dict><key>Hour</key><integer>${calendar.hour}</integer><key>Minute</key><integer>${calendar.minute}</integer></dict>` : '<key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>'}
  <key>ExitTimeOut</key><integer>30</integer>
  <key>Umask</key><integer>63</integer>
  <key>StandardOutPath</key><string>${xml(join(localDir, 'logs', `${label}.out.log`))}</string>
  <key>StandardErrorPath</key><string>${xml(join(localDir, 'logs', `${label}.err.log`))}</string>
  </dict></plist>\n`;
  const isLoaded = () => {
    try { run('/bin/launchctl', ['print', `${domain}/${label}`], { stdio: 'ignore' }); return true; } catch { return false; }
  };
  // Keep identical services running; launchd removes a stopped job asynchronously.
  if (existsSync(path) && readFileSync(path, 'utf8') === body && isLoaded()) return path;
  if (isLoaded()) {
    run('/bin/launchctl', ['bootout', `${domain}/${label}`], { stdio: 'ignore' });
    await waitUntil(() => !isLoaded(), 160);
  }
  privateFile(path, body);
  run('/usr/bin/plutil', ['-lint', path]);
  run('/bin/launchctl', ['bootstrap', domain, path]);
  return path;
}
export async function waitUntil(check, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { if (await check()) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Service did not become ready; inspect backend/.local/logs.');
}
