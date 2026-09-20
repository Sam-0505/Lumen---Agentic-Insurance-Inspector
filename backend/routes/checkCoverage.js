const express = require('express');
const router = express.Router();
const coveragePrompt = require('../prompts/coveragePrompt');
const { parseJsonResponse } = require('../lib/tamusChat');
const { runAgentLoop } = require('../lib/agentLoop');
const { TOOL_DEFINITIONS, executeTool } = require('../lib/coverageTools');
const episodicMemory = require('../lib/episodicMemory');

const STATUS_TO_COLOR = {
  covered: 'green',
  excluded: 'red',
  partial: 'amber',
  requires_review: 'gray',
};

// Compact summary of a tool call for the response payload — the full
// results (e.g. all matched policy clauses) are useful in the model's
// context but too verbose to hand back to the frontend/demo verbatim.
function summarizeToolResult(entry) {
  const { tool, result } = entry;
  if (tool === 'search_policy') {
    return (Array.isArray(result) ? result : []).map((c) => ({ section: c.section, title: c.title }));
  }
  if (tool === 'get_similar_past_claims') {
    return (Array.isArray(result) ? result : []).map((c) => ({ id: c.id, vehicle: c.vehicle, score: c.score }));
  }
  return result; // flag_for_human_review's { acknowledged, review_id } is already compact
}

router.post('/', async (req, res) => {
  try {
    const { damageJson } = req.body;
    if (!damageJson) return res.status(400).json({ error: 'No damage data provided' });

    const userMessage = `DAMAGE ASSESSMENT:
${JSON.stringify(damageJson, null, 2)}

Investigate using your tools as needed, then return the final coverage decisions JSON for every damaged area.`;

    // The model — not this route — decides which tools to call, how many
    // times, and in what order. This is what changed from the fixed
    // "always retrieve top-3, always paste the policy" pipeline.
    const { finalMessage, toolTrace, iterations } = await runAgentLoop({
      systemPrompt: coveragePrompt,
      userMessage,
      tools: TOOL_DEFINITIONS,
      executeTool,
    });

    const json = parseJsonResponse(finalMessage);
    if (Array.isArray(json.coverage_decisions)) {
      json.coverage_decisions = json.coverage_decisions.map(decision => ({
        ...decision,
        coverage_status: decision.color || STATUS_TO_COLOR[decision.coverage_status] || decision.coverage_status || 'gray',
      }));
    }

    // Transparency: which tools the agent actually chose to call, in order.
    // This is the audit trail an adjuster (or an interviewer) would want —
    // it shows *why* a decision was reached, not just what was decided.
    json.agent_trace = toolTrace.map((entry) => ({
      tool: entry.tool,
      arguments: entry.arguments,
      result: summarizeToolResult(entry),
    }));
    json.agent_iterations = iterations;

    // Write the decided claim back into episodic memory for future retrieval,
    // independent of whether the model chose to call get_similar_past_claims
    // for this one.
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
