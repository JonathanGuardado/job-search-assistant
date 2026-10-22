import { sql } from 'drizzle-orm'
import { closeDb, getDb } from '@/lib/db/client'

/*
 * `pnpm jobs:sample [seed]`: the milestone 1.5 measurement (docs/dedupe-sample.md).
 * Draws 100 open canonical jobs, the list a user would see, and prints each one's
 * look-alikes: open canonical jobs at the same company with the same normalized title,
 * seniority and location but a different fingerprint, with the words that differ. A
 * person decides whether each pair is one opening (a missed duplicate) or two. Read-only.
 */

type SampledJob = { id: string; company: string; title: string; seniority: string | null; location: string | null; description: string; linked: string }
type LookAlike = { id: string; title: string; description: string }

const seed = process.argv[2] ?? '2026-10-21'
const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
const difference = (a: string, b: string) => {
  const [inA, inB] = [words(a), words(b)]
  return { onlyA: [...inA].filter((w) => !inB.has(w)), onlyB: [...inB].filter((w) => !inA.has(w)) }
}

try {
  const db = getDb()
  const sample = await db.execute<SampledJob>(sql`
    select j.id, j.company_name company, j.title, j.seniority, j.location_text location, j.description,
      (select count(*) from jobs d where d.canonical_job_id = j.id)::text linked
    from jobs j where j.closed_at is null and j.canonical_job_id is null
    order by md5(j.id::text || ${seed}) limit 100`)
  let withLookAlikes = 0
  for (const [index, job] of sample.entries()) {
    const lookAlikes = await db.execute<LookAlike>(sql`
      select o.id, o.title, o.description from jobs o, jobs j
      where j.id = ${job.id} and o.id <> j.id and o.closed_at is null and o.canonical_job_id is null
        and o.company_normalized = j.company_normalized and o.title_normalized = j.title_normalized
        and o.seniority is not distinct from j.seniority and o.location_policy = j.location_policy
        and coalesce(o.location_text, '') = coalesce(j.location_text, '')`)
    if (lookAlikes.length > 0) withLookAlikes++
    console.log(`${String(index + 1).padStart(3)}. ${job.company} | ${job.title} | ${job.location ?? '(no location)'} | linked duplicates: ${job.linked}`)
    for (const other of lookAlikes) {
      const { onlyA, onlyB } = difference(job.description, other.description)
      console.log(`       look-alike ${other.id}: only here [${onlyA.slice(0, 15).join(' ')}] only there [${onlyB.slice(0, 15).join(' ')}]`)
    }
  }
  console.log(`\nseed ${seed}: ${sample.length} sampled, ${withLookAlikes} with at least one look-alike to judge`)
} finally {
  await closeDb()
}
