'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import styles from './app-navigation.module.css'

const DESTINATIONS = [
  { href: '/jobs', label: 'Jobs' },
  { href: '/applications', label: 'Applications' },
  { href: '/answers', label: 'Answers' },
  { href: '/resumes', label: 'Resumes' },
  { href: '/settings', label: 'Settings' },
  { href: '/sources', label: 'Sources' },
]

/** The bar above every page; it reads the path itself so pages do not pass it. */
export function AppNavigation() {
  const path = usePathname()
  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        <Link href="/jobs" className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">J</span>
          Job Seeker
        </Link>
        <nav aria-label="Main navigation" className={styles.navigation}>
          {DESTINATIONS.map(({ href, label }) => (
            <Link key={href} href={href} className={styles.link}
              aria-current={path === href ? 'page' : path.startsWith(`${href}/`) ? 'location' : undefined}>
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  )
}
