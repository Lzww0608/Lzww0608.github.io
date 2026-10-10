import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { encryptBackup, decryptBackup, sha256, digest, verifyBackupContents, validateBackupRemotes, validateSourcePaths } from '../src/backup-archive.mjs';

test('authenticated database backup restores exact bytes and binds its manifest metadata', () => {
  const key=randomBytes(32),plain=Buffer.from('PGDMP 原文、译文、修订与私有草稿'),metadata={snapshotId:'2026-10-10T14-00-00Z',sourceCommit:'a'.repeat(40)};
  const a=encryptBackup(plain,key,metadata),b=encryptBackup(plain,key,metadata);
  assert.notDeepEqual(a,b,'every archive has a fresh nonce');
  assert.equal(a.includes(plain),false);
  assert.deepEqual(decryptBackup(a,key),{plaintext:plain,metadata});
});

test('wrong keys and tampered, malformed or truncated encrypted files fail closed', () => {
  const key=randomBytes(32),encrypted=encryptBackup(Buffer.from('PGDMP test content'),key,{snapshotId:'test'});
  assert.throws(()=>decryptBackup(encrypted,randomBytes(32)));
  assert.throws(()=>encryptBackup(Buffer.from('data'),Buffer.alloc(16),{}));
  for(const i of [0,20,encrypted.length-1]){const changed=Buffer.from(encrypted);changed[i]^=1;assert.throws(()=>decryptBackup(changed,key));}
  assert.throws(()=>decryptBackup(encrypted.subarray(0,encrypted.length-5),key));
});

test('public manifest rewrites cannot replace the authenticated source archive or database identity', () => {
  const key=randomBytes(32),projectArchive=Buffer.from('committed public content'),plaintext=Buffer.from('PGDMP real rows');
  const state={tables:{originals:{rows:2,sha256:sha256('row data')}},sequences:{originals_id_seq:{last_value:'2',is_called:true}},schemaSha256:sha256('schema')};
  const database={...state,sha256:digest(state)},snapshotId='2026-10-10T14-00-00Z-aabbccdd';
  const metadata={snapshotId,sourceCommit:'a'.repeat(40),sourceState:'committed-release',projectArchiveSha256:sha256(projectArchive),databaseSha256:database.sha256,databaseDumpSha256:sha256(plaintext),keyId:sha256(key).slice(0,16)};
  const encryptedDatabase=encryptBackup(plaintext,key,metadata);
  const manifest={schemaVersion:1,snapshotId,sourceCommit:metadata.sourceCommit,sourceState:metadata.sourceState,database,databaseDumpSha256:metadata.databaseDumpSha256,
    encryption:{algorithm:'AES-256-GCM',format:'HISTORY-BACKUP-1',metadata},files:{'project.tar.gz':{bytes:projectArchive.length,sha256:sha256(projectArchive)},'database.dump.enc':{bytes:encryptedDatabase.length,sha256:sha256(encryptedDatabase)}}};
  const verify=(candidate,archive=projectArchive)=>verifyBackupContents({manifest:candidate,snapshotId,projectArchive:archive,encryptedDatabase,key});
  assert.deepEqual(verify(manifest).plaintext,plaintext);
  for(const change of [m=>{m.sourceCommit='b'.repeat(40);},m=>{m.sourceState='committed-baseline';},m=>{m.database.tables.originals.rows=3;},m=>{m.encryption.metadata.keyId='0'.repeat(16);},m=>{m.databaseDumpSha256=sha256('another dump');}]){
    const changed=structuredClone(manifest);change(changed);assert.throws(()=>verify(changed));
  }
  const archive=Buffer.from('replaced public content'),changed=structuredClone(manifest);
  changed.files['project.tar.gz']={bytes:archive.length,sha256:sha256(archive)};
  changed.encryption.metadata.projectArchiveSha256=sha256(archive);
  assert.throws(()=>verify(changed,archive),'rewriting the source package and manifest cannot change authenticated metadata');
});

test('both fetch and every push destination must be the user authorized backup repository', () => {
  const https='https://github.com/Lzww0608/history_backup.git',ssh='git@github.com:Lzww0608/history_backup.git';
  assert.doesNotThrow(()=>validateBackupRemotes([https],[ssh]));
  for(const [fetch,push]of [[[],[https]],[[https],[]],[[https],[https,'https://github.com/other/backup.git']],[[ssh],['https://token@github.com/Lzww0608/history_backup.git']]])
    assert.throws(()=>validateBackupRemotes(fetch,push));
});

test('source archiving rejects private runtime data and credentials even when accidentally tracked', () => {
  assert.doesNotThrow(()=>validateSourcePaths(['content/five-dynasties/catalog.json','backend/.env.example','frontend/.env.development','frontend/.env.production','backend/src/server.mjs']));
  for(const path of ['backend/.local/config.json','backend/.local/backup-key.bin','backend/.env','frontend/.env.local','frontend/.env.production.local','secrets/password.txt','node_modules/pg/index.js','.git/config','backup.dump','backup-key.bin','../outside'])
    assert.throws(()=>validateSourcePaths([path]),path);
});
