# Retrain run log

## Phase 0 complete @ 2026-04-25
- Python: 3.10.10
- Node: v22.13.1
- OpenAI key present: yes (loaded from .env.local)
- Vercel CLI authed: not yet checked (needed for Phase 8 only)

## Phase 5 — Fine-tune jobs submitted

Base model: `gpt-4.1-mini-2025-04-14`, n_epochs=2

| Section | Job ID | Env var | Train | Val | Status |
|---------|--------|---------|-------|-----|--------|
| 1_1 | `ftjob-QHTS6uObQWS3HVxNSKvgjVY1` | `IRIS_MODEL_OBJECTIVES` | 11 | 0 | validating_files |
| 1_2 | `ftjob-ZazOQl4xu1xCmccrmrs5jSIM` | `IRIS_MODEL_SOTA` | 5 | 1 | validating_files |
| 1_3 | `ftjob-shH8labLNo8r4IxZa06HQaYy` | `IRIS_MODEL_METHODOLOGY` | 4 | 1 | validating_files |
| 1_4 | `` | `IRIS_MODEL_INNOVATION` | — | — | skipped |
| 2_1 | `ftjob-OwkWI7bD2gbCwMz8Ece0UsrZ` | `IRIS_MODEL_OUTCOMES` | 8 | 1 | validating_files |
| 2_2 | `ftjob-jyWZXBEO1apDVoPDCgxxVNGD` | `IRIS_MODEL_DISSEMINATION` | 11 | 2 | validating_files |
| 2_3 | `ftjob-m8bO5FfG0TFv2qGVgio7lBm9` | `IRIS_MODEL_COMMUNICATION` | 7 | 0 | validating_files |
| 3_1 | `` | `IRIS_MODEL_WORKPLAN` | — | — | error |
| 3_2 | `` | `IRIS_MODEL_MANAGEMENT` | — | — | error |
| 3_3 | `` | `IRIS_MODEL_CONSORTIUM` | — | — | error |
| 4 | `ftjob-TimOjJJwNABwfIliQSWqUSR7` | `IRIS_MODEL_BUSINESS_CASE` | 30 | 4 | validating_files |
