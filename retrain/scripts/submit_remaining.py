#!/usr/bin/env python3
"""Submit the remaining fine-tune jobs that hit the rate limit: 3.1, 3.2, 3.3."""
import os, time
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv(Path(".env.local"))
client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

MODEL    = "gpt-4.1-mini-2025-04-14"
N_EPOCHS = 2

REMAINING = [
    ("3_1", "IRIS_MODEL_WORKPLAN",    "iris-31"),
    ("3_2", "IRIS_MODEL_MANAGEMENT",  "iris-32"),
    ("3_3", "IRIS_MODEL_CONSORTIUM",  "iris-33"),
]

def upload(path: Path) -> str:
    print(f"  Uploading {path.name}...")
    with open(path, "rb") as f:
        return client.files.create(file=f, purpose="fine-tune").id

def wait_for_slot(max_jobs=6):
    while True:
        jobs = client.fine_tuning.jobs.list(limit=20).data
        active = [j for j in jobs if j.status in ("validating_files", "queued", "running")]
        print(f"  Active jobs: {len(active)}/6", flush=True)
        if len(active) < max_jobs:
            return
        time.sleep(60)

for sid, env_var, suffix in REMAINING:
    train = Path(f"retrain/training/{sid}/train.jsonl")
    val   = Path(f"retrain/training/{sid}/val.jsonl")

    if not train.exists():
        print(f"SKIP {sid}: no train.jsonl")
        continue

    print(f"\nSection {sid}:")
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
