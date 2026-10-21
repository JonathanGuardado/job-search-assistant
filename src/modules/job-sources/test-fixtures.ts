import { z } from 'zod'
import greenhouseJson from './__fixtures__/greenhouse-jobs.json'
import leverJson from './__fixtures__/lever-postings.json'
import type { RawJob, SourceRef } from './adapter.js'

export const greenhouseFixture = z.object({ jobs: z.array(z.looseObject({ id: z.number(), title: z.string(), content: z.string() })) }).parse(greenhouseJson)
export const leverFixture = z.array(z.looseObject({ id: z.string(), text: z.string(), applyUrl: z.string() })).parse(leverJson)
export const fixtureSource: SourceRef = { name: 'Fixture Co', config: { token: 'fixture' } }
export const rawFixture = (payload: unknown, externalId = 'malformed-posting'): RawJob => ({ payload, externalId, fetchedAt: new Date('2026-10-20T00:00:00Z') })
