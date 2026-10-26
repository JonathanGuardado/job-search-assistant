# 0013 — Assisted applications before tailored documents

**Status:** accepted
**Date:** 2026-10-26

## Context

The plan ordered phase 2 as the application copilot (tailored resumes, cover letters,
grounded answers), phase 3 as agentic applications (browser automation, auto-apply), and
phase 4 as intelligence (email parsing, analytics). After using phase 1, the owner asked for
something else first: the system should send applications it can complete on its own, hand
back any it cannot (CAPTCHA, an account wall, an unanswerable question) for the owner to
finish, and read follow-up emails to keep the tracker current.

A look at a real Greenhouse posting (Canonical, 2026-10-26) showed what that means:

- Greenhouse's public job board API returns each posting's application questions with
  their labels, types, options and whether they are required
  (`/v1/boards/<token>/jobs/<id>?questions=true`). 21 of the 26 sources are Greenhouse.
  The questions can be known before any form is opened.
- One posting asked 24 questions: contact fields, a resume, yes/no and multiple-choice
  questions, demographic questions, and several required essays.
- It also required the attestation "During this application process I agree to use only
  my own words." No answer to such a posting may be written by the system.

## Decision

Phase 2 becomes **assisted applications**, in this order:

1. **2.1 Saved answers and application readiness.** The owner writes their standard answers
   once. For each job the owner can apply to, the system fetches its questions, maps each
   to a saved answer, and states whether it could fill the whole form or which questions
   block it. No form is opened yet.
2. **2.2 Form filling in approval mode** (Greenhouse first): the system fills the form, the
   owner sees exactly what will be sent, and submits from the app. Browser automation and
   its dependency arrive here, with their own decision record.
3. **2.3 Automatic submission** under the owner's rules (roles, companies, daily cap), with
   a confirmation screenshot stored on the application. Anything blocked stays in "Can
   apply", marked "Apply yourself" with the reason.
4. **2.4 Read-only email.** Follow-ups from a label or folder the owner chooses become
   suggested stage changes, confirmed by the owner. The provider and access method are
   decided then.

Grounded written answers, tailored resumes and cover letters move after these, and are
never produced for a posting that requires the candidate's own words.

Rules that hold throughout:

- **Only jobs eligibility found the owner can take.** Nothing in "Needs review", "Probably
  onsite", "Needs a visa" or "Not eligible" is ever sent automatically.
- **Answers come from the owner, never from a model.** A model may recognize which saved
  answer a question asks for (structured output, rule 3); the value sent is always the
  owner's own. A required question with no saved answer is a blocker.
- **No CAPTCHA is solved or bypassed.** A CAPTCHA is a blocker.
- **An own-words attestation is a blocker** for anything beyond the owner's saved answers.

## Consequences

- Phase 1's milestone gates (the owner's trial week, one logged application) still close
  phase 1 before 2.2 ships; 2.1 needs no browser and can be planned now.
- Applications gain a submission mode (`manual` or `automatic`), added with 2.3.
- Most Canonical postings will be blocked until written answers exist, and those that
  require the candidate's own words stay manual by design.
