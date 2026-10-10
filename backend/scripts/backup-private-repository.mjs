import { execFileSync } from 'node:child_process';
import { validatePrivateRepository } from '../src/backup-archive.mjs';

// Reuse Git's existing authentication. Credential values stay in memory and are
// never placed in a URL, file, command argument, log or exception message.
export async function requirePrivateBackupRepository(repository){
  let credential;
  try{
    credential=execFileSync('git',['-C',repository,'credential','fill'],{
      input:'protocol=https\nhost=github.com\npath=Lzww0608/history_backup.git\n\n',encoding:'utf8',
      env:{...process.env,GIT_TERMINAL_PROMPT:'0'},stdio:['pipe','pipe','pipe'],timeout:10000,
    });
  }catch{throw new Error('GitHub authentication is required to confirm backup repository visibility.');}
  const password=credential.split('\n').find(line=>line.startsWith('password='))?.slice(9);
  credential=undefined;
  if(!password)throw new Error('GitHub authentication is required to confirm backup repository visibility.');
  let response;
  try{
    response=await fetch('https://api.github.com/repos/Lzww0608/history_backup',{
      headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${password}`,'User-Agent':'ancient-history-backup'},
      signal:AbortSignal.timeout(10000),redirect:'error',
    });
  }catch{throw new Error('Unable to confirm that the backup repository is private; no database was uploaded.');}
  if(!response.ok)throw new Error(`GitHub visibility check failed (HTTP ${response.status}); no database was uploaded.`);
  let metadata;
  try{metadata=await response.json();}catch{throw new Error('GitHub returned invalid repository metadata.');}
  validatePrivateRepository(metadata);
  return {repository:metadata.full_name,visibility:'private',checkedAt:new Date().toISOString()};
}
