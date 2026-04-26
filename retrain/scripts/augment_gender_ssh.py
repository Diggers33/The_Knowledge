#!/usr/bin/env python3
"""T8/T9: Augment §1.3 and §3.3 training examples with gender, open science, and SSH paragraphs.

Run from iris-kb/:  py -3 retrain/scripts/augment_gender_ssh.py
"""

import json, os, sys
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(".env.local"))

try:
    from openai import OpenAI
except ImportError:
    sys.exit("pip install openai")

client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

TRAINING_DIR = Path("./retrain/training")

# ── Prompt templates ──────────────────────────────────────────────────────────

GENDER_PROMPT_13 = """\
You are augmenting a Horizon Europe §1.3 Methodology section. The existing text is provided below.

TASK: Write exactly TWO short paragraphs (80-120 words total) to append to this methodology section:

Paragraph 1 — Gender dimension (heading: ### Gender dimension):
Explain how sex and/or gender analysis is integrated into the research CONTENT (not just team composition). Identify what sex/gender variables are relevant to the technology or application domain described in the text. Be specific to the domain. Write in first-person plural.

Paragraph 2 — Open science practices (heading: ### Open science practices):
Describe the open science approach: open access publications (≥60% via Zenodo/OpenAIRE), FAIR data principles, data management plan (DMP) as mandatory deliverable by M6, software/code sharing. Write in first-person plural. 80-120 words total.

EXISTING METHODOLOGY TEXT (for domain context):
{text}

Output ONLY the two paragraphs with their ### headings. No preamble."""

SSH_GENDER_PROMPT_33 = """\
You are augmenting a Horizon Europe §3.3 Consortium section. The existing text is provided below.

TASK: Write exactly TWO short paragraphs (120-160 words total) to append to this consortium section:

Paragraph 1 — Social sciences and humanities (heading: ### Social sciences and humanities (SSH)):
Explain whether and how SSH expertise contributes to the project (e.g. user behaviour, adoption barriers, policy design, social impact). Be specific to the consortium and technology described. If no SSH partner is named, state what SSH-relevant questions the technical partners address. Write in first-person plural.

Paragraph 2 — Open science and gender aspects of R&I (heading: ### Open science and gender aspects of R&I):
Describe: (a) open science practices (open access, FAIR data, software sharing), and (b) the gender dimension at consortium level — gender balance, gender equality plan (GEP) required under HE rules, and how gender is considered in the research design. Write in first-person plural.

EXISTING CONSORTIUM TEXT (for domain context):
{text}

Output ONLY the two paragraphs with their ### headings. No preamble."""


def needs_augmentation_13(text: str) -> bool:
    return 'gender' not in text.lower() or 'open science' not in text.lower()


def needs_augmentation_33(text: str) -> bool:
    return 'gender' not in text.lower() or ('social science' not in text.lower() and 'ssh' not in text.lower())


def augment_13(text: str) -> str:
    resp = client.chat.completions.create(
        model='gpt-4o-mini',
        messages=[{'role': 'user', 'content': GENDER_PROMPT_13.format(text=text[:3000])}],
        max_tokens=350,
        temperature=0.4,
    )
    addition = resp.choices[0].message.content.strip()
    return text.rstrip() + '\n\n' + addition


def augment_33(text: str) -> str:
    resp = client.chat.completions.create(
        model='gpt-4o-mini',
        messages=[{'role': 'user', 'content': SSH_GENDER_PROMPT_33.format(text=text[:3000])}],
        max_tokens=400,
        temperature=0.4,
    )
    addition = resp.choices[0].message.content.strip()
    return text.rstrip() + '\n\n' + addition


def process_file(path: Path, needs_fn, augment_fn, section_label: str):
    lines = [json.loads(l) for l in path.read_text(encoding='utf-8').splitlines() if l.strip()]
    updated = 0
    out_lines = []
    for ex in lines:
        assistant_idx = next(i for i, m in enumerate(ex['messages']) if m['role'] == 'assistant')
        text = ex['messages'][assistant_idx]['content']
        if needs_fn(text):
            print(f"  Augmenting {section_label} example ({len(text.split())}w)...")
            new_text = augment_fn(text)
            ex['messages'][assistant_idx]['content'] = new_text
            updated += 1
        out_lines.append(json.dumps(ex, ensure_ascii=False))
    path.write_text('\n'.join(out_lines) + '\n', encoding='utf-8')
    print(f"  {path.name}: {updated}/{len(lines)} examples augmented")


def main():
    for sid, needs_fn, augment_fn, label in [
        ('1_3', needs_augmentation_13, augment_13, '§1.3 Methodology'),
        ('3_3', needs_augmentation_33, augment_33, '§3.3 Consortium'),
    ]:
        sec_dir = TRAINING_DIR / sid
        print(f"\n=== {label} ({sec_dir}) ===")
        for fname in ('train.jsonl', 'val.jsonl'):
            fpath = sec_dir / fname
            if fpath.exists():
                process_file(fpath, needs_fn, augment_fn, label)
            else:
                print(f"  {fname}: not found, skipping")

    print("\nDone. Re-run rewrite_to_firstperson.py to normalise voice.")


if __name__ == '__main__':
    main()
