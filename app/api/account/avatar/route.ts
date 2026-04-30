import { NextRequest, NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import path from 'path';
import { getSession } from '@/lib/session';
import sql from '@/lib/db';

const MAX_BYTES = 3 * 1024 * 1024; // 3 MB
const ALLOWED   = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const EXT_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
  'image/gif':  'gif',
};

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get('file') as File | null;

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  if (!ALLOWED.has(file.type)) return NextResponse.json({ error: 'Only JPEG, PNG, WebP or GIF allowed' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File too large (max 3 MB)' }, { status: 400 });

  const ext      = EXT_MAP[file.type] ?? 'jpg';
  const filename = `${session.userId}.${ext}`;
  const filepath = path.join(process.cwd(), 'public', 'avatars', filename);

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filepath, buffer);

  const avatarUrl = `/avatars/${filename}?v=${Date.now()}`;

  try {
    await sql`UPDATE users SET avatar_url = ${avatarUrl}, updated_at = NOW() WHERE id = ${session.userId}`;
  } catch {
    // Column may not exist yet — try without updated_at
    try {
      await sql`UPDATE users SET avatar_url = ${avatarUrl} WHERE id = ${session.userId}`;
    } catch { /* ignore — file is saved, URL returned anyway */ }
  }

  return NextResponse.json({ success: true, avatarUrl });
}
