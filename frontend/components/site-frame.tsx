'use client';

import { usePathname } from 'next/navigation';

export function SiteFrame(): React.ReactElement | null {
  const pathname = usePathname();
  if (pathname.startsWith('/app')) return null;
  return (
    <>
      <div className="site-frame site-frame--top" aria-hidden="true" />
      <div className="site-frame site-frame--bottom" aria-hidden="true" />
      <div className="site-frame site-frame--left" aria-hidden="true" />
      <div className="site-frame site-frame--right" aria-hidden="true" />
    </>
  );
}