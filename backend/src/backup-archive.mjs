import { createHash } from 'node:crypto';
export const sha256=value=>createHash('sha256').update(value).digest('hex');
export const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b,'en'))):item);
export const digest=value=>sha256(canonical(value));
export function verifyBackupContents({manifest,snapshotId,projectArchive,databaseDump}){
  if(manifest.schemaVersion!==2||manifest.snapshotId!==snapshotId||manifest.storage?.encrypted!==false
    ||manifest.storage?.visibility!=='private'||manifest.storage?.databaseFormat!=='postgresql-custom'
    ||!/^[a-f0-9]{40}$/u.test(manifest.sourceCommit)||!['committed-baseline','committed-release'].includes(manifest.sourceState))throw new Error('Invalid plain snapshot manifest.');
  for(const [filename,bytes]of [['project.tar.gz',projectArchive],['database.dump',databaseDump]]){
    if(manifest.files?.[filename]?.sha256!==sha256(bytes)||manifest.files[filename].bytes!==bytes.length)
      throw new Error('A backup file checksum does not match its manifest.');
  }
  const {sha256:stateHash,...state}=manifest.database||{};
  if(digest(state)!==stateHash||sha256(databaseDump)!==manifest.databaseDumpSha256
    ||databaseDump.length<=5||databaseDump.subarray(0,5).toString('ascii')!=='PGDMP')throw new Error('Database backup content or fingerprint does not match.');
  return {plaintext:databaseDump};
}

export function validatePrivateRepository(metadata){
  if(metadata?.full_name!=='Lzww0608/history_backup'||metadata.private!==true
    ||metadata.visibility!==undefined&&metadata.visibility!=='private')throw new Error('Lzww0608/history_backup must be confirmed private before uploading a plain database.');
}

const allowedRemotes=new Set(['https://github.com/Lzww0608/history_backup.git','git@github.com:Lzww0608/history_backup.git']);
export function validateBackupRemotes(fetchUrls,pushUrls){
  if(!fetchUrls.length||!pushUrls.length||[...fetchUrls,...pushUrls].some(url=>!allowedRemotes.has(url)))
    throw new Error('Both origin fetch and push URLs must be Lzww0608/history_backup.');
}
export function validateSourcePaths(paths){
  for(const path of paths){
    if(path.startsWith('/')||path.split('/').includes('..')||/(^|\/)(?:\.local|\.git|node_modules|secrets)(\/|$)/u.test(path)
      ||/(^|\/)(?:backup-key\.bin|editor-key\.txt|editor-config\.json|state\.json)$/u.test(path)
      ||path.endsWith('.dump')||path.endsWith('.log')||(/(^|\/)\.env(?:\.|$)/u.test(path)&&!['backend/.env.example','frontend/.env.development','frontend/.env.production'].includes(path)))
      throw new Error('Tracked private runtime data cannot enter a source archive.');
  }
}
