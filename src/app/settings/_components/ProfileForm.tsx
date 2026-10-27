'use client'

import { useState, type ReactNode } from 'react'
import {
  CandidateProfileFormSchema, CURRENCIES, EMPLOYMENT_TYPES, ENGLISH_LEVELS, profileFormInput, salaryToInput, SPOKEN_LANGUAGES,
  type CandidateProfile, type ConstraintField,
} from '@/modules/profiles'
import { saveProfileAction } from '../actions'
import styles from '../settings.module.css'

const REGIONS = [
  ['worldwide', 'Anywhere (worldwide)'], ['latam', 'Latin America'], ['namer', 'North America (US and Canada)'],
  ['emea', 'Europe, Middle East and Africa'], ['apac', 'Asia-Pacific'],
] as const
const regionName = new Intl.DisplayNames('en', { type: 'region' })
const countryName = (code: string) => regionName.of(code) ?? code
// Every ISO 3166-1 alpha-2 code the runtime can name, so the list is predefined rather than typed.
const COUNTRIES = Array.from({ length: 26 * 26 }, (_, i) => String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26)))
  .filter((code) => { const name = regionName.of(code); return name !== undefined && name !== code && !/unknown/i.test(name) })
  .sort((a, b) => countryName(a).localeCompare(countryName(b)))
const TIMEZONES = Intl.supportedValuesOf('timeZone')
const languageName = new Intl.DisplayNames('en', { type: 'language' })
const ENGLISH_LEVEL_LABELS = {
  A1: 'A1 · Beginner', A2: 'A2 · Elementary', B1: 'B1 · Intermediate', B2: 'B2 · Upper intermediate',
  C1: 'C1 · Advanced', C2: 'C2 · Proficient', native: 'Native or bilingual',
} as const
const LANGUAGES = [...SPOKEN_LANGUAGES].sort((a, b) => (languageName.of(a) ?? a).localeCompare(languageName.of(b) ?? b))

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

export function ProfileForm({ profile, regionCountries }: {
  readonly profile: CandidateProfile | null
  /** Region → ISO codes, from the eligibility rule's table, so every option is one the rule understands. */
  readonly regionCountries: Readonly<Record<string, readonly string[]>>
}) {
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
        {row('country', 'Country', <select name="country" aria-label="Country" defaultValue={defaults?.country ?? ''} required><option value="" disabled>Choose your country</option>{COUNTRIES.map((code) => <option value={code} key={code}>{countryName(code)}</option>)}</select>, 'Where you live and work from.')}
        {row('city', 'City', text('city', 'City', 'Your city'))}
        {row('timezone', 'Timezone', <select name="timezone" aria-label="Timezone" defaultValue={defaults?.timezone ?? ''} required>
          <option value="" disabled>Choose your timezone</option>
          {defaults && !TIMEZONES.includes(defaults.timezone) && <option value={defaults.timezone}>{defaults.timezone} (current, not a standard zone)</option>}
          {TIMEZONES.map((zone) => <option value={zone} key={zone}>{zone.replaceAll('_', ' ')}</option>)}
        </select>, 'Pick your city’s zone, e.g. America/El Salvador. Abbreviations like CST shift with daylight saving.')}
        {row('workAuthorizations', 'Work authorizations', <>
          {authorizations.map((authorization) => <div className={styles.authorization} key={authorization.key}>
            <label>Country<input name="authorizationCountry" defaultValue={authorization.country} placeholder="Country code" required /></label>
            <label>Authorization type<input name="authorizationType" defaultValue={authorization.type} placeholder="Your authorization type" required /></label>
            <label>Expires (optional)<input name="authorizationExpiresAt" type="date" defaultValue={authorization.expiresAt ?? ''} /></label>
            <button type="button" aria-label={`Remove authorization ${authorization.key + 1}`} onClick={() => setAuthorizations((rows) => rows.filter((entry) => entry.key !== authorization.key))}>Remove</button>
          </div>)}
          <button type="button" onClick={() => { setAuthorizations((rows) => [...rows, { key: nextKey, country: '', type: '' }]); setNextKey((key) => key + 1) }}>Add authorization</button>
        </>, 'Only add authorizations you actually hold. Leave the list empty if none apply.')}
        <fieldset className={styles.constraint}>
          <legend>Citizenship</legend>
          <div className={styles.control}>
            {[0, 1].map((index) => <select key={index} name="citizenships" aria-label={index === 0 ? 'Citizenship' : 'Second citizenship'} defaultValue={defaults?.citizenships[index] ?? ''}>
              <option value="">{index === 0 ? 'Choose your citizenship' : 'No second citizenship'}</option>
              {COUNTRIES.map((code) => <option value={code} key={code}>{countryName(code)}</option>)}
            </select>)}
            <p className={styles.hint}>Application forms ask about citizenship and sponsorship. Without it, those questions wait for your answer.</p>
          </div>
          <div className={styles.mode}><strong>Used for application questions</strong><p>Never excludes a job by itself.</p></div>
        </fieldset>
        {row('willingToRelocate', 'Relocation', <label className={styles.checkbox}><input name="willingToRelocate" type="checkbox" defaultChecked={defaults?.willingToRelocate ?? false} />I am willing to relocate</label>)}
      </section>
      <section className={styles.section}>
        <h2>Languages</h2>
        <fieldset className={styles.constraint}>
          <legend>Languages you can work in</legend>
          <div className={styles.control}>
            <div className={styles.options}>{LANGUAGES.map((code) => <label className={styles.checkbox} key={code}><input type="checkbox" name="spokenLanguages" value={code} defaultChecked={defaults?.spokenLanguages.includes(code) ?? false} />{languageName.of(code) ?? code}</label>)}</div>
            <p className={styles.hint}>Select languages you could use at work. Matching flags postings that require a language you did not select.</p>
          </div>
          <div className={styles.mode}><strong>Used for matching</strong><p>Never excludes a job by itself.</p></div>
        </fieldset>
        <fieldset className={styles.constraint}>
          <legend>English level</legend>
          <div className={styles.control}>
            <select name="englishLevel" aria-label="English level" defaultValue={defaults?.englishLevel ?? ''}>
              <option value="">Not stated</option>
              {ENGLISH_LEVELS.map((level) => <option value={level} key={level}>{ENGLISH_LEVEL_LABELS[level]}</option>)}
            </select>
            <p className={styles.hint}>On the CEFR scale. Forms that ask your English level are answered from this.</p>
          </div>
          <div className={styles.mode}><strong>Used for application questions</strong><p>Never excludes a job by itself.</p></div>
        </fieldset>
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
        {row('allowedRegions', 'Where you can work', <>
          <div className={styles.options}>{REGIONS.map(([value, label]) => <label className={styles.checkbox} key={value}><input type="checkbox" name="allowedRegions" value={value} defaultChecked={defaults?.allowedRegions.includes(value) ?? false} />{label}</label>)}</div>
          {Object.entries(regionCountries).map(([region, codes]) => <details key={region}>
            <summary>Extra countries in {REGIONS.find(([value]) => value === region)?.[1]}</summary>
            <div className={styles.options}>{[...codes].sort((a, b) => countryName(a).localeCompare(countryName(b))).map((code) => <label className={styles.checkbox} key={code}><input type="checkbox" name="allowedRegions" value={code.toLowerCase()} defaultChecked={defaults?.allowedRegions.includes(code.toLowerCase()) ?? false} />{countryName(code)}</label>)}</div>
          </details>)}
        </>, 'Remote jobs hiring in a region you select, or in your own country, count as open to you. Select a single country only if you can legally work there.')}
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
      <div className={styles.footer}><p>Saving re-checks every open job against these settings in the background.</p><button className={styles.primary} type="submit">Save profile</button></div>
    </form>
  )
}
