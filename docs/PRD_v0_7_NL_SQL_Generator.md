# Natural Language SQL Generator PRD

## Problem Context
- Analysts and clinicians need quick ad-hoc views of patient metrics but rely on engineering for SQL, which slows decisions.
- Current UI offers fixed reports only, forcing manual SQL authoring for custom analysis.
- A read-only SQL generator powered by GPT-5-mini lets users ask questions in English or Russian, then copy vetted SQL for later execution.
- Desktop-first interface extends analytics tooling without running queries in-app, preserving database safety.

## Goals
- Accept natural-language questions (English/Russian) and return syntactically correct Postgres SQL scoped to the user’s read-only permissions.
- Surface generated SQL in the UI for easy copy, including inline guidance and error states.
- Maintain low latency (<6 s p95) from submission to SQL response for typical requests.
- Provide enough metadata (table names, assumptions) for users to vet queries before executing elsewhere.

## Non-Goals
- Executing SQL or showing live query results inside HealthUp.
- Supporting write operations, stored procedures, or non-Postgres dialects.
- Delivering mobile or tablet layouts in this phase.
- Automating schema-change handling without manual prompt updates.

## User Personas & Key Scenarios
- Data-savvy clinician: “Show all cholesterol tests over the last 12 months” → receives tenant-filtered SELECT with date window.
- Russian-speaking clinician: “Покажи все анализы на холестерин за последние 12 месяцев” → sees equivalent SQL.
- Operations analyst: “List missed appointments per clinic for Q2” → obtains aggregation query with GROUP BY guidance.
- Compliance reviewer: Validates generated SQL stays within read-only schema before auditing.

## Assumptions
- GPT-5-mini has access to schema metadata via embeddings or prompt injection; language detection/translation handled within prompt strategy.
- Schema remains largely static during launch window; manual updates acceptable.
- Users authenticate through existing HealthUp web app and already possess external read-only DB roles.
- Only English and Russian inputs are in scope; other languages deferred.

## Functional Requirements
- Accept free-form text up to 500 characters (supports English/Russian alphabets); inline validation for length and disallowed characters.
- On submit, backend enriches prompt with schema metadata, language hint, and requests SQL from GPT-5-mini.
- Display generated SQL in read-only text area with copy button and timestamp.
- Provide states: loading spinner, success with SQL, warning if model confidence is low, error message on failure or unsupported language.
- Log each request/response (user ID hash, prompt language, output, latency, confidence) for monitoring.

## UX & Interaction Requirements
- Desktop layout: left column input, right column SQL output; responsive down to 1024 px width.
- Helper text under question field with bilingual examples and privacy disclaimer.
- SQL syntax highlighting in monospaced font; 10-line viewport with scroll.
- “Regenerate” button reuses last prompt; notes previous attempt.
- Caution banner reminding users to review SQL before external execution; bilingual messaging.

## Technical Requirements
- Backend (Node/Express) exposes POST `/api/sql-generator` secured via existing auth middleware.
- Schema metadata sourced from `information_schema` snapshot cached daily; fallback default prompt if stale.
- GPT-5-mini invocation includes system prompt enforcing read-only operations, tenant scoping, language disambiguation, and default LIMIT guidance.
- Guardrails reject prompts containing blacklisted verbs (`INSERT`, `UPDATE`, `DELETE`, `DROP`, etc.) before LLM call.
- Store generations in `sql_generation_logs` Postgres table; keep 90-day retention.

## Data & Security
- Enforce tenant scoping: backend injects user/tenant filters into prompt context.
- API responses exclude PHI; logs store hashed IDs and redact prompts flagged as sensitive.
- Rate limit requests per user (e.g., 30/hour) to control usage and prevent schema probing.
- HTTPS for all traffic; GPT key managed via existing secrets manager.

## Analytics & Success Metrics
- Track daily active generators, average generations per user/session, and p95 latency.
- Monitor copy actions vs. generations to gauge usefulness.
- Keep rejection/error rate <5%; manual QA on 50 random bilingual queries weekly for correctness.

## Dependencies
- GPT-5-mini API availability and quota scaling.
- Schema snapshot job (cron or deployment hook).
- Frontend syntax-highlighting component (Prism or equivalent) with bilingual helper text support.
- Security review of logging strategy and multilingual prompt handling.

## Risks & Mitigations
- Incorrect/unsafe SQL → static validation, manual launch review, and bilingual QA.
- Latency spikes → caching identical prompts and queuing with timeout fallback.
- Schema drift → weekly prompt refresh, alerting on references to missing columns.
- User overtrust of SQL → persistent bilingual warnings and onboarding documentation emphasizing manual verification.

## Rollout Plan
- Week 1: Finalize schema metadata pipeline, bilingual UX copy, backend contract.
- Week 2: Implement backend endpoint, prompt templates with language support, logging, guardrails; internal tests with seeded English/Russian prompts.
- Week 3: Build frontend UI, integrate API, copy/regenerate interactions, analytics instrumentation.
- Week 4: QA with bilingual scenarios, schema drift tests, security review, internal beta (analyst and clinician groups).
- Week 5: Production rollout behind feature flag, monitor metrics, collect feedback, prepare V2 backlog.
