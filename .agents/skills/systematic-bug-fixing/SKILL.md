---
name: systematic-bug-fixing
description: Use whenever a bug, error, exception, failing test, crash, or unexpected behavior appears. Enforces reproduce-then-diagnose-then-prove debugging and blocks unverified or symptom-level fixes.
---

# Systematic Bug Fixing

## The core rule

Find the root cause before changing any code. A fix that makes the symptom disappear
without an explanation of the mechanism is not a fix, it's a disguise. You will be
judged on whether the bug is actually gone, not on how fast you produced a diff.

Two failure modes to avoid above all else:

1. **Guess-and-check.** Trying plausible edits until the error stops printing. This
   burns time, and it silently introduces new bugs because each speculative edit stays
   in the tree.
2. **Declaring victory without evidence.** Agents routinely report "fixed" on work that
   is partly or wholly unimplemented. Assume your own claim of success is untrustworthy
   until a command you actually ran proves it.

## Phase 1 — Read the error, exactly

Before theorizing, extract the literal facts:

- The full error message and complete stack trace, not a paraphrase.
- The deepest frame that lives in *our* code, that's usually where to start reading.
- Exact file, line, and the values involved.
- What changed recently. Check version control history around the failing area first;
  "what did we just change" solves a large share of bugs in one step.

If the error text is ambiguous or comes from a dependency, look up that exact string
rather than inferring what it probably means.

## Phase 2 — Reproduce reliably

Get a command that fails on demand, and write it down. Ideally the smallest one:
a single test, a single request, a minimal script.

If you cannot reproduce it, do not start fixing. Instead: add logging or an assertion
that will capture the state next time, ask for the conditions that trigger it, or narrow
by environment. Fixing an unreproduced bug is guessing with extra steps.

Intermittent failures are still reproducible: run it in a loop, force ordering, or
shrink timing windows until it fails consistently. A flaky repro means you don't yet
understand the trigger.

## Phase 3 — Localize

Shrink the search space before you theorize about mechanisms.

- Bisect: comment out, stub, or short-circuit halves of the path to find which side fails.
- Trace the real data. Print or breakpoint the actual values at the boundaries between
  components, don't assume what a function returns, verify it.
- Check the boring causes early: stale build artifacts, cached dependencies, wrong branch,
  wrong environment variables, a service that isn't running, a schema that doesn't match.
  These waste the most time precisely because they feel beneath suspicion.

## Phase 4 — Hypothesize and prove

State one hypothesis at a time, in the form: *"X fails because Y, and if that's true then
Z must be observable."* Then run the cheapest experiment that could **disprove** it.

Do not edit production code to test a hypothesis. Observe first (logs, debugger, a
throwaway script). Editing to test conflates diagnosis with fixing and leaves debris.

You have the root cause when you can explain the entire causal chain from trigger to
symptom, with observed evidence at each link, and you can predict a *new* behavior that
you hadn't seen before and be right. If any link is "probably" or "I assume", keep going.

## Phase 5 — Fix minimally, at the cause

- Fix the mechanism you proved, not the place the error surfaced. The crash site is
  usually the victim, not the culprit.
- Change the smallest amount of code that addresses that cause. No opportunistic
  refactors, cleanups, formatting, or renames in a bug fix, they hide the real change
  in review and make bisecting the next bug harder.
- If the correct fix is large or architectural, say so and get agreement before doing it.
- Then search the codebase for the same mistake elsewhere. Bugs of a class rarely occur
  once, and this is the highest-value minute you'll spend.

## Phase 6 — Verify with evidence

Do not report a fix without all of these:

- The exact repro from Phase 2 run again, now passing. Paste the real output.
- A regression test that fails on the old code and passes on the new one. If it passes
  on the old code too, it isn't testing the bug.
- The broader test suite and type checker / linter run, to prove you didn't trade one
  bug for another.
- A quick read of your own diff, line by line, asking what else consumes the thing you
  changed.

If you couldn't run something, state that plainly instead of implying it passed.

## Fake fixes — reject these in your own work

Each of these makes a symptom vanish while the defect survives:

- Widening a `try/catch` or swallowing an exception so the error stops appearing.
- Adding a null/undefined guard at the crash site without answering *why* it's null.
- Increasing a timeout, adding a sleep, or wrapping a retry around a deterministic failure.
- Loosening an assertion, skipping the test, or editing the expected value to match the
  actual output. The test was probably right and the code wrong.
- Silencing the compiler with `any`, `# type: ignore`, casts, or suppression pragmas.
- Pinning to an older dependency version without identifying which change broke you.
- Rewriting a whole file to avoid understanding the ten lines that are broken.

If one of these genuinely is the right answer (an upstream bug, a real race that needs
backoff), you must be able to explain the underlying mechanism first. That's the test.

## When you're stuck

After roughly three disproven hypotheses, stop editing and reset. More attempts along
the same line will not work, because the problem is your model of the system, not your
luck.

Write out two lists: what you have *observed* to be true, and what you have been
*assuming*. Then attack the assumptions. Common culprits: you're not running the code you
think you're running, the input isn't shaped how you think, the failure happened long
before the error surfaced, or the bug is in the test rather than the code.

Then re-read the original error from scratch as if you'd just arrived. Escalate to the
user with your evidence rather than continuing to churn, an accurate "here's what I know
and where I'm blocked" is more useful than another speculative diff.

## Report like this

- **Symptom** — what was observed, and the repro command.
- **Root cause** — the mechanism, in one or two sentences.
- **Why it happened** — the change or assumption that introduced it.
- **Fix** — what you changed and why that's the right layer.
- **Evidence** — commands run and their real output, including the new regression test.
- **Blast radius** — anything else touching this, and where the same bug class may exist.
