/**
 * Public surface of the applications module: the applications a candidate sent and the
 * stages each moved through (decision 0012). Model-free. Other modules import from here
 * and nowhere deeper (docs/architecture.md).
 */

// Exported for foreign keys only. Only this module writes them.
export { applicationEvents, applications } from './schema.js'

export {
  APPLICATION_STATUSES,
  ApplicationEditSchema,
  ApplicationStatusSchema,
  ContactSchema,
  NewApplicationSchema,
  SalaryAskedSchema,
  StatusChangeSchema,
} from './types.js'
export type {
  Application,
  ApplicationEdit,
  ApplicationEvent,
  ApplicationStatus,
  Contact,
  NewApplication,
  SalaryAsked,
  StatusChange,
} from './types.js'
