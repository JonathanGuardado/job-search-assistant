import type { ApplicantDetails } from '@/modules/application-answers'
import { saveDetailsAction } from '../actions'
import styles from '../settings.module.css'

export function DetailsForm({ details }: { readonly details: ApplicantDetails | null }) {
  return (
    <form action={saveDetailsAction}>
      <section id="details" className={styles.section} aria-labelledby="details-heading">
        <h2 id="details-heading">Your details</h2>
        <div className={styles.detailsFields}>
          <label>First name<input name="firstName" autoComplete="given-name" maxLength={100} defaultValue={details?.firstName ?? ''} required /></label>
          <label>Last name<input name="lastName" autoComplete="family-name" maxLength={100} defaultValue={details?.lastName ?? ''} required /></label>
          <label>Email<input name="email" type="email" autoComplete="email" maxLength={320} defaultValue={details?.email ?? ''} required /></label>
          <label>Phone<input name="phone" type="tel" autoComplete="tel" maxLength={40} defaultValue={details?.phone ?? ''} /></label>
          <label>LinkedIn URL<input name="linkedinUrl" type="url" maxLength={2000} defaultValue={details?.linkedinUrl ?? ''} /></label>
          <label>GitHub URL<input name="githubUrl" type="url" maxLength={2000} defaultValue={details?.githubUrl ?? ''} /></label>
          <label>Website URL<input name="websiteUrl" type="url" maxLength={2000} defaultValue={details?.websiteUrl ?? ''} /></label>
        </div>
        <div className={styles.footer}><p>Used for the standard fields of every application. Saving these does not re-check your jobs.</p><button className={styles.primary} type="submit">Save details</button></div>
      </section>
    </form>
  )
}
