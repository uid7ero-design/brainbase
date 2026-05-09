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
    <div className="min-h-screen bg-[#0a0a0a] px-6 pt-28 pb-20">
      <div className="max-w-3xl mx-auto">
        <Link href="/tennis/blog" className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors">← All posts</Link>

        <article className="mt-8">
          {post.cover_image_url && (
            <div className="rounded-2xl overflow-hidden mb-8 aspect-[16/7]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={post.cover_image_url} alt={post.title} className="w-full h-full object-cover" />
            </div>
          )}

          <div className="flex items-center gap-3 mb-5 text-sm text-zinc-500">
            <span>{formatDate(post.published_at)}</span>
            {post.author_name && <><span>·</span><span>{post.author_name}</span></>}
          </div>

          <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight leading-tight mb-4">{post.title}</h1>

          {post.excerpt && (
            <p className="text-xl text-zinc-400 leading-relaxed mb-8 border-l-2 border-green-500/40 pl-5">{post.excerpt}</p>
          )}

          <div className="prose prose-invert prose-zinc prose-lg max-w-none">
            {post.content.split('\n\n').map((para, i) => (
              <p key={i} className="text-zinc-300 leading-relaxed mb-5 text-base">{para}</p>
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
