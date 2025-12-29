---
description: Interview about a PRD/feature and refine it for implementation
argument-hint: <prd-file-or-feature-description> [comments]
---

Read the PRD or feature description at $1 and my comments in $2 (if provided).

Before asking questions, review:
- CLAUDE.md for project context
- docs/ folder for previously implemented PRDs as reference
- Relevant parts of the codebase to understand existing patterns and constraints

Interview me using AskUserQuestionTool to clarify and deepen the spec. Focus on:
- Edge cases and error states not covered
- Data model and state management implications
- Integration points with existing code
- UX flows that seem underspecified
- Technical tradeoffs worth discussing
- Security or performance considerations if applicable

Skip questions already answered by the codebase or existing docs.

Continue until:
- All user flows have clear acceptance criteria
- Technical approach is unambiguous for an LLM coding agent
- Edge cases are documented

Then:
- If $1 was an existing PRD file, update it with the finalized spec
- If $1 was a feature description, create a new PRD file in docs/

Embed all decisions directly in the spec text—no separate decision log.