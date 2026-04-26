#!/usr/bin/env python3
"""Phase 5: Upload training files and create per-section fine-tune jobs.

Reads retrain/training/<section>/train.jsonl (and val.jsonl if present).
Creates one fine-tune job per section on gpt-4.1-mini-2025-04-14.
Writes retrain/STATUS.md with job IDs and status.
"""

import json, os, sys, time
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(".env.local"))          # iris-kb/.env.local

try:
    from openai import OpenAI
except ImportError:
    sys.exit("pip install openai")

client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

TRAINING_DIR = Path("./retrain/training")
STATUS_FILE  = Path("./retrain/STATUS.md")
MODEL        = "gpt-4.1-mini-2025-04-14"
N_EPOCHS     = 2
MIN_EXAMPLES = 4   # OpenAI requires ≥10 but we try anyway; real minimum enforced server-side

SECTION_ENV = {
    "1_1": "IRIS_MODEL_OBJECTIVES",
    "1_2": "IRIS_MODEL_SOTA",
    "1_3": "IRIS_MODEL_METHODOLOGY",
    "1_4": "IRIS_MODEL_INNOVATION",
    "2_1": "IRIS_MODEL_OUTCOMES",
    "2_2": "IRIS_MODEL_DISSEMINATION",
    "2_3": "IRIS_MODEL_COMMUNICATION",
    "3_1": "IRIS_MODEL_WORKPLAN",
    "3_2": "IRIS_MODEL_MANAGEMENT",
    "3_3": "IRIS_MODEL_CONSORTIUM",
    "4":   "IRIS_MODEL_BUSINESS_CASE",
}

def upload_file(path: Path, purpose: str = "fine-tune") -> str:
    print(f"    Uploading {path.name} ({path.stat().st_size // 1024} KB)...")
    with open(path, "rb") as f:
        resp = client.files.create(file=f, purpose=purpose)
    return resp.id

def count_lines(path: Path) -> int:
    return sum(1 for _ in open(path, encoding="utf-8"))

def main():
    sections = sorted(p for p in TRAINING_DIR.iterdir() if p.is_dir())
    jobs = []

    for sec_dir in sections:
        sid = sec_dir.name   # e.g. "1_1"
        train_path = sec_dir / "train.jsonl"
        val_path   = sec_dir / "val.jsonl"

        if not train_path.exists():
            print(f"  SKIP {sid}: no train.jsonl")
            continue

        n_train = count_lines(train_path)
        n_val   = count_lines(val_path) if val_path.exists() else 0

        if n_train < MIN_EXAMPLES:
            print(f"  SKIP {sid}: only {n_train} train examples (minimum {MIN_EXAMPLES})")
            jobs.append({"sid": sid, "status": "skipped", "reason": f"only {n_train} examples", "job_id": "", "env_var": SECTION_ENV.get(sid, "")})
            continue

        print(f"\n  Section {sid}: {n_train} train, {n_val} val")

        try:
            train_file_id = upload_file(train_path)
            val_file_id   = upload_file(val_path) if val_path.exists() and n_val > 0 else None

            kwargs = dict(
                training_file=train_file_id,
                model=MODEL,
                hyperparameters={"n_epochs": N_EPOCHS},
                suffix=f"iris-{sid.replace('_', '')}",
            )
            if val_file_id:
                kwargs["validation_file"] = val_file_id

            job = client.fine_tuning.jobs.create(**kwargs)
            print(f"    Job created: {job.id}  status={job.status}")
            jobs.append({
                "sid":     sid,
                "status":  job.status,
                "job_id":  job.id,
                "env_var": SECTION_ENV.get(sid, ""),
                "train_n": n_train,
                "val_n":   n_val,
            })
        except Exception as e:
            print(f"    ERROR: {e}")
            jobs.append({"sid": sid, "status": "error", "reason": str(e), "job_id": "", "env_var": SECTION_ENV.get(sid, "")})

    # Write STATUS.md update
    existing = STATUS_FILE.read_text(encoding="utf-8") if STATUS_FILE.exists() else ""
    block = "\n## Phase 5 — Fine-tune jobs submitted\n\n"
    block += f"Base model: `{MODEL}`, n_epochs={N_EPOCHS}\n\n"
    block += "| Section | Job ID | Env var | Train | Val | Status |\n"
    block += "|---------|--------|---------|-------|-----|--------|\n"
    for j in jobs:
        block += f"| {j['sid']} | `{j.get('job_id','—')}` | `{j.get('env_var','')}` | {j.get('train_n','—')} | {j.get('val_n','—')} | {j['status']} |\n"

    STATUS_FILE.write_text(existing + block, encoding="utf-8")
    print(f"\nJobs written to {STATUS_FILE}")
    print("\nPoll status with:")
    for j in jobs:
        if j.get("job_id"):
            print(f"  python -c \"from openai import OpenAI; c=OpenAI(); print(c.fine_tuning.jobs.retrieve('{j['job_id']}').status)\"")

if __name__ == "__main__":
    main()
