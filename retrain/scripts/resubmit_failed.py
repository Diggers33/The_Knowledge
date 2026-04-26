#!/usr/bin/env python3
"""Resubmit the 5 failed fine-tune jobs with updated training data, plus attempt 1.4."""
import os, time
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(".env.local"))
from openai import OpenAI
client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

MODEL    = "gpt-4.1-mini-2025-04-14"
N_EPOCHS = 2

RESUBMIT = [
    ("1_2", "IRIS_MODEL_SOTA",         "iris-12"),
    ("1_3", "IRIS_MODEL_METHODOLOGY",  "iris-13"),
    ("1_4", "IRIS_MODEL_INNOVATION",   "iris-14"),
    ("2_1", "IRIS_MODEL_OUTCOMES",     "iris-21"),
    ("2_3", "IRIS_MODEL_COMMUNICATION","iris-23"),
    ("3_3", "IRIS_MODEL_CONSORTIUM",   "iris-33"),
]

def upload(path: Path) -> str:
    print(f"  Uploading {path.name} ({path.stat().st_size // 1024} KB)...")
    with open(path, "rb") as f:
        return client.files.create(file=f, purpose="fine-tune").id

def wait_for_slot(max_jobs=6):
    while True:
        jobs = client.fine_tuning.jobs.list(limit=20).data
        active = [j for j in jobs if j.status in ("validating_files", "queued", "running")]
        print(f"  Active jobs: {len(active)}/6")
        if len(active) < max_jobs:
            return
        time.sleep(60)

for sid, env_var, suffix in RESUBMIT:
    train = Path(f"retrain/training/{sid}/train.jsonl")
    val   = Path(f"retrain/training/{sid}/val.jsonl")

    if not train.exists():
        print(f"SKIP {sid}: no train.jsonl")
        continue

    n = sum(1 for _ in open(train, encoding="utf-8"))
    if n < 10:
        print(f"SKIP {sid}: only {n} examples (need 10)")
        continue

    print(f"\nSection {sid} ({n} examples):")
    wait_for_slot()

    train_id = upload(train)
    val_id   = upload(val) if val.exists() else None

    kwargs = dict(
        training_file=train_id,
        model=MODEL,
        hyperparameters={"n_epochs": N_EPOCHS},
        suffix=suffix,
    )
    if val_id:
        kwargs["validation_file"] = val_id

    job = client.fine_tuning.jobs.create(**kwargs)
    print(f"  Job created: {job.id}  status={job.status}  env_var={env_var}")
