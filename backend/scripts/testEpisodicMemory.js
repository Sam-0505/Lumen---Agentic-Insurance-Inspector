/**
 * Offline test for episodic memory retrieval — no server, no LLM key needed.
 * Run: node scripts/testEpisodicMemory.js
 */
const path = require('path');
const fs = require('fs');
const episodicMemory = require('../lib/episodicMemory');

const STORE_PATH = path.join(__dirname, '../data/episodicMemory.json');

// Start each run from a clean copy of the seed set so results are repeatable.
if (fs.existsSync(STORE_PATH)) fs.unlinkSync(STORE_PATH);

function section(title) {
  console.log(`\n=== ${title} ===`);
}

function printMatches(matches) {
  if (matches.length === 0) {
    console.log('  (no matches)');
    return;
  }
  matches.forEach((m, i) => {
    console.log(`  ${i + 1}. [score ${m.score}] ${m.id} — ${m.vehicle} — ${m.damage_type}`);
  });
}

section('Seed load');
const all = episodicMemory.listEpisodes();
console.log(`Loaded ${all.length} episodes from episodicMemory.json (seeded from seedClaims.json)`);
console.assert(all.length === 12, `Expected 12 seed claims, got ${all.length}`);

section('Query: "rear bumper collision dent"');
printMatches(episodicMemory.searchSimilarClaims('rear bumper collision dent', 3));

section('Query: "aftermarket bumper light bar damage"');
printMatches(episodicMemory.searchSimilarClaims('aftermarket bumper light bar damage', 3));

section('Query: "windshield crack rock chip"');
printMatches(episodicMemory.searchSimilarClaims('windshield crack rock chip', 3));

section('Query: "worn suspension bushings clunking noise"');
printMatches(episodicMemory.searchSimilarClaims('worn suspension bushings clunking noise', 3));

section('Query: "gibberish unrelated banana spacecraft"');
printMatches(episodicMemory.searchSimilarClaims('gibberish unrelated banana spacecraft', 3));

section('formatForPrompt() sample');
const matches = episodicMemory.searchSimilarClaims('rear bumper collision dent', 2);
console.log(episodicMemory.formatForPrompt(matches));

section('saveEpisode() round-trip');
episodicMemory.saveEpisode({
  id: 'test-claim-999',
  vehicle: '2023 Test Vehicle',
  damage_type: 'Collision - rear bumper',
  damage_summary: 'Synthetic test episode with a rear bumper dent, for round-trip verification.',
  affected_areas: [{ name: 'Rear Bumper Cover', description: 'Dented for test purposes' }],
  coverage_decisions: [{ area_name: 'Rear Bumper Cover', coverage_status: 'covered', policy_section: '3.2b', reason: 'test', color: 'green' }],
  total_estimated_payout_usd: { min: 100, max: 200 },
  outcome_note: 'Synthetic test outcome.',
});
const afterSave = episodicMemory.listEpisodes();
console.log(`Episode count after saveEpisode(): ${afterSave.length} (expected 13)`);
console.assert(afterSave.length === 12 + 1, 'saveEpisode did not persist');
console.assert(afterSave.some((e) => e.id === 'test-claim-999'), 'saved episode not found by id');

section('Retrieval now finds the newly-saved episode too');
printMatches(episodicMemory.searchSimilarClaims('rear bumper dent test vehicle', 5));

console.log('\nAll checks completed.');
