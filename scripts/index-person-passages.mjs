import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadLibrary } from '../content/library.mjs';
import { loadPassagePeople, originalSha256, personPassagesRoot, validatePersonPassageIndex } from '../content/person-passages.mjs';

const requireValue = (condition, message) => { if (!condition) throw new Error(`Invalid passage rules: ${message}`); };
const ranks = { mention: 1, record: 2, biography: 3 };
const narrativeContext = /[梁唐晉晋漢周軍將兵帝]|河東|克用|太祖|莊宗|明宗|節度|天祐|乾寧|光化|同光|長興|天成/;
const unqualifiedTitles = new Set(['太祖', '高祖', '末帝', '少帝']);
const qualifiedPrefix = /[唐漢晉晋周宋梁魏]/;

const chineseNumber = value => {
  if (value === '元' || value === '正') return 1;
  const digits = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (value.includes('十')) {
    const [tens, ones] = value.split('十');
    return (tens ? digits[tens] : 1) * 10 + (ones ? digits[ones] : 0);
  }
  return digits[value] ?? null;
};
const edictAction = /(?:敕|勅|詔)(?=曰|：|:|「|“|節文|令|賜|罷|授|禁|改|遣|命)|御札(?:曰|：|:|「|“)/u;
// The gap can contain the date and the explicitly recorded council's memorial;
// arbitrary intervening narration, another named subject, and place names stop it.
const dateToEdictGap = /^(?:[，、,。．\s]|[春夏秋冬]|閏?[正一二三四五六七八九十]+月|[一二三四五六七八九十]+日|[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥](?:朔|晦)?|中書門下奏|中書門下|太常禮院奏|奏|降|赦|大赦|赦書)*$/u;

export function inferRegnalEdictPeople(original, bookId, config) {
  if (!config?.bookIds.includes(bookId)) return [];
  const eras = [...new Set(config.periods.map(period => period.era))];
  const marker = new RegExp(`(?:後唐|唐|梁|晉|晋|漢|周)?(${eras.join('|')})([元一二三四五六七八九十]+)年`, 'gu');
  const matches = [...original.matchAll(marker)], found = new Set();
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i], start = match.index + match[0].length;
    const following = original.slice(start, Math.min(start + config.actionMaxDistance, matches[i + 1]?.index ?? original.length));
    const action = edictAction.exec(following);
    if (!action || !dateToEdictGap.test(following.slice(0, action.index))) continue;
    const year = chineseNumber(match[2]);
    const monthText = following.slice(0, action.index).match(/閏?([正一二三四五六七八九十]+)月/u)?.[1];
    const month = monthText ? chineseNumber(monthText) : null;
    for (const period of config.periods) {
      if (period.era === match[1] && year >= period.yearMin && year <= period.yearMax
        && (period.monthMin === undefined || month !== null && month >= period.monthMin && month <= period.monthMax)) {
        found.add(period.personId);
      }
    }
  }
  return [...found];
}

function hasScopedTerm(text, term, chronological = false) {
  if (chronological && /^(?:臣光曰|司馬光曰)/u.test(text)) return false;
  if (chronological && ['帝', '上'].includes(term)) {
    // Only an actual prose subject at a sentence/clause boundary: neither 皇帝/上帝
    // nor 上書/以上 nor a foreign ruler's title constitutes this local subject.
    const following = term === '帝'
      ? '[曰欲命以與為遣令聞幸還至親自不大嘗召問見性怒崩殂許受知引更數使既憂]'
      : '[曰欲命以與為遣令聞幸還至親自不嘗召問見怒許受知初疾]';
    return new RegExp(`(?:^|[，。；！？：」])${term}(?:[，。；！？：]|${following})`, 'u').test(text);
  }
  let at = text.indexOf(term);
  while (at >= 0) {
    const pastJinKing = chronological && term === '晉王'
      && (/^(?:李)?克用/u.test(text.slice(at + term.length)) || /[先故]/u.test(text[at - 1] ?? ''));
    if (!pastJinKing && (!unqualifiedTitles.has(term) || at === 0 || !qualifiedPrefix.test(text[at - 1]))) return true;
    at = text.indexOf(term, at + term.length);
  }
  return false;
}

function matchedKind(text, terms, defaultKind) {
  if (defaultKind === 'mention') return 'mention';
  for (const term of terms) {
    let at = text.indexOf(term);
    while (at >= 0) {
      if (!/^(?:本紀|列傳|紀年|實錄|實録|本傳|紀|傳)/u.test(text.slice(at + term.length))) return 'record';
      at = text.indexOf(term, at + term.length);
    }
  }
  return 'mention';
}

function maskOtherNames(text, rule) {
  const protectedRanges = [];
  for (const phrase of rule.protectedPhrases ?? []) {
    let at = text.indexOf(phrase);
    while (at >= 0) {
      protectedRanges.push([at, at + phrase.length]);
      at = text.indexOf(phrase, at + phrase.length);
    }
  }
  let hasOtherName = false;
  const masked = rule.excludedPhrases.reduce((result, phrase) => result.replaceAll(phrase, (match, offset) => {
    // A surname can also be the final character of a real title: the 王 in
    // 梁王宗訓 is not the Wang surname of the Former Shu commander 王宗訓.
    if (protectedRanges.some(([start, end]) => offset >= start && offset + match.length <= end)) return match;
    hasOtherName = true;
    return ' '.repeat(match.length);
  }), text);
  return { masked, hasOtherName };
}

export function validateChronologySubjects(input, library = loadLibrary()) {
  requireValue(input?.schemaVersion === 1 && Array.isArray(input.entries), 'chronology subject supplements');
  const personIds = new Set(loadPassagePeople().map(person => person.id));
  const paragraphs = new Map(library.chapters.flatMap(chapter => chapter.paragraphs.map(paragraph => [paragraph.id, { paragraph, chapter }])));
  const seen = new Set();
  for (const entry of input.entries) {
    const match = paragraphs.get(entry?.paragraphId), key = `${entry?.paragraphId}/${entry?.personId}`;
    requireValue(match && match.chapter.bookId === 'tongjian' && personIds.has(entry.personId) && entry.kind === 'record'
      && typeof entry.reason === 'string' && entry.reason.trim() && !seen.has(key), `chronology subject reference ${key}`);
    requireValue(typeof entry.expectedSha256 === 'string' && /^[a-f0-9]{64}$/u.test(entry.expectedSha256)
      && entry.expectedSha256 === originalSha256(match.paragraph.original), `chronology subject original ${entry.paragraphId}`);
    seen.add(key);
  }
  return input;
}

export function buildPersonPassageIndex(library = loadLibrary(), suppliedRules) {
  const rules = suppliedRules ?? JSON.parse(readFileSync(new URL('rules.json', personPassagesRoot), 'utf8'));
  requireValue(rules?.schemaVersion === 1 && rules.scope === 'current-archive', 'schema/scope');
  const people = loadPassagePeople(), personIds = new Set(people.map(person => person.id));
  requireValue(Array.isArray(rules.people) && rules.people.length === people.length
    && new Set(rules.people.map(rule => rule.personId)).size === people.length, 'people coverage');
  const chapters = new Map(library.chapters.map(chapter => [chapter.id, chapter]));
  const rulePeople = new Map();
  for (const rule of rules.people) {
    requireValue(personIds.has(rule.personId) && ['names', 'shortNames', 'titles', 'excludedPhrases'].every(key =>
      Array.isArray(rule[key]) && rule[key].every(term => typeof term === 'string' && term.length >= 2)), `names ${rule.personId}`);
    requireValue(rule.shortNames.every(term => [...term].length >= 2), `single-character name ${rule.personId}`);
    requireValue(![...rule.names, ...rule.shortNames, ...rule.titles].some(term => ['康君利', '安景思'].includes(term)), 'literary names');
    requireValue(rule.protectedPhrases === undefined || Array.isArray(rule.protectedPhrases) && rule.protectedPhrases.every(phrase =>
      typeof phrase === 'string' && rule.excludedPhrases.some(excluded => phrase.includes(excluded))), `protected name context ${rule.personId}`);
    rulePeople.set(rule.personId, rule);
  }
  const ranges = new Map();
  for (const [kind, entries] of [['section', rules.sections], ['chronology', rules.chronology]]) {
    requireValue(Array.isArray(entries), kind);
    for (const range of entries) {
      const chapter = chapters.get(range.chapterId);
      requireValue(chapter && personIds.has(range.personId) && Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end)
        && range.start > 0 && range.end >= range.start && range.end <= chapter.paragraphs.length, `range ${range.chapterId}`);
      requireValue(typeof range.startText === 'string' && range.startText.length > 0 && typeof range.endText === 'string' && range.endText.length > 0
        && chapter.paragraphs[range.start - 1].original.startsWith(range.startText)
        && chapter.paragraphs[range.end - 1].original.startsWith(range.endText), `range evidence ${range.chapterId}/${range.start}`);
      requireValue(kind === 'chronology' || (['biography', 'record', 'mention'].includes(range.kind) && typeof range.label === 'string'), 'range kind');
      requireValue(!range.terms || Array.isArray(range.terms) && range.terms.length > 0
        && range.terms.every(term => typeof term === 'string' && term.length > 0), 'range terms');
      const list = ranges.get(chapter.id) ?? []; list.push({ ...range, type: kind }); ranges.set(chapter.id, list);
    }
  }
  const exclusions = new Map();
  for (const exclusion of rules.titleExclusions) {
    const paragraph = library.chapters.flatMap(chapter => chapter.paragraphs).find(paragraph => paragraph.id === exclusion.paragraphId);
    requireValue(paragraph && personIds.has(exclusion.personId) && exclusion.terms.length > 0
      && exclusion.terms.every(term => paragraph.original.includes(term)) && typeof exclusion.reason === 'string', 'title exclusion evidence');
    exclusions.set(`${exclusion.paragraphId}/${exclusion.personId}`, exclusion.terms);
  }
  const edicts = rules.regnalEdicts;
  requireValue(edicts && Array.isArray(edicts.bookIds) && edicts.bookIds.every(id => library.catalog.books.some(book => book.id === id))
    && Number.isSafeInteger(edicts.actionMaxDistance) && edicts.actionMaxDistance > 0 && edicts.actionMaxDistance <= 80
    && Array.isArray(edicts.periods), 'regnal edict config');
  for (const period of edicts.periods) requireValue(personIds.has(period.personId) && typeof period.era === 'string' && /^[\p{Script=Han}]{2}$/u.test(period.era)
    && Number.isSafeInteger(period.yearMin) && Number.isSafeInteger(period.yearMax) && period.yearMin > 0 && period.yearMax >= period.yearMin
    && (period.monthMin === undefined || Number.isSafeInteger(period.monthMin) && Number.isSafeInteger(period.monthMax)
      && period.monthMin >= 1 && period.monthMax <= 12 && period.monthMax >= period.monthMin), 'regnal edict period');
  const supplements = validateChronologySubjects(JSON.parse(readFileSync(new URL('chronology-subjects.json', personPassagesRoot), 'utf8')), library);
  const supplementedParagraphs = new Map();
  for (const entry of supplements.entries) {
    const list = supplementedParagraphs.get(entry.paragraphId) ?? []; list.push(entry);
    supplementedParagraphs.set(entry.paragraphId, list);
  }
  const passages = [];
  // Every archive paragraph is visited. catalog.subjects is deliberately never read.
  const orderedChapters = [...library.chapters].sort((a, b) => a.bookId.localeCompare(b.bookId, 'en') || a.position - b.position);
  for (const chapter of orderedChapters) for (const paragraph of chapter.paragraphs) {
    const associated = new Map(); let label = null;
    const directKind = paragraph.original.startsWith('↑')
      || ([...paragraph.original].length <= 25 && !/[，。；！？：「」]/u.test(paragraph.original)) ? 'mention' : 'record';
    const add = (personId, kind) => {
      if (!associated.has(personId) || ranks[kind] > ranks[associated.get(personId)]) associated.set(personId, kind);
    };
    for (const rule of rules.people) {
      const { masked, hasOtherName } = maskOtherNames(paragraph.original, rule);
      // A checked paragraph may refer to a different person with the same name.
      const excludedTerms = exclusions.get(`${paragraph.id}/${rule.personId}`) ?? [];
      const fullNames = rule.names.filter(term => !excludedTerms.includes(term) && masked.includes(term));
      // A separately named contemporary can then be referred to by the same short
      // name throughout this paragraph (張知遠、張承祐、王宗訓、石/米君立).
      const shortNames = !hasOtherName && narrativeContext.test(masked)
        ? rule.shortNames.filter(term => !excludedTerms.includes(term) && masked.includes(term)) : [];
      const titles = rule.titles.filter(term => !excludedTerms.includes(term) && masked.includes(term));
      const matched = [...fullNames, ...shortNames, ...titles];
      if (matched.length) add(rule.personId, matchedKind(masked, matched, directKind));
    }
    for (const range of ranges.get(chapter.id) ?? []) {
      if (paragraph.position < range.start || paragraph.position > range.end) continue;
      const excludedTerms = exclusions.get(`${paragraph.id}/${range.personId}`) ?? [];
      if (range.terms && !range.terms.some(term => !excludedTerms.includes(term) && hasScopedTerm(paragraph.original, term, range.type === 'chronology'))) continue;
      add(range.personId, range.type === 'chronology' ? directKind : range.kind);
      if (range.kind === 'biography') label = range.label;
    }
    for (const personId of inferRegnalEdictPeople(paragraph.original, chapter.bookId, edicts)) add(personId, 'record');
    for (const entry of supplementedParagraphs.get(paragraph.id) ?? []) add(entry.personId, entry.kind);
    if (associated.size === 0) continue;
    passages.push({ id: `passage-${paragraph.id}`, chapterId: chapter.id,
      title: `${chapter.title}${label ? ` · ${label}` : ''} · 第 ${paragraph.position} 段`,
      spans: [{ paragraphId: paragraph.id, originalRevision: paragraph.revision,
        originalSha256: originalSha256(paragraph.original), start: 0, end: [...paragraph.original].length }],
      people: people.filter(person => associated.has(person.id)).map(person => ({ personId: person.id, kind: associated.get(person.id) })) });
  }
  return validatePersonPassageIndex({ schemaVersion: 1, scope: 'current-archive',
    coverage: { bookCount: library.catalog.books.length, chapterCount: library.chapters.length,
      paragraphCount: library.chapters.reduce((total, chapter) => total + chapter.paragraphs.length, 0) }, people, passages }, library);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const index = buildPersonPassageIndex(), serialized = `${JSON.stringify(index, null, 2)}\n`;
  const path = new URL('index.json', personPassagesRoot);
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8') !== serialized) throw new Error('Person passage index differs; regenerate with scripts/index-person-passages.mjs');
  } else writeFileSync(path, serialized);
  console.log(`Person passages: ${index.people.length} people; ${index.passages.length} shared paragraphs; ${index.passages.reduce((n, p) => n + p.people.length, 0)} associations; scanned ${index.coverage.paragraphCount} paragraphs.`);
}
