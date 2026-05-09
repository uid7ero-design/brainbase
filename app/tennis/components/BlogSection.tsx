'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ScrollFadeIn from './ScrollFadeIn';

type Post = {
  id: string; title: string; slug: string;
  excerpt: string | null; cover_image_url: string | null;
  published_at: string | null; author_name: string | null;
};

function formatDate(ts: string | null) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function BlogSection({ orgId }: { orgId: string }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [email, setEmail] = useState('');
  const [subState, setSubState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  useEffect(() => {
    fetch(`/api/tennis/blog?orgId=${orgId}`)
      .then(r => r.json())
      .then(d => setPosts((d.posts ?? []).slice(0, 3)))
      .catch(() => {});
  }, [orgId]);

  async function subscribe(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSubState('loading');
    const res = await fetch('/api/tennis/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), orgId }),
    });
    setSubState(res.ok ? 'done' : 'error');
  }

  if (posts.length === 0) return null;

  return (
    <section id="blog" className="py-20 px-6 bg-[#0a0a0a]">
      <div className="max-w-5xl mx-auto">
        <ScrollFadeIn className="mb-10 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <p className="text-green-500 text-sm font-semibold uppercase tracking-widest mb-3">From the court</p>
            <h2 className="text-4xl md:text-5xl font-bold text-white tracking-tight">Latest Posts</h2>
          </div>
          <Link href="/tennis/blog" className="text-sm font-medium text-zinc-400 hover:text-white transition-colors shrink-0">
            All posts →
          </Link>
        </ScrollFadeIn>

        <ScrollFadeIn delay={80}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-14">
            {posts.map((post) => (
              <Link
                key={post.id}
                href={`/tennis/blog/${post.slug}`}
                className="group relative rounded-2xl border border-white/8 bg-white/4 overflow-hidden flex flex-col hover:-translate-y-1.5 hover:border-white/15 hover:bg-white/7 transition-all duration-300 shadow-md shadow-black/30"
              >
                {post.cover_image_url ? (
                  <div className="relative h-44 overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={post.cover_image_url} alt={post.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    <div className="absolute inset-0 bg-linear-to-t from-black/40 to-transparent" />
                  </div>
                ) : (
                  <div className="h-44 bg-linear-to-br from-green-500/10 to-green-500/5 flex items-center justify-center">
                    <svg className="w-8 h-8 text-green-500/30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10l6 6v8a2 2 0 01-2 2z"/></svg>
                  </div>
                )}
                <div className="flex flex-col gap-2 p-5 flex-1">
                  <span className="text-xs text-zinc-500">{formatDate(post.published_at)}</span>
                  <h3 className="text-base font-bold text-white leading-snug group-hover:text-green-400 transition-colors">{post.title}</h3>
                  {post.excerpt && <p className="text-zinc-500 text-sm leading-relaxed line-clamp-2">{post.excerpt}</p>}
                  <span className="mt-auto pt-3 text-xs font-medium text-green-500 group-hover:text-green-400">Read more →</span>
                </div>
              </Link>
            ))}
          </div>
        </ScrollFadeIn>

        {/* Subscribe */}
        <ScrollFadeIn delay={160}>
          <div className="rounded-2xl border border-green-500/20 bg-green-500/5 p-8 flex flex-col sm:flex-row items-center gap-6">
            <div className="flex-1 text-center sm:text-left">
              <h3 className="text-xl font-bold text-white mb-1">Stay in the loop</h3>
              <p className="text-zinc-400 text-sm">Tips, updates, and coaching news — straight to your inbox.</p>
            </div>
            {subState === 'done' ? (
              <div className="text-green-400 text-sm font-semibold">You&apos;re subscribed ✓</div>
            ) : (
              <form onSubmit={subscribe} className="flex gap-2 w-full sm:w-auto">
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  className="flex-1 sm:w-56 bg-black/40 border border-white/10 rounded-full px-4 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-green-500/50"
                />
                <button
                  type="submit"
                  disabled={subState === 'loading'}
                  className="bg-green-500 hover:bg-green-400 text-black font-semibold px-5 py-2.5 rounded-full text-sm transition-colors disabled:opacity-50 shrink-0"
                >
                  {subState === 'loading' ? '…' : 'Subscribe'}
                </button>
              </form>
            )}
            {subState === 'error' && <p className="text-red-400 text-xs">Something went wrong. Try again.</p>}
          </div>
        </ScrollFadeIn>
      </div>
    </section>
  );
}
