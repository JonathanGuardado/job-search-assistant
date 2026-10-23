# 0010 — How matching reads, compares and explains

**Status:** accepted
**Date:** 2026-10-22

## Context

Milestone 1.7: "every job card explains itself without a single score." The architecture
table listed matching as a module that calls a model for *reasoning*, but CLAUDE.md rule 3
says a model may only extract structured claims. Matching has to compare a posting's
requirements with the candidate's career record and preferences, and it needs the
posting's requirements in a structured form to do that.

## Decision

- **M1. The model reads; code compares.** One extraction task,
  `matching.extract-requirements`, turns a posting into requirements, each with a
  verbatim quote. Every comparison, status and explanation line is code. The
  architecture table now says "Extraction only" for matching.
  - Why a model at all (rule 7): a keyword list and a years regex find skill names, but
    not required versus nice-to-have, or which skill "5+ years" belongs to, across 26
    boards' free-form sections ("WHO YOU ARE", "Requisitos"), some in Spanish or
    Portuguese.
- **M2. What is extracted:** skills (names, required or preferred, years if tied to that
  skill; since prompt v2 a requirement lists every skill the posting accepts in its place,
  any one of which satisfies it, and a name written "C/C++" offers each), overall years of experience, spoken languages (ISO 639-1), and other
  requirements (degrees, certifications, domain). Other requirements are shown on the
  card as *not compared*. Requirements are stored per job and prompt version in the shared
  `job_requirements` table, like eligibility claims (0009, D6). Quotes are re-validated on
  every comparison; an entry whose quote is not in the posting is dropped.
- **M3. Skills compare as keys.** A key is the lowercased name without spaces, dots,
  hyphens or slashes, mapped through a curated alias table (`postgres` → `postgresql`,
  `k8s` → `kubernetes`). A listed skill can imply another (PostgreSQL shows SQL; never the
  reverse). Evidence comes from a career item's technologies, its title, summary and
  achievements (as whole sentences), or an implication, and says which. Unverified items
  count, as the domain model allows, and are labeled unconfirmed. Ordinary words ("go",
  "rest", "spring") never count as evidence from free text.
- **M3. Years are the least the dates can mean.** Partial dates read a year alone as late
  in its year for a start and early for an end; overlapping roles count once. The card
  says "at least".
- **M4. Nine dimensions, no score:** required skills, nice-to-have skills, experience,
  languages, role, seniority, salary, employment arrangement, and preferences (excluded
  companies and technologies, preferred technologies). Each is `meets`, `partial`, `gap`,
  `unknown` or `not_stated`, with findings and evidence. Concerns are a list of one-line
  sentences, worst first.
- **M5. Spoken languages are part of the profile** (`candidate_profiles.spoken_languages`,
  a predefined list of ISO 639-1 codes). They are a fact about the candidate, not a
  constraint, so they have no hard/preferred mode, and eligibility never reads them.
- **M6. Matching runs on jobs eligibility did not reject** (the user's override counts),
  except reviews whose posting names only a place (0009, D10).
  A match is stale when the job's text, the matching-relevant profile fields, the career
  record, or the engine version changes. Eligibility queues a match after each verdict
  that is not a rejection; a profile save, a career-item edit, a resume deletion and a
  finished parse each queue a re-match of the candidate's jobs (`match-reassess-user`).
- **M7. A small extraction eval** (`pnpm eval:matching`, 25 postings labeled before the
  first run) measures quote validity and how many required skills are found. The
  comparison itself is covered by unit tests.
- **M7a. Prompt v4 ships one requirement short of the recall target** (decided by the
  owner, 2026-10-22). On 20 unseen postings it finds 83.9% of required skills (target 85%)
  with 98.9% of extractions correct. A miss leaves a requirement off the card rather than
  adding a false gap, and v4 fixes the failures real cards showed. The next prompt change
  waits for feedback from real use and needs a fresh labeled set (`docs/matching-eval.md`).
- **M8. The card is a service output** (`getMatchCard`), shown by `pnpm match:explain`
  until the jobs UI (1.8) renders it.

## Consequences

- A posting costs one more extraction, only once eligibility has not rejected it for some
  candidate: roughly 600–800 postings for the owner, about $1.
- Matching quality is bounded by the career record. Skills a resume never names, and
  roles without dates, show as missing or unknown. The card says where each match came
  from, so a thin record is visible rather than hidden.
- Title-based role matching is word overlap, not understanding: "Senior Backend Engineer"
  is close to a "Senior Software Engineer" target, not a match. It only ever informs.
- The UI's ordering of jobs (1.8) must be derived from the dimensions at query time and
  shown, per the domain model; this decision does not define one.
