/**
 * Public surface of the application-answers module: the candidate's details and saved
 * answers, whether each job's application form could be filled from them, and suggestions
 * that reuse an answer for a differently worded question (decision 0013). A model only
 * pairs questions; every answer is the candidate's own. Other modules import from here
 * and nowhere deeper (docs/architecture.md).
 */

// Exported for foreign keys only. Only this module writes them.
export { applicantDetails, questionMatchRuns, savedAnswers } from './schema.js'

export {
  acceptSuggestion, canApplyJobs, deleteSavedAnswer, formFetchRequest, getApplicantDetails, listSavedAnswers, matchQuestionsWithModel,
  openQuestions, queueFormFetchNow, readinessForJobs, refreshQuestionMatches, saveAnswer, saveApplicantDetails,
} from './service.js'
export type { FormFetchRequest, JobReadiness, MatchOutcome, MatchQuestions, OpenQuestion, Suggestion } from './service.js'
export { questionMatchQueue, queueQuestionMatch } from './queues.js'
export { matchQuestionsTask } from './prompts/match-questions.js'
export { assessReadiness, questionKey, standardField } from './readiness.js'
export type { FilledValue, QuestionAnswer, Readiness, ReadinessInput, SavedAnswerValue } from './readiness.js'
export { ApplicantDetailsSchema, SaveAnswerSchema, SavedAnswerValueSchema } from './types.js'
export type { ApplicantDetails, SaveAnswer, SavedAnswer } from './types.js'
