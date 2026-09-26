/**
 * Public surface of the jobs module — the reference shape every module copies.
 * Other modules import from here and nowhere deeper (docs/architecture.md).
 *
 * `jobs` is the shared catalog (no tenant). `job_user_states` is per-user and
 * reached only through functions that take a TenantScope.
 */

export { getJob, getJobUserState, insertJob, markJobSeen, setJobUserState } from './service.js'
export { jobSeenQueue } from './queues.js'

export {
  EmploymentTypeSchema,
  JobSchema,
  JobSeenPayloadSchema,
  JobUserStateSchema,
  JobUserStateValueSchema,
  LocationPolicySchema,
  NewJobSchema,
  SalarySchema,
} from './types.js'

export type {
  EmploymentType,
  Job,
  JobSeenPayload,
  JobUserState,
  JobUserStateValue,
  LocationPolicy,
  NewJob,
  Salary,
} from './types.js'
