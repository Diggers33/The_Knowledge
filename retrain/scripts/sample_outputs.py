#!/usr/bin/env python3
"""Phase 7: Generate sample outputs across 3 domains and 5 section types.

Domains:
  A - NIR spectroscopy for food quality in smart manufacturing (core IRIS)
  B - Photonic sensors for pharmaceutical inline process control
  C - Hyperspectral imaging for plastic waste sorting in circular economy

Sections sampled: 1.1, 1.3, 2.1, 3.1, 3.3
"""

import os, json
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(".env.local"))
from openai import OpenAI
client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

DOMAINS = {
    "A": "NIR spectroscopy for real-time food quality control in smart manufacturing lines",
    "B": "photonic sensors for pharmaceutical inline process analytical technology (PAT)",
    "C": "hyperspectral imaging for automated plastic waste sorting in circular economy facilities",
}

SECTION_MODELS = {
    "1_1": (os.environ.get("IRIS_MODEL_OBJECTIVES"),    "Objectives and ambition"),
    "1_2": (os.environ.get("IRIS_MODEL_SOTA"),          "State of the art and innovation"),
    "1_3": (os.environ.get("IRIS_MODEL_METHODOLOGY"),   "Methodology and approach"),
    "1_4": (os.environ.get("IRIS_MODEL_INNOVATION"),    "Ambition and innovation beyond the state of the art"),
    "2_1": (os.environ.get("IRIS_MODEL_OUTCOMES"),      "Expected outcomes and impacts"),
    "2_2": (os.environ.get("IRIS_MODEL_DISSEMINATION"), "Dissemination, exploitation and communication"),
    "2_3": (os.environ.get("IRIS_MODEL_COMMUNICATION"), "Communication and open science"),
    "3_1": (os.environ.get("IRIS_MODEL_WORKPLAN"),      "Work plan and work packages"),
    "3_2": (os.environ.get("IRIS_MODEL_MANAGEMENT"),    "Management structure and procedures"),
    "3_3": (os.environ.get("IRIS_MODEL_CONSORTIUM"),    "Consortium as a whole"),
    "4":   (os.environ.get("IRIS_MODEL_BUSINESS_CASE"), "Business case and exploitation strategy"),
}

SYSTEM = """You are an expert EU proposal writer for IRIS Technology Solutions, a photonics and NIR spectroscopy company. Write in first-person plural (we/our). Use precise technical language. Follow EU Horizon proposal conventions: numbered tasks (**Task X.Y**), clear objectives, evidence-based claims."""

OUT_DIR = Path("./retrain/samples")
OUT_DIR.mkdir(parents=True, exist_ok=True)

def generate(model: str, section_title: str, domain: str) -> str:
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user",   "content": f"Write the {section_title} section for a Horizon Europe proposal on {domain}."},
        ],
        max_tokens=1000,
        temperature=0.7,
    )
    return resp.choices[0].message.content or ""

def main():
    all_samples = []
    for domain_key, domain_desc in DOMAINS.items():
        print(f"\nDomain {domain_key}: {domain_desc[:60]}...")
        for sid, (model, title) in SECTION_MODELS.items():
            if not model:
                print(f"  SKIP {sid}: no model")
                continue
            print(f"  Generating {sid} — {title[:40]}...", end="", flush=True)
            output = generate(model, title, domain_desc)
            words = len(output.split())
            print(f" {words} words")
            sample = {
                "domain": domain_key,
                "domain_desc": domain_desc,
                "section": sid,
                "section_title": title,
                "model": model,
                "output": output,
                "words": words,
            }
            all_samples.append(sample)

            # Write individual file
            fname = OUT_DIR / f"domain{domain_key}_{sid}.txt"
            fname.write_text(f"=== Domain {domain_key}: {domain_desc} ===\n=== Section {sid}: {title} ===\n\n{output}", encoding="utf-8")

    # Write combined JSON
    (OUT_DIR / "all_samples.json").write_text(
        json.dumps(all_samples, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    print(f"\nDone: {len(all_samples)} samples written to {OUT_DIR}/")
    print("\nSample preview (Domain A, Section 1.1):")
    for s in all_samples:
        if s["domain"] == "A" and s["section"] == "1_1":
            print(s["output"][:600])
            break

if __name__ == "__main__":
    main()
