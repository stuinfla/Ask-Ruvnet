/**
 * Quality Gate — Shared scoring function for ALL KB ingestion paths
 *
 * This is the SINGLE source of truth for quality scoring.
 * Both 03-rewrite.js (batch curation) and ingest.js (incremental ingestion)
 * import from here. If you change the scoring logic, change it HERE.
 *
 * Scores a rewrite against the Five Tests from KNOWLEDGE-QUALITY-GOALS.md:
 *   1. Standalone (weight: 2.0) — no orphan fragments
 *   2. Teaches (weight: 2.0) — at least 2 concrete facts
 *   3. Structured (weight: 2.0) — title + 2+ headings
 *   4. Honest (weight: 2.5) — no banned words, qualified claims
 *   5. Connected (weight: 1.5) — related tools section
 *
 * Returns { pass, score, breakdown, failures }
 * Threshold: 7.0/10 weighted average. Any dimension at 0 = auto-reject.
 */

const QUALITY_THRESHOLD = 7.0;

const BANNED_WORDS = [
  'seamlessly', 'seamless', 'leverage', 'cutting-edge', 'cutting edge',
  'revolutionary', 'game-changing', 'game changer', 'next-generation',
  'next generation', 'state-of-the-art', 'state of the art',
  'best-in-class', 'holistic', 'synergy', 'streamline', 'empower',
];

const KNOWN_TOOLS = [
  'AgentDB', 'RuVector', 'Ruflo', 'Agentic Flow', 'AIMDS',
  'RVF', 'ruv-swarm', 'Flow Nexus', 'SONA', 'MinCut',
  'Micro-HNSW', 'RuVector-WASM', 'RuVector-Postgres',
];

const WEIGHTS = { standalone: 2, teaches: 2, structured: 2, honest: 2.5, connected: 1.5 };

function scoreRewrite(content, sourceFragments = []) {
  const failures = [];
  const scores = {};

  // ─── TEST 1: STANDALONE (weight: 2) ───
  let standaloneScore = 10;
  const orphanPatterns = [
    /\bpart \d+ of \d+\b/i,
    /\bcontinued from\b/i,
    /\bsee above\b/i,
    /\bsee below\b/i,
    /\bas mentioned earlier\b/i,
    /\bin the previous section\b/i,
    /\bcontinued\.\.\./i,
  ];
  for (const pat of orphanPatterns) {
    if (pat.test(content)) {
      standaloneScore -= 3;
      failures.push(`Standalone: orphan pattern — ${pat.source}`);
    }
  }
  if (content.length < 400) {
    standaloneScore -= 5;
    failures.push(`Standalone: too short (${content.length} chars, min 400)`);
  }
  if (!content.match(/^# .+/m)) {
    standaloneScore -= 4;
    failures.push('Standalone: missing top-level # title');
  }
  scores.standalone = Math.max(0, standaloneScore);

  // ─── TEST 2: TEACHES (weight: 2) ───
  let teachesScore = 10;
  const factPatterns = [
    /\d+[\.,]?\d*\s*(ms|seconds?|minutes?|hours?|bytes?|KB|MB|GB|TB|%|x faster|x slower|RPM|RPS|QPS|TPS|dims?|dimensions?)/gi,
    /`[^`]{3,}`/g,
    /```[\s\S]{10,}?```/g,
    /\bport \d+\b/gi,
    /\bv\d+\.\d+/gi,
    /\b(?:SELECT|INSERT|CREATE|ALTER|DROP|UPDATE)\b/g,
    /\b(?:npm|npx|pip|cargo|docker|curl|wget)\s+\S+/g,
    /\b\d+\+?\s+(?:functions?|methods?|endpoints?|APIs?|modules?|crates?)\b/gi,
  ];
  let factCount = 0;
  for (const pat of factPatterns) {
    const matches = content.match(pat);
    if (matches) factCount += matches.length;
  }
  if (factCount === 0) {
    teachesScore = 2;
    failures.push('Teaches: zero concrete facts (no numbers, commands, or configs)');
  } else if (factCount === 1) {
    teachesScore = 5;
    failures.push('Teaches: only 1 concrete fact (need 2+)');
  }
  scores.teaches = teachesScore;

  // ─── TEST 3: STRUCTURED (weight: 2) ───
  let structuredScore = 10;
  if (!content.match(/^# .+/m)) {
    structuredScore -= 5;
    failures.push('Structured: no top-level # title');
  }
  const sectionHeadings = content.match(/^## .+/gm) || [];
  if (sectionHeadings.length < 2) {
    structuredScore -= 5;
    failures.push(`Structured: only ${sectionHeadings.length} section heading(s) (need 2+)`);
  }
  if (!/^## Overview/m.test(content)) {
    structuredScore -= 2;
    failures.push('Structured: missing ## Overview section');
  }
  if (!/^## Summary/m.test(content)) {
    structuredScore -= 1;
    failures.push('Structured: missing ## Summary section');
  }
  scores.structured = Math.max(0, structuredScore);

  // ─── TEST 4: HONEST (weight: 2.5) ───
  let honestScore = 10;
  const contentLower = content.toLowerCase();
  const foundBanned = BANNED_WORDS.filter(w => contentLower.includes(w));
  if (foundBanned.length > 0) {
    honestScore -= Math.min(5, foundBanned.length * 2);
    failures.push(`Honest: banned words — ${foundBanned.join(', ')}`);
  }
  const intelligentUses = content.match(/\bintelligent\b/gi) || [];
  const intelligentInCode = content.match(/`[^`]*intelligent[^`]*`/gi) || [];
  if (intelligentUses.length > intelligentInCode.length) {
    honestScore -= 2;
    failures.push('Honest: "intelligent" used to describe software');
  }
  const vagueHits = content.match(/\b(robust|powerful)\b(?![^.]*(?:because|since|by|via|through|with \d|supporting \d))/gi) || [];
  if (vagueHits.length > 0) {
    honestScore -= Math.min(3, vagueHits.length);
    failures.push(`Honest: vague adjective(s) without specifics (${vagueHits.length})`);
  }
  if (/think of it as/i.test(content)) {
    honestScore -= 3;
    failures.push('Honest: "Think of it as" pattern detected');
  }
  const perfClaims = content.match(/\d+x\s+faster/gi) || [];
  const qualifiedClaims = content.match(/\d+x\s+faster[^.]*\([^)]+\)/gi) || [];
  const unqualified = perfClaims.length - qualifiedClaims.length;
  if (unqualified > 0) {
    honestScore -= Math.min(4, unqualified * 2);
    failures.push(`Honest: ${unqualified} unqualified "Nx faster" claim(s)`);
  }
  scores.honest = Math.max(0, honestScore);

  // ─── TEST 5: CONNECTED (weight: 1.5) ───
  let connectedScore = 10;
  const hasRelatedSection = /^## (?:Related Tools|How It Connects)/m.test(content);
  if (!hasRelatedSection) {
    connectedScore = 4;
    failures.push('Connected: no Related Tools / How It Connects section');
  } else {
    const noConnectionsDisclaimer = /no documented integrations/i.test(content);
    const mentionedTools = KNOWN_TOOLS.filter(t => content.includes(t));
    const sourceText = sourceFragments.map(f => f.content || '').join(' ');
    const toolsInSource = KNOWN_TOOLS.filter(t => sourceText.includes(t));
    if (!noConnectionsDisclaimer && mentionedTools.length === 0) {
      connectedScore = 5;
      failures.push('Connected: section exists but no known tools mentioned and no disclaimer');
    }
    const missedTools = toolsInSource.filter(t => !mentionedTools.includes(t));
    if (missedTools.length > 0 && !noConnectionsDisclaimer) {
      connectedScore -= Math.min(3, missedTools.length);
      failures.push(`Connected: source mentions ${missedTools.join(', ')} but rewrite omits them`);
    }
  }
  scores.connected = Math.max(0, connectedScore);

  // ─── WEIGHTED AVERAGE ───
  const totalWeight = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  const weightedSum = Object.entries(scores).reduce(
    (sum, [dim, score]) => sum + score * WEIGHTS[dim], 0
  );
  const overall = Math.round((weightedSum / totalWeight) * 10) / 10;
  const anyZero = Object.values(scores).some(s => s === 0);

  return { pass: overall >= QUALITY_THRESHOLD && !anyZero, score: overall, breakdown: scores, failures };
}

module.exports = { scoreRewrite, QUALITY_THRESHOLD, BANNED_WORDS, KNOWN_TOOLS, WEIGHTS };
