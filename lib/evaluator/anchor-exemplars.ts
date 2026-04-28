export interface AnchorExemplar {
  aspectId: string
  descriptors: { score: 0 | 1 | 2 | 3 | 4 | 5; lookLike: string }[]
}

export const ANCHOR_EXEMPLARS: AnchorExemplar[] = [
  {
    aspectId: 'EX-1',
    descriptors: [
      { score: 0, lookLike: 'Objectives are absent or stated only as topic-level platitudes ("advance the state of the art"); no measurable targets; no link to any prior work or gap.' },
      { score: 1, lookLike: 'Objectives present but entirely generic ("improve materials for manufacturing"); zero quantitative targets; no specific research gap identified; ambition indistinguishable from a project summary.' },
      { score: 2, lookLike: '2–3 high-level objectives with one quantitative target; one paragraph on prior work without specific citations; the gap being addressed is implied rather than named; ambition is claimed but not substantiated.' },
      { score: 3, lookLike: '3–5 specific objectives, at least half with measurable targets (e.g. "reduce CRM use by 30%"); a state-of-the-art section with ≥5 cited gaps tied to named prior works; ambition is explicit; at least one non-trivial shortcoming (e.g. unclear scalability path, one objective has no measurable indicator).' },
      { score: 4, lookLike: '5+ specific objectives, nearly all with quantitative targets; SoA section with ≥10 cited gaps each linked to a specific objective; the proposal goes demonstrably beyond SoA on at least two dimensions; only minor shortcomings (e.g. one unquantified target, one gap without a bibliographic reference).' },
      { score: 5, lookLike: '5+ specific objectives, all measurable; SoA section is comprehensive (≥15 cited prior works); each objective is explicitly mapped to a named gap; ambition justified end-to-end with quantified advancement claims; no notable shortcoming.' },
    ],
  },
  {
    aspectId: 'EX-1-CSA',
    descriptors: [
      { score: 0, lookLike: 'Coordination or support objectives are not stated; only a mission statement or topic name is present.' },
      { score: 1, lookLike: 'Generic coordination objectives ("foster European collaboration"); no named stakeholder communities; no deliverable tied to a coordination output; no reference to existing networks or roadmaps.' },
      { score: 2, lookLike: '2–3 coordination objectives; one named stakeholder group; coordination outputs mentioned (workshops, reports) but without specific scope or timeline; no policy linkage.' },
      { score: 3, lookLike: '3–5 coordination objectives with named stakeholder communities; at least one output linked to a policy instrument (SRIA, roadmap, white paper); governance structure described at a high level; one or two shortcomings (e.g. stakeholder engagement plan thin, no reach metrics).' },
      { score: 4, lookLike: '5+ coordination objectives mapped to named stakeholder communities with engagement timelines; governance structure with named roles (secretariat, advisory board); policy linkage with specific EU instruments identified; metrics for network reach; only minor shortcomings.' },
      { score: 5, lookLike: 'All of score 4 plus: each objective has a measurable coordination outcome; stakeholder engagement strategy with named channels and frequency; sustainability plan for the network beyond project lifetime; concrete policy uptake mechanism specified.' },
    ],
  },
  {
    aspectId: 'EX-2',
    descriptors: [
      { score: 0, lookLike: 'No methodology section, or a single sentence ("we will apply standard methods"); no named techniques, tools, or models.' },
      { score: 1, lookLike: 'Methodology is one paragraph with generic language ("we will use machine learning and experiments"); no named tools or versions; no interdisciplinary integration; no gender dimension; no open-science treatment.' },
      { score: 2, lookLike: 'Methodology has 2–3 subsections; some named tools without versions; one mention of interdisciplinarity; gender dimension addressed in one sentence; open science mentioned generically ("results will be published open access").' },
      { score: 3, lookLike: 'Methodology has 4+ subsections with named tools (versions stated where applicable), at least one workflow diagram; explicit interdisciplinary integration described; gender and open science each addressed in a dedicated paragraph; one or two normal shortcomings (e.g. validation plan thin, assumptions not quantified).' },
      { score: 4, lookLike: 'Methodology is comprehensive (5+ subsections), tools named with versions, multiple diagrams, validation plan with named datasets and benchmarks, gender dimension integrated rather than appended, open-science plan with named repositories and licences; only minor shortcomings (e.g. one assumption unquantified).' },
      { score: 5, lookLike: 'All of score 4 plus: methodology explicitly references the SoA gaps from EX-1, uncertainty quantification on key assumptions, gender/open-science are evidenced with concrete artefacts (DMP with persistent identifiers, named repository and licence).' },
    ],
  },
  {
    aspectId: 'IM-1',
    descriptors: [
      { score: 0, lookLike: 'No impact pathway; no link to call expected outcomes; no beneficiary named; no Theory of Change or equivalent.' },
      { score: 1, lookLike: 'Generic impact claim ("will advance European competitiveness"); no named beneficiary; no causal pathway; call expected outcomes not referenced; no timeline for impact realisation.' },
      { score: 2, lookLike: '2–3 beneficiary groups identified by type; one pathway described but without causal logic; call outcomes referenced generically ("the project contributes to the call objectives"); no quantification of reach or uptake.' },
      { score: 3, lookLike: '3+ beneficiary groups with named populations or market segments; credible causal pathway; at least one call expected outcome explicitly cited with a project-to-EO mapping; quantified reach for at least one beneficiary; one or two shortcomings (e.g. adoption timeline unclear, one EO not addressed).' },
      { score: 4, lookLike: 'All main call EOs cited explicitly with project-to-EO mapping; beneficiary analysis with quantified market or policy reach; pathway includes short/medium/long-term outcomes; only minor shortcomings (e.g. one EO partially addressed, one beneficiary group without reach estimate).' },
      { score: 5, lookLike: 'All of score 4 plus: Theory of Change diagram or equivalent; each EO has a quantified target and a named leading beneficiary group; validation evidence for pathway credibility (prior pilots, user studies, regulatory pre-engagement).' },
    ],
  },
  {
    aspectId: 'IM-2',
    descriptors: [
      { score: 0, lookLike: 'No dissemination plan; no exploitation plan; no mention of IPR or open access.' },
      { score: 1, lookLike: '"Results will be published in peer-reviewed journals" — no named journals, no exploitation roadmap, no IPR discussion; generic conference mention; no reach metrics.' },
      { score: 2, lookLike: '2–3 dissemination channels named; one exploitation route described without commercial specifics; IPR mentioned generically; no named industry partner for commercialisation; no reach or uptake metrics.' },
      { score: 3, lookLike: 'Dissemination plan with named journals and conferences per WP; 2+ exploitation routes with named leads; IPR plan with ownership clause; at least one industry partner for commercialisation; no reach KPIs; one or two shortcomings (e.g. open-access plan generic, exploitation timeline vague).' },
      { score: 4, lookLike: 'Dissemination plan with timeline, named responsible partners, and reach targets; exploitation plan with commercialisation milestones; IPR plan with named inventors and ownership structure; open-access and data-sharing plan with named repository; KPIs for reach (e.g. 50,000 downloads, 3 patents); only minor shortcomings.' },
      { score: 5, lookLike: 'All of score 4 plus: exploitation includes a named spin-off route or licensing deal in progress; TRL progression plan with post-project funding roadmap; communication plan with named channels, frequency, and audience segmentation metrics.' },
    ],
  },
  {
    aspectId: 'IM-3',
    descriptors: [
      { score: 0, lookLike: 'No discussion of scale or significance; no societal or economic framing beyond the project deliverables.' },
      { score: 1, lookLike: 'Claims large societal impact without evidence ("will transform European manufacturing"); no market sizing; no systemic-change pathway; no reference to EU strategic priorities.' },
      { score: 2, lookLike: 'One domain of societal significance described; market sizing mentioned but unsupported by a reference; no discussion of systemic change triggers; EU strategic priority mentioned by name only.' },
      { score: 3, lookLike: '2–3 significance domains with supporting data (e.g. "European market for X is €Y billion, project addresses Z% of the gap"); pathway to systemic change described; reference to EU strategic programmes (Green Deal, Digital Decade); one shortcoming (e.g. significance in only one sector, no quantified job-creation estimate).' },
      { score: 4, lookLike: '3+ significance domains with quantified data; systemic change pathway credible with named triggers (standards, regulation, policy adoption); European and international reach addressed; specific policy instruments referenced; only minor shortcomings (e.g. one domain without quantification).' },
      { score: 5, lookLike: 'All of score 4 plus: significance linked to named EU KPIs (e.g. Green Deal 55% emissions target, Fit-for-55); quantified job-creation or carbon-reduction figures with source; independent validation of market size or societal need (e.g. Eurostat, JRC study).' },
    ],
  },
  {
    aspectId: 'IMPL-1',
    descriptors: [
      { score: 0, lookLike: 'No work plan; no deliverables; no timeline; no task structure.' },
      { score: 1, lookLike: '1–2 work packages named only without objectives; no deliverable IDs; no milestones; no Gantt chart or schedule; risks not mentioned.' },
      { score: 2, lookLike: '3–4 work packages with brief descriptions; some deliverable titles (no D-IDs); no formal milestone table; risks listed as bullet points without mitigations; no task-level breakdown.' },
      { score: 3, lookLike: '5–7 work packages with objectives and deliverables with D-IDs; milestone table with M-IDs; Gantt chart or timeline; risk table with named mitigations; task breakdown for at least 2 WPs; one or two shortcomings (e.g. resource allocation missing, KPIs informal, one WP has no deliverables).' },
      { score: 4, lookLike: '7–10 work packages, all with D-IDs, M-IDs, and T-IDs; detailed Gantt with month-level milestones; risk register with named mitigations for each risk; KPIs per WP; resource allocation table; only minor shortcomings (e.g. one WP lacks T-IDs).' },
      { score: 5, lookLike: 'All of score 4 plus: critical path analysis; WP interdependency diagram; named deliverable-lead roles; contingency planning per WP; quality assurance plan; management response protocol for deviations.' },
    ],
  },
  {
    aspectId: 'IMPL-2',
    descriptors: [
      { score: 0, lookLike: 'No partner descriptions; roles not assigned; expertise not stated; single institution.' },
      { score: 1, lookLike: 'Partner names listed only; no roles; no expertise stated; all from one country; no SME or end-user; no complementarity argument.' },
      { score: 2, lookLike: '2–3 partners with brief institutional descriptions; coordinator named; general expertise ("strong research track record"); 1–2 countries; no SME; no end-user; complementarity asserted but not evidenced.' },
      { score: 3, lookLike: '4–7 partners with named roles (coordinator, WP leaders); expertise statements per partner; 3+ countries; SME or end-user present; complementarity described with specific examples; one or two shortcomings (e.g. role overlap between partners, gender balance not discussed).' },
      { score: 4, lookLike: '7–10 partners, each with named WP-leader role, stated expertise, and explicit complementarity; 4+ countries; SME and end-user both present; gender balance addressed; at least two partners cite relevant prior EC projects; only minor shortcomings (e.g. one partner has a thin expertise statement).' },
      { score: 5, lookLike: 'All of score 4 plus: competence matrix mapping partners to WP tasks; consortium agreement pre-planned with IP clauses; named advisory board with external experts; all diversity metrics (gender, country, sector) addressed with data.' },
    ],
  },
]

export function getExemplars(aspectId: string): AnchorExemplar | undefined {
  return ANCHOR_EXEMPLARS.find(e => e.aspectId === aspectId)
}

export function buildExemplarBlock(aspectId: string): string {
  const exemplar = getExemplars(aspectId)
  if (!exemplar) return ''
  const lines = exemplar.descriptors.map(d => `Score ${d.score}: ${d.lookLike}`)
  return `SCORE EXEMPLARS FOR ${aspectId} (pattern-match the proposal text against these):
${lines.join('\n')}

Do not award a score unless the proposal text matches the corresponding exemplar. Quote 1–2 short phrases from the proposal that anchor your score to a specific exemplar level. Do not award the same score to all aspects within a criterion unless the proposal genuinely matches the same exemplar across all aspects.`
}
