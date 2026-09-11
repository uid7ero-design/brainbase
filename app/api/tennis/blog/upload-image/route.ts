import { NextRequest, NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { requireSession } from '@/lib/org';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED   = new Set(['image/jpeg', 'image/png', 'image/webp']);

const MAX_WIDTH  = 1200;
const MAX_HEIGHT = 800;

export async function POST(req: NextRequest) {
  // SEC-1B3: was raw getSession() — the JWT-only claim, never revalidated
  // against the DB. requireSession() (lib/org.ts) re-reads the caller's
  // current role/organisation/status from the database on every call, so
  // a since-deactivated, since-reassigned, or deleted user's still-valid
  // JWT can no longer write a resized image to disk under this gate.
  // Gated before any file read/resize/write, unchanged.
  try { await requireSession(); } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  const formData = await req.formData();
  const file = formData.get('file') as File | null;

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  if (!ALLOWED.has(file.type)) return NextResponse.json({ error: 'Only JPEG, PNG, or WebP allowed' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File too large (max 5 MB)' }, { status: 400 });

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.webp`;
  const filepath = path.join(process.cwd(), 'public', 'blog-images', filename);

  const buffer = Buffer.from(await file.arrayBuffer());
  const resized = await sharp(buffer)
    .resize(MAX_WIDTH, MAX_HEIGHT, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();

  await writeFile(filepath, resized);

  return NextResponse.json({ url: `/blog-images/${filename}` });
}
