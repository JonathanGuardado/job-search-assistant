import { and, asc, eq, sql } from 'drizzle-orm'
import type { TenantScope } from '@/lib/db/tenancy'
import { domainError, err, ok, type Result } from '@/lib/result'
import { careerItems } from './schema.js'
import type {
  CareerItem,
  CareerItemDraft,
  CareerItemEdit,
  VerifiedCareerItem,
} from './types.js'

type CareerItemRow = typeof careerItems.$inferSelect

function toCareerItem(row: CareerItemRow): CareerItem {
  const fields = {
    id: row.id,
    userId: row.userId,
    type: row.type,
    organization: row.organization,
    title: row.title,
    startedOn: row.startedOn,
    endedOn: row.endedOn,
    isCurrent: row.isCurrent,
    summary: row.summary,
    achievements: row.achievements,
    technologies: row.technologies,
    evidence: row.evidence,
    sourceResumeId: row.sourceResumeId,
    sourceParseId: row.sourceParseId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
  if (!row.verifiedByUser) return { ...fields, verifiedByUser: false, verifiedAt: null }
  if (row.verifiedAt === null) {
    throw new Error(`career item ${row.id}: verified without verified_at; career_items_verified_check is missing`)
  }
  return { ...fields, verifiedByUser: true, verifiedAt: row.verifiedAt }
}

function editColumns(edit: CareerItemEdit) {
  return {
    type: edit.type,
    organization: edit.organization,
    title: edit.title,
    startedOn: edit.startedOn,
    endedOn: edit.endedOn,
    isCurrent: edit.isCurrent,
    summary: edit.summary,
    achievements: edit.achievements,
    technologies: edit.technologies,
    updatedAt: sql`now()`,
  }
}

/** Stores parse output as unverified drafts. Drafts may inform matching, never generation. */
export async function recordDrafts(
  scope: TenantScope,
  input: {
    readonly sourceResumeId: string
    readonly sourceParseId: string
    readonly drafts: readonly CareerItemDraft[]
  },
): Promise<number> {
  if (input.drafts.length === 0) return 0
  const inserted = await scope.db
    .insert(careerItems)
    .values(
      input.drafts.map((draft) => ({
        userId: scope.userId,
        ...draft,
        sourceResumeId: input.sourceResumeId,
        sourceParseId: input.sourceParseId,
      })),
    )
    .returning({ id: careerItems.id })
  return inserted.length
}

/** Where an item first appears in its resume; drafts from one parse share a created_at. */
function sourcePosition(item: CareerItem): number {
  const { achievements, technologies, ...fields } = item.evidence
  const starts = [...Object.values(fields), ...achievements, ...technologies]
    .filter((span) => span !== undefined)
    .map((span) => span.start)
  return starts.length > 0 ? Math.min(...starts) : Number.MAX_SAFE_INTEGER
}

/** Every item, verified or not, in resume order. For review and (later) matching. */
export async function listCareerItems(
  scope: TenantScope,
  filter: { readonly sourceResumeId?: string } = {},
): Promise<CareerItem[]> {
  const rows = await scope.db
    .select()
    .from(careerItems)
    .where(
      filter.sourceResumeId === undefined
        ? undefined
        : eq(careerItems.sourceResumeId, filter.sourceResumeId),
    )
  return rows
    .map(toCareerItem)
    .sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() ||
        sourcePosition(a) - sourcePosition(b) ||
        a.id.localeCompare(b.id),
    )
}

/**
 * The ONLY read that generated text may be grounded in. It returns verified
 * items and is typed so: code that needs VerifiedCareerItem cannot be handed
 * a draft (CLAUDE.md rule 1).
 */
export async function listGroundingItems(scope: TenantScope): Promise<VerifiedCareerItem[]> {
  const rows = await scope.db
    .select()
    .from(careerItems)
    .where(eq(careerItems.verifiedByUser, true))
    .orderBy(asc(careerItems.createdAt), asc(careerItems.id))
  return rows.map(toCareerItem).filter((item): item is VerifiedCareerItem => item.verifiedByUser)
}

/** Saves a correction without changing verification: a draft stays a draft. */
export async function saveCareerItem(
  scope: TenantScope,
  itemId: string,
  edit: CareerItemEdit,
): Promise<Result<CareerItem>> {
  const [row] = await scope.db
    .update(careerItems)
    .set(editColumns(edit))
    .where(eq(careerItems.id, itemId))
    .returning()
  return row ? ok(toCareerItem(row)) : err(domainError('not_found', `career item ${itemId} not found`))
}

/**
 * The user's confirmation, with whatever corrections they made. This is the
 * only path that sets verified_by_user.
 */
export async function confirmCareerItem(
  scope: TenantScope,
  itemId: string,
  edit: CareerItemEdit,
): Promise<Result<VerifiedCareerItem>> {
  const [row] = await scope.db
    .update(careerItems)
    .set({
      ...editColumns(edit),
      verifiedByUser: true,
      // Keep the first confirmation time when a verified item is corrected again.
      verifiedAt: sql`coalesce(${careerItems.verifiedAt}, now())`,
    })
    .where(eq(careerItems.id, itemId))
    .returning()
  if (!row) return err(domainError('not_found', `career item ${itemId} not found`))
  const item = toCareerItem(row)
  if (!item.verifiedByUser) throw new Error(`career item ${itemId} did not verify`)
  return ok(item)
}

/** Deletes an unconfirmed draft, e.g. one duplicating an item already verified from an older version. */
export async function discardDraft(scope: TenantScope, itemId: string): Promise<Result<void>> {
  const deleted = await scope.db
    .delete(careerItems)
    .where(and(eq(careerItems.id, itemId), eq(careerItems.verifiedByUser, false)))
    .returning({ id: careerItems.id })
  if (deleted.length > 0) return ok(undefined)

  const [existing] = await scope.db
    .select({ id: careerItems.id })
    .from(careerItems)
    .where(eq(careerItems.id, itemId))
  return existing
    ? err(domainError('invalid_input', 'Confirmed items are part of your record and cannot be discarded as drafts.'))
    : err(domainError('not_found', `career item ${itemId} not found`))
}

export async function prepareCareerItemsForResumeDeletion(scope: TenantScope, resumeId: string): Promise<void> {
  await scope.db.delete(careerItems).where(and(
    eq(careerItems.sourceResumeId, resumeId),
    eq(careerItems.verifiedByUser, false),
  ))
  // Clear both links together: independent cascading actions can transiently violate the other FK.
  await scope.db.update(careerItems).set({ sourceResumeId: null, sourceParseId: null }).where(
    and(eq(careerItems.sourceResumeId, resumeId), eq(careerItems.verifiedByUser, true)),
  )
}
