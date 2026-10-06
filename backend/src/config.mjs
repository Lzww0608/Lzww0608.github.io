import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export const defaultConfigPath = fileURLToPath(new URL('../.local/config.json', import.meta.url));
export function loadConfig() {
  return JSON.parse(readFileSync(process.env.HISTORY_CONFIG_FILE || defaultConfigPath, 'utf8'));
}
