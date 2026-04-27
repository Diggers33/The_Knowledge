# PROMPT_SHAPES.md

Documents the exact prompt structure that IRIS fine-tuned models are trained to respond to.
Derived from `app/api/proposal/route.ts` (as at 2026-04-27).

---

## 1. Message Structure (all sections)

Every model call follows the OpenAI Chat Completions format:

```
messages: [
  { role: "system",  content: <SYSTEM_PROMPT> },
  { role: "user",    content: <USER_MESSAGE>  },
]
```

---

## 2. System Prompt Layers

The system prompt is assembled by concatenating blocks in this order:

### 2a. Per-section system prompt (from `SECTION_SYSTEM_PROMPTS` or `BASE_SUBSECTION_GUARDRAILS + SUBSECTION_SYSTEM_BLOCKS`)

For **multi-pass sections** (methodology, objectives, pathways, measures, capacity):
```
BASE_SUBSECTION_GUARDRAILS
+ "\n\n"
+ SUBSECTION_SYSTEM_BLOCKS["{sectionId}.{anchor}"]
```

For **single-pass sections** (workplan, summary, sota, etc.): a bespoke system prompt is constructed inline per section from `SECTION_SYSTEM_PROMPTS`.

### 2b. STYLE_ENFORCEMENT (appended to every prompt)

```
VOICE: Write in first person plural — "we", "our", "we will develop", "our approach".
Never use the project acronym as the grammatical subject...

SENTENCE STRUCTURE: Vary sentence length...

METRICS AND EVIDENCE: Never assert a target figure without...

CROSS-REFERENCING: Check previously written sections. Do not restate...

TASK DESCRIPTIONS: **Task X.Y: [Task name]** (Lead: PARTNER; Partners: A, B, C)
  Then 3-5 sentences prose.

TASK DESCRIPTION VARIETY: Rotate through openers...

FORBIDDEN PHRASES: [see full list in route.ts STYLE_ENFORCEMENT block]

NUMBERS AND SPECIFICITY: Use real, specific numbers...
```

### 2c. BASE_GUARDRAILS (appended after STYLE_ENFORCEMENT for single-pass)

```
DEGENERACY GUARD: If you detect yourself entering a word or phrase loop — STOP...
UNIQUENESS REQUIREMENT: No sentence or 6+ word phrase may appear more than once...
```

### 2d. MODE_INSTRUCTION (for single-pass sections)

Injected based on section mode:
- `INTERNAL` — ground in IRIS project data; numbered citations [N] for specific claims
- `EXTERNAL` — SotA only; cite only from provided research blocks; strict structure (approaches → advances → gaps → why timely)
- `HYBRID` — combine external landscape with IRIS position

---

## 3. User Message Structure

### Multi-pass subsection user message:

```
## Call / Topic
<sanitised call text, first 1500 chars>

## Project brief
Acronym: <brief.acronym>
Call ID: <brief.callId>
Partners: <partner list with roles>
TRL: <trlStart> → <trlEnd>
Technologies: <irisTechnologies>

## IRIS KB context
<Supabase RAG chunks numbered [1]..[N]>

## Already-written sections
<previously saved section text>

## Partner count
<N partners in consortium>

## Subsection task
Write ONLY the subsection: "<subsection title>"
Target: ~<targetWords> words
Do NOT write the heading.

<QUALITY_RULES>

<focusBullets from Pass 1 outline, if present>

CROSS-SECTION BOUNDARIES: <from SUBSECTION_SYSTEM_BLOCKS[key]>
```

### Single-pass section user message:

```
## Call / Topic
<sanitised call text>

## Project brief
<same brief block>

## IRIS KB context (project summaries + RAG chunks)
<dimension summaries from project_summaries>
<RAG chunks [1]..[N]>
<SotA research sources for EXTERNAL sections>

## Already-written sections
<previously saved sections>

## Instructions
Write the <Section Label> section for a Horizon Europe Part B proposal.
[Section-specific length instruction]
```

---

## 4. Section → Model Mapping

| Section ID | Mode | Fine-tuned model env var | Multi-pass |
|------------|------|--------------------------|------------|
| `objectives` | INTERNAL | `IRIS_MODEL_OBJECTIVES` | Yes (5 subsections, 1600w total) |
| `methodology` | INTERNAL | `IRIS_MODEL_METHODOLOGY` | Yes (8 subsections, 4000w total) |
| `pathways` | HYBRID | `IRIS_MODEL_OUTCOMES` | Yes (6 subsections, 2400w total) |
| `measures` | INTERNAL | `IRIS_MODEL_DISSEMINATION` | Yes (5 subsections, 2000w total) |
| `capacity` | INTERNAL | `IRIS_MODEL_CONSORTIUM` | Yes (4 subsections, 2000w total) |
| `sota` | EXTERNAL | `IRIS_MODEL_SOTA` | No |
| `workplan` | INTERNAL | `IRIS_MODEL_WORKPLAN` | No |
| `summary` | INTERNAL | — (gpt-4o fallback) | No |
| `dissemination` | INTERNAL | `IRIS_MODEL_DISSEMINATION` | No (legacy) |
| `communication` | INTERNAL | `IRIS_MODEL_COMMUNICATION` | No (legacy) |
| `management` | INTERNAL | `IRIS_MODEL_MANAGEMENT` | No (legacy) |
| `business_case` | INTERNAL | `IRIS_MODEL_BUSINESS_CASE` | No (legacy) |
| `innovation` | HYBRID | `IRIS_MODEL_INNOVATION` | No |

---

## 5. Key Constants and Their Effect on Training

| Constant | Purpose | Fine-tune implication |
|----------|---------|----------------------|
| `STYLE_ENFORCEMENT` | Voice, sentence structure, forbidden phrases, task format | Every assistant turn must follow all rules |
| `BASE_SUBSECTION_GUARDRAILS` | Subsection-scope rules (no headings, no summaries, cite density) | Multi-pass models must NOT write headings or closing paras |
| `SUBSECTION_SYSTEM_BLOCKS` | Per-subsection MUST INCLUDE + CROSS-SECTION BOUNDARIES | Each subsection model must stay strictly in-scope |
| `QUALITY_RULES` | No meta-commentary, no filler, stop if content exhausted | Models must write dense, specific content only |
| `BASE_GUARDRAILS` | Anti-degeneracy, uniqueness | Especially critical for long sections (methodology) |
| `MODE_INSTRUCTION[EXTERNAL]` | SotA-specific citation rules | SotA model must ONLY cite from provided sources |

---

## 6. Length Retry Behaviour (inference, not training)

Single-pass sections with output below 75% of target are retried up to 3 times with an extension hint from `SUBSECTION_EXTENSION_HINTS`. Multi-pass subsections below 85% of `targetWords` are retried once with fresh sub-topics.

Training data should reflect the **target length** for each section — examples that are 50% of target should not appear in training JSONL.

---

## 7. Contamination Filter (post-generation, not a prompt)

All model output passes through `lib/contamination-filter.ts` after generation:
- Strips call-portal boilerplate (`call_portal_scrape` category)
- Strips past-project references that would reveal training data (`past_project`)
- Strips prompt leaks (`prompt_leak`)
- Strips self-references (`self_reference`)

Training data must not contain any of these patterns.
