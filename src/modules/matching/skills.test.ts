import { describe, expect, it } from 'vitest'
import { impliedSkills, skillKey, skillsMentioned } from './skills.js'

describe('skillKey: one key per skill, however it is written', () => {
  it.each([
    [['Node.js', 'node', 'NodeJS', 'node js', 'Node'], 'nodejs'],
    [['PostgreSQL', 'Postgres', 'postgresql'], 'postgresql'],
    [['Ruby on Rails', 'Rails', 'RoR', 'ruby-on-rails'], 'rubyonrails'],
    [['Kubernetes', 'K8s', 'Kubernetes (K8s)'], 'kubernetes'],
    [['REST APIs', 'RESTful API', 'REST'], 'rest'],
    [['.NET', 'dotnet', '.Net'], 'dotnet'],
    [['React', 'React.js', 'ReactJS'], 'react'],
    [['Go', 'Golang'], 'go'],
    [['CI/CD', 'CICD', 'ci-cd'], 'cicd'],
    [['Kafka', 'Apache Kafka'], 'kafka'],
    [['Microservices', 'microservice', 'Microservices architecture'], 'microservices'],
    [['OOP', 'Object-Oriented Programming', 'object oriented programming'], 'objectorientedprogramming'],
    [['GCP', 'Google Cloud Platform', 'Google Cloud'], 'googlecloud'],
  ])('%j → %s', (names, key) => {
    for (const name of names) expect(skillKey(name)).toBe(key)
  })

  it('keeps distinct skills apart', () => {
    const keys = ['C', 'C++', 'C#', 'Java', 'JavaScript', 'Angular', 'AngularJS'].map(skillKey)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('impliedSkills: a listed skill can show another, never the reverse', () => {
  it('a framework or database shows its language', () => {
    expect(impliedSkills('postgresql')).toContain('sql')
    expect(impliedSkills('nextjs')).toEqual(expect.arrayContaining(['react', 'javascript']))
    expect(impliedSkills('rubyonrails')).toContain('ruby')
    expect(impliedSkills('springmvc')).toContain('java')
  })

  it('a language does not show a superset of it', () => {
    expect(impliedSkills('javascript')).not.toContain('typescript')
    expect(impliedSkills('sql')).not.toContain('postgresql')
  })
})

describe('skillsMentioned: skills named in free text', () => {
  it('finds single and multi-word skills', () => {
    const found = skillsMentioned('Built APIs in Node.js and Ruby on Rails, shipped with CI/CD on Google Cloud.')
    expect([...found]).toEqual(expect.arrayContaining(['nodejs', 'rubyonrails', 'cicd', 'googlecloud']))
  })

  it('does not read ordinary words as skills', () => {
    const found = skillsMentioned('Led the go-to-market launch; the rest of the team moved to Spring planning in C. America.')
    for (const key of ['go', 'rest', 'spring', 'c']) expect(found.has(key)).toBe(false)
  })

  it('does not find Java inside JavaScript', () => {
    const found = skillsMentioned('Wrote JavaScript daily.')
    expect(found.has('javascript')).toBe(true)
    expect(found.has('java')).toBe(false)
  })
})
