import test from 'node:test';
import assert from 'node:assert/strict';
import {eventComparisonRoute, resolveEventComparisonRoute} from '../src/event-comparison-route.ts';
import {chapterRoute, libraryChapters, resolveReadingRoute, resolveRoute} from '../src/library.ts';
import {comparisonsForPerson} from '../src/event-comparison-data.ts';

test('the published comparison and its exact stages are reachable without restoring global historical navigation', () => {
  const route=eventComparisonRoute('baixiang','battle');
  assert.equal(resolveRoute('#'+route),route);
  assert.equal(resolveEventComparisonRoute(route).stageId,'battle');
  assert.equal(comparisonsForPerson('li-cunxu')[0].id,'baixiang');
  assert.deepEqual(comparisonsForPerson('unknown'),[]);
  for (const path of ['event-comparison/missing','event-comparison/baixiang?stage=missing','event-comparison/baixiang?stage=battle&stage=aftermath','event-comparison/baixiang?unexpected=1','event-comparison/baixiang?stage=battle?extra=1']) {
    assert.equal(resolveEventComparisonRoute(path),null);
    assert.equal(resolveRoute('#'+path),'eras');
  }
});

test('original context links survive refresh and return to the specific comparison stage safely', () => {
  const chapter=libraryChapters.find(item=>item.id==='old-v027');
  const returnTo=eventComparisonRoute('baixiang','battle');
  const route=chapterRoute(chapter,{paragraphId:'old-v027-p18',query:'',field:'both',returnTo});
  const target=resolveReadingRoute(route);
  assert.equal(target.chapter.id,'old-v027');
  assert.equal(target.focusParagraphId,'old-v027-p18');
  assert.equal(target.returnTo,returnTo);
  for(const invalid of ['https://evil.invalid/','event-comparison/baixiang?stage=forged','javascript:alert(1)']) {
    const bad=chapterRoute(chapter,{paragraphId:'old-v027-p18',query:'',field:'both',returnTo:invalid});
    assert.equal(resolveReadingRoute(bad).returnTo,undefined);
  }
});
