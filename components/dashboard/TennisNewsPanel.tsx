import styles from './TennisNewsPanel.module.css'

type NewsItem = {
  title: string
  link: string
  pubDate: string
  description: string
}

async function fetchTennisNews(): Promise<NewsItem[]> {
  try {
    const res = await fetch(
      'https://feeds.bbci.co.uk/sport/tennis/rss.xml',
      {
        next: { revalidate: 1800 },
      }
    )

    if (!res.ok) return []

    const xml = await res.text()
    const items: NewsItem[] = []

    const itemBlocks =
      xml.match(/<item>([\s\S]*?)<\/item>/g) ?? []

    for (const block of itemBlocks.slice(0, 6)) {
      const title =
        block.match(
          /<title><!\[CDATA\[(.+?)\]\]><\/title>/
        )?.[1] ??
        block.match(/<title>(.+?)<\/title>/)?.[1] ??
        ''

      const link =
        block.match(/<link>(.+?)<\/link>/)?.[1] ??
        block.match(/<guid[^>]*>(.+?)<\/guid>/)?.[1] ??
        ''

      const pubDate =
        block.match(/<pubDate>(.+?)<\/pubDate>/)?.[1] ??
        ''

      const description = (
        block.match(
          /<description><!\[CDATA\[(.+?)\]\]><\/description>/
        )?.[1] ??
        block.match(
          /<description>(.+?)<\/description>/
        )?.[1] ??
        ''
      )
        .replace(/<[^>]+>/g, '')
        .slice(0, 150)

      if (title) {
        items.push({
          title,
          link,
          pubDate,
          description,
        })
      }
    }

    return items
  } catch {
    return []
  }
}

function timeAgo(dateStr: string): string {
  try {
    const diff = Date.now() - new Date(dateStr).getTime()

    const minutes = Math.floor(diff / 60000)

    if (minutes < 1) return 'Just now'
    if (minutes < 60) return `${minutes}m ago`

    const hours = Math.floor(diff / 3600000)

    if (hours < 24) return `${hours}h ago`

    const days = Math.floor(hours / 24)

    return `${days}d ago`
  } catch {
    return ''
  }
}

const VISIBLE_ITEM_COUNT = 4

export default async function TennisNewsPanel() {
  const items = (
    await fetchTennisNews()
  ).slice(0, VISIBLE_ITEM_COUNT)

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>
            External Intelligence
          </div>

          <h2 className={styles.title}>
            Tennis News
          </h2>
        </div>

        <div className={styles.source}>
          <span className={styles.sourceDot} aria-hidden="true" />
          BBC Sport
        </div>
      </header>

      {items.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon} aria-hidden="true">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            >
              <path d="M4 5h16v14H4z" />
              <path d="M8 9h8M8 13h5" />
            </svg>
          </div>

          <div className={styles.emptyTitle}>
            No news available
          </div>

          <div className={styles.emptyCopy}>
            Tennis headlines will appear here when the feed is available.
          </div>
        </div>
      ) : (
        <ul className={styles.list}>
          {items.map((item, index) => (
            <li key={`${item.link}-${index}`}>
              <a
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.item}
              >
                <div className={styles.marker} aria-hidden="true">
                  <span>
                    {String(index + 1).padStart(2, '0')}
                  </span>
                </div>

                <div className={styles.copy}>
                  <div className={styles.top}>
                    <h3 className={styles.itemTitle}>
                      {item.title}
                    </h3>

                    <span className={styles.time}>
                      {timeAgo(item.pubDate)}
                    </span>
                  </div>

                  {item.description && (
                    <p className={styles.description}>
                      {item.description}
                      {item.description.length >= 150
                        ? '…'
                        : ''}
                    </p>
                  )}
                </div>

                <span className={styles.arrow} aria-hidden="true">
                  ↗
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      <footer className={styles.footer}>
        <div className={styles.footerCopy}>
          News feed refreshed automatically.
        </div>

        <a
          href="https://www.bbc.com/sport/tennis"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.footerLink}
        >
          Open BBC Tennis
          <span aria-hidden="true">↗</span>
        </a>
      </footer>
    </section>
  )
}
