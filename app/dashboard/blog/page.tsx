'use client';

import { useEffect, useState, useRef } from 'react';

type Post = {
  id: string; title: string; slug: string; excerpt: string | null;
  cover_image_url: string | null; published: boolean; published_at: string | null;
  content: string; author_name: string | null; created_at: string;
};

type View = 'list' | 'edit';

const FONT = "var(--font-inter),-apple-system,sans-serif";

// ── HLNA writing assistant ──────────────────────────────────────────────────
function HlnaWriter({ title, onInsert }: { title: string; onInsert: (text: string) => void }) {
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);

  async function generate(type: string) {
    const q = type === 'custom' ? prompt.trim() : type;
    if (!q) return;
    setLoading(true);
    setResult('');
    const context = title ? `The blog post is titled: "${title}". ` : '';
    const fullPrompt = type === 'custom'
      ? `${context}${q}`
      : `${context}Write a ${q} for a tennis coaching blog post. Keep it friendly, practical, and specific to grassroots tennis coaching. About 150 words.`;

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: fullPrompt }] }),
    });
    const data = await res.json();
    setResult(data.response ?? '');
    setLoading(false);
  }

  return (
    <div style={{
      background: 'rgba(99,102,241,.05)', border: '1px solid rgba(99,102,241,.18)',
      borderRadius: 12, padding: 16, fontFamily: FONT,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 14, color: '#818cf8' }}>◈</span>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,.40)' }}>
          HLNA Writing Assistant
        </span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {['introduction', 'full post draft', 'tips section', 'closing paragraph'].map(t => (
          <button key={t} onClick={() => generate(t)} disabled={loading}
            style={{
              fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 20, cursor: 'pointer',
              background: 'rgba(99,102,241,.12)', border: '1px solid rgba(99,102,241,.25)',
              color: '#a5b4fc', fontFamily: FONT, transition: 'opacity .15s',
              opacity: loading ? .5 : 1,
            }}>
            {t}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && generate('custom')}
          placeholder="Or ask HLNA anything…"
          style={{
            flex: 1, background: 'rgba(0,0,0,.3)', border: '1px solid rgba(255,255,255,.08)',
            borderRadius: 8, padding: '7px 12px', fontSize: 12, color: '#F5F7FA',
            outline: 'none', fontFamily: FONT,
          }}
        />
        <button onClick={() => generate('custom')} disabled={loading || !prompt.trim()}
          style={{
            background: 'rgba(99,102,241,.22)', border: '1px solid rgba(99,102,241,.35)',
            borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 600,
            color: '#a5b4fc', cursor: 'pointer', fontFamily: FONT,
            opacity: loading || !prompt.trim() ? .5 : 1,
          }}>
          {loading ? '…' : 'Ask'}
        </button>
      </div>

      {result && (
        <div style={{ marginTop: 12, background: 'rgba(0,0,0,.3)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 9, padding: 12 }}>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,.75)', lineHeight: 1.7, margin: '0 0 10px', whiteSpace: 'pre-wrap' }}>
            {result}
          </p>
          <button onClick={() => { onInsert(result); setResult(''); }}
            style={{
              fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
              background: 'rgba(74,222,128,.12)', border: '1px solid rgba(74,222,128,.25)',
              color: '#4ade80', fontFamily: FONT,
            }}>
            Insert into post
          </button>
        </div>
      )}
    </div>
  );
}

// ── Editor ──────────────────────────────────────────────────────────────────
function Editor({ post, onSave, onDelete, onBack }: {
  post: Partial<Post> | null;
  onSave: (p: Partial<Post>) => void;
  onDelete?: (id: string) => void;
  onBack: () => void;
}) {
  const [title, setTitle]       = useState(post?.title ?? '');
  const [excerpt, setExcerpt]   = useState(post?.excerpt ?? '');
  const [content, setContent]   = useState(post?.content ?? '');
  const [imageUrl, setImageUrl]   = useState(post?.cover_image_url ?? '');
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [author, setAuthor]     = useState(post?.author_name ?? 'Luke Doughty');
  const [published, setPublished] = useState(post?.published ?? false);
  const [saving, setSaving]     = useState(false);
  const [deleting, setDeleting] = useState(false);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  async function handleImageFile(file: File) {
    setUploadErr('');
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/tennis/blog/upload-image', { method: 'POST', body: fd });
    const data = await res.json();
    setUploading(false);
    if (!res.ok) { setUploadErr(data.error ?? 'Upload failed'); return; }
    setImageUrl(data.url);
  }

  function insertText(text: string) {
    const ta = contentRef.current;
    if (!ta) { setContent(c => c + (c ? '\n\n' : '') + text); return; }
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const newVal = content.slice(0, start) + (start > 0 ? '\n\n' : '') + text + '\n\n' + content.slice(end);
    setContent(newVal);
    setTimeout(() => { ta.focus(); ta.setSelectionRange(start + text.length + 2, start + text.length + 2); }, 0);
  }

  async function save(pub?: boolean) {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    const finalPublished = pub ?? published;
    await onSave({ ...post, title, excerpt, content, cover_image_url: imageUrl, author_name: author, published: finalPublished });
    setPublished(finalPublished);
    setSaving(false);
  }

  const inp: React.CSSProperties = {
    width: '100%', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)',
    borderRadius: 9, padding: '10px 14px', fontSize: 13, color: '#F5F7FA',
    outline: 'none', fontFamily: FONT, boxSizing: 'border-box',
  };

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 24px 64px', fontFamily: FONT }}>
      <button onClick={onBack} style={{ fontSize: 12, color: 'rgba(255,255,255,.35)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 20, padding: 0 }}>
        ← All posts
      </button>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20 }}>
        {/* Main */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Post title…"
            style={{ ...inp, fontSize: 22, fontWeight: 700, padding: '12px 16px', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,.08)', borderRadius: 0, paddingLeft: 0 }} />

          <input value={excerpt} onChange={e => setExcerpt(e.target.value)} placeholder="Short excerpt / teaser (optional)…" style={inp} />

          <textarea
            ref={contentRef}
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="Write your post here… Use blank lines to separate paragraphs."
            rows={18}
            style={{ ...inp, resize: 'vertical', lineHeight: 1.75 }}
          />
        </div>

        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Actions */}
          <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,.25)', marginBottom: 12 }}>Publish</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 14 }}>
              <input type="checkbox" checked={published} onChange={e => setPublished(e.target.checked)}
                style={{ width: 14, height: 14, accentColor: '#22c55e' }} />
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,.60)' }}>Visible to public</span>
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button onClick={() => save()} disabled={saving || !title.trim() || !content.trim()}
                style={{
                  width: '100%', padding: '9px 0', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)',
                  color: 'rgba(255,255,255,.70)', cursor: 'pointer', fontFamily: FONT,
                  opacity: saving || !title.trim() || !content.trim() ? .5 : 1,
                }}>
                {saving ? 'Saving…' : 'Save draft'}
              </button>
              {!published && (
                <button onClick={() => save(true)} disabled={saving || !title.trim() || !content.trim()}
                  style={{
                    width: '100%', padding: '9px 0', borderRadius: 8, fontSize: 13, fontWeight: 700,
                    background: 'rgba(34,197,94,.15)', border: '1px solid rgba(34,197,94,.30)',
                    color: '#4ade80', cursor: 'pointer', fontFamily: FONT,
                    opacity: saving || !title.trim() || !content.trim() ? .5 : 1,
                  }}>
                  Publish
                </button>
              )}
            </div>
          </div>

          {/* Cover image */}
          <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,.25)', marginBottom: 10 }}>Cover Image</div>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = ''; }}
            />
            {imageUrl ? (
              <div style={{ position: 'relative' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="" style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 8 }} />
                <button
                  onClick={() => imageInputRef.current?.click()}
                  disabled={uploading}
                  style={{
                    position: 'absolute', bottom: 6, right: 6,
                    fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
                    background: 'rgba(0,0,0,.65)', border: '1px solid rgba(255,255,255,.18)',
                    color: 'rgba(255,255,255,.75)', fontFamily: FONT,
                  }}>
                  {uploading ? 'Uploading…' : 'Change'}
                </button>
                <button
                  onClick={() => setImageUrl('')}
                  style={{
                    position: 'absolute', top: 6, right: 6,
                    fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, cursor: 'pointer',
                    background: 'rgba(239,68,68,.20)', border: '1px solid rgba(239,68,68,.35)',
                    color: '#f87171', fontFamily: FONT,
                  }}>
                  ✕
                </button>
              </div>
            ) : (
              <button
                onClick={() => imageInputRef.current?.click()}
                disabled={uploading}
                style={{
                  width: '100%', padding: '24px 0', borderRadius: 8, cursor: uploading ? 'default' : 'pointer',
                  background: 'rgba(255,255,255,.02)', border: '1px dashed rgba(255,255,255,.14)',
                  color: 'rgba(255,255,255,.30)', fontSize: 12, fontFamily: FONT,
                  opacity: uploading ? .6 : 1,
                }}>
                {uploading ? 'Uploading…' : '+ Upload image'}
              </button>
            )}
            {uploadErr && (
              <p style={{ fontSize: 11, color: '#f87171', marginTop: 6, margin: '6px 0 0' }}>{uploadErr}</p>
            )}
          </div>

          {/* Author */}
          <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,.25)', marginBottom: 10 }}>Author</div>
            <input value={author} onChange={e => setAuthor(e.target.value)} style={{ ...inp, fontSize: 12 }} />
          </div>

          {/* HLNA */}
          <HlnaWriter title={title} onInsert={insertText} />

          {/* Delete */}
          {post?.id && onDelete && (
            <button
              onClick={async () => { if (!confirm('Delete this post?')) return; setDeleting(true); onDelete(post.id!); }}
              disabled={deleting}
              style={{
                width: '100%', padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 600,
                background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.20)',
                color: 'rgba(239,68,68,.70)', cursor: 'pointer', fontFamily: FONT,
              }}>
              {deleting ? 'Deleting…' : 'Delete post'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function BlogDashboard() {
  const [posts, setPosts]   = useState<Post[]>([]);
  const [view, setView]     = useState<View>('list');
  const [editing, setEditing] = useState<Partial<Post> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadPosts(); }, []);

  async function loadPosts() {
    setLoading(true);
    const res = await fetch('/api/me').then(r => r.json());
    const orgId = res.organisationId;
    if (!orgId) { setLoading(false); return; }
    const data = await fetch(`/api/tennis/blog?orgId=${orgId}`).then(r => r.json()).catch(() => ({ posts: [] }));
    // Also fetch drafts (need auth endpoint)
    const all = await fetch('/api/tennis/blog/all').then(r => r.json()).catch(() => null);
    setPosts(all?.posts ?? data.posts ?? []);
    setLoading(false);
  }

  async function handleSave(p: Partial<Post>) {
    const isNew = !p.id;
    const url  = isNew ? '/api/tennis/blog' : `/api/tennis/blog/${p.id}`;
    const method = isNew ? 'POST' : 'PATCH';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    });
    if (res.ok) { await loadPosts(); setView('list'); }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/tennis/blog/${id}`, { method: 'DELETE' });
    await loadPosts();
    setView('list');
  }

  if (view === 'edit') {
    return (
      <Editor
        post={editing}
        onSave={handleSave}
        onDelete={editing?.id ? handleDelete : undefined}
        onBack={() => setView('list')}
      />
    );
  }

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 24px 64px', fontFamily: FONT }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#F5F7FA', margin: '0 0 3px' }}>Blog Posts</h1>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,.25)' }}>Manage your LD Tennis blog</span>
        </div>
        <button
          onClick={() => { setEditing(null); setView('edit'); }}
          style={{
            fontSize: 13, fontWeight: 600, padding: '8px 18px', borderRadius: 9, cursor: 'pointer',
            background: 'rgba(34,197,94,.15)', border: '1px solid rgba(34,197,94,.30)',
            color: '#4ade80', fontFamily: FONT,
          }}>
          + New post
        </button>
      </div>

      {loading ? (
        <div style={{ color: 'rgba(255,255,255,.25)', fontSize: 13 }}>Loading…</div>
      ) : posts.length === 0 ? (
        <div style={{
          border: '1px dashed rgba(255,255,255,.10)', borderRadius: 14,
          padding: '48px 24px', textAlign: 'center',
          color: 'rgba(255,255,255,.25)', fontSize: 13,
        }}>
          No posts yet. Click <strong style={{ color: 'rgba(255,255,255,.45)' }}>+ New post</strong> to write your first.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {posts.map(post => (
            <div
              key={post.id}
              onClick={() => { setEditing(post); setView('edit'); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)',
                borderRadius: 12, padding: '14px 18px', cursor: 'pointer',
                transition: 'background .15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,.06)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,.03)')}
            >
              {post.cover_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={post.cover_image_url} alt="" style={{ width: 52, height: 52, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
              ) : (
                <div style={{ width: 52, height: 52, borderRadius: 8, background: 'rgba(255,255,255,.05)', flexShrink: 0 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#F5F7FA', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {post.title}
                </div>
                {post.excerpt && (
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,.30)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {post.excerpt}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20, letterSpacing: '.04em',
                  background: post.published ? 'rgba(34,197,94,.10)' : 'rgba(255,255,255,.06)',
                  color: post.published ? '#4ade80' : 'rgba(255,255,255,.35)',
                  border: `1px solid ${post.published ? 'rgba(34,197,94,.22)' : 'rgba(255,255,255,.10)'}`,
                }}>
                  {post.published ? 'Published' : 'Draft'}
                </span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,.22)' }}>Edit →</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
