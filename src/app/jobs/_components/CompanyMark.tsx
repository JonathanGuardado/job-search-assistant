import { companyMark } from '../_lib/format'
import styles from '../jobs.module.css'

export function CompanyMark({ name, large = false }: { readonly name: string; readonly large?: boolean }) {
  const { letter, hue } = companyMark(name)
  return (
    <span aria-hidden="true" className={large ? `${styles.avatar} ${styles.avatarLarge}` : styles.avatar}
      style={{ background: `hsl(${hue} 70% 94%)`, color: `hsl(${hue} 45% 32%)` }}>
      {letter}
    </span>
  )
}
