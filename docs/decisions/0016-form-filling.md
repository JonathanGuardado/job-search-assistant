# 0016 — Filling Greenhouse forms in approval mode

**Status:** accepted
**Date:** 2026-10-28

## Context

Milestone 2.3: "the owner submits a real Greenhouse application that the system filled, after
seeing exactly what it sends." Decision 0013 put browser automation here, with its own record.
Greenhouse's job board API takes applications only with the employer's key, so a candidate's
application can only go through the employer's form in a browser.

The plan went through three external review rounds before any code. Step 0 ran on 2026-10-28.

**Terms**, checked 2026-10-28. The documents read:

- Greenhouse's legal index (`greenhouse.com/legal`): the master subscription agreement, the data
  processing addendum, the privacy policy, the cookie notice and the CCPA notice for people
  applying to Greenhouse itself;
- the MyGreenhouse User Agreement (`my.greenhouse.io/users/agreement`, effective 2025-01-29);
- both job boards' `robots.txt`.

What they say:

- **The legal index binds employers.** Its documents are written for Greenhouse's employer
  customers. None addresses people applying through an employer's form, or automated tools. The
  privacy policy names the employer as the controller of application data.
- **MyGreenhouse forbids automation.** MyGreenhouse is Greenhouse's account service for job
  seekers. Its agreement, section 3(z), forbids using "automated means, including spiders,
  robots, crawlers, or similar means or processes to access or use the Services".
- **robots.txt:** `job-boards.greenhouse.io/robots.txt` disallows nothing.
  `boards.greenhouse.io/robots.txt` disallows `/embed/` to crawlers.
- **Employers' own rules:** an employer can add rules in the form itself. Canonical's
  attestation forbids AI-generated content, which the own-words rule covers (decision 0014).

**Scope.** This decision covers the employer's application form, used without a MyGreenhouse
account. The filler:

- never signs in to MyGreenhouse;
- never uses its autofill or stored profile;
- runs in a fresh browser context holding no Greenhouse cookies.

The form page's own script asks MyGreenhouse whether someone is signed in
(`my.greenhouse.io/users/self`). The filler leaves that call to the page and acts on nothing
it returns.

**Still open.** The documents do not settle whether Greenhouse counts its hosted form page as
part of MyGreenhouse's Services. In 2.3 a person always presses Submit. 2.4 must settle this
before the system sends anything without the owner.

**Dry run** (`scripts/greenhouse-dry-run.ts`). It loaded the GitLab, Canonical and Elastic forms
in Chromium, with the time zone set to UTC, filled them with made-up values and pressed Submit.
Nothing reached Greenhouse: every request that is not a read was aborted, and file uploads
were answered in the browser as S3 would.

- **What "conclusive" means.** A run is conclusive only when it captured the application
  request to `boards.greenhouse.io/[embed/]<board>/jobs/<id>` with a complete JSON body. The
  script checks this and exits with an error otherwise.
- **The evidence.** All three runs were conclusive. Their captures are in
  [`docs/dry-runs/2026-10-28/`](../dry-runs/2026-10-28/). Each holds every request made after
  Submit and the full application payload, without the reCAPTCHA token or the upload
  signatures.

- **Pages.** Hosted boards serve the form at `job-boards.greenhouse.io/<board>/jobs/<id>`.
  Elastic's redirects to its own careers site, but `job-boards.greenhouse.io/embed/job_app?for=<board>&token=<id>`
  serves the same form.
- **Controls.** Each field's id is its API field name (`first_name`, `question_70134650`).
  Choices are react-select comboboxes. A several-choice question is either a combobox or a
  checkbox group with ids `<name>_<option id>`. Files are plain file inputs.
- **Controls the API does not describe.** A required phone-country picker (`country`)
  appears once a phone is typed. The API's `location`, `latitude` and `longitude` fields are
  one autocomplete on the page (`candidate-location`). The page also has optional education
  fields.
- **reCAPTCHA Enterprise** (invisible) runs on every form, and its token goes out with the
  submission.
- **Files go out when attached, not at Submit.** Attaching a file uploads it at once, by a
  presigned POST to Greenhouse's S3 bucket (`grnhse-prod-jben-*.s3.amazonaws.com`). The dry
  run could not tell, since it attached the files and pressed Submit in one go; the filler's
  tests showed it on 2026-10-28. So the resume reaches Greenhouse's storage while the form is
  being filled, before the owner presses Submit. It is the resume the owner reviewed in the
  packet.
- **What Submit sends, in order:**
  1. a reCAPTCHA reload;
  2. the application: one JSON `fetch` POST to `boards.greenhouse.io/[embed/]<board>/jobs/<id>`.
     It carries the details, each answer by question id (`text_value`, `boolean_value` or the
     chosen option ids), the location with its coordinates, the uploaded files' URLs, the
     demographic answers, the time zone and the reCAPTCHA token.
- **Page loads also POST analytics** to `c.spl.greenhouse.io`.
- **Not seen:** the response to a real submission and the confirmation page. Your first real
  submission shows them.

## Decision

### Who submits

**The owner presses Submit, in a visible browser the system filled.** The worker opens Chromium
(Playwright) on the owner's machine, fills the form, and leaves Submit to the owner, who also
handles reCAPTCHA challenges, an emailed security code, and anything left unfilled. The
worker must run on a machine with a screen: phase 2 is one owner on their own machine, and a
hosted version is out of scope.

**Phase gate.** Decision 0013 has phase 1's gates close before form filling ships. On
2026-10-28 the owner approved starting 2.3 while 1.8 and 1.9 remain open: 1.9 is hard to
validate now, and the first assisted submission will exercise it.

**No LangGraph** (amends decision 0003). The only waiting is while the browser window is open,
at most 30 minutes, inside one worker job. A status column and a lease cover it.

### What is filled

**The packet** is the complete list of what the browser will enter: each question and field,
the value, where it came from (details, resume, profile, or a saved answer, and if that answer
was a draft, which kind), and each unresolved item with its reason. It is built in code from
readiness (`application-answers`) and never by a model.

**What stops the browser from opening.** Only these:

- the job is not in "Can apply", is closed, is hidden, or the owner applied to it;
- an application already exists for the job;
- another fill for the job is in progress;
- the packet is stale: the owner's answers, the resume, the form or the posting version changed
  since review;
- the stored form is missing or could not be read.

**What is left for the owner instead.** Everything else is filled as far as possible, and each
of these is listed as unresolved with its reason:

- an unanswered required question, or a saved choice the form no longer offers;
- an answer withheld by the own-words rule;
- a consent item;
- a widget the filler cannot operate;
- a location with no exact match;
- a required page control the API does not describe.

In 2.4 any unresolved item keeps a job from being sent automatically. Readiness's "blocked"
keeps that one meaning: not sendable without the owner.

**The own-words rule is enforced.** On a form that asks for the candidate's own words
(`asksOwnWords`), a saved answer from an experience or motivation draft is not used, whether it
was accepted, edited, or reused through a suggestion. The question blocks with reason
`own_words`, readiness and the packet both apply it, and the answer is never in the packet.
Profile-fact drafts still fill (decision 0014). An answer marked `draft` whose draft method
cannot be recovered (no `draft_id`, or the row is gone) counts as a written draft. Editing a
drafted saved answer keeps it a draft.

**The page against the API.**

- **Data-protection consent:** the parser reads `data_compliance`. Each consent it requires is
  an unresolved item for the owner, never ticked by the filler.
- **Comparing the two:** after the page loads, the filler lists every visible control and
  matches it to the packet. A control on the page and not in the packet is reported, and is
  unresolved if required. A packet field not found on the page is reported.
- **Phone country:** set only when the stored phone's international dialing code belongs to
  exactly one country among the picker's own options (the page lists each country's code).
  Otherwise it is unresolved:
  - a code shared by several countries, such as +1 (the North American Numbering Plan) or +7;
  - a phone stored without an international code.
- **Location:** set only when an autocomplete suggestion equals the profile's "City, Country"
  exactly. Its coordinates come only from that suggestion, never guessed.

**Where the form is opened:** the hosted page. If it leaves `job-boards.greenhouse.io`, the
embed page instead.

### What is reviewed, filled and recorded

**The packet is fixed at review.** Preparing a fill is a server action (`prepareFill`), never
a side effect of rendering. It stores the packet and fingerprints of the packet, the form
(`application_forms.payload`), the posting version (`raw_job_id`) and the resume file, then
redirects to the review page. Preparing again returns the existing record only when that
record is still `prepared`, has not expired, and matches every pinned fingerprint: the packet,
the form, the posting version and the resume file. Otherwise, including after expiry or any
final outcome, it creates a new attempt. The
owner's Start is tied to that record and its packet fingerprint. The worker fills the stored
packet and never rebuilds it. Before opening the browser it re-fetches the form and rebuilds
the packet only to compare; any difference marks the fill `stale` and asks for a new review.
A prepared fill expires after 24 hours and is then marked `abandoned`. The application records the posting version that was
reviewed: `createApplication` takes an optional `rawJobId`, checked to belong to the job.

**Three kinds of evidence, kept apart:**

- **The packet:** what the owner reviewed.
- **The submission:** the captured final request, its address and every field as sent. The
  reCAPTCHA token and an emailed security code are removed. A file is kept as its name, size
  and fingerprint.
- **The outcome:** `confirmed` (a success response, then the confirmation page), `rejected`
  (an error response still standing when the window closed or the time ran out, with
  Greenhouse's answer as evidence), `unknown` (the request went out, but the result is
  unclear), or `user_reported` (the owner says it was submitted). An error response is not an
  outcome while the window is open; see the amendment below.

The submission and the outcome are independent. A captured request stays recorded when the
owner reports the outcome. Sent values are unknown only when nothing was captured. An
application is recorded for `confirmed` and `user_reported`, the latter labelled. `unknown`
asks the owner first.

### Attempts, crashes and the job's slot

A fill moves through: `prepared` → `queued` → `launching` → `filling` → `waiting` (for the
owner), and ends `submitted`, `uncertain`, `failed`, `abandoned` or `stale`.

- **One per job.** In progress means `queued` through `uncertain`, or `submitted` with no
  application linked yet. The database allows one such fill per person and job, and Start
  checks the same thing. Prepared fills do not hold the slot. Starting one marks other prepared
  fills for the job stale.
- **No second opening.** The fill queue never retries, and does not re-run stalled jobs.
  Before opening the browser, the worker takes a lease and moves the fill from `queued` to
  `launching` in one write. A redelivered job finds it is no longer queued and exits. The lease
  is renewed every 30 seconds while the browser is open (as in decision 0007). If renewal
  fails, the browser closes at once.
- **Uncertain unless ruled out.** Every ending after launch is `uncertain` unless network
  evidence rules a submission out: an error, Cancel, a timeout, a lost lease, or a crash. That
  evidence requires capture attached to the browser context before the first page opened, still
  attached until the browser was confirmed closed, and no outgoing request beyond the known
  safe ones:
  - Greenhouse analytics on `c.spl.greenhouse.io`;
  - the S3 upload of each file the filler attached, made while it was filling.

  A reCAPTCHA reload or the application request means Submit was pressed. An upload after the
  filler finished is the owner's doing, and is not ruled safe. If capture failed or saw
  anything else, the fill is uncertain.
  The owner settles an uncertain fill with "I submitted it" or "I didn't". Only "I didn't"
  frees the slot.
- **Recording takes two writes.** First the captured submission and outcome, with status
  `submitted`. Then the application and the link to it, in one transaction. If the second
  fails, "finish recording" completes it later, from the app or when the worker starts,
  without a browser. Finishing the same fill twice returns the same application. An
  application for the job that this fill did not create is a conflict, reported to the owner.
- **No browser waiting inside a transaction.** Each change is its own short write, checked
  against the expected status and lease holder.

**Interception stays in the dry run and the tests.** Aborting or answering requests in the
browser is done only by `scripts/` and test helpers. The filler only listens.

## Consequences

- **New module `automation`:** it owns `application_fills`, the Greenhouse filler and the
  `application-fill` queue. It never calls a model.
- **`applications`:** gains `mode` (`manual` | `assisted`; `automatic` arrives with 2.4), and
  `createApplication` takes `rawJobId`.
- **`application-answers`:**
  - builds the packet;
  - adds the `own_words` blocker;
  - reads each saved answer's draft method.
- **`resumes`:** gains a way to read a stored file.
- **`job-sources`:** gives each Greenhouse job its form page, and parses `data_compliance`.
  Stored forms are re-read from their kept payloads, not re-fetched.
- **CLAUDE.md:** allows browser automation from 2.3. Playwright is used for form filling and its
  tests.
- **2.4:** reCAPTCHA Enterprise runs on every form, so the system pressing Submit without the
  owner may be challenged or scored as a bot. 2.4 must answer that before relying on it, and
  check the terms again.

## Amendment, 2026-11-05: an error answer is a step, not an outcome

The first three real fills (Canonical) were recorded `rejected` on Greenhouse's first answer,
HTTP 428, and the browser closed. Greenhouse's page script (in the recorded GitLab page) shows
what that answer was: an error body carries a `code`, and `captcha-failed` with a
`security_code_recipient` makes the page ask for the 8-character code it emailed, which the next
Submit sends as `security_code` to the same address. After any error the page lets the owner
fix the form and submit again.

- While the window is open, an error answer is not an outcome. The worker keeps waiting, and
  judges the latest application request. Only a confirmation, the window closing or the time
  running out ends the wait.
- An error still standing at the end is `rejected` (the fill `failed`) when nothing beyond the
  known safe requests went out after Greenhouse answered; otherwise `unknown`, for the owner to
  settle.
- The evidence for an error is Greenhouse's own answer (status and body, cut to 1,000
  characters), not the page's text, which is the posting.
- The security code is removed from the captured payload, like the reCAPTCHA token.
- A request that fails without any answer still ends the wait as `unknown`.
