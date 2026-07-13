'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { OrlixaLockup } from './OrlixaMark';

const NAV = ['Product', 'AI Employees', 'Solutions', 'Pricing', 'Resources', 'Company'];

/** Sticky nav — transparent at top, glass (blur + hairline) once scrolled. */
export function DarkNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <motion.header
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'sticky top-0 z-50 h-[104px] transition-colors duration-300',
        scrolled ? 'border-b border-white/[0.08] bg-void/80 backdrop-blur-xl' : 'border-b border-transparent bg-transparent',
      )}
    >
      <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between px-8">
        <Link href="/" className="flex items-center">
          <OrlixaLockup height={100} />
        </Link>

        <nav className="hidden items-center gap-8 lg:flex">
          {NAV.map((item) => (
            <a
              key={item}
              href="#"
              className="text-[15px] font-medium text-zinc-400 transition-colors hover:text-white"
            >
              {item}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link href="/login" className="hidden text-[15px] font-medium text-zinc-300 hover:text-white sm:inline">
            Log in
          </Link>
          <Link
            href="/register"
            className="rounded-full bg-violet px-5 py-2.5 text-[15px] font-semibold text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)] transition-transform hover:scale-[1.03] hover:bg-violet-hover"
          >
            Get Started
          </Link>
        </div>
      </div>
    </motion.header>
  );
}
