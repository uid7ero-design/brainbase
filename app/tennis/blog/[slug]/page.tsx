import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import Nav from '../../components/Nav';

const LD_ORG = process.env.LD_TENNIS_ORG_ID ?? '';

function formatDate(ts: Date | null) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = LD_ORG ? await prisma.blogPost.findFirst({
    where: { organisation_id: LD_ORG, slug, published: true },
  }) : null;

  if (!post) notFound();

  const paragraphs = post.content.split('\n\n').filter(p => p.trim());
  const bodyParagraphs = post.excerpt && paragraphs[0]?.trim() === post.excerpt.trim()
    ? paragraphs.slice(1)
    : paragraphs;

  return (
    <>
      <Nav />
      <div className="min-h-screen bg-[#0a0a0a] relative">

        {/* Court background — full-width SVG, container clips to ~55vh.
            Gives a "top-down half-court" feel: baselines, net, service boxes all visible. */}
        <div className="absolute inset-x-0 top-0 h-[55vh] overflow-hidden pointer-events-none">
          <svg
            viewBox="0 0 780 360"
            className="w-full opacity-[0.11]"
            style={{ height: 'auto', display: 'block' }}
            aria-hidden
          >
            {/* Outer doubles court */}
            <rect x="0" y="0" width="780" height="360" fill="none" stroke="#4ade80" strokeWidth="2" />
            {/* Singles sidelines — 4.5ft (45px) alleys */}
            <line x1="0"   y1="45"  x2="780" y2="45"  stroke="#4ade80" strokeWidth="1.5" />
            <line x1="0"   y1="315" x2="780" y2="315" stroke="#4ade80" strokeWidth="1.5" />
            {/* Net */}
            <line x1="390" y1="0"   x2="390" y2="360" stroke="#4ade80" strokeWidth="2.5" />
            {/* Service lines — 21ft (210px) each side of net */}
            <line x1="180" y1="45"  x2="180" y2="315" stroke="#4ade80" strokeWidth="1.5" />
            <line x1="570" y1="45"  x2="570" y2="315" stroke="#4ade80" strokeWidth="1.5" />
            {/* Centre service lines */}
            <line x1="180" y1="180" x2="390" y2="180" stroke="#4ade80" strokeWidth="1.5" />
            <line x1="390" y1="180" x2="570" y2="180" stroke="#4ade80" strokeWidth="1.5" />
            {/* Baseline centre marks */}
            <line x1="0"   y1="173" x2="0"   y2="187" stroke="#4ade80" strokeWidth="2.5" />
            <line x1="780" y1="173" x2="780" y2="187" stroke="#4ade80" strokeWidth="2.5" />
          </svg>
          <div className="absolute inset-y-0 left-0  w-20 bg-linear-to-r from-[#0a0a0a] to-transparent" />
          <div className="absolute inset-y-0 right-0 w-20 bg-linear-to-l from-[#0a0a0a] to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-56 bg-linear-to-t from-[#0a0a0a] to-transparent" />
        </div>

        {/* Content */}
        <div className="relative max-w-3xl mx-auto px-6 pt-32 pb-24">
          <Link href="/tennis/blog" className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors mb-10 inline-block">← All posts</Link>

          {post.cover_image_url && (
            <div className="mb-8 rounded-2xl overflow-hidden border border-white/8 shadow-xl shadow-black/60">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={post.cover_image_url} alt={post.title} className="w-full h-auto block" />
            </div>
          )}

          <article>
            <div className="flex items-center gap-3 mb-5 text-sm text-zinc-500">
              <span>{formatDate(post.published_at)}</span>
              {post.author_name && <><span>·</span><span>{post.author_name}</span></>}
            </div>
            <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight leading-tight mb-6">{post.title}</h1>
            {post.excerpt && (
              <p className="text-lg text-zinc-400 leading-relaxed mb-10 border-l-2 border-green-500/50 pl-5">{post.excerpt}</p>
            )}
            <div className="space-y-5">
              {bodyParagraphs.map((para, i) => (
                <p key={i} className="text-zinc-300 leading-relaxed text-base">{para}</p>
              ))}
            </div>
          </article>

          <div className="mt-16 pt-8 border-t border-white/8">
            <p className="text-zinc-500 text-sm mb-4">Want coaching from Luke?</p>
            <Link href="/tennis#contact" className="inline-flex items-center gap-2 bg-green-500 text-black font-semibold px-6 py-3 rounded-full hover:bg-green-400 transition-colors text-sm">
              Get in touch →
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
