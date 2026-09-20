/**
 * Shared TF-IDF-style relevance ranking, plain JS, no native deps.
 *
 * Extracted from episodicMemory.js so the same ranking approach backs both
 * episodic-claim retrieval and policy-clause search — one retrieval
 * primitive, two tools, rather than two ad-hoc scorers that could drift out
 * of sync with each other.
 */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'with', 'for',
  'is', 'was', 'were', 'this', 'that', 'from', 'at', 'by', 'as', 'it',
  'be', 'are', 'has', 'have', 'had', 'not', 'no', 'but',
]);

function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((tok) => tok.length > 2 && !STOPWORDS.has(tok));
}

function termFrequencies(tokens) {
  const tf = {};
  for (const tok of tokens) tf[tok] = (tf[tok] || 0) + 1;
  return tf;
}

function buildIdf(documents) {
  const docCount = documents.length || 1;
  const df = {};
  for (const doc of documents) {
    const seen = new Set(doc);
    for (const tok of seen) df[tok] = (df[tok] || 0) + 1;
  }
  const idf = {};
  for (const tok of Object.keys(df)) {
    idf[tok] = Math.log(1 + docCount / df[tok]);
  }
  return idf;
}

/**
 * Ranks `items` by relevance to `query`. `getText(item)` extracts the
 * searchable string for each item. Returns up to `topN` items, each spread
 * with `score` and `matchedTerms` added.
 */
function rankByRelevance(query, items, getText, topN = 3) {
  if (items.length === 0) return [];

  const itemTokens = items.map((it) => tokenize(getText(it)));
  const idf = buildIdf(itemTokens);
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];
  const queryTf = termFrequencies(queryTokens);

  const scored = items.map((item, i) => {
    const tf = termFrequencies(itemTokens[i]);
    let score = 0;
    const matchedTerms = [];
    for (const tok of Object.keys(queryTf)) {
      if (tf[tok]) {
        score += (1 + Math.log(tf[tok])) * (idf[tok] || 0);
        matchedTerms.push(tok);
      }
    }
    return { item, score, matchedTerms };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map((s) => ({ ...s.item, score: Math.round(s.score * 100) / 100, matchedTerms: s.matchedTerms }));
}

module.exports = { tokenize, rankByRelevance };
