import { ConverterBuilder } from 'opencc-js/core';
import * as Locale from 'opencc-js/preset/t2cn';

// Verified names in the archived Five Dynasties texts. Generic t2s turns 乾 into 干.
const historicalTerms = [
  ['乾祐', '乾祐'], ['乾化', '乾化'], ['乾寧', '乾宁'], ['乾符', '乾符'],
  ['乾德', '乾德'], ['乾和', '乾和'], ['乾貞', '乾贞'], ['乾亨', '乾亨'],
  ['乾元', '乾元'], ['乾明', '乾明'], ['乾象', '乾象'], ['乾文', '乾文'],
  ['乾福', '乾福'], ['乾乾', '乾乾'], ['乾功', '乾功'],
] as const;
const standard = Locale.configs?.t2s;
if (!standard) throw new Error('Missing Traditional-to-Simplified dictionary');

export const simplifyOriginal = ConverterBuilder({
  from: {},
  to: { cn: standard.conversionChain },
  configs: {
    t2s: {
      ...standard,
      conversionChain: standard.conversionChain.map((group, index, groups) =>
        index === groups.length - 1 ? [...group, historicalTerms] : group),
    },
  },
})({ from: 't', to: 'cn' });
