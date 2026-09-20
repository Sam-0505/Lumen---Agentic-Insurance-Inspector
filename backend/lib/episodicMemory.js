/**
 * Episodic memory for past claims.
 *
 * Storage: a single JSON file (backend/data/episodicMemory.json), seeded on
 * first run from backend/data/seedClaims.json (fabricated demo claims — see
 * REVIEW.md / MEMORY_ARCHITECTURE_PLAN.md for why these are hand-written
 * rather than pulled from a public dataset). No native dependencies (no
 * sqlite build step) so it runs on whatever Node the box has.
 *
 * Retrieval: lightweight TF-IDF-style scoring in plain JS. Not real BM25,
 * but the same idea — term frequency weighted by how rare that term is
 * across the corpus — good enough at seed-data scale (dozens of claims).
 */

const fs = require('fs');
const path = require('path');
const { rankByRelevance } = require('./textSearch');

const DATA_DIR = path.join(__dirname, '../data');
const SEED_PATH = path.join(DATA_DIR, 'seedClaims.json');
const STORE_PATH = path.join(DATA_DIR, 'episodicMemory.json');

const MAX_STORED_CLAIMS = 300;

function ensureStoreExists() {
  if (fs.existsSync(STORE_PATH)) return;
  const seed = fs.existsSync(SEED_PATH)
    ? JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'))
    : [];
  fs.writeFileSync(STORE_PATH, JSON.stringify(seed, null, 2));
}

function loadStore() {
  ensureStoreExists();
  return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
}

function persistStore(claims) {
  const trimmed = claims.length > MAX_STORED_CLAIMS
    ? claims.slice(claims.length - MAX_STORED_CLAIMS)
    : claims;
  fs.writeFileSync(STORE_PATH, JSON.stringify(trimmed, null, 2));
}

function getSearchableText(claim) {
  const areaText = (claim.affected_areas || [])
    .map((a) => `${a.name || ''} ${a.description || ''}`)
    .join(' ');
  return [
    claim.vehicle,
    claim.damage_type,
    claim.damage_summary,
    areaText,
    claim.outcome_note,
  ].filter(Boolean).join(' ');
}

/**
 * Returns the top N past claims most textually similar to `queryText`.
 * Each result includes a `score` (higher = more relevant) and `matchedTerms`.
 */
function searchSimilarClaims(queryText, topN = 3) {
  return rankByRelevance(queryText, loadStore(), getSearchableText, topN);
}

/**
 * Appends a newly-decided claim to episodic memory so future claims can
 * retrieve it as precedent. Never throws — memory writes must not break
 * the coverage-check response.
 */
function saveEpisode(episode) {
  try {
    const claims = loadStore();
    claims.push({
      id: episode.id || `claim-${Date.now()}`,
      created_at: episode.created_at || new Date().toISOString(),
      vehicle: episode.vehicle || 'Unknown vehicle',
      damage_type: episode.damage_type || 'Unspecified',
      damage_summary: episode.damage_summary || '',
      affected_areas: episode.affected_areas || [],
      coverage_decisions: episode.coverage_decisions || [],
      total_estimated_payout_usd: episode.total_estimated_payout_usd || null,
      outcome_note: episode.outcome_note || '',
    });
    persistStore(claims);
    return true;
  } catch (err) {
    console.error('[episodicMemory] saveEpisode failed:', err.message);
    return false;
  }
}

function listEpisodes() {
  return loadStore();
}

/**
 * Renders retrieved claims as a compact text block to inject into an LLM
 * prompt as reference context.
 */
function formatForPrompt(matches) {
  if (!matches || matches.length === 0) return '';
  return matches.map((m, i) => {
    const decisions = (m.coverage_decisions || [])
      .map((d) => `${d.area_name}: ${d.coverage_status} (${d.policy_section || 'n/a'}) — ${d.reason || ''}`)
      .join('; ');
    return `${i + 1}. [${m.id}] ${m.vehicle} — ${m.damage_type}\n   Summary: ${m.damage_summary}\n   Past decisions: ${decisions}\n   Outcome: ${m.outcome_note || 'n/a'}`;
  }).join('\n');
}

module.exports = {
  searchSimilarClaims,
  saveEpisode,
  listEpisodes,
  formatForPrompt,
  getSearchableText,
};
