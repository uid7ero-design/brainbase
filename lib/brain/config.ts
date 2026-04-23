import fs   from 'fs';
import path  from 'path';

const CONFIG_FILE = path.join(process.cwd(), '.brainbase', 'config.json');

type BrainConfig = { vaultPath: string | null };

export function readConfig(): BrainConfig {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return { vaultPath: null };
  }
}

export function writeConfig(cfg: BrainConfig) {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}
