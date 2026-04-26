#!/usr/bin/env python3
"""Round 3 fine-tune submission — richer first-person dataset, descriptive model names."""
import os, time, json
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(".env.local"))
from openai import OpenAI
client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

MODEL    = "gpt-4.1-mini-2025-04-14"
N_EPOCHS = 2

# Local state file to track submitted job IDs across runs
STATE_FILE = Path("retrain/scripts/round3_state.json")

SECTIONS = [
    ("1_1", "IRIS_MODEL_OBJECTIVES",   "iris-s11-objectives"),
    ("1_2", "IRIS_MODEL_SOTA",         "iris-s12-sota"),
    ("1_3", "IRIS_MODEL_METHODOLOGY",  "iris-s13-method"),
    ("1_4", "IRIS_MODEL_INNOVATION",   "iris-s14-innovation"),
    ("2_1", "IRIS_MODEL_OUTCOMES",     "iris-s21-outcomes"),
    ("2_2", "IRIS_MODEL_DISSEMINATION","iris-s22-dissem"),
    ("2_3", "IRIS_MODEL_COMMUNICATION","iris-s23-comms"),
    ("3_1", "IRIS_MODEL_WORKPLAN",     "iris-s31-workplan"),
    ("3_2", "IRIS_MODEL_MANAGEMENT",   "iris-s32-mgmt"),
    ("3_3", "IRIS_MODEL_CONSORTIUM",   "iris-s33-consortium"),
    ("4",   "IRIS_MODEL_BUSINESS_CASE","iris-s4-bizcase"),
]

def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {}  # {sid: job_id}

def save_state(state: dict):
    STATE_FILE.write_text(json.dumps(state, indent=2))

def upload(path: Path) -> str:
    print(f"    Uploading {path.name} ({path.stat().st_size // 1024} KB)...")
    with open(path, "rb") as f:
        return client.files.create(file=f, purpose="fine-tune").id

def wait_for_slot(max_jobs: int = 6):
    while True:
        active = [j for j in client.fine_tuning.jobs.list(limit=20).data
                  if j.status in ("validating_files", "queued", "running")]
        if len(active) < max_jobs:
            return
        print(f"    Waiting... {len(active)} active jobs")
        time.sleep(60)

def already_submitted(suffix: str) -> str | None:
    """Return job_id if a job with this suffix is already active or succeeded.
    Checks fine_tuned_model (completed jobs) since the suffix field is always None in API responses.
    """
    for job in client.fine_tuning.jobs.list(limit=100).data:
        if job.status not in ("validating_files", "queued", "running", "succeeded"):
            continue
        # Completed jobs: suffix is embedded in fine_tuned_model
        model = job.fine_tuned_model or ''
        if f':{suffix}:' in model:
            return job.id
    return None

state = load_state()

for sid, env_var, suffix in SECTIONS:
    train = Path(f"retrain/training/{sid}/train.jsonl")
    val   = Path(f"retrain/training/{sid}/val.jsonl")

    if not train.exists():
        print(f"SKIP {sid}: no train.jsonl")
        continue

    n = sum(1 for _ in open(train, encoding="utf-8"))
    if n < 10:
        print(f"SKIP {sid}: only {n} examples")
        continue

    # Check local state first (covers running jobs whose model name isn't set yet)
    if sid in state:
        print(f"SKIP {sid}: already submitted as {state[sid]} (local state)")
        continue

    # Also check API for completed jobs from previous runs
    existing = already_submitted(suffix)
    if existing:
        print(f"SKIP {sid}: already submitted as {existing} (API check)")
        state[sid] = existing
        save_state(state)
        continue

    print(f"\nSection {sid} ({n} examples) -> suffix={suffix}:")
    wait_for_slot()

    train_id = upload(train)
    val_id = None
    if val.exists() and val.stat().st_size > 10:
        nv = sum(1 for _ in open(val, encoding="utf-8"))
        if nv > 0:
            val_id = upload(val)

    kwargs = dict(
        training_file=train_id,
        model=MODEL,
        hyperparameters={"n_epochs": N_EPOCHS},
        suffix=suffix,
    )
    if val_id:
        kwargs["validation_file"] = val_id

    job = client.fine_tuning.jobs.create(**kwargs)
    print(f"    Job: {job.id}  status={job.status}  env_var={env_var}")
    state[sid] = job.id
    save_state(state)
