/**
 * Public surface of the application-answers module: the candidate's details and saved
 * answers, whether each job's application form could be filled from them, suggestions
 * that reuse an answer for a differently worded question (decision 0013), and drafts the
 * candidate accepts or ignores (decision 0014). Models only pair questions and read what
 * they ask; code drafts from the record, and nothing drafted is used until accepted.
 * Other modules import from here and nowhere deeper (docs/architecture.md).
 */

// Exported for foreign keys only. Only this module writes them.
export { answerDrafts, applicantDetails, questionMatchRuns, questionReadings, savedAnswers } from './schema.js'

export {
  acceptSuggestion, deleteSavedAnswer, formFetchRequest, getApplicantDetails, jobsToApplyTo, latestDrafts, listSavedAnswers, matchQuestionsWithModel,
  openQuestions, queueFormFetchNow, readinessForJobs, refreshQuestionMatches, saveAnswer, saveApplicantDetails,
} from './service.js'
export type { FormFetchRequest, JobReadiness, MatchOutcome, MatchQuestions, OpenQuestion, Suggestion } from './service.js'
export { acceptDraft, draftAnswers, questionHash, readQuestionsWithModel } from './drafting.js'
export type { DraftingOutcome, ReadQuestions } from './drafting.js'
export { answerDraftQueue, queueAnswerDrafts, questionMatchQueue, queueQuestionMatch } from './queues.js'
export { readQuestionsTask } from './prompts/read-questions.js'
export type { NeverDrafted } from './never-drafted.js'
export type { QuestionReading, ReadingKind } from './question-reading.js'
export { matchQuestionsTask } from './prompts/match-questions.js'
export { assessReadiness, questionKey, standardField } from './readiness.js'
export type { FilledValue, QuestionAnswer, Readiness, ReadinessInput, SavedAnswerValue } from './readiness.js'
export { ApplicantDetailsSchema, SaveAnswerSchema, SavedAnswerValueSchema } from './types.js'
export type { AnswerDraft, AnswerOrigin, ApplicantDetails, DraftBasis, DraftMethod, DraftStatus, SaveAnswer, SavedAnswer } from './types.js'
