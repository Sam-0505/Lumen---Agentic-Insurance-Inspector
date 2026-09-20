const express = require('express');
const router = express.Router();
const episodicMemory = require('../lib/episodicMemory');
const { listReviewQueue, loadPolicy } = require('../lib/coverageTools');

// GET /memory/claims — list all stored episodes (seed + demo-generated)
router.get('/claims', (req, res) => {
  res.json(episodicMemory.listEpisodes());
});

// GET /memory/search?q=... — run retrieval directly, no LLM call needed
router.get('/search', (req, res) => {
  const q = req.query.q || '';
  if (!q) return res.status(400).json({ error: 'q query param required' });
  const topN = Number(req.query.topN) || 3;
  res.json(episodicMemory.searchSimilarClaims(q, topN));
});

// GET /memory/reviews — areas the coverage agent escalated via
// flag_for_human_review, in the order it flagged them.
router.get('/reviews', (req, res) => {
  res.json(listReviewQueue());
});

// GET /memory/policy — the structured policy clauses search_policy reads.
router.get('/policy', (req, res) => {
  res.json(loadPolicy());
});

module.exports = router;
