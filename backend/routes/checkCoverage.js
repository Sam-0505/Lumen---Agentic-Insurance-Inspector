const express = require('express');
const router = express.Router();
const coveragePrompt = require('../prompts/coveragePrompt');
const {
  createChatCompletion,
  extractTextResponse,
  parseJsonResponse,
} = require('../lib/tamusChat');
const episodicMemory = require('../lib/episodicMemory');

const STATUS_TO_COLOR = {
  covered: 'green',
  excluded: 'red',
  partial: 'amber',
  requires_review: 'gray',
};

function buildMemoryQuery(damageJson) {
  const areaText = (damageJson.affected_areas || [])
    .map((a) => `${a.name || ''} ${a.description || ''}`)
    .join(' ');
  return `${damageJson.damage_type || ''} ${areaText}`.trim();
}

router.post('/', async (req, res) => {
  try {
    const { damageJson } = req.body;
    if (!damageJson) return res.status(400).json({ error: 'No damage data provided' });

    // Retrieve similar past claims from episodic memory before deciding.
    const memoryQuery = buildMemoryQuery(damageJson);
    const similarClaims = memoryQuery ? episodicMemory.searchSimilarClaims(memoryQuery, 3) : [];
    const memoryBlock = episodicMemory.formatForPrompt(similarClaims);

    const userMessage = `DAMAGE ASSESSMENT:
${JSON.stringify(damageJson, null, 2)}
${memoryBlock ? `\nSIMILAR PAST CLAIMS (episodic memory, reference only):\n${memoryBlock}\n` : ''}
Return coverage decisions for each damaged area.`;

    const data = await createChatCompletion({
      messages: [
        { role: 'system', content: coveragePrompt },
        { role: 'user', content: userMessage },
      ],
    });

    const text = extractTextResponse(data);
    const json = parseJsonResponse(text);
    if (Array.isArray(json.coverage_decisions)) {
      json.coverage_decisions = json.coverage_decisions.map(decision => ({
        ...decision,
        coverage_status: decision.color || STATUS_TO_COLOR[decision.coverage_status] || decision.coverage_status || 'gray',
      }));
    }

    // Surface what memory contributed, useful for the demo/UI.
    json.retrieved_memory = similarClaims.map((c) => ({ id: c.id, vehicle: c.vehicle, damage_type: c.damage_type, score: c.score }));

    // Save this decided claim back into episodic memory for future retrieval.
    episodicMemory.saveEpisode({
      id: req.body.claimId ? `claim-${req.body.claimId}` : undefined,
      vehicle: req.body.vehicle,
      damage_type: damageJson.damage_type,
      damage_summary: (damageJson.affected_areas || []).map((a) => a.description).filter(Boolean).join(' '),
      affected_areas: damageJson.affected_areas,
      coverage_decisions: json.coverage_decisions,
      total_estimated_payout_usd: json.total_estimated_payout_usd,
      outcome_note: json.adjuster_notes,
    });

    res.json(json);
  } catch (err) {
    console.error('checkCoverage error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
