import { mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { loadLibrary, libraryRoot } from '../../content/library.mjs';

const { catalog } = loadLibrary();
const target = new URL('../public/history/', import.meta.url);
rmSync(target, { recursive: true, force: true });
mkdirSync(new URL('chapters/', target), { recursive: true });
copyFileSync(new URL('catalog.json', libraryRoot), new URL('catalog.json', target));
for (const chapter of catalog.chapters) copyFileSync(new URL(`chapters/${chapter.id}.json`, libraryRoot), new URL(`chapters/${chapter.id}.json`, target));
console.log(`Prepared ${catalog.chapters.length} full chapters for local website reading.`);
