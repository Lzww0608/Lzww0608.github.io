import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/http.mjs';
const servers = [];
after(async () => { for (const s of servers) await new Promise(r => s.close(r)); });
async function start(repository) { const server=createApi({repository,allowedOrigins:['https://lzww0608.github.io'],log:()=>{}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r)); servers.push(server); return `http://127.0.0.1:${server.address().port}`; }
test('chapter validation reads current data before 304, and changes, errors and empty success never reuse old content', async () => {
  let current={id:'old-v048',paragraphs:[{original:'原文',translation:{text:'译文',version:1}}]}, calls=0, fail=false;
  const base=await start({async chapter(){calls++;if(fail) throw new Error('down');return current;}});
  const first=await fetch(`${base}/api/chapters/old-v048`); const etag=first.headers.get('etag');
  assert.match(etag,/^W\/"[a-f0-9]{64}"$/); assert.equal(first.headers.get('cache-control'),'private, no-cache, must-revalidate');
  await first.json(); const unchanged=await fetch(`${base}/api/chapters/old-v048`,{headers:{'If-None-Match':etag,Origin:'https://lzww0608.github.io'}});
  assert.equal(unchanged.status,304); assert.equal(await unchanged.text(),''); assert.equal(calls,2);
  assert.equal(unchanged.headers.get('Access-Control-Allow-Origin'),'https://lzww0608.github.io');
  current={id:'old-v048',paragraphs:[]}; const empty=await fetch(`${base}/api/chapters/old-v048`,{headers:{'If-None-Match':etag}});
  assert.equal(empty.status,200); assert.deepEqual(await empty.json(),current); assert.notEqual(empty.headers.get('etag'),etag);
  fail=true; const error=await fetch(`${base}/api/chapters/old-v048`,{headers:{'If-None-Match':etag}});
  assert.equal(error.status,503); assert.equal(error.headers.get('cache-control'),'no-store'); assert.equal(error.headers.get('etag'),null);
});
test('selected timeline requests allow only bounded unique event IDs and pass them to the readonly repository',async()=>{
  const seen=[]; const base=await start({async personTimeline(person,options){seen.push([person,options]);return {events:[],unavailableCount:0};}});
  const result=await fetch(`${base}/api/people/li-keyong/timeline?eventId=li-keyong-908-death&eventId=li-keyong-907-jin`);
  assert.equal(result.status,200); await result.json(); assert.deepEqual(seen,[['li-keyong',{eventIds:['li-keyong-908-death','li-keyong-907-jin']}] ]);
  for(const query of ['eventId=','eventId=UPPER','eventId=x&eventId=x','eventId=x&limit=1','eventId='+ 'a'.repeat(121),Array.from({length:201},(_,i)=>`eventId=e-${i}`).join('&')]){
    assert.equal((await fetch(`${base}/api/people/li-keyong/timeline?${query}`)).status,400,query.slice(0,80));
  }
  assert.equal(seen.length,1);
});
