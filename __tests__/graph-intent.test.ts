/**
 * Graph Intent Coverage Tests
 *
 * Run with:  npx tsx __tests__/graph-intent.test.ts
 *
 * Each test case maps a natural-language query to the expected GraphIntent type.
 * Any FAIL means a user question would be answered from RAG (or not at all)
 * instead of the knowledge graph — add a detection pattern to fix it.
 */

// Stub env vars BEFORE loading iris-kb (Supabase client initialises at import time)
process.env.NEXT_PUBLIC_SUPABASE_URL  = 'https://stub.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-key'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { detectGraphIntent } = require('../lib/iris-kb') as typeof import('../lib/iris-kb')

interface TestCase {
  query: string
  expected: string   // intent type
  note?: string
}

const cases: TestCase[] = [

  // ── Partners in a specific project ─────────────────────────────────────────
  { query: 'Who are the partners in NANOBLOC?',                          expected: 'project_partners' },
  { query: 'List the partners in the HYPERA project',                    expected: 'project_partners' },
  { query: 'SORT4CIRC partners',                                         expected: 'project_partners' },
  { query: 'Which organisations participated in PROPAT?',                expected: 'project_partners' },

  // ── Projects a partner appears in ──────────────────────────────────────────
  { query: 'Which projects involved Fraunhofer?',                        expected: 'partner_projects' },
  { query: 'Projects with University of Barcelona',                      expected: 'partner_projects' },
  { query: 'Has IRIS worked with AIMPLAS?',                              expected: 'partner_projects' },

  // ── Technology usage — specific tech named ─────────────────────────────────
  { query: 'Which projects use NIR spectroscopy?',                       expected: 'technology_projects' },
  { query: 'Projects using hyperspectral imaging',                       expected: 'technology_projects' },
  { query: 'Which projects involve Raman spectroscopy?',                 expected: 'technology_projects' },
  { query: 'Projects that use chemometrics',                             expected: 'technology_projects' },

  // ── Domain/sector — specific sector ────────────────────────────────────────
  { query: 'Which projects are in the food sector?',                     expected: 'domain_projects' },
  { query: 'IRIS projects in pharma',                                    expected: 'domain_projects' },
  { query: 'Projects in agriculture',                                    expected: 'domain_projects' },
  { query: 'Which projects work in packaging?',                          expected: 'domain_projects' },

  // ── Sector stats: count + budget ───────────────────────────────────────────
  { query: 'How many agri-food projects has IRIS participated in?',      expected: 'sector_stats' },
  { query: 'How many food projects does IRIS have and what is the total funding?', expected: 'sector_stats' },
  { query: 'Total EU funding for agri-food projects',                    expected: 'sector_stats' },
  { query: 'Number of projects in the pharmaceutical sector',            expected: 'sector_stats' },
  { query: 'How many agriculture projects and total budget?',            expected: 'sector_stats' },

  // ── Partners by country ────────────────────────────────────────────────────
  { query: 'Which IRIS projects have Italian partners?',                 expected: 'partners_by_country' },
  { query: 'List the Italian partners across all projects',              expected: 'partners_by_country' },
  { query: 'Projects with German organisations',                         expected: 'partners_by_country' },
  { query: 'Which projects involve French universities?',                expected: 'partners_by_country' },
  { query: 'Partners from Spain',                                        expected: 'partners_by_country' },
  { query: 'Irish partners in IRIS projects',                            expected: 'partners_by_country' },
  { query: 'Which projects include Dutch partners?',                     expected: 'partners_by_country' },

  // ── Programme breakdown ────────────────────────────────────────────────────
  { query: 'How many Horizon Europe funded projects has IRIS participated in?', expected: 'programme_breakdown' },
  { query: 'How many H2020 projects does IRIS have?',                    expected: 'programme_breakdown' },
  { query: 'Breakdown of projects by funding programme',                 expected: 'programme_breakdown' },
  { query: 'How many projects funded by Enterprise Ireland?',            expected: 'programme_breakdown' },

  // ── Country network ────────────────────────────────────────────────────────
  { query: 'Which countries are represented in IRIS partner network?',   expected: 'country_network' },
  { query: 'How many partner organisations from each country?',          expected: 'country_network' },
  { query: 'Geographic distribution of consortium partners',             expected: 'country_network' },

  // ── IRIS technology portfolio (broad, no specific tech) ────────────────────
  { query: 'What technologies has IRIS developed?',                      expected: 'iris_technologies' },
  { query: 'List IRIS technology capabilities',                          expected: 'iris_technologies' },
  { query: 'What instruments does IRIS offer?',                          expected: 'iris_technologies' },
  { query: 'Create a table with the technologies developed by IRIS',     expected: 'iris_technologies',
    note: 'This was previously failing — routed to RAG giving 3 projects instead of 127' },
  { query: 'IRIS technology portfolio',                                   expected: 'iris_technologies' },

  // ── Domain list (all sectors) ──────────────────────────────────────────────
  { query: 'In which sectors and applications has IRIS worked?',         expected: 'domain_list',
    note: 'Was previously answered with only 4 sectors from RAG' },
  { query: 'What industries has IRIS been active in?',                   expected: 'domain_list' },
  { query: 'List all application domains across IRIS projects',          expected: 'domain_list' },
  { query: 'What sectors do IRIS projects cover?',                       expected: 'domain_list' },
  { query: 'Which fields has IRIS applied its technology in?',           expected: 'domain_list' },

  // ── Role list ──────────────────────────────────────────────────────────────
  { query: 'Has IRIS had non-technical roles in these projects?',        expected: 'role_list',
    note: 'Was previously answered with a hallucinated generic table' },
  { query: 'What management roles has IRIS played?',                     expected: 'role_list' },
  { query: 'In which projects is IRIS the coordinator?',                 expected: 'role_list',
    note: 'Could also be coordinator_projects — either is acceptable' },
  { query: 'What are IRIS roles across its projects?',                   expected: 'role_list' },
  { query: 'Has IRIS led any work packages?',                            expected: 'role_list' },

  // ── Active projects ────────────────────────────────────────────────────────
  { query: 'What are the current IRIS projects?',                        expected: 'active_projects' },
  { query: 'List all ongoing projects',                                  expected: 'active_projects' },
  { query: 'Which projects is IRIS currently running?',                  expected: 'active_projects' },

  // ── Coordinator projects ───────────────────────────────────────────────────
  { query: 'Which projects does IRIS coordinate?',                       expected: 'coordinator_projects' },
  { query: 'Projects where IRIS is project coordinator',                 expected: 'coordinator_projects' },
  { query: 'IRIS-led projects',                                          expected: 'coordinator_projects' },

  // ── Project list ───────────────────────────────────────────────────────────
  { query: 'List all IRIS projects',                                     expected: 'project_list' },
  { query: 'Give me a complete list of all projects',                    expected: 'project_list' },
  { query: 'How many projects does IRIS have in total?',                 expected: 'project_list' },

  // ── TRL breakdown ──────────────────────────────────────────────────────────
  { query: 'What is the TRL distribution across IRIS projects?',         expected: 'trl_breakdown' },
  { query: 'TRL breakdown of the project portfolio',                     expected: 'trl_breakdown' },
  { query: 'What TRL levels do IRIS projects start and end at?',         expected: 'trl_breakdown' },

  // ── Status breakdown ───────────────────────────────────────────────────────
  { query: 'How many active vs terminated projects does IRIS have?',     expected: 'status_breakdown' },
  { query: 'Project status breakdown',                                   expected: 'status_breakdown' },
  { query: 'How many IRIS projects have been completed?',                expected: 'status_breakdown' },

  // ── Budget summary ─────────────────────────────────────────────────────────
  { query: 'What is the total EU funding IRIS has received?',            expected: 'budget_summary' },
  { query: 'Total budget across all IRIS projects',                      expected: 'budget_summary' },
  { query: 'How much grant funding has IRIS secured?',                   expected: 'budget_summary' },
  { query: 'Budget breakdown by funding programme',                      expected: 'budget_summary' },

  // ── Frequent / recurring partners ─────────────────────────────────────────
  { query: 'What consortium partners has IRIS collaborated with most frequently?', expected: 'frequent_partners' },
  { query: 'Which partners appear in the most IRIS projects?',           expected: 'frequent_partners' },
  { query: 'Most common consortium members across IRIS projects',        expected: 'frequent_partners' },
  { query: 'List recurring partners across the portfolio',               expected: 'frequent_partners' },
]

// ─── Runner ────────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0
const failures: { query: string; expected: string; got: string; note?: string }[] = []

for (const tc of cases) {
  const intent = detectGraphIntent(tc.query)
  const ok = intent.type === tc.expected
  if (ok) {
    passed++
  } else {
    failed++
    failures.push({ query: tc.query, expected: tc.expected, got: intent.type, note: tc.note })
  }
}

console.log(`\nGraph Intent Coverage: ${passed}/${cases.length} passed\n`)

if (failures.length > 0) {
  console.log('FAILURES — add detection patterns in detectGraphIntent() to fix:\n')
  for (const f of failures) {
    console.log(`  FAIL  "${f.query}"`)
    console.log(`        expected: ${f.expected}  got: ${f.got}`)
    if (f.note) console.log(`        note: ${f.note}`)
    console.log()
  }
  process.exit(1)
} else {
  console.log('All intent patterns covered.\n')
}
