# PRD v0.5 — Model Selection for Lab Report Analysis

## Purpose
Give HealthUp users control over which AI model analyzes each uploaded lab report so they can balance speed, cost, and accuracy without waiting for engineering to change configuration.

## Background
The current pipeline always calls the vision model defined by `OPENAI_VISION_MODEL` (default `gpt-4o-mini`). Clinical partners want the option to run critical reports through GPT-5 for higher accuracy, while retaining the faster default for routine uploads. We need a lightweight way to choose the model per job without duplicating code paths or fragmenting logs.

## Goals
- Ensure every lab analysis request can target either the default model or GPT-5 at submission time.
- Keep the integration surface area small so existing clients can adopt the feature with minimal change.
- Provide clear observability about which model executed each job for debugging, billing, and analytics.

## Non-Goals
- Retraining or fine-tuning any models.
- Changing prompts, schemas, or downstream parsing logic.
- Persisting user-level model preferences beyond the single request.
- Supporting more than the two models listed in this release.

## Scope
- **In Scope**: Extend the `/api/analyze-labs` request contract, update the upload form UI, add model dispatch logic on the server, surface the model in the response payload, emit structured warnings for invalid selections.
- **Out of Scope**: Rate limiting changes, billing integrations, UI polish beyond adding the selector, automated selection heuristics, dataset updates.

## User Story
As a HealthUp user uploading a lab report, I want to choose between the current default model and GPT-5 so I can opt into the model that best matches my needs for that report.

## User Flows
1. **Web upload**: User visits the upload form, selects a file, chooses either "Default model" or "GPT-5" from a new selector (defaults to current model), submits; the system shows progress and returns results annotated with the model used.
2. **API client**: Integrator posts a multipart request to `/api/analyze-labs` with `analysisFile` and optional `model_variant`; response body includes `model_used`, allowing the client to audit which model ran.

## Functional Requirements
- **Request contract**: Accept optional `model_variant` string (multipart field and JSON override) with allowed values `current` and `gpt-5`; trim and lowercase input before evaluation.
- **Default behavior**: If `model_variant` is missing, empty, or unrecognized, run the job with the configured default model (`OPENAI_VISION_MODEL` fallback `gpt-4o-mini`).
- **GPT-5 dispatch**: Map `model_variant=gpt-5` to the GPT-5 API name (configurable via env such as `OPENAI_GPT5_MODEL`, default literal `gpt-5`).
- **Response payload**: Add `model_used` string to the top-level metadata object returned to clients and to any logged job summary.
- **Progress updates**: Include the model choice in the pipeline progress log entries already streamed to clients when feasible (e.g., augment `openai_request` step message with model identifier).
- **Observability**: Emit a structured warning event when an unsupported model is requested, with fields for `requested_model`, `fallback_model`, and request id; count occurrences via existing logging stack.

## Non-Functional Requirements
- **Performance**: Introducing model selection must not increase request latency by more than 5% for the current model path.
- **Reliability**: Fallback logic must succeed even if GPT-5 is temporarily unavailable; degrade gracefully to the default model without user-visible errors.
- **Security**: Continue validating file uploads; reject attempts to inject script content through `model_variant` (treat as plain text, limit length to 32 chars).
- **Accessibility**: The new selector on the upload form must be keyboard-navigable, labeled, and compatible with screen readers.

## Data & Configuration
- **Environment variables**: `OPENAI_VISION_MODEL` continues to define the current default; introduce optional `OPENAI_GPT5_MODEL` for override, defaulting to `gpt-5` when unset.
- **Telemetry**: Extend analytics or log ingestion to capture requested vs. actual model for each job id.
- **Documentation**: Update README and API docs to describe the new parameter and response field.

## Observability
- **Logging**: Standardize log line format `{ event: 'model_selection', requested, used, reason }` at the start of each job.
- **Alerts**: Create a lightweight alert or dashboard widget if fallback-to-default occurs more than 5% of the time over a rolling hour, signaling GPT-5 instability.
- **Tracing**: Tag existing traces/spans with `model_used` so performance comparisons between models are trivial.

## Success Metrics
- **Adoption**: ≥30% of partner-initiated jobs use GPT-5 within two weeks of release (measured via log aggregation).
- **Accuracy feedback**: Support tickets citing incorrect extraction drop by 15% for jobs that opted into GPT-5 compared to baseline.
- **Reliability**: Fewer than 1% of GPT-5 requests fall back due to errors after launch week.

## Rollout Plan
- **Phase 1**: Ship server-side support hidden behind feature flag, validate via internal API clients.
- **Phase 2**: Enable selector in the upload form for beta partners; monitor fallback rate and latency.
- **Phase 3**: Publicly document and announce the parameter once stability and metrics meet targets.

## Acceptance Criteria
- [ ] Requests accept a `model_variant` parameter in the request body.
- [ ] Supported values: `current` and `gpt-5`.
- [ ] When `current` is chosen, the system uses the default configured model.
- [ ] When `gpt-5` is chosen, the system uses GPT-5 (respecting `OPENAI_GPT5_MODEL` when set).
- [ ] When an unsupported value is provided, the system defaults to the current model and records a structured warning.
- [ ] The analysis response includes the model actually used in a `model_used` metadata field.

## Test Scenarios
1. **Default behavior**: request without specifying model → processed by the current default model.
2. **Explicit current**: request with model `current` → processed by the default model.
3. **Explicit GPT-5**: request with model `gpt-5` → processed by GPT-5.
4. **Invalid value**: request with unsupported model string → processed by default model and warning emitted.
5. **Response check**: analysis response contains `model_used` field reflecting the executing model.

## Open Questions
- Do we need separate rate limits or billing rules for GPT-5 usage at launch?
- Should we expose additional metadata (e.g., estimated cost) when GPT-5 is selected?
