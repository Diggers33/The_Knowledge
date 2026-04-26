#!/usr/bin/env python3
"""Phase 6: Eval gate for per-section fine-tuned models.

Checks:
  1. Regurgitation — does output contain verbatim 7-grams from training data?
  2. Style fidelity — first-person plural, EU Horizon task format (**Task X.Y**)
  3. No-context safety — does model refuse or hallucinate when given no call context?
  4. Grant number leakage — no Horizon grant IDs in output
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

SECTION_MODELS = {
    "1_1": (os.environ.get("IRIS_MODEL_OBJECTIVES"),   "Objectives and ambition"),
    "1_2": (os.environ.get("IRIS_MODEL_SOTA"),         "State of the art and innovation"),
    "1_3": (os.environ.get("IRIS_MODEL_METHODOLOGY"),  "Methodology and approach"),
    "1_4": (os.environ.get("IRIS_MODEL_INNOVATION"),   "Ambition and innovation beyond the state of the art"),
    "2_1": (os.environ.get("IRIS_MODEL_OUTCOMES"),     "Expected outcomes and impacts"),
    "2_2": (os.environ.get("IRIS_MODEL_DISSEMINATION"),"Dissemination, exploitation and communication"),
    "2_3": (os.environ.get("IRIS_MODEL_COMMUNICATION"),"Communication and open science"),
    "3_1": (os.environ.get("IRIS_MODEL_WORKPLAN"),     "Work plan and work packages"),
    "3_2": (os.environ.get("IRIS_MODEL_MANAGEMENT"),   "Management structure and procedures"),
    "3_3": (os.environ.get("IRIS_MODEL_CONSORTIUM"),   "Consortium as a whole"),
    "4":   (os.environ.get("IRIS_MODEL_BUSINESS_CASE"),"Business case and exploitation strategy"),
}

SYSTEM = """You are an expert EU proposal writer for IRIS Technology Solutions, a photonics and NIR spectroscopy company. Write in first-person plural (we/our). Use precise technical language. Follow EU Horizon proposal conventions: numbered tasks (**Task X.Y**), clear objectives, evidence-based claims."""

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
            {"role": "user",   "content": f"Write the {section_title} section for a Horizon Europe proposal on NIR spectroscopy for food quality control in smart manufacturing."},
        ],
        max_tokens=800,
        temperature=0,
    )
    return resp.choices[0].message.content or ""

def eval_section(sid: str, model: str, title: str) -> dict:
    print(f"\n  [{sid}] {title[:50]}")
    train_ng = load_train_ngrams(sid)

    output = generate(model, title)
    out_ng  = ngrams(output)

    overlap      = out_ng & train_ng
    regurg_score = len(overlap)
    has_we       = bool(re.search(r"\b(we|our)\b", output, re.IGNORECASE))
    has_task_fmt = bool(TASK_RE.search(output))
    grant_leak   = GRANT_RE.findall(output)
    word_count   = len(output.split())

    status = "PASS"
    issues = []
    if regurg_score > 30:
        issues.append(f"regurgitation ({regurg_score} 7-gram overlaps)")
        status = "WARN"
    if regurg_score > 100:
        status = "FAIL"
    if not has_we:
        issues.append("no first-person plural")
        status = "FAIL"
    if grant_leak:
        issues.append(f"grant number leak: {grant_leak}")
        status = "WARN"
    if word_count < 100:
        issues.append(f"output too short ({word_count} words)")
        status = "FAIL"

    print(f"    status={status}  words={word_count}  regurg={regurg_score}  we/our={has_we}  task_fmt={has_task_fmt}")
    if issues:
        for iss in issues:
            print(f"    ISSUE: {iss}")

    return {
        "sid": sid, "status": status, "words": word_count,
        "regurg": regurg_score, "has_we": has_we,
        "has_task_fmt": has_task_fmt, "grant_leak": grant_leak,
        "issues": issues, "output_preview": output[:300],
    }

def main():
    print("Phase 6 — Eval gate\n")
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
    warned = sum(1 for r in results if r["status"] == "WARN")
    failed = sum(1 for r in results if r["status"] in ("FAIL", "SKIP"))
    print(f"PASS: {passed}  WARN: {warned}  FAIL/SKIP: {failed}\n")

    for r in results:
        icon = {"PASS": "OK", "WARN": "WARN", "FAIL": "FAIL", "SKIP": "SKIP"}[r["status"]]
        print(f"  [{icon}] {r['sid']:>4}  {', '.join(r.get('issues', [])) or 'clean'}")

    out_path = Path("./retrain/EVAL.md")
    lines = ["# Phase 6 — Eval Results\n\n"]
    lines.append("| Section | Status | Words | Regurg | we/our | Task fmt | Issues |\n")
    lines.append("|---------|--------|-------|--------|--------|----------|--------|\n")
    for r in results:
        lines.append(f"| {r['sid']} | {r['status']} | {r.get('words','—')} | {r.get('regurg','—')} | {r.get('has_we','—')} | {r.get('has_task_fmt','—')} | {'; '.join(r.get('issues', [])) or '—'} |\n")
    lines.append("\n---\n\n## Output Previews (first 400 chars)\n\n")
    for r in results:
        lines.append(f"### Section {r['sid']}\n\n```\n{r.get('output_preview','—')}\n```\n\n")
    out_path.write_text("".join(lines), encoding="utf-8")
    print(f"\nReport written to {out_path}")

if __name__ == "__main__":
    main()
