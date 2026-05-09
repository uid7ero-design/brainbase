import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import Nav from '../components/Nav';

const LD_ORG = process.env.LD_TENNIS_ORG_ID ?? '';

function formatDate(ts: Date | null) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export const metadata = { title: 'Blog – LD Tennis Coaching' };

export default async function BlogPage() {
  const posts = LD_ORG ? await prisma.blogPost.findMany({
    where: { organisation_id: LD_ORG, published: true },
    orderBy: { published_at: 'desc' },
  }) : [];

  return (
    <>
      <Nav />
      <div className="min-h-screen bg-[#0a0a0a] relative">

        {/* Court background — full-width, container clips to ~55vh */}
        <div className="absolute inset-x-0 top-0 h-[55vh] overflow-hidden pointer-events-none">
          <svg
            viewBox="0 0 780 360"
            className="w-full opacity-[0.11]"
            style={{ height: 'auto', display: 'block' }}
            aria-hidden
          >
            <rect x="0" y="0" width="780" height="360" fill="none" stroke="#4ade80" strokeWidth="2" />
            <line x1="0"   y1="45"  x2="780" y2="45"  stroke="#4ade80" strokeWidth="1.5" />
            <line x1="0"   y1="315" x2="780" y2="315" stroke="#4ade80" strokeWidth="1.5" />
            <line x1="390" y1="0"   x2="390" y2="360" stroke="#4ade80" strokeWidth="2.5" />
            <line x1="180" y1="45"  x2="180" y2="315" stroke="#4ade80" strokeWidth="1.5" />
            <line x1="570" y1="45"  x2="570" y2="315" stroke="#4ade80" strokeWidth="1.5" />
            <line x1="180" y1="180" x2="390" y2="180" stroke="#4ade80" strokeWidth="1.5" />
            <line x1="390" y1="180" x2="570" y2="180" stroke="#4ade80" strokeWidth="1.5" />
            <line x1="0"   y1="173" x2="0"   y2="187" stroke="#4ade80" strokeWidth="2.5" />
            <line x1="780" y1="173" x2="780" y2="187" stroke="#4ade80" strokeWidth="2.5" />
          </svg>
          <div className="absolute inset-y-0 left-0  w-20 bg-linear-to-r from-[#0a0a0a] to-transparent" />
          <div className="absolute inset-y-0 right-0 w-20 bg-linear-to-l from-[#0a0a0a] to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-56 bg-linear-to-t from-[#0a0a0a] to-transparent" />
        </div>

        {/* Content */}
        <div className="relative max-w-4xl mx-auto px-6 pt-36 pb-20">
          <div className="mb-12">
            <Link href="/tennis" className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors">← Back to LD Tennis</Link>
            <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight mt-4 mb-2">From the Court</h1>
            <p className="text-zinc-500">Coaching tips, news, and updates from Luke.</p>
          </div>

          {posts.length === 0 ? (
            <p className="text-zinc-600 text-sm">No posts yet — check back soon.</p>
          ) : (
            <div className="flex flex-col gap-6">
              {posts.map(post => (
                <Link
                  key={post.id}
                  href={`/tennis/blog/${post.slug}`}
                  className="group grid grid-cols-1 md:grid-cols-[280px_1fr] rounded-2xl border border-white/8 bg-white/4 overflow-hidden hover:-translate-y-1 hover:border-white/15 transition-all duration-300"
                >
                  {post.cover_image_url ? (
                    <div className="relative h-48 md:h-auto overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={post.cover_image_url} alt={post.title} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    </div>
                  ) : (
                    <div className="hidden md:block h-full min-h-40 bg-linear-to-br from-green-500/10 to-transparent" />
                  )}
                  <div className="p-7 flex flex-col gap-3">
                    <span className="text-xs text-zinc-500">{formatDate(post.published_at)}</span>
                    <h2 className="text-xl font-bold text-white leading-snug group-hover:text-green-400 transition-colors">{post.title}</h2>
                    {post.excerpt && <p className="text-zinc-400 text-sm leading-relaxed">{post.excerpt}</p>}
                    <span className="mt-auto text-xs font-medium text-green-500">Read more →</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
