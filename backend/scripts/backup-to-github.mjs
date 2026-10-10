import pg from 'pg';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, renameSync, realpathSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { randomBytes } from 'node:crypto';
import { userInfo } from 'node:os';
import { loadConfig } from '../src/config.mjs';
import { adminDatabase, localDir, pgBin, backendDir, privateDir } from './runtime.mjs';
import { encryptBackup, sha256, digest, verifyBackupContents, validateBackupRemotes, validateSourcePaths } from '../src/backup-archive.mjs';

process.umask(0o077);
const project=resolve(backendDir,'..');
const repository=resolve(process.env.HISTORY_BACKUP_REPO||'/Users/lzww/history_backup');
const keyPath=resolve(process.env.HISTORY_BACKUP_KEY_FILE||join(localDir,'backup-key.bin'));
const args=process.argv.slice(2),baseline=args.includes('--baseline');
const mode=args.includes('--verify')?'verify':args.includes('--decrypt')?'decrypt':'backup';
const valueAfter=flag=>args[args.indexOf(flag)+1];
if(!(args.length===0||args.length===1&&baseline
  ||args.length===2&&args[0]==='--verify'&&!args[1].startsWith('--')
  ||args.length===4&&args[0]==='--decrypt'&&!args[1].startsWith('--')&&args[2]==='--output'&&args[3].startsWith('/')))
  throw new Error('Use no options, --baseline, --verify <snapshot-id>, or --decrypt <snapshot-id> --output <absolute-private-path>.');
const git=(cwd,...params)=>execFileSync('git',['-C',cwd,...params],{encoding:'utf8',maxBuffer:64*1024*1024}).trim();
const run=(binary,params)=>execFileSync(binary,params,{encoding:'utf8',maxBuffer:64*1024*1024});
const identifier=value=>'"'+value.replaceAll('"','""')+'"';
const put=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
function regularFile(path){
  const st=lstatSync(path);if(!st.isFile()||st.isSymbolicLink())throw new Error('Backup files must be regular files.');return st;
}
function getKey(create=false){
  if(!existsSync(keyPath)){
    if(!create)throw new Error('The backup decryption key is missing; restore your privately saved key.');
    if(existsSync(join(repository,'latest.json')))throw new Error('Existing backups require the original key; it was not replaced.');
    if(keyPath!==join(localDir,'backup-key.bin'))throw new Error('Provide the existing key at HISTORY_BACKUP_KEY_FILE.');
    privateDir(localDir);writeFileSync(keyPath,randomBytes(32),{mode:0o600,flag:'wx'});
  }
  const st=regularFile(keyPath);
  if((st.mode&0o077)!==0||st.uid!==process.getuid())throw new Error('The backup key must belong to this user and have mode 600.');
  const key=readFileSync(keyPath);if(key.length!==32)throw new Error('Invalid backup key length.');return key;
}
function checkRepository(){
  if(!existsSync(repository)||lstatSync(repository).isSymbolicLink()
    ||realpathSync(git(repository,'rev-parse','--show-toplevel'))!==realpathSync(repository))throw new Error('Use the existing backup repository root.');
  validateBackupRemotes(git(repository,'remote','get-url','--all','origin').split('\n'),git(repository,'remote','get-url','--push','--all','origin').split('\n'));
  if(git(repository,'branch','--show-current')!=='main')throw new Error('The backup repository must be on main.');
  if(git(repository,'status','--porcelain'))throw new Error('The backup repository has local changes. Preserve or commit them before backing up.');
  const snapshots=join(repository,'snapshots');
  if(existsSync(snapshots)&&(!lstatSync(snapshots).isDirectory()||lstatSync(snapshots).isSymbolicLink()))throw new Error('Snapshots must use a regular repository directory.');
}
function syncRepository(){
  git(repository,'fetch','origin','main');
  const [ahead,behind]=git(repository,'rev-list','--left-right','--count','HEAD...origin/main').split(/\s+/u).map(Number);
  if(ahead&&behind)throw new Error('Backup history has diverged; preserve both histories and resolve it before retrying.');
  if(behind)git(repository,'merge','--ff-only','origin/main');
  checkRepository();
}
function sourceState(){
  const commit=git(project,'rev-parse','HEAD');
  validateSourcePaths(git(project,'ls-tree','-rz','--name-only',commit).split('\0').filter(Boolean));
  const status=git(project,'status','--porcelain','--untracked-files=all').split('\n').filter(Boolean)
    .filter(line=>!/^\?\? package(?:-lock)?\.json$/u.test(line));
  if(!baseline&&status.length)throw new Error('Commit project changes before the final backup, or use --baseline for a pre-change committed baseline.');
  return {commit,state:baseline?'committed-baseline':'committed-release'};
}
async function databaseState(client){
  await client.query("SET TIME ZONE 'UTC'");
  await client.query("SET datestyle TO 'ISO,YMD'");
  const tables=await client.query("SELECT c.relname AS tablename FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','m') ORDER BY c.relname");
  const tableDigests={};
  for(const {tablename}of tables.rows){
    const {rows}=await client.query(`WITH hashes AS (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS h FROM public.${identifier(tablename)} t)
      SELECT count(*)::int AS rows,encode(sha256(convert_to(coalesce(string_agg(h,chr(10) ORDER BY h),''),'UTF8')),'hex') AS sha256 FROM hashes`);
    tableDigests[tablename]=rows[0];
  }
  const names=await client.query("SELECT sequencename FROM pg_catalog.pg_sequences WHERE schemaname='public' ORDER BY sequencename");
  const sequences={};
  for(const {sequencename}of names.rows)sequences[sequencename]=(await client.query(`SELECT last_value::text,is_called FROM public.${identifier(sequencename)}`)).rows[0];
  const schema={};
  schema.sequences=(await client.query("SELECT sequencename,data_type,start_value,min_value,max_value,increment_by,cycle,cache_size FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows;
  schema.extensions=(await client.query('SELECT extname,extversion FROM pg_extension ORDER BY extname')).rows;
  schema.columns=(await client.query("SELECT table_name,column_name,ordinal_position,column_default,is_nullable,data_type,udt_schema,udt_name,is_identity,identity_generation FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position")).rows;
  schema.constraints=(await client.query("SELECT c.relname AS relation,n.conname,pg_get_constraintdef(n.oid) AS definition FROM pg_constraint n JOIN pg_class c ON c.oid=n.conrelid JOIN pg_namespace s ON s.oid=c.relnamespace WHERE s.nspname='public' ORDER BY c.relname,n.conname")).rows;
  schema.functions=(await client.query("SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p') ORDER BY p.proname,arguments")).rows;
  schema.indexes=(await client.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname")).rows;
  schema.views=(await client.query("SELECT c.relname,pg_get_viewdef(c.oid) AS definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('v','m') ORDER BY c.relname")).rows;
  schema.triggers=(await client.query("SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname")).rows;
  const state={tables:tableDigests,sequences,schemaSha256:digest(schema)};
  return {...state,sha256:digest(state)};
}
async function verifyDatabase(file,expected,config){
  const name=`history_github_restore_${process.pid}_${randomBytes(5).toString('hex')}`;
  const admin=new pg.Client({...adminDatabase(config),database:'postgres'});let created=false,check;
  try{
    await admin.connect();await admin.query(`CREATE DATABASE ${name} TEMPLATE template0`);created=true;
    await admin.query(`REVOKE CONNECT ON DATABASE ${name} FROM PUBLIC`);
    run(join(pgBin,'pg_restore'),['--exit-on-error','--no-owner','--no-acl','-h',config.socketDir,'-p',String(config.database.port),'-U',userInfo().username,'-d',name,file]);
    check=new pg.Client({...adminDatabase(config),database:name});await check.connect();
    const state=await databaseState(check);
    if(state.sha256!==expected.sha256)throw new Error('Restored rows, schema or identity sequences differ from the exported database snapshot. If a concurrent edit advanced a sequence, retry during a quiet interval.');
    return {verified:true,checkedAt:new Date().toISOString(),tables:Object.keys(state.tables).length,rows:Object.values(state.tables).reduce((n,t)=>n+t.rows,0),databaseSha256:state.sha256};
  }finally{
    if(check)await check.end();if(created)await admin.query(`DROP DATABASE ${name}`);await admin.end();
  }
}
function readSnapshot(id,key){
  if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}Z-[a-f0-9]{8}$/u.test(id))throw new Error('Invalid snapshot ID.');
  const folder=join(repository,'snapshots',id);if(lstatSync(folder).isSymbolicLink())throw new Error('Invalid snapshot folder.');
  const manifestPath=join(folder,'manifest.json');regularFile(manifestPath);const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  const files=Object.fromEntries(['project.tar.gz','database.dump.enc'].map(filename=>{
    const path=join(folder,filename);regularFile(path);return [filename,readFileSync(path)];
  }));
  const decrypted=verifyBackupContents({manifest,snapshotId:id,projectArchive:files['project.tar.gz'],encryptedDatabase:files['database.dump.enc'],key});
  return {manifest,plaintext:decrypted.plaintext};
}
async function verifySnapshot(id,key,config){
  const {manifest,plaintext}=readSnapshot(id,key);const temp=mkdtempSync(join(localDir,'backups','github-verify-'));
  try{const file=join(temp,'restore.dump');writeFileSync(file,plaintext,{mode:0o600});return await verifyDatabase(file,manifest.database,config);}
  finally{rmSync(temp,{recursive:true,force:true});}
}
function pushAndVerify(){
  git(repository,'push','origin','main');const commit=git(repository,'rev-parse','HEAD');
  const remote=git(repository,'ls-remote','origin','refs/heads/main').split(/\s+/u)[0];
  if(remote!==commit)throw new Error('The backup commit is not confirmed on GitHub.');return commit;
}
async function main(){
  checkRepository();privateDir(join(localDir,'backups'));
  if(mode!=='backup'){
    const id=valueAfter(`--${mode}`),key=getKey();
    if(mode==='verify'){console.log(JSON.stringify({snapshotId:id,...await verifySnapshot(id,key,loadConfig())}));return;}
    const output=resolve(valueAfter('--output')||'');
    const privateRoot=realpathSync(join(localDir,'backups'));
    if(!args.includes('--output')||!output.startsWith(privateRoot+'/')||existsSync(output)
      ||realpathSync(dirname(output))!==dirname(output))throw new Error('Decrypt only to a new file inside backend/.local/backups.');
    const {plaintext}=readSnapshot(id,key);writeFileSync(output,plaintext,{mode:0o600,flag:'wx'});
    console.log(JSON.stringify({snapshotId:id,decryptedTo:output}));return;
  }
  syncRepository();
  const source=sourceState(),key=getKey(true),config=loadConfig(),client=new pg.Client(adminDatabase(config));
  const latestFile=join(repository,'latest.json');let temp;
  try{
    await client.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const now=new Date(),state=await databaseState(client);
    if(existsSync(latestFile)){
      regularFile(latestFile);
      const latest=JSON.parse(readFileSync(latestFile,'utf8'));
      const {manifest}=readSnapshot(latest.snapshotId,key);
      if(manifest.sourceCommit===source.commit&&manifest.database.sha256===state.sha256){
        await client.query('COMMIT');const verification=await verifySnapshot(latest.snapshotId,key,config);
        const commit=pushAndVerify();console.log(JSON.stringify({snapshotId:latest.snapshotId,reused:true,verification,commit,github:'https://github.com/Lzww0608/history_backup'}));return;
      }
    }
    const snapshot=(await client.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
    const id=now.toISOString().replace(/\.[0-9]{3}Z$/u,'Z').replaceAll(':','-')+'-'+randomBytes(4).toString('hex');
    temp=mkdtempSync(join(localDir,'backups','github-create-'));
    const dump=join(temp,'database.dump');
    run(join(pgBin,'pg_dump'),['-h',config.socketDir,'-p',String(config.database.port),'-U',userInfo().username,'-d',config.database.database,'--snapshot',snapshot,'-Fc','-f',dump]);
    await client.query('COMMIT');
    const folder=join(repository,'snapshots',id);mkdirSync(folder,{recursive:true,mode:0o700});
    const archive=join(folder,'project.tar.gz');
    run('git',['-C',project,'archive','--format=tar.gz','--output',archive,source.commit]);
    const plaintext=readFileSync(dump),metadata={snapshotId:id,sourceCommit:source.commit,sourceState:source.state,projectArchiveSha256:sha256(readFileSync(archive)),databaseSha256:state.sha256,databaseDumpSha256:sha256(plaintext),keyId:sha256(key).slice(0,16)};
    const encrypted=encryptBackup(plaintext,key,metadata);writeFileSync(join(folder,'database.dump.enc'),encrypted,{mode:0o600,flag:'wx'});
    for(const file of ['project.tar.gz','database.dump.enc'])if(statSync(join(folder,file)).size>=95*1024*1024)throw new Error('A snapshot file exceeds the safe GitHub file-size limit.');
    const manifest={schemaVersion:1,snapshotId:id,createdAt:now.toISOString(),localTime:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium'}).format(now),
      sourceCommit:source.commit,sourceState:source.state,sourceRepository:'https://github.com/Lzww0608/Lzww0608.github.io',
      database:state,databaseDumpSha256:metadata.databaseDumpSha256,
      postgresVersion:(await client.query('SHOW server_version')).rows[0].server_version,
      encryption:{algorithm:'AES-256-GCM',format:'HISTORY-BACKUP-1',metadata},
      files:Object.fromEntries(['project.tar.gz','database.dump.enc'].map(file=>[file,{bytes:statSync(join(folder,file)).size,sha256:sha256(readFileSync(join(folder,file)))}]))};
    put(join(folder,'manifest.json'),manifest);
    const verification=await verifySnapshot(id,key,config);put(join(folder,'verification.json'),verification);
    const pending=join(repository,'latest.json.tmp');writeFileSync(pending,JSON.stringify({schemaVersion:1,snapshotId:id,sourceCommit:source.commit,databaseSha256:state.sha256},null,2)+'\n',{mode:0o600,flag:'wx'});renameSync(pending,latestFile);
    git(repository,'add','--',`snapshots/${id}`,'latest.json');
    git(repository,'commit','-m',`Back up history content ${id}`);
    const commit=pushAndVerify();console.log(JSON.stringify({snapshotId:id,reused:false,verification,commit,keyFile:keyPath,github:'https://github.com/Lzww0608/history_backup'}));
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    // A committed but unpushed snapshot is kept for an ordinary retry. Never reset
    // the backup repository, replace its key, or force-push to conceal a failure.
    throw error;
  }finally{await client.end();if(temp)rmSync(temp,{recursive:true,force:true});}
}
main().catch(error=>{console.error(`Backup failed: ${error.message}`);process.exitCode=1;});
