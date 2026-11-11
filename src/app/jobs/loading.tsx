import styles from './jobs.module.css'

/** Shown the moment the list is opened, while its jobs load. */
export default function JobsLoading() {
  return (
    <main className={styles.page} aria-busy="true" aria-label="Loading jobs">
      <header className={styles.pageHeader}>
        <div><h1>Jobs</h1><div className={styles.skeleton} style={{ width: 360, height: 14, marginTop: 10 }} /></div>
      </header>
      <div className={styles.tabs}><div className={styles.skeleton} style={{ width: '100%', height: 34 }} /></div>
      <div className={styles.filter} style={{ display: 'block' }}><div className={styles.skeleton} style={{ height: 36 }} /></div>
      <div className={styles.list}>
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className={styles.card}>
            <div className={`${styles.avatar} ${styles.skeleton}`} />
            <div>
              <div className={styles.skeleton} style={{ width: 120, height: 12 }} />
              <div className={styles.skeleton} style={{ width: '60%', height: 16, margin: '10px 0' }} />
              <div className={styles.skeleton} style={{ width: '40%', height: 12 }} />
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
