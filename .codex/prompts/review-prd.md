---
description: Review PRD and persist analysis as a durable project artifact
argument-hint: <path-to-prd>
---

You are reviewing the Product Requirements Document at: $1

The PRD path is provided as the first positional argument. If `$1` is empty, STOP and ask the user to provide the PRD path.

Your goal is NOT to respond in chat.

Your goal IS to create or update a persistent review file inside the repository so that other engineers and agents can read it later.

---

## Output Rules (Critical)

1. You MUST write your output to a file.
2. If the file does not exist, you MUST create it.
3. You MUST NOT require any manual copy-paste by a human.
4. You MUST NOT modify the PRD itself.
5. The result MUST be readable by a mid-level software engineer without additional explanation.

---

## File Location & Naming

- Create (or update) a file at:

  `.codex/reviews/<PRD_FILENAME>.review.md`

  Example:
  - PRD: `docs/PRD_v4.2_chat_thumbnails.md`
  - Review file: `.codex/reviews/PRD_v4.2_chat_thumbnails.review.md`

- If a review file already exists, overwrite it fully with the new analysis.

---

## What to Analyze

Evaluate the PRD against the CURRENT CODEBASE.

You may inspect source files if needed.

Focus on:

### 1. Feasibility
- Can this be implemented with the existing architecture?
- Are there missing assumptions?
- Are any requirements underspecified or impossible?

### 2. Engineering Clarity
- Can a mid-level engineer implement this without asking questions?
- Where would they likely get stuck?

### 3. Hidden Complexity
- Concurrency issues
- Data model mismatches
- Performance traps
- State synchronization problems

### 4. Scope Control
- What is clearly MVP?
- What should explicitly be deferred?

---

## Required Review Structure

Your output file MUST follow this structure exactly:

```md
# PRD Review — <PRD title>

## Summary Verdict
(One of: APPROVABLE / APPROVABLE WITH FIXES / BLOCKED)

## High-Risk Issues
(List only issues that can break the implementation or cause rework)

## Medium-Risk Issues
(Ambiguities, missing constraints, unclear ownership)

## Low-Risk / Nice-to-Have Notes
(Polish, clarity, future improvements)

## Concrete Suggestions
(Actionable changes to the PRD wording or scope — not code)

## MVP Safety Check
(Explain whether this PRD is safe to ship to early users)```