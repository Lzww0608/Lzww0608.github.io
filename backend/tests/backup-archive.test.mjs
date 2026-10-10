import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256, digest, verifyBackupContents, validatePrivateRepository, validateBackupRemotes, validateSourcePaths } from '../src/backup-archive.mjs';

function fixture(){
  const projectArchive=Buffer.from('committed public content'),databaseDump=Buffer.from('PGDMP real rows');
  const state={tables:{originals:{rows:2,sha256:sha256('row data')}},sequences:{originals_id_seq:{last_value:'2',is_called:true}},schemaSha256:sha256('schema')};
  const database={...state,sha256:digest(state)},snapshotId='2026-10-10T14-00-00Z-aabbccdd';
  const manifest={schemaVersion:2,snapshotId,sourceCommit:'a'.repeat(40),sourceState:'committed-release',database,databaseDumpSha256:sha256(databaseDump),
    storage:{visibility:'private',databaseFormat:'postgresql-custom',encrypted:false},
    files:Object.fromEntries([['project.tar.gz',projectArchive],['database.dump',databaseDump]].map(([name,bytes])=>[name,{bytes:bytes.length,sha256:sha256(bytes)}]))};
  return {manifest,snapshotId,projectArchive,databaseDump};
}

test('plain PostgreSQL backups validate source and complete database state without a key',()=>{
  const backup=fixture();
  assert.deepEqual(verifyBackupContents(backup).plaintext,backup.databaseDump);
  assert.equal(backup.manifest.encryption,undefined);
});

test('corrupt files, mismatched manifests and incomplete database fingerprints fail before restore',()=>{
  for(const change of [b=>{b.databaseDump=Buffer.from('PGDMP replaced rows');},b=>{b.projectArchive=Buffer.from('replaced source');},
    b=>{b.manifest.database.tables.originals.rows=3;},b=>{b.manifest.databaseDumpSha256=sha256('another dump');},
    b=>{b.manifest.files['database.dump'].bytes++;},b=>{b.manifest.snapshotId='other';},b=>{b.manifest.schemaVersion=1;},
    b=>{b.manifest.storage.encrypted=true;},b=>{b.manifest.storage.visibility='public';},
    b=>{b.manifest.sourceCommit='not a commit';},b=>{b.manifest.sourceState='uncommitted';}]){
    const backup=fixture();change(backup);assert.throws(()=>verifyBackupContents(backup));
  }
  const backup=fixture();backup.databaseDump=Buffer.from('a fake database');
  backup.manifest.databaseDumpSha256=sha256(backup.databaseDump);
  backup.manifest.files['database.dump']={bytes:backup.databaseDump.length,sha256:sha256(backup.databaseDump)};
  assert.throws(()=>verifyBackupContents(backup));
});

test('plaintext upload requires an authenticated positive private flag for exactly the authorized repo',()=>{
  assert.doesNotThrow(()=>validatePrivateRepository({full_name:'Lzww0608/history_backup',private:true,visibility:'private'}));
  for(const metadata of [{full_name:'Lzww0608/history_backup',private:false},{full_name:'Lzww0608/history_backup'},
    {full_name:'other/backup',private:true},{full_name:'Lzww0608/history_backup',private:'true'},
    {full_name:'Lzww0608/history_backup',private:true,visibility:'public'},null])assert.throws(()=>validatePrivateRepository(metadata));
});

test('both fetch and every push destination must be the user authorized backup repository',()=>{
  const https='https://github.com/Lzww0608/history_backup.git',ssh='git@github.com:Lzww0608/history_backup.git';
  assert.doesNotThrow(()=>validateBackupRemotes([https],[ssh]));
  for(const [fetch,push]of [[[],[https]],[[https],[]],[[https],[https,'https://github.com/other/backup.git']],[[ssh],['https://token@github.com/Lzww0608/history_backup.git']]])
    assert.throws(()=>validateBackupRemotes(fetch,push));
});

test('a private backup still excludes runtime passwords, credentials and local files from the source archive',()=>{
  assert.doesNotThrow(()=>validateSourcePaths(['content/five-dynasties/catalog.json','backend/.env.example','frontend/.env.development','frontend/.env.production','backend/src/server.mjs']));
  for(const path of ['backend/.local/config.json','backend/.local/backup-key.bin','backend/.env','frontend/.env.local','frontend/.env.production.local','secrets/password.txt','node_modules/pg/index.js','.git/config','backup.dump','server.log','backup-key.bin','../outside'])
    assert.throws(()=>validateSourcePaths([path]),path);
});
