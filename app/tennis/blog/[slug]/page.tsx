import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import Link from 'next/link';

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

  return (
    <div className="min-h-screen bg-[#0a0a0a]">

      {/* Hero image — full bleed, sits behind the nav */}
      {post.cover_image_url ? (
        <div className="relative w-full h-72 md:h-120 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={post.cover_image_url}
            alt={post.title}
            className="absolute inset-0 w-full h-full object-cover"
          />
          {/* fade to page background at bottom */}
          <div className="absolute inset-0 bg-linear-to-t from-[#0a0a0a] via-[#0a0a0a]/30 to-transparent" />
        </div>
      ) : (
        /* spacer so content starts below nav when there's no image */
        <div className="h-28" />
      )}

      <div className="max-w-3xl mx-auto px-6 pb-24">
        {/* Back link — floats over the image fade */}
        <div className={post.cover_image_url ? '-mt-10 mb-8' : 'pt-8 mb-8'}>
          <Link href="/tennis/blog" className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors">← All posts</Link>
        </div>

        <article>
          <div className="flex items-center gap-3 mb-5 text-sm text-zinc-500">
            <span>{formatDate(post.published_at)}</span>
            {post.author_name && <><span>·</span><span>{post.author_name}</span></>}
          </div>

          <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight leading-tight mb-5">{post.title}</h1>

          {post.excerpt && (
            <p className="text-xl text-zinc-400 leading-relaxed mb-8 border-l-2 border-green-500/40 pl-5">{post.excerpt}</p>
          )}

          <div className="space-y-5">
            {post.content.split('\n\n').map((para, i) => (
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
  );
}
