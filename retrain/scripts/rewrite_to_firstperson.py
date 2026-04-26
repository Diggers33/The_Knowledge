#!/usr/bin/env python3
"""Rewrite all training JSONL assistant messages from third-person to first-person plural.

EU proposals are typically written in third-person ("The project will...") but
IRIS's system prompt requires first-person plural ("We will..."). This script
batch-rewrites all training examples so fine-tuned models learn the correct voice.

Also drops examples with excessive repetition (same 5-gram phrase > 5 times).
"""

import json, os, re, time
from pathlib import Path
from collections import Counter
from dotenv import load_dotenv

load_dotenv(Path(".env.local"))
from openai import OpenAI
client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

TRAINING_DIR = Path("./retrain/training")
MODEL        = "gpt-4o-mini"
BATCH_SIZE   = 10

REWRITE_SYSTEM = """You are a copy editor. Convert the provided EU proposal text from third-person to first-person plural (we/our/us).

Rules:
- "The project" → "we" or "our project"
- "The consortium" → "we" / "our consortium"
- "Partners will" → "We will"
- "The work plan" → "Our work plan"
- "This project" → "our project"
- Preserve all technical content, section structure, bullet points, **Task X.Y** labels, and EU Horizon formatting exactly
- Do not add or remove content — only change grammatical person
- Return ONLY the rewritten text, no preamble"""

def is_repetitive(text: str) -> bool:
    words = text.lower().split()
    if len(words) < 20:
        return False
    phrases = [' '.join(words[i:i+5]) for i in range(len(words) - 4)]
    most_common = Counter(phrases).most_common(1)
    return bool(most_common and most_common[0][1] > 5)

def needs_rewrite(text: str) -> bool:
    """True if first 300 chars have no we/our."""
    return not re.search(r'\b(we|our)\b', text[:300], re.IGNORECASE)

def rewrite_batch(texts: list[str]) -> list[str]:
    """Rewrite a batch of texts, returning same-length list."""
    results = []
    for text in texts:
        try:
            resp = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": REWRITE_SYSTEM},
                    {"role": "user",   "content": text},
                ],
                max_tokens=2000,
                temperature=0,
            )
            results.append(resp.choices[0].message.content.strip())
        except Exception as e:
            print(f"    WARN rewrite failed: {e}")
            results.append(text)  # keep original on failure
    return results

def process_section(sid_dir: Path):
    sid = sid_dir.name
    for split in ("train", "val"):
        path = sid_dir / f"{split}.jsonl"
        if not path.exists():
            continue

        lines = path.read_text(encoding="utf-8").strip().split("\n")
        examples = [json.loads(l) for l in lines if l.strip()]

        kept = []
        to_rewrite_idx = []
        to_rewrite_texts = []

        for i, ex in enumerate(examples):
            text = next(m["content"] for m in ex["messages"] if m["role"] == "assistant")

            if is_repetitive(text):
                print(f"    DROP repetitive example {i+1}")
                continue

            if needs_rewrite(text):
                to_rewrite_idx.append(len(kept))
                to_rewrite_texts.append(text)

            kept.append(ex)

        # Batch rewrite
        if to_rewrite_texts:
            print(f"    Rewriting {len(to_rewrite_texts)}/{len(kept)} {split} examples...")
            rewritten = rewrite_batch(to_rewrite_texts)
            for idx, new_text in zip(to_rewrite_idx, rewritten):
                for msg in kept[idx]["messages"]:
                    if msg["role"] == "assistant":
                        msg["content"] = new_text
                        break

        # Write back
        with open(path, "w", encoding="utf-8") as f:
            for ex in kept:
                f.write(json.dumps(ex, ensure_ascii=False) + "\n")

        print(f"    {split}: {len(examples)} -> {len(kept)} examples written")

def main():
    sections = sorted(p for p in TRAINING_DIR.iterdir() if p.is_dir())
    for sec_dir in sections:
        sid = sec_dir.name
        print(f"\nSection {sid}:")
        process_section(sec_dir)

    print("\nDone. Re-run run_finetunes.py to submit new jobs.")

if __name__ == "__main__":
    main()
