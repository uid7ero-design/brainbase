import { NextRequest } from 'next/server';
import fs   from 'fs';
import { readConfig } from '../../../../lib/brain/config';
import { syncVault }  from '../../../../lib/brain/watcher';
import { requireRole } from '../../../../lib/org';
import { resolveSafeNotePath } from '../../../../lib/brain/pathGuard';

export async function POST(req: NextRequest) {
  // The Brain vault is global, not organisation-scoped — super_admin only
  // until it becomes organisation-scoped (temporary containment).
  try { await requireRole('super_admin'); } catch { return Response.json({ error: 'Forbidden' }, { status: 403 }); }

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
  const fileName = `${safeTitle}.md`;

  const resolved = resolveSafeNotePath(cfg.vaultPath, folder, fileName);
  if (!resolved.ok) {
    return Response.json({ error: 'Invalid folder path' }, { status: 400 });
  }
  const { filePath, targetDir } = resolved;

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const content = `# ${title}\n\n*Created by Helena — ${new Date().toLocaleString()}*\n\n${body ?? ''}`;

  fs.writeFileSync(filePath, content, 'utf8');

  // Re-index the vault in background so the note is searchable immediately
  syncVault(cfg.vaultPath).catch(() => {});

  return Response.json({ ok: true, path: filePath, fileName });
}
