/**
 * Public surface of the resumes module: file storage, immutable versions,
 * deterministic text extraction, and the record of each parse run.
 * Model-free — the parse task itself belongs to career-knowledge.
 *
 * The tables are exported for foreign keys only. Only this module writes them.
 */

export { resumeParses, resumes } from './schema.js'
export {
  completeParse,
  deleteResume,
  failParse,
  getLatestParse,
  getResume,
  listResumes,
  removeUnusedResumeFile,
  renewParseLease,
  startParse,
  uploadResume,
} from './service.js'
export type { ParseAttempt, ParseStart } from './service.js'

export {
  isParseStalled,
  MAX_RESUME_BYTES,
  PARSE_LEASE_MS,
  ResumeParseSchema,
  ResumeSchema,
  UploadResumeSchema,
} from './types.js'
export type {
  ParseStatus,
  Resume,
  ResumeParse,
  ResumeSummary,
  ResumeWithText,
  UploadResume,
} from './types.js'
