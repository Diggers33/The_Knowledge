#!/usr/bin/env python3
"""Phase 6: Eval gate for per-section fine-tuned models.

Checks:
  1. Regurgitation — does output contain verbatim 7-grams from training data?
  2. Style fidelity — first-person plural, EU Horizon task format (**Task X.Y**)
  3. Output length — must exceed 150 words
  4. Grant number leakage — no Horizon grant IDs in output
  5. Forbidden phrases — STYLE_ENFORCEMENT violations
  6. Recursive heading degeneration — catches 1.1.1.1.1.1... loops

Uses a production-equivalent prompt: dummy call text, brief, and KB context chunks
that match the structure the models were trained on.
"""

import json, os, re
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(".env.local"))
from openai import OpenAI
client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

TRAINING_DIR = Path("./retrain/training")
GRANT_RE     = re.compile(r"\b(101\d{6}|1\d{8}|\d{9})\b")
TASK_RE      = re.compile(r"\*\*Task\s+\d+\.\d+\*\*")
RECURSIVE_HEADING_RE = re.compile(r"(\d+\.){4,}")  # e.g. 1.1.1.1.

FORBIDDEN_PHRASES = [
    "poised to deliver", "transformative outcomes", "holistic approach",
    "embodies", "resonates with", "aligns with", "underscores the importance",
    "it is worth noting", "leverages its expertise", "in summary",
    "needless to say", "state-of-the-art", "in conclusion",
    "well-positioned to", "revolutionize", "revolutionise",
]

SECTION_MODELS = {
    "1_1": (os.environ.get("IRIS_MODEL_OBJECTIVES"),    "Objectives and ambition"),
    "1_2": (os.environ.get("IRIS_MODEL_SOTA"),          "State of the art and innovation"),
    "1_3": (os.environ.get("IRIS_MODEL_METHODOLOGY"),   "Methodology and approach"),
    "1_4": (os.environ.get("IRIS_MODEL_INNOVATION"),    "Ambition and innovation beyond the state of the art"),
    "2_1": (os.environ.get("IRIS_MODEL_OUTCOMES"),      "Expected outcomes and impacts"),
    "2_2": (os.environ.get("IRIS_MODEL_DISSEMINATION"), "Dissemination, exploitation and communication"),
    "2_3": (os.environ.get("IRIS_MODEL_COMMUNICATION"), "Communication and open science"),
    "3_1": (os.environ.get("IRIS_MODEL_WORKPLAN"),      "Work plan and work packages"),
    "3_2": (os.environ.get("IRIS_MODEL_MANAGEMENT"),    "Management structure and procedures"),
    "3_3": (os.environ.get("IRIS_MODEL_CONSORTIUM"),    "Consortium as a whole"),
    "4":   (os.environ.get("IRIS_MODEL_BUSINESS_CASE"), "Business case and exploitation strategy"),
}

# ── Production-equivalent system prompt ───────────────────────────────────────
# Mirrors STYLE_ENFORCEMENT + BASE_GUARDRAILS from route.ts
SYSTEM = """You are an expert EU Horizon Europe proposal writer for IRIS Technology Solutions, a photonics and NIR spectroscopy SME based in Barcelona, Spain. You write high-quality, evidence-based proposal sections in first-person plural.

VOICE:
Write in first person plural throughout — "we", "our", "we will develop", "our approach".
Never use the project acronym as the grammatical subject of a sentence.

SENTENCE STRUCTURE:
Vary sentence length deliberately. Use a short declarative statement to introduce an idea, then a longer sentence with supporting evidence or detail.

METRICS AND EVIDENCE:
Never assert a target figure without showing the reasoning or source.

TASK DESCRIPTIONS (for Implementation and Methodology sections):
Use bold task labels with partner attribution.
Format: **Task X.Y: [Task name]** (Lead: PARTNER; Partners: A, B, C)
Then describe the task in 3-5 sentences of flowing prose.

FORBIDDEN PHRASES — never use: poised to deliver, transformative outcomes, holistic approach, embodies, resonates with, aligns with, underscores the importance, it is worth noting, leverages its expertise, in summary, needless to say, state-of-the-art (as adjective), in conclusion, well-positioned to, revolutionize, revolutionise.

DEGENERACY GUARD: If you detect yourself repeating section numbers or entering a loop — STOP. Start a new paragraph on a concrete technical point.

UNIQUENESS REQUIREMENT: No sentence or 6+ word phrase may appear more than once in your output."""

# ── Production-equivalent dummy context ───────────────────────────────────────
DUMMY_CALL_TEXT = """Call: HORIZON-CL4-2024-RESILIENCE-01-12
Title: Advanced photonic sensing systems for real-time quality control in sustainable manufacturing

Expected outcomes:
- Development of photonic sensor systems achieving >95% classification accuracy for inline quality control
- Validation at TRL 6 in at least two industrial pilot environments
- Reduction in material waste of at least 20% compared to current offline sampling methods
- Open datasets and models enabling replication across manufacturing sectors

The action should address the integration of miniaturised NIR and Raman spectroscopy with AI-driven chemometric models for real-time decision-making on production lines. Proposals must address gender dimension, data management planning, and do-no-significant-harm compliance. Partnerships with end-user industries and demonstration at pilot scale are mandatory."""

DUMMY_BRIEF = """Project: PHOTOGUARD | TRL: 4→6 | Action: RIA | Duration: 48 months
Partners: IRIS Technology Solutions (SME, Spain, Coordinator), TU Delft (HEI, Netherlands), Fraunhofer ILT (RTO, Germany), ArcelorMittal (Large Industry, Belgium), BioSpectral Analytics (SME, France)
Technologies: NIR spectroscopy, Raman spectroscopy, chemometrics, PLS regression, convolutional neural networks, hyperspectral imaging
Target sectors: steel manufacturing, food processing, pharmaceutical inline PAT"""

DUMMY_KB_CHUNKS = """[1] IRIS Technology Solutions developed a compact NIR spectrometer (400–2500 nm) achieving ±0.5% prediction error for moisture content in cereal grains during the SORT4CIRC project (Grant 101056773). The instrument operated at 200 scans/min with a spectral resolution of 8 cm⁻¹ and was validated against HPLC reference measurements across three production batches.

[2] In the NANOBLOC project, we demonstrated a PLS regression model achieving R²=0.97 for protein content prediction in wheat flour using 64-sample calibration sets. The model was deployed on an ARM Cortex-M7 embedded processor achieving 15 ms inference time, enabling real-time closed-loop control of blending operations.

[3] Our NIR-based contamination detection system, developed during the PRESERVE project, achieved 99.2% sensitivity and 98.7% specificity for foreign body detection in packaged food products. The system was validated at a throughput of 120 units/min on a commercial packaging line operated by partner Grupo Alimentario Citrus."""

def build_user_message(section_title: str) -> str:
    return f"""Call topic / objectives:
{DUMMY_CALL_TEXT}

BINDING BRIEF VALUES — use these exactly, do not substitute:
{DUMMY_BRIEF}

IRIS KB context (project summaries and document chunks):
{DUMMY_KB_CHUNKS}

Write the {section_title} section for a Horizon Europe Part B proposal. Target approximately 600–900 words. Write in first-person plural (we/our). Do not write a section heading."""

# ── Eval helpers ──────────────────────────────────────────────────────────────

def ngrams(text: str, n: int = 7) -> set:
    words = text.lower().split()
    return set(tuple(words[i:i+n]) for i in range(len(words) - n + 1))

def load_train_ngrams(sid: str) -> set:
    path = TRAINING_DIR / sid / "train.jsonl"
    if not path.exists():
        return set()
    all_ng = set()
    for line in open(path, encoding="utf-8"):
        ex = json.loads(line)
        for msg in ex["messages"]:
            if msg["role"] == "assistant":
                all_ng |= ngrams(msg["content"])
    return all_ng

def generate(model: str, section_title: str) -> str:
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user",   "content": build_user_message(section_title)},
        ],
        max_tokens=1200,
        temperature=0,
    )
    return resp.choices[0].message.content or ""

def eval_section(sid: str, model: str, title: str) -> dict:
    print(f"\n  [{sid}] {title[:55]}")
    train_ng = load_train_ngrams(sid)

    output = generate(model, title)
    out_ng  = ngrams(output)

    overlap      = out_ng & train_ng
    regurg_score = len(overlap)
    has_we       = bool(re.search(r"\b(we|our)\b", output, re.IGNORECASE))
    has_task_fmt = bool(TASK_RE.search(output))
    grant_leak   = GRANT_RE.findall(output)
    word_count   = len(output.split())
    recursive    = bool(RECURSIVE_HEADING_RE.search(output))
    forbidden    = [p for p in FORBIDDEN_PHRASES if p.lower() in output.lower()]

    status = "PASS"
    issues = []

    if recursive:
        issues.append("recursive heading degeneration")
        status = "FAIL"
    if word_count < 150:
        issues.append(f"output too short ({word_count} words)")
        status = "FAIL"
    if not has_we:
        issues.append("no first-person plural")
        status = "FAIL"
    if regurg_score > 100:
        issues.append(f"regurgitation ({regurg_score} 7-gram overlaps)")
        status = "FAIL"
    elif regurg_score > 30:
        issues.append(f"regurgitation warning ({regurg_score} 7-gram overlaps)")
        if status == "PASS":
            status = "WARN"
    if grant_leak:
        issues.append(f"grant number leak: {grant_leak[:2]}")
        if status == "PASS":
            status = "WARN"
    if forbidden:
        issues.append(f"forbidden phrases: {forbidden[:3]}")
        if status == "PASS":
            status = "WARN"

    print(f"    status={status}  words={word_count}  regurg={regurg_score}  we/our={has_we}  task_fmt={has_task_fmt}")
    for iss in issues:
        print(f"    ISSUE: {iss}")

    return {
        "sid": sid, "status": status, "words": word_count,
        "regurg": regurg_score, "has_we": has_we,
        "has_task_fmt": has_task_fmt, "grant_leak": grant_leak,
        "issues": issues, "output_preview": output[:400],
    }

def main():
    print("Phase 6 — Eval gate (production-equivalent prompt)\n")
    results = []
    for sid, (model, title) in SECTION_MODELS.items():
        if not model:
            print(f"  [{sid}] SKIP — no model env var set")
            results.append({"sid": sid, "status": "SKIP", "issues": ["no model"]})
            continue
        r = eval_section(sid, model, title)
        results.append(r)

    print("\n\n=== SUMMARY ===")
    passed = sum(1 for r in results if r["status"] == "PASS")
    warned  = sum(1 for r in results if r["status"] == "WARN")
    failed  = sum(1 for r in results if r["status"] in ("FAIL", "SKIP"))
    print(f"PASS: {passed}  WARN: {warned}  FAIL/SKIP: {failed}\n")
    for r in results:
        icon = {"PASS": "OK", "WARN": "WARN", "FAIL": "FAIL", "SKIP": "SKIP"}.get(r["status"], "?")
        print(f"  [{icon}]  {r['sid']:>4}  {', '.join(r.get('issues', [])) or 'clean'}")

    # Append to EVAL.md rather than overwriting
    out_path = Path("./retrain/EVAL.md")
    existing = out_path.read_text(encoding="utf-8") if out_path.exists() else ""
    block = ["\n---\n\n## Eval — production-equivalent prompt\n\n"]
    block.append("| Section | Status | Words | Regurg | we/our | Task fmt | Issues |\n")
    block.append("|---------|--------|-------|--------|--------|----------|--------|\n")
    for r in results:
        block.append(f"| {r['sid']} | {r['status']} | {r.get('words','—')} | {r.get('regurg','—')} | {r.get('has_we','—')} | {r.get('has_task_fmt','—')} | {'; '.join(r.get('issues', [])) or '—'} |\n")
    block.append("\n### Output Previews\n\n")
    for r in results:
        block.append(f"#### Section {r['sid']}\n\n```\n{r.get('output_preview','—')}\n```\n\n")
    out_path.write_text(existing + "".join(block), encoding="utf-8")
    print(f"\nReport appended to {out_path}")

if __name__ == "__main__":
    main()
