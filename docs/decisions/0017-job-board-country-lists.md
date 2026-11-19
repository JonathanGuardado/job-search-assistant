# 0017 — Job boards: the Himalayas source and its country lists

**Status:** accepted
**Date:** 2026-11-12

## Context

Every source so far is one company's own board (Greenhouse, Lever, Ashby). The sources track
(S.2) adds one job board that lists many companies. The owner chose Himalayas on 2026-11-12:
it can be queried by country (`country=SV`), about 3,400 postings match, and its API terms
allow personal and commercial use on four conditions:

- every Apply action uses the posting's `applicationLink` unchanged, never the employer's link;
- a visible credit links back to Himalayas;
- the data is shown only in apps we operate and never passed on to third parties;
- postings are removed once they expire.

A board differs from a company's own ATS in one way that matters to eligibility. Himalayas
says where a remote worker may live in a structured list of country names
(`locationRestrictions`), not in the posting's text. Running the engine on real postings
(2026-11-12) showed three things:

- The model reads a list of 6 or 7 countries placed in the location line, and reads nothing
  from a list of 22 or 56. Most lists are long.
- The lists are region words expanded to countries. Of 121 non-empty lists in 180 sampled
  postings, 34 were one 45-country "Latin America", 23 one 56-country "Americas", and 5 one
  42-country "North America" that includes El Salvador, because the United Nations geoscheme
  puts Central America and the Caribbean in North America. Four of those five state a scope
  in their text, and all four limit the role to "North America" or the United States, which
  this project's region table reads as the US and Canada.
- An empty list is Himalayas' "worldwide", and it is not reliable: one posting with an empty
  list is titled "U.S. Based".

## Decision

- **D1. `jobs.remote_countries`** (text array, ISO 3166-1 alpha-2) holds the source's
  structured list of where a remote worker may live. Null when the source has no such field
  or lists nothing: an empty list is silence, never "worldwide". Names the adapter cannot
  map to a code are left out (`job-sources/country-names.ts`).
- **D2. The list never rejects.** It is a job board's reading of a posting, not the
  employer's words. `not_eligible` still needs a sentence from the posting.
- **D3. Where the text states no remote scope, the list stands in for it** (engine v6). A
  list that includes somewhere the candidate can work passes the location rule, and the
  whole list is stored as the verdict's evidence (`Evidence.sourceCountries`), shown in the
  jobs view as the board's listing and never as a quote. A list that leaves the candidate
  out is an open question.
- **D4. Where the text and the list disagree, the verdict is `needs_review`.**
  - A list with the candidate in it holds back a rejection the text alone would make: a
    stated scope that excludes them, or office work abroad.
  - A list without the candidate contests a worldwide claim quoted from the description,
    the way a location line does (engine v5).
  - A stated authorization requirement with sponsorship refused still rejects.
- **D5. A "North America" list does not name Central America.** A list holding all of
  Northern America (the US, Canada, Greenland, Bermuda, Saint Pierre and Miquelon) and no
  South American country is read as the words "North America". In it, the countries the
  region table puts in LATAM are the expansion's doing and are not taken as listed. A short
  list picked by hand ("US, Canada, Mexico, El Salvador") is taken at its word.
- **D6. The list is part of the fingerprint when there is one.** A changed list re-assesses
  the job. Postings without a list keep the fingerprint they had, so nothing is re-read.
- **D7. The list never enters the text the model reads.** The adapter sets `locationText`
  to null. A list in the location line could be quoted, and a quote can reject.
- **D8. A job board's salary is not a posted salary.** The adapter reports the salary as
  unknown. A structured salary can reject without a quote (stage 1), and a third party's
  number must not hide a job. A range the description states is still read from the text
  (decision 0011), shown by matching and never rejected on.
- **D9. A board's copy of a followed company's job is left out.** When the posting's
  company, normalized, is the name of an enabled Greenhouse, Lever or Ashby source, the
  board's posting does not become a job. The company's own board has the same job with a
  form the assistant can read. This is checked on every poll, so following or unfollowing
  a company corrects itself on the next one. It replaces cross-source fingerprint matching
  for S.2: decision 0008's exact fingerprint cannot match a board's reformatted copy.
- **D10. Himalayas is polled once a day** (its data refreshes daily), one page every 1.5
  seconds, without an API key. Adapters may set their own poll interval.
- **D11. Himalayas postings are not committed.** The repository is public and the terms
  forbid passing the data on. Adapter fixtures are written by hand in the payload's shape.
  The labeled eval postings live in `evals/local/` (gitignored) and are measured when present.

## Measured

180 postings from nine pages of `country=SV` results, engine v5 against v6, same extractions:

| | Lists ignored (v5) | With lists (v6) |
| --- | --- | --- |
| eligible | 84 | 128 |
| needs_review | 87 (48%) | 45 (25%) |
| not_eligible | 9 | 7 |

- All 7 rejections rest on a sentence that excludes El Salvador. The 2 that v6 no longer
  makes were wrong: the model read "work from Canada, Latin America, or Ukraine" as Canada
  and Ukraine, and the list had El Salvador (D4).
- In 75 postings the text states a scope and the list has El Salvador. For the 71 whose
  list is not a "North America" expansion, the engine read the text as including El Salvador
  in 65, and the other 6, read by hand, do not exclude it. In the 4 that are, the text
  excludes it every time (D5).
- 44 postings whose text is silent become eligible on the list. Nothing in the text can
  check those; the 71 above, none contradicted, are the evidence for trusting them.
- 30 of the 180, evenly spaced and labeled by hand from the full text before v6 ran on them
  (split `source-lists`): v6 matches 29. Rejections 3 of 3, wrongly eligible 0. With the
  lists ignored it matches 24 and calls one posting eligible that is not.
- The 297 earlier labels are unchanged: precision 99.4%, recall 85.6%.

## Consequences

- Engine v6 starts a new row per job. Re-checking every open job re-runs the rules over
  stored claims and costs no model calls.
- A wrong list can still put a job in "Can apply". The job page says the verdict rests on
  the job board's listing.
- 37 of 59 postings with an empty list stay `needs_review`: bare "Remote" from gig and
  AI-training platforms, which three companies made 22% of the sample. Whether to leave
  those platforms out is decided after the first full poll, from real counts.
- Region filters in the jobs view read the list when the text states no scope.
- Not done: Himalayas' per-posting expiry date is not used. A posting closes when a poll no
  longer lists it, like every other source.
- Found, not changed: 123 open postings have claims that name both regions and countries
  ("Argentina; Chile; Latin America"), and the location rule reads only one of the two. Some
  of the 71 it rejects are wrong and some are right; it needs its own labeled look.
