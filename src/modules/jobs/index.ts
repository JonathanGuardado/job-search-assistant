/**
 * Public surface of the jobs module — the reference shape every module copies.
 * Other modules import from here and nowhere deeper (docs/architecture.md).
 *
 * `jobs` is the shared catalog (no tenant), normalized from job-sources' raw capture
 * and deduplicated by fingerprint (decision 0008). `job_user_states` is per-user and
 * reached only through functions that take a TenantScope. Model-free.
 */

// Exported for foreign keys only. Only this module writes it.
export { jobs } from './schema.js'

export {
  closeUnseenJobs,
  getJob,
  getJobs,
  getJobUserState,
  listAssessableJobs,
  listJobUserStates,
  recordSightings,
  setJobUserState,
  upsertJobFromRaw,
} from './service.js'
export { jobNormalizeKey, jobNormalizeQueue } from './queues.js'

export {
  EmploymentTypeSchema,
  JobNormalizePayloadSchema,
  JobSchema,
  JobUserStateSchema,
  JobUserStateValueSchema,
  LocationPolicySchema,
  SalarySchema,
  SENIORITIES,
  SenioritySchema,
} from './types.js'

export type {
  EmploymentType,
  Job,
  JobNormalizePayload,
  JobUserState,
  JobUserStateValue,
  LocationPolicy,
  Salary,
  Seniority,
} from './types.js'
