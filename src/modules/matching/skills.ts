/**
 * Skill names, compared as keys. Postings and resumes spell the same skill many ways
 * ("Node.js", "NodeJS", "node"); a key is the lowercased name without spaces, dots,
 * hyphens or slashes, mapped through a curated alias table. Unknown skills still
 * compare by their own key, so the table only needs the spellings that differ.
 */

const ALIASES: Readonly<Record<string, string>> = {
  node: 'nodejs',
  js: 'javascript', ecmascript: 'javascript', es6: 'javascript',
  ts: 'typescript',
  postgres: 'postgresql', psql: 'postgresql',
  mongo: 'mongodb',
  mssql: 'sqlserver', microsoftsqlserver: 'sqlserver',
  rails: 'rubyonrails', ror: 'rubyonrails',
  k8s: 'kubernetes', k8: 'kubernetes',
  apachekafka: 'kafka', apachespark: 'spark', apacheiceberg: 'iceberg', apachehudi: 'hudi', apacheairflow: 'airflow',
  oop: 'objectorientedprogramming', microservice: 'microservices', microservicesarchitecture: 'microservices',
  hashicorpvault: 'vault', lightningwebcomponents: 'lwc', elk: 'elasticstack',
  golang: 'go',
  reactjs: 'react', vuejs: 'vue', expressjs: 'express', nest: 'nestjs', next: 'nextjs',
  restapi: 'rest', restapis: 'rest', restful: 'rest', restfulapi: 'rest', restfulapis: 'rest',
  gcp: 'googlecloud', googlecloudplatform: 'googlecloud',
  amazonwebservices: 'aws',
  azure: 'microsoftazure',
  csharp: 'c#', cpp: 'c++',
  dotnetcore: 'dotnet', aspnet: 'aspdotnet',
  tailwindcss: 'tailwind',
  gha: 'githubactions',
  llms: 'llm', largelanguagemodels: 'llm', largelanguagemodel: 'llm',
  ml: 'machinelearning',
}

/** A skill on the left shows each skill on the right. Never the reverse: SQL does not show PostgreSQL. */
const IMPLIES: Readonly<Record<string, readonly string[]>> = {
  typescript: ['javascript'],
  react: ['javascript'], vue: ['javascript'], angular: ['typescript'], angularjs: ['javascript'], nextjs: ['react'],
  nodejs: ['javascript'], express: ['nodejs'], nestjs: ['nodejs', 'typescript'],
  postgresql: ['sql'], mysql: ['sql'], oracle: ['sql'], sqlserver: ['sql'], sqlite: ['sql'], mariadb: ['sql'],
  rubyonrails: ['ruby'], django: ['python'], flask: ['python'], fastapi: ['python'],
  spring: ['java'], springmvc: ['spring'], springboot: ['spring'], hibernate: ['java'], javaee: ['java'],
  aspdotnet: ['dotnet'],
}

/**
 * Written this way, these are usually ordinary words ("go-to-market", "the rest of"), so
 * text never counts as evidence through them. Unambiguous spellings ("Golang", "RESTful")
 * still do, and so does a career item's technologies list.
 */
const AMBIGUOUS_IN_TEXT = new Set(['go', 'r', 'c', 'd', 'express', 'rest', 'spring', 'less', 'swift', 'dart', 'ember', 'chef', 'puppet', 'salt', 'make', 'next', 'node', 'shell', 'excel', 'sheets', 'word'])

function normalize(name: string): string {
  return name
    .replace(/\(.*?\)/g, '')
    .trim()
    .toLowerCase()
    .replace(/^\./, 'dot')
    .replace(/\.net\b/g, 'dotnet')
    .replace(/[\s._/-]+/g, '')
}

export function skillKey(name: string): string {
  const normalized = normalize(name)
  // "Kubernetes (K8s)": the parenthetical is dropped, but a name that is only an alias in parentheses still resolves.
  return ALIASES[normalized] ?? normalized
}

/** Every skill a listed skill shows, transitively, excluding itself. */
export function impliedSkills(key: string): string[] {
  const found = new Set<string>()
  const pending = [...(IMPLIES[key] ?? [])]
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (found.has(next) || next === key) continue
    found.add(next)
    pending.push(...(IMPLIES[next] ?? []))
  }
  return [...found]
}

/** Terms written with a slash that name one thing, not a choice between two. */
const SLASHED_TERMS = new Set(['cicd', 'tcpip', 'plsql', 'abtesting', 'io', 'uiux', 'uxui'])

/**
 * The skills a name offers as alternatives: "C/C++" is C or C++, while "CI/CD" is one
 * practice. Models often return the posting's own "A/B" spelling as a single name.
 */
export function alternativesIn(name: string): string[] {
  if (!name.includes('/') || SLASHED_TERMS.has(normalize(name))) return [name]
  const parts = name.split('/').map((part) => part.trim())
  return parts.every((part) => part.length > 0) ? parts : [name]
}

const MAX_WORDS = 4

/**
 * Skill keys named in free text, read as runs of up to four words. The set also holds
 * keys of ordinary phrases; that is harmless, because only requirement keys are looked up.
 */
export function skillsMentioned(text: string): Set<string> {
  const words = text.split(/[\s,;:()[\]{}"'!?|]+/).map((word) => word.replace(/\.+$/, '')).filter(Boolean)
  const found = new Set<string>()
  for (let start = 0; start < words.length; start++) {
    for (let length = 1; length <= MAX_WORDS && start + length <= words.length; length++) {
      const phrase = words.slice(start, start + length).join(' ')
      if (!AMBIGUOUS_IN_TEXT.has(normalize(phrase))) found.add(skillKey(phrase))
    }
  }
  return found
}
