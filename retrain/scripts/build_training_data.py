#!/usr/bin/env python3
"""Phase 4: Build per-section fine-tuning JSONL files.

For each section_id (1.1, 1.2 ... 3.3, 4) produces:
  retrain/training/<section_id>/train.jsonl
  retrain/training/<section_id>/val.jsonl

Each example:
  {"messages": [
    {"role": "system", "content": "<section-specific system prompt>"},
    {"role": "user",   "content": "Write the <section title> section for a Horizon Europe proposal."},
    {"role": "assistant", "content": "<extracted section text>"}
  ]}

Contamination guards applied before inclusion:
  - No grant numbers (101XXXXXXX / 1XXXXXXXXX)
  - No known project names from CONTAMINATION_LIST
  - No TOC artifacts (lines of dots)
  - Minimum 200 words, maximum 4000 words (trimmed)
  - 7-gram canary check against val set
"""

import csv, json, re, sys
from pathlib import Path
from collections import defaultdict

SECTIONS_DIR  = Path("./retrain/corpus/sections")
INVENTORY     = Path("./retrain/corpus/inventory.csv")
TRAINING_DIR  = Path("./retrain/training")

# Grant number pattern (Horizon grants: 101XXXXXX, H2020: 7-8 digit)
GRANT_RE = re.compile(r"\b(101\d{6}|1\d{8}|\d{9})\b")

# Known contamination names from the bad fine-tune
CONTAMINATION_LIST = [
    "SecureFood", "MICROORCH", "GIANT LEAPS", "CIRCSHOE",
    "CIRCULAR FoodPack", "PHOTONFOOD", "PRESERVE", "SORT4CIRC",
    "NANOBLOC", "HYPERA", "GRIDHEAL", "FARM2FORK",
]

# TOC artifact: lines with 5+ consecutive dots
TOC_RE = re.compile(r"\.{5,}")

SECTION_TITLES = {
    "1.1": "Objectives and ambition",
    "1.2": "State of the art and innovation",
    "1.3": "Methodology and approach",
    "1.4": "Ambition and innovation beyond the state of the art",
    "2.1": "Expected outcomes and impacts",
    "2.2": "Dissemination, exploitation and communication",
    "2.3": "Communication and open science",
    "3.1": "Work plan and work packages",
    "3.2": "Management structure and procedures",
    "3.3": "Consortium as a whole",
    "4":   "Business case and exploitation strategy",
}

SYSTEM_PROMPT_BASE = """You are an expert EU proposal writer for IRIS Technology Solutions, a photonics and NIR spectroscopy company. Write in first-person plural (we/our). Use precise technical language. Follow EU Horizon proposal conventions: numbered tasks (**Task X.Y**), clear objectives, evidence-based claims."""

SECTION_SYSTEM_ADDENDUM = {
    "1.1": " Focus on specific, measurable objectives linked to the call expected outcomes. Explain why the project is ambitious and beyond the current state of the art.",
    "1.2": " Provide a comprehensive analysis of the current state of the art, identify gaps, and explain how this project advances beyond existing knowledge.",
    "1.3": " Describe the research methodology, technical approach, risk mitigation strategies, and TRL progression.",
    "1.4": " Articulate the novel and ambitious elements. Explain what makes this genuinely breakthrough and beyond state of the art.",
    "2.1": " Map the project to the call's expected outcomes. Provide quantified KPIs and pathways to impact.",
    "2.2": " Detail the dissemination plan, exploitation roadmap, IP strategy, and open access commitments.",
    "2.3": " Describe communication activities, target audiences, key messages, and channels.",
    "3.1": " Present the work plan with work packages, tasks, deliverables, milestones, and Gantt logic.",
    "3.2": " Describe the governance structure, decision-making processes, risk management, and quality assurance.",
    "3.3": " Profile the consortium partners, explain complementarity, and justify the partnership composition.",
    "4":   " Present the business case, market analysis, commercialisation pathway, and investment needs.",
}

def is_contaminated(text: str, own_acronym: str = "") -> tuple[bool, str]:
    # Multiple distinct grant numbers = cross-contamination
    grants = set(GRANT_RE.findall(text))
    if len(grants) > 1:
        return True, f"multiple grant numbers: {grants}"

    # Own project name is fine; OTHER IRIS project names are not
    own_lower = own_acronym.lower()
    for name in CONTAMINATION_LIST:
        if name.lower() in text.lower() and name.lower() != own_lower:
            return True, f"cross-project name: {name}"

    toc_lines = [l for l in text.split('\n') if TOC_RE.search(l)]
    if len(toc_lines) > 3:
        return True, f"TOC artifact ({len(toc_lines)} dot-lines)"
    return False, ""

def clean_text(text: str) -> str:
    # Remove TOC lines
    lines = [l for l in text.split('\n') if not TOC_RE.search(l)]
    # Remove EC tags like #@REL-EVA-RE@#
    cleaned = '\n'.join(lines)
    cleaned = re.sub(r'#[@#][A-Z0-9\-]+[@#]#?', '', cleaned)
    # Collapse excessive blank lines
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)
    return cleaned.strip()

def word_count(text: str) -> int:
    return len(text.split())

def build_example(section_id: str, text: str) -> dict:
    title = SECTION_TITLES.get(section_id, f"section {section_id}")
    system = SYSTEM_PROMPT_BASE + SECTION_SYSTEM_ADDENDUM.get(section_id, "")
    user = f"Write the {title} section for a Horizon Europe proposal."
    return {"messages": [
        {"role": "system",    "content": system},
        {"role": "user",      "content": user},
        {"role": "assistant", "content": text},
    ]}

def ngrams(text: str, n: int = 7) -> set:
    words = text.lower().split()
    return set(tuple(words[i:i+n]) for i in range(len(words) - n + 1))

def main():
    rows = list(csv.DictReader(open(INVENTORY)))
    by_section: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_section[r['section_id']].append(r)

    total_train = 0
    total_val   = 0
    skipped     = 0

    for sid, section_rows in sorted(by_section.items()):
        out_dir = TRAINING_DIR / sid.replace(".", "_")
        out_dir.mkdir(parents=True, exist_ok=True)

        examples = []
        for r in section_rows:
            txt_path = Path(r['extracted_text'])
            if not txt_path.exists():
                continue
            raw = txt_path.read_text(encoding='utf-8', errors='replace')
            text = clean_text(raw)
            wc = word_count(text)

            if wc < 200:
                print(f"  SKIP {r['acronym']}/{sid}: too short ({wc} words)")
                skipped += 1
                continue
            # Trim to 4000 words
            if wc > 4000:
                words = text.split()
                text = ' '.join(words[:4000])

            contaminated, reason = is_contaminated(text, own_acronym=r['acronym'])
            if contaminated:
                print(f"  SKIP {r['acronym']}/{sid}: {reason}")
                skipped += 1
                continue

            examples.append((r['acronym'], text))

        if not examples:
            print(f"  Section {sid}: no usable examples")
            continue

        # 80/20 train/val split — at least 1 val example
        n_val   = max(1, len(examples) // 5)
        n_train = len(examples) - n_val
        train_ex = examples[:n_train]
        val_ex   = examples[n_train:]

        # 7-gram canary check: ensure val examples don't appear verbatim in train
        train_ngrams: set = set()
        for _, t in train_ex:
            train_ngrams |= ngrams(t)

        clean_val = []
        for acr, t in val_ex:
            overlap = ngrams(t) & train_ngrams
            if len(overlap) > 50:
                print(f"  WARN {acr}/{sid} val example has {len(overlap)} 7-gram overlaps with train — skipping from val")
                train_ex.append((acr, t))
            else:
                clean_val.append((acr, t))

        # Write JSONL
        train_path = out_dir / "train.jsonl"
        val_path   = out_dir / "val.jsonl"

        with open(train_path, 'w', encoding='utf-8') as f:
            for acr, text in train_ex:
                f.write(json.dumps(build_example(sid, text), ensure_ascii=False) + '\n')

        with open(val_path, 'w', encoding='utf-8') as f:
            for acr, text in clean_val:
                f.write(json.dumps(build_example(sid, text), ensure_ascii=False) + '\n')

        print(f"  Section {sid:>4}: {len(train_ex):>2} train, {len(clean_val):>2} val  -> {out_dir}")
        total_train += len(train_ex)
        total_val   += len(clean_val)

    print(f"\nDone: {total_train} train + {total_val} val examples, {skipped} skipped")

if __name__ == "__main__":
    main()
