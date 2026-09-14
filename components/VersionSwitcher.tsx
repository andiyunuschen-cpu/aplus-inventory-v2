'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function VersionSwitcher() {
  const pathname = usePathname()
  const isV3 = pathname.startsWith('/v3')

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <Link
        href={isV3 ? '/' : '/v3'}
        className="flex items-center gap-2 bg-slate-900 hover:bg-black text-white px-4 py-2.5 rounded-full shadow-xl text-xs font-bold transition-all border border-slate-700 hover:scale-105 active:scale-95"
      >
        <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
        {isV3 ? '← Switch to Legacy (V1)' : '⚡ Switch to V3 Dashboard'}
      </Link>
    </div>
  )
}