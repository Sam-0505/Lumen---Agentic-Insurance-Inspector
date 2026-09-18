const express = require('express');
const router = express.Router();
const episodicMemory = require('../lib/episodicMemory');

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

module.exports = router;
