# 0014 — Drafted answers, and which jobs the assistant works on

**Status:** accepted
**Date:** 2026-10-26

## Context

Milestone 2.1 left every one of the owner's 129 "Can apply" jobs blocked: 246 questions had
no answer. Decision 0013's amendment planned drafted answers for written questions only,
with personal questions always asked of the owner. Reviewing the 2.2 plan, the owner asked
for more: every question should be drafted from their profile and resume, drafting should
run without them asking question by question, and the point of all of it is an autopilot
that applies for them (milestone 2.4), not a tool they apply through job by job.

The data also showed why "Can apply" alone is the wrong work list. Eligibility asks whether
the owner may take a job, not whether they want it: 100 of the 129 jobs were Canonical's,
and 52 of those (financial analyst, account executive, sales director) share nothing with
the owner's target roles. Their questions crowded the answers page and would have spent
drafting budget on applications nobody should send.

## Decision

**Which jobs.** The assistant prepares applications only for open jobs in "Can apply" that
the owner has not hidden or applied to, and whose title is not a role gap in matching (it
shares no word of kind with any target role: "Financial Analyst" against "Software
Engineer"). A job the owner saved stays in whatever its role; a job not matched yet stays in
until matching says otherwise. A role gap still shows in "Can apply" on the jobs page; the
assistant just does no work on it.

**Three ways a question gets a draft**, chosen per question:

1. **Profile facts** (work authorization, sponsorship, citizenship, residence, relocation,
   salary expectation, languages, current title and employer, past employment at a company,
   years of experience, recent graduation). A model reads what the question asks into a
   fixed set of structured readings ("needs sponsorship to work in: US"); it never sees the
   profile. Code answers each reading from the profile and confirmed career items, and picks
   a choice question's option by matching option labels in code. A reading code cannot
   answer from the record (a country not named anywhere in the profile) gets no draft.
2. **Experience** (written questions about what the owner has done): a model writes from
   confirmed career items only, sentence by sentence, each sentence citing the items it
   relies on with a quote copied from them. The grounding check below runs before anyone
   sees it.
3. **Motivation** ("Why do you want to join us?"): as experience, plus the job's posting as a
   second source for claims about the company. These drafts are per job.

The model's reading is cached per question wording and options in a shared table: what a
question asks is the same for every candidate (decision 0013's catalog principle).

**Never drafted**, whatever the reading: consents and attestations (agreeing is the owner's
act), demographic and voluntary self-identification questions (inferring them is wrong),
and questions no record holds (school results, contact preferences). These are found by
code first (label patterns and the form's own compliance and demographic sections), so a
model misreading cannot route them to a draft. The owner answers each once; the answer is
reused for every job.

**The grounding check** (CLAUDE.md rule 1), deterministic, run on every experience and
motivation draft. Every sentence must cite at least one item from the confirmed set given
to the model, carry quotes found verbatim in what it cites, and contain no number, date,
capitalized name, technology-shaped token (`C++`, `Node.js`, `CI/CD`) or term taken from the
question unless the cited sources contain it. A draft that fails is retried once with the
failing terms named, then stored as rejected with its reasons and never shown. What the
check cannot catch is an invented event told entirely in common words; the verbatim anchor
per sentence, the owner's review, and drafts being off for unattended sending by default
(decision 0013's amendment) cover that.

**When drafting runs.** In the background, most widely blocking question first, without the
owner asking. Profile-fact drafts cost only the shared reading. Written drafts stop for the
day at a spending cap (US$0.50 per candidate per UTC day; the owner raised it from US$0.20 on
2026-10-27); a "Draft now" action skips
the queue for one question. Readings are not counted against the cap: they are bounded by
the number of distinct questions and shared by every candidate.

**Approval.** Nothing drafted is used until the owner accepts it, which saves it as their
answer with `origin = 'draft'` (an edited draft stays a draft). Answers the owner writes
themselves have `origin = 'owner'`. Milestone 2.4 sends `draft` answers unattended only if
the owner switches that on.

**Pending approval is one button** (for 2.3 and 2.4). A job that waits for the owner, such as
a posting that requires the candidate's own words, arrives with its whole form already
filled from saved answers and drafts. The owner sees exactly what will be sent and presses
Send; editing is possible, never required.

## Amendments (2026-10-27, building experience drafts)

**Own-words forms get no written drafts.** Canonical's form says "I agree to use only my own
words… the use of AI or other generated content will disqualify my application." A model-written
answer, even one the owner edits, would make that attestation untrue. No experience or motivation
draft is written for a question any job asks on a form with such a statement (`asksOwnWords`);
the question says so and the owner writes it. Profile-fact drafts are unaffected: they fill in
the owner's own facts. On the owner's data this covers 109 of about 120 experience questions.

**Placeholders are not facts.** Career items confirmed with blanks ("led a team of [N]
engineers", "by [X%]") produced drafts that copied them. The grounding check rejects a sentence
containing a bracketed placeholder, and the prompt tells the model to leave such details out.

**More never-drafted questions, found by code:** contact preferences ("How should we
communicate with you?"), employment agreements and non-competes, and the owner's own equipment
("Are you comfortable using your own computer?"). The first model reading had called these
experience questions.

**Time zone is a profile fact.** Forms ask it as a region ("American Time Zones", "EMEA",
"APAC"); code answers from the profile's country with eligibility's region table, or writes the
IANA zone and its offset in a text field.

Experience drafts run on the primary model (decision 0015): they send confirmed career items.
A choice question read as experience ("Do you have experience with…? Yes/No") gets no draft:
choosing is the owner's act.

## Consequences

- The profile gains citizenships and an English level, without which authorization,
  sponsorship and language questions cannot be answered from the record.
- New tables: `question_readings` (shared) and `answer_drafts` (per candidate);
  `saved_answers` gains `origin` and `draft_id`.
- Decision 0013's amendment ("questions no record answers are always asked of the owner")
  narrows to the never-drafted list above.
- An answer accepted from a profile draft does not follow later profile edits: it is the
  owner's saved answer from then on, as any other.
