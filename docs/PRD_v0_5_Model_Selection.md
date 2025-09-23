
# PRD v0.5 — Model Selection for Lab Report Analysis

## Purpose
Allow users to choose which AI model is used to analyze their uploaded lab reports, enabling flexibility between the default model currently in use and the more advanced GPT-5.

## Scope
- The system must support two selectable model options:
  - **Current model** (default: value of `OPENAI_VISION_MODEL`, falling back to `gpt-4o-mini`).
  - **GPT-5**.
- Users must provide the desired model through the `model_variant` field in the request body when submitting an analysis job.
- If no model is specified, the system must default to the current model.
- The system must validate the requested model and fall back to the current model if an unsupported option is provided, while emitting a structured warning for observability.
- The analysis response metadata must surface the model actually used via a `model_used` field.

## User Story
As a user, I want to select which AI model processes my lab report (either the current model or GPT-5), so that I can choose between faster/cheaper processing and maximum accuracy.

## Acceptance Criteria
- [ ] Requests accept a **model_variant** parameter in the request body.
- [ ] Supported values: `"current"` and `"gpt-5"`.
- [ ] When `"current"` is chosen, the system uses the default configured model.
- [ ] When `"gpt-5"` is chosen, the system uses GPT-5.
- [ ] When an unsupported value is provided, the system defaults to the current model and records a warning (e.g., structured log flag).
- [ ] The analysis response includes the model actually used in a `model_used` metadata field.

## Test Scenarios
1. **Default behavior**: request without specifying model → processed by the current default model.
2. **Explicit current**: request with model `"current"` → processed by the default model.
3. **Explicit GPT-5**: request with model `"gpt-5"` → processed by GPT-5.
4. **Invalid value**: request with unsupported model string → processed by default model.
5. **Response check**: analysis response contains which model was used.
