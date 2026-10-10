import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

const magic=Buffer.from('HISTORY-BACKUP-1\n');
const keyCheck=key=>{if(!Buffer.isBuffer(key)||key.length!==32)throw new Error('A 32-byte backup key is required.');};
export const sha256=value=>createHash('sha256').update(value).digest('hex');
export const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b,'en'))):item);
export const digest=value=>sha256(canonical(value));
export function encryptBackup(plaintext,key,metadata){
  keyCheck(key);
  const header=Buffer.from(JSON.stringify(metadata));
  if(header.length>16384)throw new Error('Backup metadata is too large.');
  const length=Buffer.alloc(4);length.writeUInt32BE(header.length);
  const aad=Buffer.concat([magic,length,header]),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(aad);
  const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);
  return Buffer.concat([aad,iv,cipher.getAuthTag(),ciphertext]);
}
export function decryptBackup(encrypted,key){
  keyCheck(key);
  if(encrypted.length<magic.length+4+28||!encrypted.subarray(0,magic.length).equals(magic))throw new Error('Invalid backup format.');
  const length=encrypted.readUInt32BE(magic.length),end=magic.length+4+length;
  if(length>16384||encrypted.length<end+28)throw new Error('Truncated backup header.');
  const decipher=createDecipheriv('aes-256-gcm',key,encrypted.subarray(end,end+12));
  decipher.setAAD(encrypted.subarray(0,end));decipher.setAuthTag(encrypted.subarray(end+12,end+28));
  const plaintext=Buffer.concat([decipher.update(encrypted.subarray(end+28)),decipher.final()]);
  const metadata=JSON.parse(encrypted.subarray(magic.length+4,end).toString('utf8'));
  return {plaintext,metadata};
}

// Authenticate the project and database together. A replacement source archive
// and a rewritten public manifest must not pass with an older encrypted dump.
export function verifyBackupContents({manifest,snapshotId,projectArchive,encryptedDatabase,key}){
  if(manifest.schemaVersion!==1||manifest.snapshotId!==snapshotId
    ||manifest.encryption?.algorithm!=='AES-256-GCM'||manifest.encryption?.format!=='HISTORY-BACKUP-1')throw new Error('Invalid snapshot manifest.');
  for(const [filename,bytes]of [['project.tar.gz',projectArchive],['database.dump.enc',encryptedDatabase]]){
    if(manifest.files?.[filename]?.sha256!==sha256(bytes)||manifest.files[filename].bytes!==bytes.length)
      throw new Error('A backup file checksum does not match its manifest.');
  }
  const decrypted=decryptBackup(encryptedDatabase,key);
  const expected={snapshotId,sourceCommit:manifest.sourceCommit,sourceState:manifest.sourceState,
    projectArchiveSha256:sha256(projectArchive),databaseSha256:manifest.database?.sha256,
    databaseDumpSha256:manifest.databaseDumpSha256,keyId:sha256(key).slice(0,16)};
  const {sha256:stateHash,...state}=manifest.database||{};
  if(digest(state)!==stateHash||digest(decrypted.metadata)!==digest(expected)
    ||digest(decrypted.metadata)!==digest(manifest.encryption.metadata)
    ||sha256(decrypted.plaintext)!==manifest.databaseDumpSha256)throw new Error('Authenticated backup metadata does not match.');
  return decrypted;
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
      ||path.endsWith('.dump')||(/(^|\/)\.env(?:\.|$)/u.test(path)&&!['backend/.env.example','frontend/.env.development','frontend/.env.production'].includes(path)))
      throw new Error('Tracked private runtime data cannot enter a source archive.');
  }
}
