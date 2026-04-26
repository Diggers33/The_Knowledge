#!/usr/bin/env python3
"""Split each IRIS Part B PDF into its numbered sections.
Outputs ./retrain/corpus/sections/<acronym>__<section_id>.txt and
./retrain/corpus/inventory.csv
"""
import csv, re, sys, warnings
warnings.filterwarnings("ignore")
from pathlib import Path
from pypdf import PdfReader

SECTION_HEADERS = [
    # Match any 1.1 subsection (Objectives / Ambition in all call variants)
    ("1.1", r"^\s*1\s*[.]\s*1\s+\w"),
    # Match any 1.2 subsection
    ("1.2", r"^\s*1\s*[.]\s*2\s+\w"),
    # Match any 1.3 subsection
    ("1.3", r"^\s*1\s*[.]\s*3\s+\w"),
    # Match any 1.4 subsection
    ("1.4", r"^\s*1\s*[.]\s*4\s+\w"),
    # Match any 2.1 subsection
    ("2.1", r"^\s*2\s*[.]\s*1\s+\w"),
    # Match any 2.2 subsection
    ("2.2", r"^\s*2\s*[.]\s*2\s+\w"),
    # Match any 2.3 subsection
    ("2.3", r"^\s*2\s*[.]\s*3\s+\w"),
    # 3.1 Work plan variants
    ("3.1", r"^\s*3\s*[.]\s*1\s+\w"),
    # 3.2 Management
    ("3.2", r"^\s*3\s*[.]\s*2\s+\w"),
    # 3.3 Consortium
    ("3.3", r"^\s*3\s*[.]\s*3\s+\w"),
    # Section 4 (Business case / Members)
    ("4",   r"^\s*4\s*[.]\s*(?![\d])\w"),
]

# Extract project acronym from filename prefix (e.g. PBCS108-_SECUREFOOD__ → SECUREFOOD)
def get_acronym(stem: str) -> str:
    # Primary: our naming convention is ACRONYM__<original_filename>
    if "__" in stem:
        return stem.split("__")[0]
    # Fallback: look for all-caps token after project code prefix
    m = re.search(r"[-_]([A-Z][A-Z0-9]{2,14})[-_]", stem)
    if m:
        return m.group(1)
    tokens = re.findall(r"[A-Z][A-Z0-9]{2,14}", stem)
    return tokens[0] if tokens else stem[:12]

def preprocess(text: str) -> str:
    # Insert newlines before section headers that pypdf merged into preceding lines
    text = re.sub(r'(?<!\n)(\s{2,})(\d\s*[.]\s*\d\s+[A-Z])', r'\n\2', text)
    return text

def extract(pdf_path: Path):
    try:
        reader = PdfReader(str(pdf_path))
        full = "\n".join((p.extract_text() or "") for p in reader.pages)
        full = preprocess(full)
    except Exception as e:
        print(f"  ERROR reading {pdf_path.name}: {e}", file=sys.stderr)
        return "", {}

    indices = []
    for sid, pat in SECTION_HEADERS:
        m = re.search(pat, full, flags=re.MULTILINE | re.IGNORECASE)
        if m:
            indices.append((sid, m.start()))
    indices.sort(key=lambda x: x[1])

    out = {}
    for i, (sid, start) in enumerate(indices):
        end = indices[i+1][1] if i+1 < len(indices) else len(full)
        text = full[start:end].strip()
        # Minimum viable section: 200 words
        if len(text.split()) >= 200:
            out[sid] = text
    return full, out

def main():
    corpus_dir  = Path("./retrain/corpus/pdf")
    sections_dir = Path("./retrain/corpus/sections")
    sections_dir.mkdir(parents=True, exist_ok=True)

    rows = []
    pdfs = sorted(corpus_dir.glob("*.pdf"))
    print(f"Processing {len(pdfs)} PDFs...")

    for pdf in pdfs:
        acronym = get_acronym(pdf.stem)
        print(f"  {acronym} ({pdf.name[:60]}...)")
        full, sections = extract(pdf)
        if not sections:
            print(f"    -> no sections found, skipping")
            continue

        grant_m = re.search(r"\b(1\d{8})\b", full)
        grant   = grant_m.group(1) if grant_m else ""
        call_m  = re.search(r"HORIZON-CL\d-20\d\d-[A-Z0-9\-]+", full)
        call    = call_m.group(0) if call_m else ""

        for sid, text in sections.items():
            safe_sid = sid.replace(".", "_")
            out_path = sections_dir / f"{acronym}__{safe_sid}.txt"
            out_path.write_text(text, encoding="utf-8")
            rows.append({
                "acronym":        acronym,
                "grant":          grant,
                "call_id":        call,
                "section_id":     sid,
                "word_count":     len(text.split()),
                "char_count":     len(text),
                "source_pdf":     pdf.name,
                "extracted_text": str(out_path),
            })
        print(f"    -> {len(sections)} sections: {list(sections.keys())}")

    if not rows:
        print("ERROR: no sections extracted from any PDF", file=sys.stderr)
        sys.exit(1)

    inv_path = Path("./retrain/corpus/inventory.csv")
    with open(inv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    projects = set(r["acronym"] for r in rows)
    print(f"\nExtracted {len(rows)} sections from {len(projects)} projects -> {inv_path}")

    # Print coverage matrix
    from collections import defaultdict
    matrix = defaultdict(set)
    for r in rows:
        call = r["call_id"]
        cluster = re.search(r"CL(\d)", call).group(1) if re.search(r"CL(\d)", call) else "?"
        matrix[cluster].add(r["section_id"])

    print("\nCoverage matrix (cluster × section_id):")
    all_sids = sorted(set(r["section_id"] for r in rows))
    clusters = sorted(matrix.keys())
    # Count per (cluster, section_id)
    counts = defaultdict(int)
    for r in rows:
        call = r["call_id"]
        cluster = re.search(r"CL(\d)", call).group(1) if re.search(r"CL(\d)", call) else "?"
        counts[(cluster, r["section_id"])] += 1

    header = f"{'cluster':>8} | " + " | ".join(f"{s:>5}" for s in all_sids)
    print(header)
    print("-" * len(header))
    for cl in clusters:
        row_str = f"{'CL'+cl:>8} | " + " | ".join(f"{counts.get((cl, s), 0):>5}" for s in all_sids)
        print(row_str)

if __name__ == "__main__":
    main()
