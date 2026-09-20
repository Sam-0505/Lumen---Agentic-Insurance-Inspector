/**
 * Live test for the coverage agent loop — needs a working TAMUS_AI_CHAT_API_KEY
 * in backend/.env, since it exercises the real tool-calling model, not just
 * local logic. Run: node scripts/testAgentCoverage.js
 *
 * Demonstrates the thing a fixed pipeline can't: effort matched to
 * ambiguity. A clean case gets one lookup; a genuinely ambiguous case gets
 * escalated instead of guessed.
 */
require('dotenv').config();
const coveragePrompt = require('../prompts/coveragePrompt');
const { runAgentLoop } = require('../lib/agentLoop');
const { TOOL_DEFINITIONS, executeTool } = require('../lib/coverageTools');
const { parseJsonResponse } = require('../lib/tamusChat');

async function runCase(label, damageJson) {
  const userMessage = `DAMAGE ASSESSMENT:\n${JSON.stringify(damageJson, null, 2)}\n\nInvestigate using your tools as needed, then return the final coverage decisions JSON for every damaged area.`;
  const t0 = Date.now();
  const { finalMessage, toolTrace, iterations } = await runAgentLoop({
    systemPrompt: coveragePrompt, userMessage, tools: TOOL_DEFINITIONS, executeTool,
  });
  const ms = Date.now() - t0;

  console.log(`\n=== ${label} — ${iterations} iteration(s), ${ms}ms, ${toolTrace.length} tool call(s) ===`);
  toolTrace.forEach((t, i) => console.log(`  ${i + 1}. ${t.tool}(${JSON.stringify(t.arguments)})`));

  const json = parseJsonResponse(finalMessage);
  json.coverage_decisions.forEach((d) => {
    console.log(`  → ${d.area_name}: ${d.coverage_status} (§${d.policy_section || 'n/a'}) — ${d.reason}`);
  });
  return { toolTrace, json };
}

(async () => {
  // Case 1: unambiguous — expect minimal tool use (ideally one policy lookup).
  await runCase('SIMPLE: clear windshield crack', {
    damage_type: 'Glass damage',
    affected_areas: [{ name: 'Windshield', description: 'long crack from a rock chip on the highway' }],
  });

  // Case 2: mixed — one clean area, one exclusion, one ambiguous judgement call.
  // Demonstrates the model investigating each area differently in one pass.
  await runCase('MIXED: collision + aftermarket + possible pre-existing rust', {
    damage_type: 'Collision - rear bumper',
    affected_areas: [
      { name: 'Rear Bumper Cover', description: 'cracked, fresh paint transfer, clearly from the collision' },
      { name: 'Aftermarket Exhaust Tip', description: 'dented, non-factory chrome exhaust tip' },
      { name: 'Rear Quarter Panel', description: 'scuff mark with slight surface rust visible inside the scratch' },
    ],
  });

  // Case 3: genuinely unresolvable from the evidence given — expect
  // flag_for_human_review rather than a guessed verdict.
  const ambiguous = await runCase('AMBIGUOUS: unusable photo evidence', {
    damage_type: 'Unclear',
    affected_areas: [{
      name: 'Front Fender',
      description: 'Photo is extremely blurry and taken from too far away to confirm any damage or its cause',
    }],
  });
  const escalated = ambiguous.toolTrace.some((t) => t.tool === 'flag_for_human_review');
  console.log(`\nEscalation check: ${escalated ? 'PASS — agent flagged for review instead of guessing' : 'FAIL — agent guessed on unusable evidence'}`);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
