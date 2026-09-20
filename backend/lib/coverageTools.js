/**
 * Tools exposed to the coverage-adjudication agent (see agentLoop.js and
 * routes/checkCoverage.js). Each tool is a real side-effecting or
 * data-returning function — the model decides when to call which, this
 * module only implements what happens when it does.
 */

const fs = require('fs');
const path = require('path');
const { rankByRelevance } = require('./textSearch');
const episodicMemory = require('./episodicMemory');

const POLICY_PATH = path.join(__dirname, '../data/samplePolicy.json');
const REVIEW_QUEUE_PATH = path.join(__dirname, '../data/reviewQueue.json');

function loadPolicy() {
  return JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
}

/**
 * search_policy(query) — retrieves the policy clauses most relevant to a
 * query, instead of the old approach of pasting the entire policy into
 * every prompt. At 7 clauses this is a small win; the point is that it
 * scales to a real policy document without changing the calling code.
 */
function searchPolicy(query) {
  const { clauses } = loadPolicy();
  const matches = rankByRelevance(query, clauses, (c) => `${c.title} ${c.text} ${c.category}`, 3);
  // A clause set this small can occasionally score nothing for an unusual
  // query; returning nothing would just make the model guess anyway, so
  // fall back to handing over everything rather than an empty result.
  return matches.length > 0 ? matches : clauses;
}

/**
 * get_similar_past_claims(query) — same episodic memory used by the
 * write-back after a decision, exposed as a tool the model can choose to
 * call rather than something the route always runs up front.
 */
function getSimilarPastClaims(query) {
  return episodicMemory.searchSimilarClaims(query, 3);
}

/**
 * flag_for_human_review(area_name, reason) — the escalation path. A real
 * side effect (persisted to disk) so a flagged area is actually
 * retrievable by an adjuster, not just a string embedded in a JSON blob.
 */
function flagForHumanReview({ area_name, reason }) {
  if (!area_name || !reason) {
    return { error: 'area_name and reason are both required to flag for review' };
  }
  let queue = [];
  try {
    if (fs.existsSync(REVIEW_QUEUE_PATH)) {
      queue = JSON.parse(fs.readFileSync(REVIEW_QUEUE_PATH, 'utf8'));
    }
  } catch { /* corrupt or missing file — start fresh */ }

  const entry = {
    id: `review-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    area_name,
    reason,
    flagged_at: new Date().toISOString(),
  };
  queue.push(entry);
  fs.writeFileSync(REVIEW_QUEUE_PATH, JSON.stringify(queue, null, 2));
  return { acknowledged: true, review_id: entry.id };
}

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'search_policy',
      description: 'Search the insurance policy for clauses relevant to a damage description. Returns matching covered/excluded sections with their policy section numbers. Call this before citing any policy section — never invent one.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Damage description or topic, e.g. "aftermarket parts" or "glass damage"' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_similar_past_claims',
      description: 'Retrieve past claims with similar damage, for consistency reference only. Shows how comparable damage was previously decided and which policy section was cited. Does not override the policy text — if a past decision conflicts with the policy, follow the policy.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Damage description to find comparable past claims for' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flag_for_human_review',
      description: 'Escalate a specific damaged area to a human adjuster instead of guessing. Use this when evidence is genuinely ambiguous — e.g. unclear whether damage is pre-existing, low image confidence, or coverage depends on facts not present in the damage report. A wrong guess is worse than an honest escalation.',
      parameters: {
        type: 'object',
        properties: {
          area_name: { type: 'string', description: 'The affected area being escalated — must match an area_name from the damage assessment' },
          reason: { type: 'string', description: 'One sentence explaining what is ambiguous and needs human judgement' },
        },
        required: ['area_name', 'reason'],
      },
    },
  },
];

async function executeTool(name, args) {
  switch (name) {
    case 'search_policy': return searchPolicy(args.query);
    case 'get_similar_past_claims': return getSimilarPastClaims(args.query);
    case 'flag_for_human_review': return flagForHumanReview(args);
    default: return { error: `Unknown tool: ${name}` };
  }
}

function listReviewQueue() {
  if (!fs.existsSync(REVIEW_QUEUE_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(REVIEW_QUEUE_PATH, 'utf8'));
  } catch {
    return [];
  }
}

module.exports = { TOOL_DEFINITIONS, executeTool, loadPolicy, listReviewQueue };
