#!/usr/bin/env python3
"""Augment thin training sections using chunks already in Supabase rag_documents.

For each section still below TARGET_MIN examples, queries DoA/Part B chunks
for IRIS projects, reconstructs ~2000-word blocks, classifies by section keyword,
and adds passing examples to retrain/training/<sid>/train.jsonl.
"""

import json, os, re, sys
from pathlib import Path
from collections import defaultdict
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv(Path(".env.local"))

try:
    from supabase import create_client
except ImportError:
    sys.exit("pip install supabase")

SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
openai_client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

REWRITE_SYSTEM = """You are a copy editor. Convert the provided EU proposal text from third-person to first-person plural (we/our/us).
Rules:
- "The project" -> "we" or "our project"
- "The consortium" -> "we" / "our consortium"
- "Partners will" -> "We will"
- "This project" -> "our project"
- Preserve all technical content, structure, bullet points, and formatting exactly
- Return ONLY the rewritten text, no preamble"""

def rewrite_to_firstperson(text: str) -> str:
    if re.search(r'\b(we|our)\b', text[:300], re.IGNORECASE):
        return text  # already first-person
    try:
        resp = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": REWRITE_SYSTEM},
                {"role": "user",   "content": text},
            ],
            max_tokens=2000,
            temperature=0,
        )
        return resp.choices[0].message.content.strip()
    except Exception:
        return text

TRAINING_DIR = Path("./retrain/training")
TARGET_MIN   = 10   # minimum examples per section before augmentation stops
BLOCK_WORDS  = 2000 # target words per reconstructed block
MAX_WORDS    = 4000

GRANT_RE   = re.compile(r"\b(101\d{6}|1\d{8}|\d{9})\b")
TOC_RE     = re.compile(r"\.{5,}")

# Section classification keywords (must appear in >30% of sentences to qualify)
SECTION_KEYWORDS: dict[str, list[str]] = {
    "1.1": ["objective", "ambition", "aim", "goal", "beyond state of the art", "novelty", "vision"],
    "1.2": ["state of the art", "sota", "current knowledge", "literature", "gap", "limitation", "innovation", "breakthrough"],
    "1.3": ["methodology", "approach", "research design", "technical", "trl", "validation", "experimental"],
    "1.4": ["ambition", "innovation", "breakthrough", "beyond", "novel", "transformative", "frontier"],
    "2.1": ["expected outcome", "impact", "kpi", "indicator", "contribution", "benefit", "pathway"],
    "2.2": ["dissemination", "exploitation", "open access", "ipr", "intellectual property", "standard"],
    "2.3": ["communication", "outreach", "public", "stakeholder", "media", "awareness"],
    "3.1": ["work package", "task", "deliverable", "milestone", "gantt", "wp", "work plan"],
    "3.2": ["management", "governance", "decision", "risk", "quality", "coordinator"],
    "3.3": ["consortium", "partner", "complementarity", "expertise", "collaboration"],
}

DOA_PATTERNS = [
    r"doa", r"part[_\- ]?b", r"description.of.action",
    r"proposal\b", r"annex\b", r"public.doa",
]
DOA_RE = re.compile("|".join(DOA_PATTERNS), re.IGNORECASE)

CONTAMINATION_LIST = [
    "SecureFood", "MICROORCH", "GIANT LEAPS", "CIRCSHOE",
    "CIRCULAR FoodPack", "PHOTONFOOD", "PRESERVE", "SORT4CIRC",
    "NANOBLOC", "HYPERA", "GRIDHEAL", "FARM2FORK",
]

SECTION_TITLES = {
    "1.1": "Objectives and ambition",
    "1.2": "State of the art and innovation",
    "1.3": "Methodology and approach",
    "1.4": "Ambition and innovation beyond the state of the art",
    "2.1": "Expected outcomes and impacts",
    "2.2": "Dissemination, exploitation and communication",
    "2.3": "Communication and open science",
    "3.1": "Work plan and work packages",
    "3.2": "Management structure and procedures",
    "3.3": "Consortium as a whole",
    "4":   "Business case and exploitation strategy",
}

SYSTEM_PROMPT_BASE = """You are an expert EU proposal writer for IRIS Technology Solutions, a photonics and NIR spectroscopy company. Write in first-person plural (we/our). Use precise technical language. Follow EU Horizon proposal conventions: numbered tasks (**Task X.Y**), clear objectives, evidence-based claims."""

SECTION_SYSTEM_ADDENDUM = {
    "1.1": " Focus on specific, measurable objectives linked to the call expected outcomes.",
    "1.2": " Provide a comprehensive analysis of the current state of the art, identify gaps, and explain how this project advances beyond existing knowledge.",
    "1.3": " Describe the research methodology, technical approach, risk mitigation strategies, and TRL progression.",
    "1.4": " Articulate the novel and ambitious elements. Explain what makes this genuinely breakthrough.",
    "2.1": " Map the project to the call's expected outcomes. Provide quantified KPIs and pathways to impact.",
    "2.2": " Detail the dissemination plan, exploitation roadmap, IP strategy, and open access commitments.",
    "2.3": " Describe communication activities, target audiences, key messages, and channels.",
    "3.1": " Present the work plan with work packages, tasks, deliverables, milestones, and Gantt logic.",
    "3.2": " Describe the governance structure, decision-making processes, risk management, and quality assurance.",
    "3.3": " Profile the consortium partners, explain complementarity, and justify the partnership composition.",
    "4":   " Present the business case, market analysis, commercialisation pathway, and investment needs.",
}

def count_lines(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(1 for _ in open(path, encoding="utf-8"))

def classify_block(text: str) -> str | None:
    """Return section_id if block clearly belongs to one section, else None."""
    lower = text.lower()
    words = lower.split()
    total = len(words)
    if total < 100:
        return None

    scores: dict[str, float] = {}
    for sid, kws in SECTION_KEYWORDS.items():
        hits = sum(lower.count(kw) for kw in kws)
        scores[sid] = hits / (total / 100)  # hits per 100 words

    if not scores:
        return None
    best = max(scores, key=lambda k: scores[k])
    if scores[best] < 0.3:  # too few keywords
        return None
    # Check no competing section scores > 60% of best
    competitors = [s for s, v in scores.items() if s != best and v > scores[best] * 0.6]
    if competitors:
        return None
    return best

def is_contaminated(text: str, own_acronym: str) -> bool:
    grants = set(GRANT_RE.findall(text))
    if len(grants) > 1:
        return True
    own_lower = own_acronym.lower()
    for name in CONTAMINATION_LIST:
        if name.lower() in text.lower() and name.lower() != own_lower:
            return True
    toc_lines = [l for l in text.split('\n') if TOC_RE.search(l)]
    if len(toc_lines) > 3:
        return True
    return False

def build_example(sid: str, text: str) -> dict:
    title = SECTION_TITLES.get(sid, f"section {sid}")
    system = SYSTEM_PROMPT_BASE + SECTION_SYSTEM_ADDENDUM.get(sid, "")
    return {"messages": [
        {"role": "system",    "content": system},
        {"role": "user",      "content": f"Write the {title} section for a Horizon Europe proposal."},
        {"role": "assistant", "content": text},
    ]}

def fetch_doa_chunks(project_tag: str) -> list[dict]:
    resp = (
        supabase.table("rag_documents")
        .select("chunk_text, source_file, page_number")
        .eq("project_tag", project_tag)
        .order("page_number")
        .execute()
    )
    return [r for r in (resp.data or []) if DOA_RE.search(r.get("source_file", ""))]

def reconstruct_blocks(chunks: list[dict], target_words: int = BLOCK_WORDS) -> list[str]:
    """Concatenate adjacent chunks into target_words-sized blocks."""
    blocks = []
    current_words = []
    for ch in chunks:
        text = ch.get("chunk_text", "").strip()
        if not text:
            continue
        words = text.split()
        current_words.extend(words)
        if len(current_words) >= target_words:
            blocks.append(" ".join(current_words[:MAX_WORDS]))
            current_words = current_words[target_words:]
    if len(current_words) >= 200:
        blocks.append(" ".join(current_words[:MAX_WORDS]))
    return blocks

def get_known_projects() -> list[str]:
    resp = (
        supabase.table("rag_documents")
        .select("project_tag")
        .not_.is_("project_tag", "null")
        .execute()
    )
    tags = set(r["project_tag"] for r in (resp.data or []) if r.get("project_tag"))
    return sorted(tags)

def main():
    # Find sections that need more examples
    thin_sections = []
    for sid_dir in sorted(TRAINING_DIR.iterdir()):
        if not sid_dir.is_dir():
            continue
        n = count_lines(sid_dir / "train.jsonl")
        sid = sid_dir.name.replace("_", ".", 1)
        if n < TARGET_MIN:
            thin_sections.append((sid, sid_dir, n))
            print(f"  Section {sid}: {n} examples (need {TARGET_MIN - n} more)")

    if not thin_sections:
        print("All sections already at target. Nothing to do.")
        return

    print(f"\nFetching project tags from Supabase...")
    projects = get_known_projects()
    print(f"Found {len(projects)} projects with DoA chunks")

    added_total = 0

    for project_tag in projects:
        print(f"\n  Project: {project_tag}")
        chunks = fetch_doa_chunks(project_tag)
        if not chunks:
            continue
        blocks = reconstruct_blocks(chunks)

        for block in blocks:
            sid = classify_block(block)
            if not sid:
                continue

            # Check if this section still needs examples
            matching = [(s, d, n) for s, d, n in thin_sections if s == sid]
            if not matching:
                continue
            _, sec_dir, current_n = matching[0]
            if current_n >= TARGET_MIN:
                continue

            if is_contaminated(block, project_tag):
                continue

            wc = len(block.split())
            if wc < 200:
                continue

            block = rewrite_to_firstperson(block)
            example = build_example(sid, block)
            train_path = sec_dir / "train.jsonl"
            with open(train_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(example, ensure_ascii=False) + "\n")

            # Update count
            for i, (s, d, n) in enumerate(thin_sections):
                if s == sid:
                    thin_sections[i] = (s, d, n + 1)
                    current_n = n + 1
                    break

            print(f"    Added block to {sid} ({wc} words) — now {current_n}/{TARGET_MIN}")
            added_total += 1

    print(f"\nDone: {added_total} blocks added from Supabase chunks")
    print("\nFinal counts:")
    for sid, sec_dir, _ in thin_sections:
        n = count_lines(sec_dir / "train.jsonl")
        status = "OK" if n >= TARGET_MIN else "STILL THIN"
        print(f"  {sid}: {n} examples [{status}]")

if __name__ == "__main__":
    main()
