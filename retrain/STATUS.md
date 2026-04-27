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

## Phase 5 — Fine-tune jobs submitted

Base model: `gpt-4.1-mini-2025-04-14`, n_epochs=2

| Section | Job ID | Env var | Train | Val | Status |
|---------|--------|---------|-------|-----|--------|
| 1_1 | `ftjob-tON27FPci18sSXE926iXfqGY` | `IRIS_MODEL_OBJECTIVES` | 14 | 1 | validating_files |
| 1_2 | `ftjob-lbbqO2cEeTlP9hZwJCghyH3n` | `IRIS_MODEL_SOTA` | 11 | 3 | validating_files |
| 1_3 | `ftjob-9qGEtcCnaRGBYLEACWbIZkxt` | `IRIS_MODEL_METHODOLOGY` | 9 | 1 | validating_files |
| 1_4 | `ftjob-x2g9EDB2HcNcRLogrpBdiyS3` | `IRIS_MODEL_INNOVATION` | 5 | 2 | validating_files |
| 2_1 | `ftjob-WhdDJR6jZ9wW2N6oleBJ2YfS` | `IRIS_MODEL_OUTCOMES` | 9 | 3 | validating_files |
| 2_2 | `ftjob-wHtbYyfIyzEl6gkQYeCy8fRf` | `IRIS_MODEL_DISSEMINATION` | 11 | 4 | validating_files |
| 2_3 | `` | `IRIS_MODEL_COMMUNICATION` | — | — | error |
| 3_1 | `` | `IRIS_MODEL_WORKPLAN` | — | — | error |
| 3_2 | `` | `IRIS_MODEL_MANAGEMENT` | — | — | error |
| 3_3 | `ftjob-nxNJvMkSnzWxIojpKXvshYM6` | `IRIS_MODEL_CONSORTIUM` | 12 | 1 | validating_files |
| 4 | `ftjob-qBlQUzkEpXNwZlPtccxWob0R` | `IRIS_MODEL_BUSINESS_CASE` | 24 | 3 | validating_files |

## Phase 5 — Round 4 resubmit (2_3, 3_1, 3_2)

| Section | Job ID | Env var | Train | Val |
|---------|--------|---------|-------|-----|
| 2_3 | `ftjob-4YF1DMkJFYMNn8YVtlaiSVnv` | `IRIS_MODEL_COMMUNICATION` | 6 | 2 |
| 3_1 | `ftjob-osV1ss2PknMPajlKT24skKJV` | `IRIS_MODEL_WORKPLAN` | 10 | 4 |
| 3_2 | `ftjob-1M3hLU5avG0sNWD5m9w1jjpp` | `IRIS_MODEL_MANAGEMENT` | 21 | 5 |

## Phase 5 — Round 5 (§1.3 methodology + §3.3 consortium, gender/SSH augmented)

| Section | Job ID | Env var | Suffix | Train | Val | Result |
|---------|--------|---------|--------|-------|-----|--------|
| 1_3 | `ftjob-9oZxxRyynhJcndPYYHrsq9Fr` | `IRIS_MODEL_METHODOLOGY` | `iris-r5-methodology` | 9 | 1 | **failed** — <10 examples |
| 3_3 | `ftjob-uoK3TomAsIUvuQLd7EQGTWTQ` | `IRIS_MODEL_CONSORTIUM` | `iris-r5-consortium` | 12 | 1 | **succeeded** → `ft:gpt-4.1-mini-2025-04-14:personal:iris-r5-consortium:DZ26hyof` (active in .env.local) |

## Phase 5 — Round 5 retry (§1.3, 10 examples)

| Section | Job ID | Env var | Suffix | Train | Val | Status |
|---------|--------|---------|--------|-------|-----|--------|
| 1_3 | `ftjob-TWBESuwbqRzPRWkocZMmHQw5` | `IRIS_MODEL_METHODOLOGY` | `iris-r5-methodology` | 10 | 1 | validating_files |

## Phase 5 — Round 6 (1_3, 1_4, 2_1, 2_3 — post first-person rewrite, 2026-04-27)

All training data rewritten to first-person plural via rewrite_to_firstperson.py.
Fingerprints generated to retrain/fingerprints/. All 11 sections confirmed 100% first_person_rate.

| Section | Job ID | Env var | Suffix | Train | Val | Status |
|---------|--------|---------|--------|-------|-----|--------|
| 1_3 | `ftjob-ugdb5YNwRsuIMfhYVKlK9D5h` | `IRIS_MODEL_METHODOLOGY` | `iris-r6-methodology` | 10 | 1 | validating_files |
| 1_4 | `ftjob-AfxUVAVQnlNeku479Lh98sYy` | `IRIS_MODEL_INNOVATION` | `iris-r6-innovation` | 5 | 2 | validating_files |
| 2_1 | `ftjob-4MYiX5Gup41bscZm8rB3b3bX` | `IRIS_MODEL_OUTCOMES` | `iris-r6-outcomes` | 9 | 3 | validating_files |
| 2_3 | `ftjob-YScpyJPl6sF2TqfP9E2ADHmp` | `IRIS_MODEL_COMMUNICATION` | `iris-r6-comms` | 6 | 2 | validating_files |

## Phase 5 — Round 6 resubmit (2_1, 2_3, 1_4 — after augmentation to ≥10 examples)

| Section | Job ID | Env var | Train | Val | Status |
|---------|--------|---------|-------|-----|--------|
| 2_1 | `ftjob-k4eGUsqfVMFdjeHbeNmUjzVj` | `IRIS_MODEL_OUTCOMES` | 10 | 3 | validating_files |
| 2_3 | `ftjob-lDGdoan33jF9ILgI9PfLfdj9` | `IRIS_MODEL_COMMUNICATION` | 10 | 2 | validating_files |
| 1_4 | `ftjob-FwRnWQpNnFyRYWi97Z5Owgvf` | `IRIS_MODEL_INNOVATION` | 10 | 2 | validating_files |
