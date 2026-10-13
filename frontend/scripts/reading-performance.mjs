#!/usr/bin/env node
// Public-only browser benchmark. Raw network details belong in an ignored local output directory.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, ...value] = arg.replace(/^--/, '').split('=');
  return [key, value.join('=')];
}));
if (!args.cli || !args.out) throw new Error('Required: --cli=/path/playwright-cli.js --out=/ignored/local/path');
const root = resolve(import.meta.dirname, '../..');
const out = resolve(args.out);
mkdirSync(out, { recursive: true });
const mode = args.mode ?? 'normal';
if (!['normal', 'slow', 'backend-offline'].includes(mode)) throw new Error('Unknown condition');
const id = args.route ?? 'li-keyong';
const routes = {
  'li-keyong': { kind: 'timeline', hash: 'person-timeline/li-keyong', expectedEvents: 26, warmButton: '869 年 1 条记载' },
  baixiang: { kind: 'comparison', hash: 'event-comparison/baixiang?stage=battle', stage: 'battle', expectedSources: 18, warmStage: 'aftermath', warmTitle: '追击、战果与邢魏攻守', warmSources: 17 },
  huliu: { kind: 'comparison', hash: 'event-comparison/huliu?stage=counterattack', stage: 'counterattack', expectedSources: 19, warmStage: 'aftermath', warmTitle: '濮阳、德胜与战后影响', warmSources: 17 },
  jinyang: { kind: 'comparison', hash: 'event-comparison/jinyang?stage=relief', stage: 'relief', expectedSources: 14, warmStage: 'foundation', warmTitle: '册立、割地与晋安结局', warmSources: 23 },
};
const config = { ...routes[id], id, mode, base: args.base ?? 'http://127.0.0.1:5173/', timeout: +(args.timeout ?? 180000), warm: args.warm !== 'false' };
if (!config.kind) throw new Error('Unknown route');
if (config.kind === 'comparison') {
  const document = JSON.parse(readFileSync(resolve(root, `content/event-comparisons/${id}.json`), 'utf8'));
  const selected = new Set(['old', 'new', 'tongjian']);
  const selectedSourceIds = stageId => document.stages.find(stage => stage.id === stageId).sourceIds.filter(sourceId => selected.has(document.sources.find(source => source.id === sourceId).bookId));
  config.expectedSourceIds = selectedSourceIds(config.stage);
  config.warmSourceIds = selectedSourceIds(config.warmStage);
  if (config.expectedSourceIds.length !== config.expectedSources || config.warmSourceIds.length !== config.warmSources) throw new Error('Frozen benchmark source scope changed');
}
const browserCode = readFileSync(resolve(import.meta.dirname, 'reading-performance-browser.mjs'), 'utf8');
const snippet = browserCode.replace('null /* BENCHMARK_SETTINGS */', JSON.stringify(config));
const label = `${args.label ?? 'baseline'}-${mode}-${id}-${args.run ?? '1'}`;
const snippetPath = resolve(out, `${label}.browser.js`);
writeFileSync(snippetPath, snippet);
const result = spawnSync(process.execPath, [resolve(args.cli), `-s=${args.session ?? 'reading-performance'}`, '--raw', 'run-code', '--filename', snippetPath], {
  cwd: root, encoding: 'utf8', timeout: config.timeout + 120000, maxBuffer: 32 * 1024 * 1024,
});
writeFileSync(resolve(out, `${label}.cli.log`), `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
if (result.error || result.status !== 0) throw new Error(result.error?.message ?? `CLI failed (${result.status}): ${result.stderr}`);
const data = JSON.parse(result.stdout.trim());
writeFileSync(resolve(out, `${label}.json`), JSON.stringify({ label, recordedAt: new Date().toISOString(), ...data }, null, 2));
console.log(JSON.stringify({ label, firstReadableMs: data.marks.firstReadableMs, completeCurrentMs: data.marks.completeCurrentMs, linksReadyMs: data.marks.linksReadyMs, final: data.final, requests: data.network.summary, warm: data.warm && { switchMs: data.warm.switchMs, returnMs: data.warm.returnMs, requests: data.warm.requests }, output: resolve(out, `${label}.json`) }));
