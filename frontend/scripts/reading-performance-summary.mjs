#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, ...value] = arg.replace(/^--/, '').split('=');
  return [key, value.join('=')];
}));
if (!args.out) throw new Error('Required: --out=/ignored/local/path [--labels=baseline,after]');
const out = resolve(args.out);
const labels = (args.labels ?? 'baseline,after').split(',');
const median = values => { const sorted = values.filter(value => typeof value === 'number').sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length ? sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2 : null; };
const groups = new Map();
for (const file of readdirSync(out).filter(name => name.endsWith('.json'))) {
  const data = JSON.parse(readFileSync(resolve(out, file), 'utf8'));
  if (!data.settings || !labels.some(label => data.label?.startsWith(`${label}-`))) continue;
  const label = labels.find(label => data.label.startsWith(`${label}-`));
  const key = `${label}/${data.settings.mode}/${data.settings.id}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push({ file, data });
}
const rows = [...groups].map(([key, entries]) => {
  const [label, mode, route] = key.split('/');
  const results = entries.map(entry => entry.data);
  const metric = key => ({ median: median(results.map(result => result.marks[key])), min: Math.min(...results.map(result => result.marks[key] ?? Infinity)), max: Math.max(...results.map(result => result.marks[key] ?? -Infinity)) });
  return { label, mode, route, runs: entries.length, firstReadableMs: metric('firstReadableMs'), completeCurrentMs: metric('completeCurrentMs'), linksReadyMs: metric('linksReadyMs'), requests: median(results.map(result => result.network.summary.requests)), jsonRequests: median(results.map(result => result.network.summary.jsonRequests)), apiRequests: median(results.map(result => result.network.summary.apiRequests)), staticJsonRequests: median(results.map(result => result.network.summary.staticJsonRequests)), transferredBytes: median(results.map(result => result.network.summary.transferredBytes)), jsonTransferredBytes: median(results.map(result => result.network.requests.filter(item => item.url.includes('/api/') || new URL(item.url).pathname.endsWith('.json')).reduce((sum, item) => sum + (item.encodedDataLength ?? 0), 0))), unfinished: results.map(result => result.network.summary.unfinished), failures: results.map(result => result.network.summary.failed), timedOut: results.map(result => result.timedOut), warmSwitchMs: median(results.map(result => result.warm?.switchMs)), warmLinksReadyMs: median(results.map(result => result.warm?.switchLinksReadyMs)), warmReturnWith100msSettleMs: median(results.map(result => result.warm?.returnMs)), warmRequestCounts: results.map(result => result.warm?.requests.requests), warmNotModifiedCounts: results.map(result => result.warm?.requestDetails?.some(item => item.wireStatus !== undefined) ? result.warm.requestDetails.filter(item => item.wireStatus === 304).length : result.warm?.requests.requests === 0 ? 0 : null), files: entries.map(entry => entry.file), jsonUris: [...new Set(results.flatMap(result => result.network.jsonUris))] };
});
rows.sort((a, b) => labels.indexOf(a.label) - labels.indexOf(b.label) || ['normal', 'slow', 'backend-offline'].indexOf(a.mode) - ['normal', 'slow', 'backend-offline'].indexOf(b.mode) || ['li-keyong', 'baixiang', 'huliu', 'jinyang'].indexOf(a.route) - ['li-keyong', 'baixiang', 'huliu', 'jinyang'].indexOf(b.route));
const identity = JSON.parse(readFileSync(resolve(out, 'baseline-identity.json'), 'utf8'));
const notes = ['Independent Chromium playwright-cli reading-performance session; production bundle served on 127.0.0.1:5173.', 'Normal and slow conditions use the real current public API. Slow CDP network parameters: 150ms latency, 1.6Mbps down, 0.75Mbps up.', 'Backend-offline aborts only public GET API calls; static site stays reachable. No real home-network disconnection was measured.', 'Cold: full navigation, browser cache cleared and disabled, local public reading storage cleared. Warm: same-page stage/year change plus browser back; warm return includes a fixed 100ms position-settling interval.', 'First readable requires actual event summary plus evidence or current-stage original prose, not a heading. Complete current requires all 26 timeline events in final authoritative/archive state or all selected current-stage originals, full translation bindings and sentence triggers. Link readiness comes from the actual component readiness marker.', 'Transferred bytes are measured CDP encodedDataLength through network settlement; readiness-time counts remain in readySummary. Fixed shared image/main-bundle costs are included in totals and excluded from JSON-only totals.', 'Latest current API contents and response compression may vary slightly between runs; median and range are reported.'];
writeFileSync(resolve(out, 'summary.json'), JSON.stringify({ generatedAt: new Date().toISOString(), baselineSourceHeadProvidedByParent: identity.sourceHeadProvidedByParent, baselineDistFingerprint: identity.distFingerprint, notes, rows }, null, 2));
const lines = ['# 阅读性能测量', '', `基线源码提交：${identity.sourceHeadProvidedByParent}（由根任务提供）；dist SHA-256 指纹：${identity.distFingerprint}`, '', '| 构建 | 条件 | 入口 | 次数 | 首次可读中位 ms | 当前完整中位 ms | 联动ready中位 ms | 请求 / JSON | 传输 MB / JSON MB |', '|---|---|---|---:|---:|---:|---:|---:|---:|'];
for (const row of rows) lines.push(`| ${row.label} | ${row.mode} | ${row.route} | ${row.runs} | ${row.firstReadableMs.median} | ${row.completeCurrentMs.median} | ${row.linksReadyMs.median} | ${row.requests} / ${row.jsonRequests} | ${(row.transferredBytes / 1e6).toFixed(3)} / ${(row.jsonTransferredBytes / 1e6).toFixed(3)} |`);
lines.push('', ...notes.map(note => `- ${note}`), '', '全部请求、具体 JSON URI、运行参数、最终可读内容摘要及控件快照保存在同目录各次 JSON。');
writeFileSync(resolve(out, 'summary.md'), `${lines.join('\n')}\n`);
console.log(JSON.stringify({ groups: rows.length, runs: rows.reduce((sum, row) => sum + row.runs, 0), output: resolve(out, 'summary.md'), rows: rows.map(({ files, jsonUris, ...rest }) => rest) }));
