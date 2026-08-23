const FONT =
  "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

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
    <section className="bb-news-panel">
      <header className="bb-news-header">
        <div>
          <div className="bb-news-eyebrow">
            External Intelligence
          </div>

          <div className="bb-news-title">
            Tennis News
          </div>
        </div>

        <div className="bb-news-source">
          <span className="bb-news-source-dot" />
          BBC Sport
        </div>
      </header>

      {items.length === 0 ? (
        <div className="bb-news-empty">
          <div className="bb-news-empty-icon">
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

          <div className="bb-news-empty-title">
            No news available
          </div>

          <div className="bb-news-empty-copy">
            Tennis headlines will appear here when the feed is available.
          </div>
        </div>
      ) : (
        <div className="bb-news-list">
          {items.map((item, index) => (
            <a
              key={`${item.link}-${index}`}
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className={`bb-news-item ${
                index === items.length - 1
                  ? 'bb-news-item-last'
                  : ''
              }`}
            >
              <div className="bb-news-item-marker">
                <span>
                  {String(index + 1).padStart(2, '0')}
                </span>
              </div>

              <div className="bb-news-item-copy">
                <div className="bb-news-item-top">
                  <h3 className="bb-news-item-title">
                    {item.title}
                  </h3>

                  <span className="bb-news-time">
                    {timeAgo(item.pubDate)}
                  </span>
                </div>

                {item.description && (
                  <p className="bb-news-description">
                    {item.description}
                    {item.description.length >= 150
                      ? '…'
                      : ''}
                  </p>
                )}
              </div>

              <span className="bb-news-arrow">
                ↗
              </span>
            </a>
          ))}
        </div>
      )}

      <footer className="bb-news-footer">
        <div className="bb-news-footer-copy">
          News feed refreshed automatically.
        </div>

        <a
          href="https://www.bbc.com/sport/tennis"
          target="_blank"
          rel="noopener noreferrer"
          className="bb-news-footer-link"
        >
          Open BBC Tennis
          <span>↗</span>
        </a>
      </footer>

      <style>{`
        .bb-news-panel {
          overflow: hidden;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,.07);
          background: rgba(255,255,255,.025);
          font-family: ${FONT};
        }

        .bb-news-header {
          min-height: 58px;
          padding: 12px 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          border-bottom:
            1px solid rgba(255,255,255,.055);
        }

        .bb-news-eyebrow {
          margin-bottom: 3px;
          font-size: 7px;
          line-height: 1.2;
          font-weight: 750;
          letter-spacing: .13em;
          text-transform: uppercase;
          color: rgba(167,139,250,.45);
        }

        .bb-news-title {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: .09em;
          text-transform: uppercase;
          color: rgba(255,255,255,.48);
        }

        .bb-news-source {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 8px;
          border-radius: 999px;
          border:
            1px solid rgba(255,255,255,.06);
          background:
            rgba(255,255,255,.025);
          color:
            rgba(255,255,255,.24);
          font-size: 8px;
          font-weight: 600;
          white-space: nowrap;
        }

        .bb-news-source-dot {
          width: 5px;
          height: 5px;
          flex-shrink: 0;
          border-radius: 999px;
          background:
            rgba(255,255,255,.32);
        }

        .bb-news-list {
          display: flex;
          flex-direction: column;
        }

        .bb-news-item {
          position: relative;
          min-height: 86px;
          display: flex;
          align-items: flex-start;
          gap: 14px;
          padding: 15px 20px;
          border-bottom:
            1px solid rgba(255,255,255,.045);
          text-decoration: none;
          transition:
            background .16s ease,
            transform .16s ease;
        }

        .bb-news-item:hover {
          background:
            rgba(255,255,255,.025);
        }

        .bb-news-item-last {
          border-bottom: none;
        }

        .bb-news-item-marker {
          width: 30px;
          height: 30px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
          border:
            1px solid rgba(139,92,246,.12);
          background:
            rgba(139,92,246,.045);
          color:
            rgba(167,139,250,.50);
          font-size: 8px;
          font-weight: 750;
          letter-spacing: .05em;
        }

        .bb-news-item-copy {
          flex: 1;
          min-width: 0;
        }

        .bb-news-item-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
        }

        .bb-news-item-title {
          flex: 1;
          min-width: 0;
          margin: 0;
          font-size: 12px;
          line-height: 1.45;
          font-weight: 600;
          color:
            rgba(245,247,250,.88);
          letter-spacing: -.01em;
          transition: color .15s ease;
        }

        .bb-news-item:hover
        .bb-news-item-title {
          color: #c4b5fd;
        }

        .bb-news-time {
          flex-shrink: 0;
          padding-top: 2px;
          font-size: 8px;
          line-height: 1.2;
          color:
            rgba(255,255,255,.22);
          white-space: nowrap;
        }

        .bb-news-description {
          max-width: 850px;
          margin: 5px 0 0;
          font-size: 10px;
          line-height: 1.55;
          color:
            rgba(255,255,255,.29);
        }

        .bb-news-arrow {
          flex-shrink: 0;
          padding-top: 3px;
          color:
            rgba(167,139,250,.24);
          font-size: 12px;
          transition:
            color .16s ease,
            transform .16s ease;
        }

        .bb-news-item:hover
        .bb-news-arrow {
          color:
            rgba(196,181,253,.70);
          transform:
            translate(2px,-2px);
        }

        .bb-news-footer {
          min-height: 46px;
          padding: 10px 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          border-top:
            1px solid rgba(255,255,255,.045);
          background:
            rgba(255,255,255,.012);
        }

        .bb-news-footer-copy {
          font-size: 8px;
          color:
            rgba(255,255,255,.20);
        }

        .bb-news-footer-link {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 8px;
          font-weight: 650;
          color:
            rgba(167,139,250,.55);
          text-decoration: none;
          transition: color .15s ease;
        }

        .bb-news-footer-link:hover {
          color: #c4b5fd;
        }

        .bb-news-empty {
          min-height: 190px;
          padding: 30px 22px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
        }

        .bb-news-empty-icon {
          width: 42px;
          height: 42px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 12px;
          border-radius: 11px;
          border:
            1px solid rgba(139,92,246,.14);
          background:
            rgba(139,92,246,.055);
          color:
            rgba(167,139,250,.60);
        }

        .bb-news-empty-title {
          margin-bottom: 5px;
          font-size: 12px;
          font-weight: 650;
          color:
            rgba(245,247,250,.70);
        }

        .bb-news-empty-copy {
          max-width: 300px;
          font-size: 10.5px;
          line-height: 1.55;
          color:
            rgba(255,255,255,.27);
        }

        @media (max-width: 620px) {
          .bb-news-header {
            padding-left: 15px;
            padding-right: 15px;
          }

          .bb-news-item {
            padding:
              14px 15px;
          }

          .bb-news-description {
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
          }

          .bb-news-footer {
            padding-left: 15px;
            padding-right: 15px;
          }
        }

        @media (max-width: 440px) {
          .bb-news-item-marker {
            display: none;
          }

          .bb-news-source {
            padding-left: 6px;
            padding-right: 6px;
          }

          .bb-news-item-top {
            gap: 10px;
          }

          .bb-news-footer-copy {
            display: none;
          }

          .bb-news-footer {
            justify-content: flex-end;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .bb-news-item,
          .bb-news-item-title,
          .bb-news-arrow,
          .bb-news-footer-link {
            transition: none !important;
          }
        }
      `}</style>
    </section>
  )
}