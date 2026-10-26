/**
 * Public surface of the job-sources module: source adapters, polling, and the
 * verbatim raw capture that normalization (M1.5) replays. Model-free.
 *
 * The tables are exported for foreign keys only. Only this module writes them.
 */

export { applicationForms, jobSources, rawJobs } from './schema.js'

export {
  ADAPTER_KEYS,
  AdapterConfigSchema,
  ApplicationFormSchema,
  FORM_FIELD_TYPES,
  AdapterKeySchema,
  NormalizedJobSchema,
  NormalizedSalarySchema,
} from './adapter.js'
export type {
  AdapterConfig,
  AdapterKey,
  ApplicationForm,
  Cursor,
  Fetcher,
  FetchResult,
  FormField,
  FormQuestion,
  JobSourceAdapter,
  NormalizedJob,
  NormalizedSalary,
  RawJob,
  SourceHealth,
  SourceRef,
} from './adapter.js'

export { SOURCE_HEALTH_STATUSES, SourceHealthStatusSchema } from './types.js'
export type { SourceHealthStatus } from './types.js'
export { greenhouseAdapter } from './adapters/greenhouse.js'
export { LEVER_PAGE_SIZE, leverAdapter } from './adapters/lever.js'
export { getAdapter } from './registry.js'
export { canonicalJson, contentHash } from './content-hash.js'
export { htmlToPlainText } from './html-text.js'
export { getJson } from './http.js'
export { NewSourceSchema, SourcePollPayloadSchema } from './types.js'
export type {
  JobSource, JobSourceSummary, NewSource, NormalizationReport, NormalizedPosting, PagePosting, PollOutcome, SourcePollPayload,
} from './types.js'
export { POLL_INTERVAL_MS, DISPATCH_EVERY_MS, sourcePollQueue, sourcePollDispatchQueue, sourcePollKey, enqueueSourcePoll, applicationFormFetchQueue, applicationFormFetchKey } from './queues.js'
export {
  addSource, checkNormalization, dispatchSourcePolls, getApplicationForms, listLatestRawJobIds, listSources, pollSourcePage, postingKey,
  readNormalizedPosting, refreshApplicationForm, setSourceEnabled, sourcePublishesForms,
} from './service.js'
export type { PostingRef, StoredApplicationForm } from './service.js'
