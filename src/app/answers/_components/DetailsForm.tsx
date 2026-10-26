import type { ApplicantDetails } from '@/modules/application-answers'
import { saveDetailsAction } from '../actions'
import styles from '../answers.module.css'

export function DetailsForm({ details }: { readonly details: ApplicantDetails | null }) {
  return (
    <form action={saveDetailsAction}>
      <input type="hidden" name="back" value="/answers" />
      <div className={styles.detailsFields}>
        <label>First name<input name="firstName" autoComplete="given-name" maxLength={100} defaultValue={details?.firstName ?? ''} required /></label>
        <label>Last name<input name="lastName" autoComplete="family-name" maxLength={100} defaultValue={details?.lastName ?? ''} required /></label>
        <label>Email<input name="email" type="email" autoComplete="email" maxLength={320} defaultValue={details?.email ?? ''} required /></label>
        <label>Phone<input name="phone" type="tel" autoComplete="tel" maxLength={40} defaultValue={details?.phone ?? ''} /></label>
        <label>LinkedIn URL<input name="linkedinUrl" type="url" maxLength={2000} defaultValue={details?.linkedinUrl ?? ''} /></label>
        <label>GitHub URL<input name="githubUrl" type="url" maxLength={2000} defaultValue={details?.githubUrl ?? ''} /></label>
        <label>Website URL<input name="websiteUrl" type="url" maxLength={2000} defaultValue={details?.websiteUrl ?? ''} /></label>
      </div>
      <button type="submit">Save details</button>
      <p className={styles.muted}>Used for the standard fields of every application.</p>
    </form>
  )
}
