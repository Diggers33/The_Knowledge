#!/usr/bin/env python3
"""Round 5 fine-tune submission: §1.3 Methodology and §3.3 Consortium.

These sections were augmented with gender dimension, open science, and SSH
paragraphs (T8/T9) and need new fine-tuned models.

Run from iris-kb/:  py -3 retrain/scripts/submit_round5.py
"""

import os, sys, time
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(".env.local"))

try:
    from openai import OpenAI
except ImportError:
    sys.exit("pip install openai")

client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

MODEL        = "gpt-4.1-mini-2025-04-14"
STATUS_FILE  = Path("./retrain/STATUS.md")
TRAINING_DIR = Path("./retrain/training")

SECTIONS = [
    {"sid": "1_3", "env": "IRIS_MODEL_METHODOLOGY",  "suffix": "iris-r5-methodology"},
    {"sid": "3_3", "env": "IRIS_MODEL_CONSORTIUM",   "suffix": "iris-r5-consortium"},
]


def active_jobs() -> int:
    jobs = client.fine_tuning.jobs.list(limit=20).data
    return sum(1 for j in jobs if j.status in ("validating_files", "queued", "running"))


def upload(path: Path) -> str:
    print(f"    Uploading {path.name} ({path.stat().st_size // 1024} KB)...")
    with open(path, "rb") as f:
        return client.files.create(file=f, purpose="fine-tune").id


def main():
    new_jobs = []
    for sec in SECTIONS:
        sid      = sec["sid"]
        sec_dir  = TRAINING_DIR / sid
        train_p  = sec_dir / "train.jsonl"
        val_p    = sec_dir / "val.jsonl"

        if not train_p.exists():
            print(f"SKIP {sid}: no train.jsonl")
            continue

        n_train = sum(1 for _ in open(train_p, encoding="utf-8"))
        n_val   = sum(1 for _ in open(val_p,   encoding="utf-8")) if val_p.exists() else 0
        print(f"\nSection {sid}: {n_train} train, {n_val} val")

        for attempt in range(20):
            active = active_jobs()
            print(f"  Active jobs: {active}")
            if active < 6:
                break
            print("  Waiting 60s for a free slot...")
            time.sleep(60)
        else:
            print(f"  ABORT {sid}: no free slot after 20 minutes")
            continue

        try:
            train_id = upload(train_p)
            val_id   = upload(val_p) if val_p.exists() and n_val > 0 else None

            kwargs: dict = dict(
                training_file=train_id,
                model=MODEL,
                hyperparameters={"n_epochs": 3},
                suffix=sec["suffix"],
            )
            if val_id:
                kwargs["validation_file"] = val_id

            job = client.fine_tuning.jobs.create(**kwargs)
            print(f"  Job created: {job.id}  status={job.status}")
            new_jobs.append({**sec, "job_id": job.id, "train": n_train, "val": n_val})
        except Exception as e:
            print(f"  ERROR submitting {sid}: {e}")

    if new_jobs:
        existing = STATUS_FILE.read_text(encoding="utf-8") if STATUS_FILE.exists() else ""
        block = "\n## Phase 5 — Round 5 (§1.3 methodology + §3.3 consortium, gender/SSH augmented)\n\n"
        block += "| Section | Job ID | Env var | Suffix | Train | Val |\n|---------|--------|---------|--------|-------|-----|\n"
        for j in new_jobs:
            block += f"| {j['sid']} | `{j['job_id']}` | `{j['env']}` | `{j['suffix']}` | {j['train']} | {j['val']} |\n"
        STATUS_FILE.write_text(existing + block, encoding="utf-8")
        print(f"\nAppended {len(new_jobs)} job(s) to {STATUS_FILE}")
        print("\nNext steps after jobs complete:")
        print("  Update .env.local with the new ft: model IDs:")
        for j in new_jobs:
            print(f"    {j['env']}=<new model id>")
    else:
        print("\nNo jobs submitted.")


if __name__ == "__main__":
    main()
