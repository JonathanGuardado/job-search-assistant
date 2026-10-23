import { z } from 'zod'
import { CURRENCIES, salaryFromInput } from './salary.js'
import { CandidateProfileInputSchema, ConstraintModesSchema, WorkAuthorizationSchema } from './types.js'

const separatedList = z.string().max(20_000).transform((value) =>
  [...new Set(value.split(/[,\n]/).map((entry) => entry.trim()).filter(Boolean))],
)
const authorizations = z.array(z.object({ country: z.string(), type: z.string(), expiresAt: z.string() }))
  .max(50).transform((rows) => rows.filter((row) => row.country.trim() || row.type.trim() || row.expiresAt.trim())
    .map((row): z.input<typeof WorkAuthorizationSchema> => ({ country: row.country, type: row.type, ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}) })))
  .pipe(z.array(WorkAuthorizationSchema))

export const CandidateProfileFormSchema = CandidateProfileInputSchema.omit({ salaryFloorMinor: true }).extend({
  salaryFloor: z.string().max(40),
  salaryCurrency: z.string().refine((value) => CURRENCIES.includes(value), 'Choose a supported currency.'),
  workAuthorizations: authorizations,
  // Checkboxes: one value per selected region or country.
  allowedRegions: z.array(z.string().max(20)).max(300).transform((values) => [...new Set(values.map((v) => v.trim().toLowerCase()).filter(Boolean))]),
  spokenLanguages: z.array(z.string().max(10)).max(100).transform((values) => [...new Set(values)]),
  targetRoles: separatedList,
  preferredTech: separatedList,
  excludedTech: separatedList,
  excludedCompanies: separatedList,
  excludedIndustries: separatedList,
}).transform((form, ctx) => {
  const amount = salaryFromInput(form.salaryFloor, form.salaryCurrency)
  if (!amount.ok) {
    ctx.addIssue({ code: 'custom', message: amount.error.message, path: ['salaryFloor'] })
    return z.NEVER
  }
  const { salaryFloor: _amount, ...fields } = form
  return { ...fields, salaryFloorMinor: amount.value }
}).pipe(CandidateProfileInputSchema)

/** FormData is untrusted in both the browser and server action; the shared schema parses this shape. */
export function profileFormInput(form: FormData) {
  const countries = form.getAll('authorizationCountry')
  const types = form.getAll('authorizationType')
  const expirations = form.getAll('authorizationExpiresAt')
  return {
    country: form.get('country'), city: form.get('city'), timezone: form.get('timezone'),
    workAuthorizations: countries.map((country, index) => ({ country, type: types[index], expiresAt: expirations[index] })),
    willingToRelocate: form.get('willingToRelocate') === 'on',
    allowedRegions: form.getAll('allowedRegions'), employmentTypes: form.getAll('employmentTypes'),
    salaryFloor: form.get('salaryFloor'), salaryCurrency: form.get('salaryCurrency'),
    targetRoles: form.get('targetRoles'), seniority: form.get('seniority'),
    preferredTech: form.get('preferredTech'), excludedTech: form.get('excludedTech'),
    excludedCompanies: form.get('excludedCompanies'), excludedIndustries: form.get('excludedIndustries'),
    spokenLanguages: form.getAll('spokenLanguages'),
    constraintModes: Object.fromEntries(Object.keys(ConstraintModesSchema.shape).map((field) => [field, form.get(`mode.${field}`)])),
  }
}
