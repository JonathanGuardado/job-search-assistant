import type { AdapterKey, JobSourceAdapter } from './adapter.js'
import { greenhouseAdapter } from './adapters/greenhouse.js'
import { leverAdapter } from './adapters/lever.js'

const adapters: Readonly<Record<AdapterKey, JobSourceAdapter>> = { greenhouse: greenhouseAdapter, lever: leverAdapter }

export function getAdapter(key: AdapterKey): JobSourceAdapter {
  return adapters[key]
}
