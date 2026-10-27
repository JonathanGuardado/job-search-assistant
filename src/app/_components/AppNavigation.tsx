import Link from 'next/link'
import styles from './app-navigation.module.css'

const DESTINATIONS = [
  { href: '/jobs', label: 'Jobs' },
  { href: '/applications', label: 'Applications' },
  { href: '/answers', label: 'Answers' },
  { href: '/resumes', label: 'Resume library' },
  { href: '/settings', label: 'Candidate settings' },
  { href: '/sources', label: 'Job sources' },
]

export function AppNavigation({ currentPath }: { readonly currentPath: string }) {
  return (
    <nav aria-label="Main navigation" className={styles.navigation}>
      {DESTINATIONS.map(({ href, label }) => (
        <Link key={href} href={href} className={styles.link}
          aria-current={currentPath === href ? 'page' : currentPath.startsWith(`${href}/`) ? 'location' : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  )
}
