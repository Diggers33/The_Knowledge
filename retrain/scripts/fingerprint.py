#!/usr/bin/env python3
"""Phase 2: Style fingerprinting — produce per-section JSON fingerprints from training JSONL.

Outputs retrain/fingerprints/<section>.json with:
  - example_count
  - avg_words
  - median_sentence_length
  - we_our_density  (we/our hits per 100 words)
  - task_format_count  (number of **Task X.Y** patterns)
  - bullet_density  (bullet lines per 100 words)
  - first_person_rate  (fraction of examples with ≥1 we/our hit)
"""

import json, re, statistics
from pathlib import Path

TRAINING_DIR = Path("./retrain/training")
FINGERPRINT_DIR = Path("./retrain/fingerprints")
FINGERPRINT_DIR.mkdir(exist_ok=True)

TASK_RE   = re.compile(r"\*\*Task\s+\d+\.\d+\*\*", re.IGNORECASE)
BULLET_RE = re.compile(r"^\s*[-*•]\s", re.MULTILINE)
WE_OUR_RE = re.compile(r"\b(we|our|us|ourselves|ours)\b", re.IGNORECASE)

SECTIONS = ["1_1","1_2","1_3","1_4","2_1","2_2","2_3","3_1","3_2","3_3","4"]

def analyse(text: str) -> dict:
    words = text.split()
    word_count = len(words)
    sentences = [s.strip() for s in re.split(r"[.!?]+", text) if s.strip()]
    sentence_lengths = [len(s.split()) for s in sentences] if sentences else [0]
    we_our_hits = len(WE_OUR_RE.findall(text))
    task_hits   = len(TASK_RE.findall(text))
    bullet_hits = len(BULLET_RE.findall(text))
    return {
        "word_count":     word_count,
        "sentence_lengths": sentence_lengths,
        "we_our_hits":    we_our_hits,
        "task_hits":      task_hits,
        "bullet_hits":    bullet_hits,
    }

def fingerprint_section(section: str) -> dict | None:
    train_path = TRAINING_DIR / section / "train.jsonl"
    if not train_path.exists():
        print(f"  [{section}] no train.jsonl — skipping")
        return None

    examples = []
    with open(train_path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            msgs = d.get("messages", [])
            asst = next((m["content"] for m in msgs if m["role"] == "assistant"), "")
            if asst:
                examples.append(asst)

    if not examples:
        print(f"  [{section}] no assistant turns found")
        return None

    stats = [analyse(e) for e in examples]
    all_words     = [s["word_count"] for s in stats]
    all_sent_lens = [l for s in stats for l in s["sentence_lengths"]]
    total_words   = sum(all_words)
    total_we_our  = sum(s["we_our_hits"] for s in stats)
    total_tasks   = sum(s["task_hits"] for s in stats)
    total_bullets = sum(s["bullet_hits"] for s in stats)
    first_person_rate = sum(1 for s in stats if s["we_our_hits"] > 0) / len(stats)

    fp = {
        "section":            section,
        "example_count":      len(examples),
        "avg_words":          round(sum(all_words) / len(all_words), 1),
        "median_sentence_length": round(statistics.median(all_sent_lens), 1) if all_sent_lens else 0,
        "we_our_density":     round(total_we_our / total_words * 100, 2) if total_words else 0,
        "task_format_count":  total_tasks,
        "bullet_density":     round(total_bullets / total_words * 100, 2) if total_words else 0,
        "first_person_rate":  round(first_person_rate, 3),
    }
    return fp

def main():
    summary = {}
    for section in SECTIONS:
        fp = fingerprint_section(section)
        if fp is None:
            continue
        out_path = FINGERPRINT_DIR / f"{section}.json"
        out_path.write_text(json.dumps(fp, indent=2))
        summary[section] = fp
        print(f"  [{section}] examples={fp['example_count']}  avg_words={fp['avg_words']}  "
              f"we/our_density={fp['we_our_density']}%  first_person_rate={fp['first_person_rate']:.0%}")

    # Write combined summary
    (FINGERPRINT_DIR / "_summary.json").write_text(json.dumps(summary, indent=2))
    print(f"\nDone. {len(summary)} fingerprints written to retrain/fingerprints/")

if __name__ == "__main__":
    main()
