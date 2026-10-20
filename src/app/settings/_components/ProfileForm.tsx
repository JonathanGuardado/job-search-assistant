'use client'

import { useState, type ReactNode } from 'react'
import {
  CandidateProfileFormSchema, CURRENCIES, EMPLOYMENT_TYPES, profileFormInput, salaryToInput,
  type CandidateProfile, type ConstraintField,
} from '@/modules/profiles'
import { saveProfileAction } from '../actions'
import styles from '../settings.module.css'

function Constraint({ field, label, hint, profile, children }: {
  readonly field: ConstraintField
  readonly label: string
  readonly hint?: string
  readonly profile: CandidateProfile | null
  readonly children: ReactNode
}) {
  const isAlwaysHard = field === 'workAuthorizations' || field === 'willingToRelocate'
  return (
    <fieldset className={styles.constraint}>
      <legend>{label}</legend>
      <div className={styles.control}>{children}{hint && <p className={styles.hint}>{hint}</p>}</div>
      <div className={styles.mode}>
        {isAlwaysHard ? <><input type="hidden" name={`mode.${field}`} value="hard" /><strong>Always required</strong><p>Authorization and relocation are firm eligibility constraints.</p></> : (
          <><label>How to apply this
            <select name={`mode.${field}`} defaultValue={profile?.constraintModes[field] ?? 'preferred'}>
              <option value="preferred">Preferred</option><option value="hard">Required</option>
            </select>
          </label><p>Required can exclude jobs. Preferred affects matching and concerns.</p></>
        )}
      </div>
    </fieldset>
  )
}

export function ProfileForm({ profile }: { readonly profile: CandidateProfile | null }) {
  const [errors, setErrors] = useState<string[]>([])
  const [authorizations, setAuthorizations] = useState((profile?.workAuthorizations ?? []).map((entry, key) => ({ ...entry, key })))
  const [nextKey, setNextKey] = useState(authorizations.length)
  const defaults = profile
  const row = (field: ConstraintField, label: string, children: ReactNode, hint?: string) => (
    <Constraint field={field} label={label} profile={profile} {...(hint ? { hint } : {})}>{children}</Constraint>
  )
  const text = (field: 'country' | 'city' | 'timezone' | 'seniority', label: string, placeholder: string) => (
    <input name={field} aria-label={label} defaultValue={defaults?.[field] ?? ''} placeholder={placeholder} required />
  )
  const list = (field: 'allowedRegions' | 'targetRoles' | 'preferredTech' | 'excludedTech' | 'excludedCompanies' | 'excludedIndustries', label: string) => (
    <textarea name={field} aria-label={label} rows={2} defaultValue={defaults?.[field].join(', ') ?? ''} />
  )
  return (
    <form action={saveProfileAction} onSubmit={(event) => {
      const parsed = CandidateProfileFormSchema.safeParse(profileFormInput(new FormData(event.currentTarget)))
      if (!parsed.success) { event.preventDefault(); setErrors(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)) }
      else setErrors([])
    }}>
      {errors.length > 0 && <div className={styles.error} role="alert"><strong>Check these fields before saving:</strong><ul>{errors.map((error, index) => <li key={index}>{error}</li>)}</ul></div>}
      <section className={styles.section}>
        <h2>Location and authorization</h2>
        {row('country', 'Country', text('country', 'Country', 'Two-letter code, e.g. SV'))}
        {row('city', 'City', text('city', 'City', 'Your city'))}
        {row('timezone', 'Timezone', text('timezone', 'Timezone', 'America/El_Salvador'))}
        {row('workAuthorizations', 'Work authorizations', <>
          {authorizations.map((authorization) => <div className={styles.authorization} key={authorization.key}>
            <label>Country<input name="authorizationCountry" defaultValue={authorization.country} placeholder="Country code" required /></label>
            <label>Authorization type<input name="authorizationType" defaultValue={authorization.type} placeholder="Your authorization type" required /></label>
            <label>Expires (optional)<input name="authorizationExpiresAt" type="date" defaultValue={authorization.expiresAt ?? ''} /></label>
            <button type="button" aria-label={`Remove authorization ${authorization.key + 1}`} onClick={() => setAuthorizations((rows) => rows.filter((entry) => entry.key !== authorization.key))}>Remove</button>
          </div>)}
          <button type="button" onClick={() => { setAuthorizations((rows) => [...rows, { key: nextKey, country: '', type: '' }]); setNextKey((key) => key + 1) }}>Add authorization</button>
        </>, 'Only add authorizations you actually hold. Leave the list empty if none apply.')}
        {row('willingToRelocate', 'Relocation', <label className={styles.checkbox}><input name="willingToRelocate" type="checkbox" defaultChecked={defaults?.willingToRelocate ?? false} />I am willing to relocate</label>)}
      </section>
      <section className={styles.section}>
        <h2>Compensation</h2>
        {row('salaryCurrency', 'Currency', <select name="salaryCurrency" aria-label="Salary currency" defaultValue={defaults?.salaryCurrency ?? ''} required><option value="" disabled>Choose a currency</option>{CURRENCIES.map((currency) => <option value={currency} key={currency}>{currency}</option>)}</select>)}
        {row('salaryFloorMinor', 'Minimum salary', <input name="salaryFloor" aria-label="Minimum salary" inputMode="decimal" defaultValue={defaults ? salaryToInput(defaults.salaryFloorMinor, defaults.salaryCurrency) : ''} />, 'Use the selected currency, without commas. Leave blank if you have no minimum.')}
      </section>
      <section className={styles.section}>
        <h2>Roles and seniority</h2>
        {row('targetRoles', 'Target roles', list('targetRoles', 'Target roles'), 'Separate roles with commas or new lines.')}
        {row('seniority', 'Seniority', text('seniority', 'Seniority', 'Your target level'))}
      </section>
      <section className={styles.section}>
        <h2>Work arrangement</h2>
        {row('allowedRegions', 'Allowed regions', list('allowedRegions', 'Allowed regions'), 'Separate worldwide, latam, emea, apac, namer, or two-letter country codes with commas.')}
        {row('employmentTypes', 'Employment arrangements', <div className={styles.options}>{EMPLOYMENT_TYPES.map((kind) => <label className={styles.checkbox} key={kind}><input type="checkbox" name="employmentTypes" value={kind} defaultChecked={defaults?.employmentTypes.includes(kind) ?? false} />{kind === 'eor' ? 'Employer of record (EOR)' : kind === 'employee' ? 'Employee' : 'Contractor'}</label>)}</div>)}
      </section>
      <section className={styles.section}>
        <h2>Technology preferences</h2>
        {row('preferredTech', 'Preferred technologies', list('preferredTech', 'Preferred technologies'), 'Separate technologies with commas or new lines.')}
        {row('excludedTech', 'Excluded technologies', list('excludedTech', 'Excluded technologies'))}
      </section>
      <section className={styles.section}>
        <h2>Company exclusions</h2>
        {row('excludedCompanies', 'Excluded companies', list('excludedCompanies', 'Excluded companies'), 'Separate companies with commas or new lines.')}
        {row('excludedIndustries', 'Excluded industries', list('excludedIndustries', 'Excluded industries'))}
      </section>
      <div className={styles.footer}><p>These settings are saved for your profile. Job assessment will use them when that pipeline is connected.</p><button className={styles.primary} type="submit">Save profile</button></div>
    </form>
  )
}
