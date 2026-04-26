#!/usr/bin/env python3
"""Resubmit the 3 Round 4 sections that failed due to the 6-active-job cap.
Run from iris-kb/:  python retrain/scripts/resubmit_r4_remaining.py
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

MODEL   = "gpt-4.1-mini-2025-04-14"
MISSING = ["2_3", "3_1", "3_2"]

SECTION_ENV = {
    "2_3": "IRIS_MODEL_COMMUNICATION",
    "3_1": "IRIS_MODEL_WORKPLAN",
    "3_2": "IRIS_MODEL_MANAGEMENT",
}

TRAINING_DIR = Path("./retrain/training")
STATUS_FILE  = Path("./retrain/STATUS.md")

def active_jobs() -> int:
    jobs = client.fine_tuning.jobs.list(limit=20).data
    return sum(1 for j in jobs if j.status in ("validating_files", "queued", "running"))

def already_submitted(sid: str) -> bool:
    suffix = f"iris-{sid.replace('_', '')}"
    for j in client.fine_tuning.jobs.list(limit=50).data:
        if j.status not in ("validating_files", "queued", "running", "succeeded"):
            continue
        model = j.fine_tuned_model or ""
        if f":{suffix}:" in model:
            return True
        # Also check if suffix matches in-flight jobs via metadata (not always populated)
    return False

def upload(path: Path) -> str:
    print(f"    Uploading {path.name} ({path.stat().st_size // 1024} KB)...")
    with open(path, "rb") as f:
        return client.files.create(file=f, purpose="fine-tune").id

def main():
    new_jobs = []
    for sid in MISSING:
        sec_dir    = TRAINING_DIR / sid
        train_path = sec_dir / "train.jsonl"
        val_path   = sec_dir / "val.jsonl"

        if not train_path.exists():
            print(f"SKIP {sid}: no train.jsonl")
            continue

        n_train = sum(1 for _ in open(train_path, encoding="utf-8"))
        n_val   = sum(1 for _ in open(val_path, encoding="utf-8")) if val_path.exists() else 0
        print(f"\nSection {sid}: {n_train} train, {n_val} val")

        # Wait for a free slot (cap = 6 active)
        for attempt in range(20):
            active = active_jobs()
            print(f"  Active jobs: {active}")
            if active < 6:
                break
            print(f"  Waiting 60s for a slot to free up...")
            time.sleep(60)
        else:
            print(f"  ABORT {sid}: no free slot after 20 minutes")
            continue

        try:
            train_id = upload(train_path)
            val_id   = upload(val_path) if val_path.exists() and n_val > 0 else None

            kwargs = dict(
                training_file=train_id,
                model=MODEL,
                hyperparameters={"n_epochs": 2},
                suffix=f"iris-{sid.replace('_', '')}",
            )
            if val_id:
                kwargs["validation_file"] = val_id

            job = client.fine_tuning.jobs.create(**kwargs)
            print(f"  Job created: {job.id}  status={job.status}")
            new_jobs.append({"sid": sid, "job_id": job.id, "env": SECTION_ENV[sid], "train": n_train, "val": n_val})
        except Exception as e:
            print(f"  ERROR submitting {sid}: {e}")

    if new_jobs:
        existing = STATUS_FILE.read_text(encoding="utf-8") if STATUS_FILE.exists() else ""
        block = "\n## Phase 5 — Round 4 resubmit (2_3, 3_1, 3_2)\n\n"
        block += "| Section | Job ID | Env var | Train | Val |\n|---------|--------|---------|-------|-----|\n"
        for j in new_jobs:
            block += f"| {j['sid']} | `{j['job_id']}` | `{j['env']}` | {j['train']} | {j['val']} |\n"
        STATUS_FILE.write_text(existing + block, encoding="utf-8")
        print(f"\nAppended {len(new_jobs)} job(s) to {STATUS_FILE}")
    else:
        print("\nNo jobs submitted.")

if __name__ == "__main__":
    main()
