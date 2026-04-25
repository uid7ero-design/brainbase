import { NextRequest } from 'next/server';
import fs   from 'fs';
import path from 'path';
import { readConfig } from '../../../../lib/brain/config';
import { syncVault }  from '../../../../lib/brain/watcher';

export async function POST(req: NextRequest) {
  const { title, body, folder } = await req.json() as {
    title: string;
    body:  string;
    folder?: string;
  };

  if (!title?.trim()) {
    return Response.json({ error: 'Title required' }, { status: 400 });
  }

  const cfg = readConfig();
  if (!cfg.vaultPath) {
    return Response.json({ error: 'No vault configured' }, { status: 400 });
  }

  const safeTitle = title.replace(/[<>:"/\\|?*]/g, '-').trim();
  const timestamp = new Date().toISOString().slice(0, 10);

  const targetDir = folder
    ? path.join(cfg.vaultPath, folder)
    : cfg.vaultPath;

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const fileName = `${safeTitle}.md`;
  const filePath = path.join(targetDir, fileName);

  const content = `# ${title}\n\n*Created by Helena — ${new Date().toLocaleString()}*\n\n${body ?? ''}`;

  fs.writeFileSync(filePath, content, 'utf8');

  // Re-index the vault in background so the note is searchable immediately
  syncVault(cfg.vaultPath).catch(() => {});

  return Response.json({ ok: true, path: filePath, fileName });
}
