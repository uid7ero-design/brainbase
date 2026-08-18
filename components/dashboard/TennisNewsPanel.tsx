const FONT = "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

type NewsItem = { title: string; link: string; pubDate: string; description: string }

async function fetchTennisNews(): Promise<NewsItem[]> {
  try {
    const res = await fetch('https://feeds.bbci.co.uk/sport/tennis/rss.xml', {
      next: { revalidate: 1800 },
    })
    if (!res.ok) return []
    const xml = await res.text()
    const items: NewsItem[] = []
    const itemBlocks = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? []
    for (const block of itemBlocks.slice(0, 6)) {
      const title = block.match(/<title><!\[CDATA\[(.+?)\]\]><\/title>/)?.[1]
        ?? block.match(/<title>(.+?)<\/title>/)?.[1] ?? ''
      const link = block.match(/<link>(.+?)<\/link>/)?.[1]
        ?? block.match(/<guid[^>]*>(.+?)<\/guid>/)?.[1] ?? ''
      const pubDate = block.match(/<pubDate>(.+?)<\/pubDate>/)?.[1] ?? ''
      const description = (block.match(/<description><!\[CDATA\[(.+?)\]\]><\/description>/)?.[1]
        ?? block.match(/<description>(.+?)<\/description>/)?.[1] ?? '')
        .replace(/<[^>]+>/g, '').slice(0, 120)
      if (title) items.push({ title, link, pubDate, description })
    }
    return items
  } catch {
    return []
  }
}

function timeAgo(dateStr: string): string {
  try {
    const diff = Date.now() - new Date(dateStr).getTime()
    const h = Math.floor(diff / 3600000)
    if (h < 1) return `${Math.floor(diff / 60000)}m ago`
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
  } catch {
    return ''
  }
}

// How many articles are shown by default — a display-only cap, not a
// change to how many are fetched (fetchTennisNews still pulls up to 6 from
// the feed above; this just renders fewer of them so the panel stops
// dominating the lower half of the page). No expand/collapse control:
// this component has no client-side state today, and adding it would be
// more UI work than this polish round calls for.
const VISIBLE_ITEM_COUNT = 4

export default async function TennisNewsPanel() {
  const items = (await fetchTennisNews()).slice(0, VISIBLE_ITEM_COUNT)

  return (
    <div style={{
      background: 'rgba(255,255,255,.025)',
      border: '1px solid rgba(255,255,255,.07)',
      borderRadius: 14, overflow: 'hidden', fontFamily: FONT,
    }}>
      <div style={{
        padding: '14px 22px',
        borderBottom: '1px solid rgba(255,255,255,.07)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,.40)' }}>
          Tennis News
        </span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,.20)' }}>via BBC Sport</span>
      </div>

      {items.length === 0 ? (
        <div style={{ padding: '32px 22px', textAlign: 'center', color: 'rgba(255,255,255,.18)', fontSize: 12 }}>
          No news available right now.
        </div>
      ) : (
        <div>
          {items.map((item, i) => (
            <a
              key={i}
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'block',
                padding: '13px 22px',
                borderBottom: i === items.length - 1 ? 'none' : '1px solid rgba(255,255,255,.05)',
                textDecoration: 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: '#F5F7FA', lineHeight: 1.45, flex: 1 }}>
                  {item.title}
                </span>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,.22)', whiteSpace: 'nowrap', paddingTop: 2 }}>
                  {timeAgo(item.pubDate)}
                </span>
              </div>
              {item.description && (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.30)', marginTop: 4, lineHeight: 1.5 }}>
                  {item.description}{item.description.length >= 120 ? '…' : ''}
                </div>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
