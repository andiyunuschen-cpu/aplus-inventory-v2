'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function VersionSwitcher() {
  const pathname = usePathname()
  const isV3 = pathname.startsWith('/v3')

  return (
    <div className="fixed bottom-3 right-3 z-50">
      <Link
        href={isV3 ? '/' : '/v3'}
        className="flex items-center gap-1.5 bg-slate-900/90 hover:bg-black text-white px-3 py-1.5 rounded-full shadow-lg text-[11px] font-bold transition-all border border-slate-700/80 backdrop-blur-sm hover:scale-105 active:scale-95"
      >
        <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse flex-shrink-0" />
        <span>{isV3 ? '← V1' : '⚡ V3'}</span>
        <span className="hidden sm:inline">
          {isV3 ? ' (Legacy)' : ' (Dashboard)'}
        </span>
      </Link>
    </div>
  )
}