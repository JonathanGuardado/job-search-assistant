import { randomUUID } from 'node:crypto'
import type { NewJob } from './types.js'

export function aNewJob(overrides: Partial<NewJob> = {}): NewJob {
  return {
    companyName: 'Acme, Inc.',
    companyNormalized: 'acme',
    title: 'Senior Backend Engineer (Remote)',
    titleNormalized: 'backend engineer',
    description: 'We hire anywhere in LATAM.',
    locationPolicy: 'remote',
    locationText: 'Remote - LATAM',
    employmentType: 'contractor',
    salary: { source: 'unknown' },
    applyUrl: 'https://boards.example.com/acme/123',
    fingerprint: `fp-${randomUUID()}`,
    seenAt: new Date('2026-09-01T12:00:00Z'),
    ...overrides,
  }
}
