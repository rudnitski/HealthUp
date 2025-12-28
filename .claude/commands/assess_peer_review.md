You are reviewing peer review feedback on code YOU wrote. Your goal: honest, critical assessment - not automatic agreement or defensiveness.

You will receive:
1. Optionally, a *path* to a peer-review file (written by Codex or a human) as the argument.
2. Your original codebase.

If the path argument is omitted, you MUST automatically locate the peer-review file in the `.codex/reviews/` directory.
It is guaranteed that exactly ONE file will exist in that directory in this case.
The peer-review file name will always correspond to the reviewed PRD/code context and is sufficient to infer what was reviewed.

## How to ingest the review
- Interpret `#$ARGUMENTS` as an optional single path (it may be relative to repo root or absolute).
- If `#$ARGUMENTS` is empty or missing, you MUST:
  1) Inspect the `.codex/reviews/` directory
  2) Locate the single existing review file
  3) Use that file as the peer-review input
- If `#$ARGUMENTS` is provided, use it exactly as the peer-review file path.
- Read the resolved file from disk and treat its contents as the peer review input.
- If the resolved file does not exist or is empty, STOP and output an error explaining what path was resolved and what you expected.
- If `.codex/reviews/` contains ZERO files when no argument is provided, STOP and explain that you expected exactly one review file there.
- If `.codex/reviews/` contains MORE THAN ONE file when no argument is provided, STOP and explain that you expected exactly one review file there.
- If the file contains YAML frontmatter or metadata, keep it as context but focus your analysis on the substantive review content.

For each issue you find in the review file, evaluate rigorously:

**1. Is the reviewer correct about the facts?**
- Do they accurately describe what the code does?
- Are their assumptions about the codebase correct?
- Did they miss context or misunderstand the requirements?

**2. Is their concern actually valid?**
- Valid: Genuine bug, poor practice, or improvement needed → Accept and fix
- Invalid: Based on misunderstanding, incorrect assumptions, or wrong → Respectfully disagree with evidence
- Debatable: Different approaches, trade-offs → Discuss pros/cons

**3. Burden of proof:**
- The reviewer must make a clear, specific case
- Vague concerns like this seems wrong need clarification
- You should push back on unclear or unsubstantiated issues

**4. Evidence requirement:**
- When responding, cite concrete code locations (file paths + function names, and line numbers if available).
- If you cannot find the referenced code, say so explicitly and treat the issue as unproven until located.

Output format:
## Issue [N]: [Title]
**Understanding**: [Restate the concern accurately]
**Fact check**: [Are their observations correct?]
**Assessment**: [Valid/Invalid/Debatable - with clear reasoning]
**Response**:
- If Valid: [Admit issue + proposed fix]
- If Invalid: [Explain why with evidence/code references]
- If Debatable: [Present your reasoning + trade-offs considered]

Guidelines:
✓ Be intellectually honest - change your mind when wrong
✓ Defend good decisions with clear reasoning
✓ Request clarification for vague feedback
✗ Don't accept criticism just to seem agreeable
✗ Don't reject criticism just to seem confident:

---

<peer_review_path>
#$ARGUMENTS
</peer_review_path>

<peer_review>
(You MUST populate this by reading the file at <peer_review_path>. Do not treat the argument as the review content.)
</peer_review>

## Review Lifecycle Rule (Critical)

- This peer-review file is a temporary coordination artifact.
- Once all fixes implied by the review have been fully implemented and verified, this peer-review file MUST be deleted.
- You MUST NOT keep stale peer-review files after fixes are completed.
- The absence of a peer-review file indicates there is no outstanding review feedback to assess.
