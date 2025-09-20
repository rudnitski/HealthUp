
# PRD v0.3 — Enhanced Lab Results Parsing

## Purpose
Extend lab analysis so that, in addition to detecting Vitamin D, the system also extracts the patient’s name, date of birth, the date of the check-up, and the reference interval for Vitamin D.

## Scope
- The system must be able to recognize and return:
  - Patient name
  - Date of birth
  - Date of the check-up (use the specimen collection date when available)
  - Vitamin D measurements (if present)
  - Reference interval bounds and qualifiers for each Vitamin D measurement (if present)

- Each distinct Vitamin D analyte (e.g., Vitamin D2, Vitamin D3, Total 25(OH)D) must be returned as a separate result item.

- If a piece of information is not present in the document, the system must indicate that it is missing.
- If Vitamin D is not found in the report, the system must clearly indicate its absence.

## User Story
As a user, I want to upload a lab report and receive back not only my Vitamin D result but also my identifying information and the relevant reference interval, so that I can understand my results in context.

## Acceptance Criteria
- The system consistently identifies patient name, date of birth, and check-up date when they are present.
- The system consistently identifies Vitamin D results and their reference interval bounds when they are present.
- Multiple Vitamin D entries in a single report are all returned individually.
- When information is absent, the system indicates that it is missing.
- When Vitamin D is absent from the report, the system indicates that clearly.

## Test Scenarios
1. A lab report that contains all required information → all values are returned.
2. A lab report with Vitamin D missing → system indicates absence of Vitamin D.
3. A lab report with no patient name → system indicates name is missing.
4. A lab report with no date of birth → system indicates date of birth is missing.
5. A lab report with unusual unit or format → system still returns the detected values.
