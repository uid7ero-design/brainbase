type Category = 'tech' | 'ai' | 'cyber';

interface Article {
  id:        string;
  title:     string;
  url:       string;
  source:    string;
  category:  Category;
  time:      string;       // ISO date string
  points?:   number;       // upvotes / score
  comments?: number;
}

interface Cache {
  articles:  Article[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: Cache | null = null;

// ── RSS feeds ──────────────────────────────────────────────────────────────
const RSS_FEEDS: { url: string; source: string; category: Category }[] = [
  { url: 'https://techcrunch.com/feed/',                    source: 'TechCrunch',      category: 'tech'  },
  { url: 'https://feeds.arstechnica.com/arstechnica/index', source: 'Ars Technica',    category: 'tech'  },
  { url: 'https://venturebeat.com/category/ai/feed/',       source: 'VentureBeat',     category: 'ai'    },
  { url: 'https://www.technologyreview.com/feed/',          source: 'MIT Tech Review', category: 'ai'    },
  { url: 'https://krebsonsecurity.com/feed/',               source: 'Krebs Security',  category: 'cyber' },
  { url: 'https://feeds.feedburner.com/TheHackersNews',     source: 'The Hacker News', category: 'cyber' },
];

// ── Reddit subreddits ──────────────────────────────────────────────────────
const REDDIT_SUBS: { sub: string; source: string; category: Category }[] = [
  { sub: 'technology',      source: 'r/technology',      category: 'tech'  },
  { sub: 'programming',     source: 'r/programming',     category: 'tech'  },
  { sub: 'artificial',      source: 'r/artificial',      category: 'ai'    },
  { sub: 'MachineLearning', source: 'r/MachineLearning', category: 'ai'    },
  { sub: 'netsec',          source: 'r/netsec',          category: 'cyber' },
  { sub: 'cybersecurity',   source: 'r/cybersecurity',   category: 'cyber' },
];

const ITEMS_PER_SOURCE = 4;
const UA = 'BrainBase/1.0 (news aggregator; contact uid7ero@gmail.com)';

// ── RSS helpers ────────────────────────────────────────────────────────────
function extractTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
  return m?.[1]?.trim() ?? '';
}

function extractAtomLink(chunk: string): string {
  const m =
    chunk.match(/<link[^>]+href="([^"]+)"[^>]*rel="alternate"/i) ||
    chunk.match(/<link[^>]+rel="alternate"[^>]+href="([^"]+)"/i) ||
    chunk.match(/<link[^>]+href="([^"]+)"/i);
  return m?.[1]?.trim() ?? '';
}

function cleanText(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, '').trim();
}

function parseRSS(xml: string, source: string, category: Category): Article[] {
  const out: Article[] = [];

  const rss = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = rss.exec(xml)) !== null && out.length < ITEMS_PER_SOURCE) {
    const chunk = m[1];
    const title = cleanText(extractTag(chunk, 'title'));
    const url   = cleanText(extractTag(chunk, 'link') || extractAtomLink(chunk));
    const date  = extractTag(chunk, 'pubDate') || extractTag(chunk, 'dc:date') || '';
    if (title && url) out.push({ id: url, title, url, source, category, time: date ? new Date(date).toISOString() : new Date().toISOString() });
  }

  if (!out.length) {
    const atom = /<entry[\s>]([\s\S]*?)<\/entry>/gi;
    while ((m = atom.exec(xml)) !== null && out.length < ITEMS_PER_SOURCE) {
      const chunk = m[1];
      const title = cleanText(extractTag(chunk, 'title'));
      const url   = extractAtomLink(chunk) || cleanText(extractTag(chunk, 'link'));
      const date  = extractTag(chunk, 'published') || extractTag(chunk, 'updated') || '';
      if (title && url) out.push({ id: url, title, url, source, category, time: date ? new Date(date).toISOString() : new Date().toISOString() });
    }
  }

  return out;
}

async function fetchRSS(feed: typeof RSS_FEEDS[number]): Promise<Article[]> {
  const res = await fetch(feed.url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseRSS(await res.text(), feed.source, feed.category);
}

// ── Reddit fetcher ─────────────────────────────────────────────────────────
async function fetchReddit(sub: typeof REDDIT_SUBS[number]): Promise<Article[]> {
  const res = await fetch(
    `https://www.reddit.com/r/${sub.sub}/top.json?t=day&limit=${ITEMS_PER_SOURCE}`,
    {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(7000),
    }
  );
  if (!res.ok) throw new Error(`Reddit HTTP ${res.status}`);

  const json = await res.json() as { data?: { children?: { data: Record<string, unknown> }[] } };
  const children = json.data?.children ?? [];

  return children
    .map(c => c.data)
    .filter(p => p.title && !p.stickied)
    .slice(0, ITEMS_PER_SOURCE)
    .map(p => ({
      id:       `reddit-${p.id}`,
      title:    String(p.title),
      // External link posts have a real url; self posts link to Reddit thread
      url:      String(p.is_self ? `https://reddit.com${p.permalink}` : (p.url || `https://reddit.com${p.permalink}`)),
      source:   sub.source,
      category: sub.category,
      time:     new Date((p.created_utc as number) * 1000).toISOString(),
      points:   p.score as number,
      comments: p.num_comments as number,
    }));
}

// ── Route handler ──────────────────────────────────────────────────────────
export async function GET() {
  const now = Date.now();

  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return Response.json({ articles: cache.articles, fetchedAt: cache.fetchedAt });
  }

  const [rssResults, redditResults] = await Promise.all([
    Promise.allSettled(RSS_FEEDS.map(fetchRSS)),
    Promise.allSettled(REDDIT_SUBS.map(fetchReddit)),
  ]);

  const articles: Article[] = [
    ...rssResults.flatMap(r => r.status === 'fulfilled' ? r.value : []),
    ...redditResults.flatMap(r => r.status === 'fulfilled' ? r.value : []),
  ];

  // Sort newest first
  articles.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  cache = { articles, fetchedAt: now };
  return Response.json({ articles, fetchedAt: now });
}
