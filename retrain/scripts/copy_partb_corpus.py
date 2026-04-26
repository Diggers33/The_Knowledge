#!/usr/bin/env python3
"""Select and copy the best Part B PDF per project from Y:\IRIS-Projects-Coordination.

Priority order (highest first):
  1. PROPOSAL_...PART_B... files  (original Horizon submission)
  2. Proposal-SEP-...pdf          (original F&T portal download)
  3. ...Public Proposal...pdf     (original shared proposal)
  4. ...Annex 1...part B...pdf    (amendment version)
  5. PUBLIC DOA / Public DoA...   (post-grant restructured)

Outputs to ./retrain/corpus/pdf/ with prefix <ACRONYM>__<original_name>.pdf
"""

import re, shutil, sys
from pathlib import Path

COORD_ROOT = Path(r"Y:\IRIS-Projects-Coordination\10 Projects")
OUT_DIR    = Path("./retrain/corpus/pdf")

EXCLUDE_PATTERNS = [
    r"grant.agreement", r"consortium.agreement", r"CA_", r"GAP-",
    r"_CA_", r"Declaration", r"success.fee", r"invitation.letter",
    r"information.letter", r"ESR\b", r"EthSR\b", r"budget.table",
    r"subcontracting", r"part.A\b", r"Part_A", r"PART_A",
    r"Annex B", r"annex.b", r"CELSA", r"SIGNED",
]

PRIORITY = [
    (5, r"PROPOSAL_.*PART_B"),          # Horizon sealed proposal
    (4, r"Proposal-SEP-\d"),            # F&T portal download
    (4, r"0[12345].*Excellence|0[12345].*Impact|0[12345].*Implementation"),  # numbered section files
    (3, r"Public.Proposal"),            # shared public proposal
    (2, r"Annex.1.*part.B"),            # amendment DoA
    (1, r"PUBLIC.DOA|Public.DoA|public.doa"),  # post-grant DoA
]

def is_excluded(name: str) -> bool:
    n = name.lower()
    return any(re.search(p, n, re.IGNORECASE) for p in EXCLUDE_PATTERNS)

def priority_score(name: str) -> int:
    for score, pat in PRIORITY:
        if re.search(pat, name, re.IGNORECASE):
            return score
    return 0

def get_acronym(folder_name: str) -> str:
    # Try last all-caps token after the project code prefix (e.g. "PBMO097 - DiCiM" -> "DICIM")
    # Handle mixed case like DiCiM
    m = re.search(r"[-\s]+([A-Za-z][A-Za-z0-9\-]{2,14})\s*$", folder_name)
    if m:
        return m.group(1).replace("-", "").upper()
    tokens = re.findall(r"[A-Z][A-Za-z0-9]{2,14}", folder_name)
    return tokens[-1].upper() if tokens else folder_name[:12]

def find_candidates(proj_dir: Path):
    agree_dir = proj_dir / "1- Agreements"
    if not agree_dir.exists():
        return []
    candidates = []
    for pdf in agree_dir.rglob("*.pdf"):
        if is_excluded(pdf.name):
            continue
        score = priority_score(pdf.name)
        if score > 0:
            candidates.append((score, pdf))
    return candidates

def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # Clear existing
    for f in OUT_DIR.glob("*.pdf"):
        f.unlink()

    copied = 0
    skipped = 0
    # Active projects + terminated projects subfolder
    active = [p for p in COORD_ROOT.iterdir() if p.is_dir() and not p.name.startswith("0")]
    terminated_root = COORD_ROOT / "TERMINATED"
    terminated = [p for p in terminated_root.iterdir() if p.is_dir()] if terminated_root.exists() else []
    projects = sorted(active + terminated)

    for proj in projects:
        acronym = get_acronym(proj.name)
        candidates = find_candidates(proj)
        if not candidates:
            print(f"  SKIP {acronym} ({proj.name}) — no candidates found")
            skipped += 1
            continue

        # Group by score, take all from highest score group (deduplicated by name)
        best_score = max(s for s, _ in candidates)
        seen_names = set()
        best = []
        for s, pdf in candidates:
            if s == best_score and pdf.name not in seen_names:
                best.append(pdf)
                seen_names.add(pdf.name)

        for pdf in best:
            safe_name = re.sub(r"[^\w\-. ]", "_", pdf.name)
            dest = OUT_DIR / f"{acronym}__{safe_name}"
            shutil.copy2(str(pdf), str(dest))
            print(f"  OK  {acronym} (score={best_score}) -> {pdf.name[:70]}")
            copied += 1

    print(f"\nDone: {copied} PDFs copied, {skipped} projects skipped -> {OUT_DIR}")

if __name__ == "__main__":
    main()
