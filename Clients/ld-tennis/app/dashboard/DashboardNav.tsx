'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { OrgConfig } from '@/lib/org'

export default function DashboardNav({ config }: { config: OrgConfig }) {
  const pathname = usePathname()

  return (
    <aside className="w-56 shrink-0 bg-white border-r border-gray-100 flex flex-col min-h-screen">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className="text-lg">🎾</span>
          <div>
            <p className="text-sm font-bold text-gray-900 leading-tight">{config.name}</p>
            <p className="text-[10px] text-gray-400 uppercase tracking-widest">HLNA</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {config.navItems.map(item => {
          const active = pathname === item.href ||
            (item.href !== '/dashboard' && pathname.startsWith(item.href))

          if (item.comingSoon) {
            return (
              <div
                key={item.href}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-gray-300 cursor-default select-none"
              >
                <span className="text-sm w-4 text-center">{item.icon}</span>
                <span className="text-sm flex-1">{item.label}</span>
                <span className="text-[9px] font-medium bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded uppercase tracking-wide">
                  Soon
                </span>
              </div>
            )
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                active
                  ? 'bg-green-50 text-green-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <span className="text-sm w-4 text-center">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-gray-100 space-y-2">
        <a
          href="/tennis"
          className="block text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          ← Landing page
        </a>
      </div>
    </aside>
  )
}
