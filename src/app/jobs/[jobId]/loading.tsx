import styles from '../jobs.module.css'

/** Shown the moment a job is opened, while it loads. */
export default function JobLoading() {
  return (
    <main className={styles.page} aria-busy="true" aria-label="Loading job">
      <div className={styles.skeleton} style={{ width: 120, height: 14, marginBottom: 18 }} />
      <div className={styles.jobHeader}>
        <div className={`${styles.avatar} ${styles.avatarLarge} ${styles.skeleton}`} />
        <div>
          <div className={styles.skeleton} style={{ width: 140, height: 12 }} />
          <div className={styles.skeleton} style={{ width: '70%', height: 24, margin: '12px 0' }} />
          <div className={styles.skeleton} style={{ width: '45%', height: 12 }} />
        </div>
      </div>
      {[0, 1].map((index) => <div key={index} className={styles.section}><div className={styles.skeleton} style={{ height: 90 }} /></div>)}
    </main>
  )
}
