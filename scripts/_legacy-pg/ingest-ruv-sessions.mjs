#!/usr/bin/env node
/**
 * Ingest ALL Ruv Coaching + Vibecast + Agentic Sessions into RuVector KB
 * Handles both .srt and .txt transcript formats
 * Priority: Ruv Coaching > Ruv Vibecast > Live Vibe Coding > AI Hackerspace
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  host: 'localhost',
  port: 5435,
  user: 'postgres',
  database: 'postgres',
});

const SCHEMA = 'ask_ruvnet';
const BASE = './data_ingestion_ruv_coaching';

// ── Session manifest — all sessions to ingest ──────────────────────────────
const SESSIONS = [
  // === RUV COACHING (highest priority — direct 1:1 architecture teaching) ===
  {
    date: '2025-10-02', type: 'ruv-coaching', priority: 'critical',
    title: 'Ruv Coaching: Ruflo Setup & GitHub Codespaces Architecture',
    dir: 'Ruv Coaching/2025-10-02 Ruv Coaching',
    files: ['2025-10-02 Ruv coaching Transcript.txt', 'Ruflo coaching_  Summary.txt'],
  },
  {
    date: '2025-10-16', type: 'ruv-coaching', priority: 'critical',
    title: 'Ruv Coaching: Agent Architecture & Ruflo Patterns',
    dir: 'Ruv Coaching/2025-10-16 Ruv Coaching',
    files: ['2025-10-16 Ruv Coaching Transcript.txt'],
  },
  {
    date: '2025-10-20', type: 'ruv-coaching', priority: 'critical',
    title: 'Ruv Coaching: Agentic Systems Deep Dive',
    dir: 'Ruv Coaching/2025-10-20 Ruv Coaching',
    files: ['2025-10-20 Ruv Coaching transcript.srt'],
  },
  {
    date: '2025-10-22', type: 'ruv-coaching', priority: 'critical',
    title: 'Ruv Coaching: Vector Architecture & Memory Systems',
    dir: 'Ruv Coaching/2025-10-22 Ruv Coaching',
    files: ['2025-10-22 Ruv Coaching transcript.srt'],
  },
  {
    date: '2025-11-10', type: 'ruv-coaching', priority: 'critical',
    title: 'Ruv Coaching: RuVector Architecture Session',
    dir: 'Ruv Coaching/2025-11-10 Ruv Coaching',
    files: ['Ruv Coaching Transcript.txt'],
  },
  {
    date: '2025-11-12', type: 'ruv-coaching', priority: 'critical',
    title: 'Ruv Coaching: Agent Swarms & Deployment Patterns',
    dir: 'Ruv Coaching/2025-11-12 Ruv Coaching',
    files: ['Ruv Coaching Transcript.txt'],
  },
  {
    date: '2025-11-19', type: 'ruv-coaching', priority: 'critical',
    title: 'Ruv Coaching: Self-Learning Systems & ReasoningBank',
    dir: 'Ruv Coaching/2025-11-19 Ruv Coaching',
    files: ['Ruv Coaching Transcript.txt', 'Ruv Coaching Summary.txt'],
  },
  {
    date: '2025-12-01', type: 'ruv-coaching', priority: 'critical',
    title: 'Ruv Coaching: December Architecture Review',
    dir: 'Ruv Coaching/2025-12-1 Ruv Coaching',
    files: ['2025-12-1 Ruv Coaching.txt'],
  },
  {
    date: '2026-01-01', type: 'ruv-vibecast', priority: 'critical',
    title: 'Ruv Vibecast: January 1st — Year in Review & Roadmap',
    dir: 'Ruv Coaching/2026-01-01 Ruv Coaching',
    files: ['Ruv Vibecast Transcript (1).txt', 'Ruv Vibecast Summary.txt'],
  },
  {
    date: '2026-01-08', type: 'ruv-vibecast', priority: 'critical',
    title: 'Ruv Vibecast: January 8th — Ruflo V3 Deep Dive',
    dir: 'Ruv Coaching/2026-01-08 Ruv Coaching',
    files: ['Ruv Vibecast Transcript (1).txt'],
  },

  // === RUV VIBECAST (live community teaching sessions) ===
  {
    date: '2025-10-16', type: 'ruv-vibecast', priority: 'high',
    title: 'Ruv Vibecast Oct 16: ReasoningBank, Symbolic AI & Building While Sleeping',
    dir: 'Agentic Coding Training/Agentics Videos/2025-10-16 Ruv Vibecast',
    files: ['Ruv Vibecast Transcript.txt'],
  },
  {
    date: '2025-10-30', type: 'ruv-vibecast', priority: 'high',
    title: 'Ruv Vibecast Oct 30: Agentic Architecture Patterns & Live Demos',
    dir: 'Agentic Coding Training/Agentics Videos/2025-10-30 Ruv Vibecast',
    files: ['Ruv Vibecast Transcript.txt'],
  },
  {
    date: '2025-11-13', type: 'ruv-vibecast', priority: 'high',
    title: 'Ruv Vibecast Nov 13: Ruflo V3 Features & Agent Coordination',
    dir: 'Agentic Coding Training/Agentics Videos/2025-11-13 Ruv Vibecast',
    files: ['Ruv Vibecast - November 13, 2025.srt'],
  },
  {
    date: '2025-11-20', type: 'ruv-vibecast', priority: 'high',
    title: 'Ruv Vibecast Nov 20: Live Vibe Coding — Agentic Systems Build',
    dir: 'Agentic Coding Training/Agentics Videos/2025-11-20 Ruve Vibecast',
    files: ['Agentics Live Vibe Coding.srt'],
  },

  // === LIVE VIBE CODING (rUv building with the stack — architecture in action) ===
  {
    date: '2025-08-14', type: 'vibe-coding', priority: 'medium',
    title: 'Live Vibe Coding Aug 14: Extraterrestrial AI Detector — Concept to Code',
    dir: 'Agentic Coding Training/Agentics Videos/2025-08-14 Live Vibe Coding',
    files: ['Agentics Live Vibe Coding Aug 14_ From Concept to Code - Creating an Extraterrestrial AI Detector.srt'],
  },
  {
    date: '2025-08-21', type: 'vibe-coding', priority: 'medium',
    title: 'Live Vibe Coding Aug 21: Agentic System Build Session',
    dir: 'Agentic Coding Training/Agentics Videos/2025-08-21 Live Vibe Coding',
    files: ['2025-08-21 Live Vibe Coding.srt'],
  },
  {
    date: '2025-09-18', type: 'vibe-coding', priority: 'medium',
    title: 'Live Vibe Coding Sep 18: Agentic Coding Patterns',
    dir: 'Agentic Coding Training/Agentics Videos/2025-09-18 Live Vibe Coding',
    files: ['2025-09-18 Live Vibe Coding.srt'],
  },
  {
    date: '2025-09-25', type: 'vibe-coding', priority: 'medium',
    title: 'Live Vibe Coding Sep 25: Stock Trading to Simulated Consciousness',
    dir: 'Agentic Coding Training/Agentics Videos/2025-09-25 Live Vibe Coding',
    files: ['Agentics Live Vibe Coding Sept 25_ From Stock Trading to Simulated Consciousness.srt'],
  },

  // === AI HACKERSPACE (community sessions with rUv teaching) ===
  {
    date: '2025-08-08', type: 'hackerspace', priority: 'medium',
    title: 'AI Hackerspace Aug 8: Community Session & rUv Architecture Talk',
    dir: 'Agentic Coding Training/Agentics Videos/2025-08-08 AI Hackerspace',
    files: ['2025-08-08 AI Hackerspace.srt'],
  },
  {
    date: '2025-08-15', type: 'hackerspace', priority: 'medium',
    title: 'AI Hackerspace Aug 15: Agentic Systems Overview',
    dir: 'Agentic Coding Training/Agentics Videos/2025-08-15 AI Hackerspace',
    files: ['2025-08-15 AI Hackerspace.srt'],
  },
  {
    date: '2025-08-22', type: 'hackerspace', priority: 'medium',
    title: 'AI Hackerspace Aug 22: Ruflo Patterns & Q&A',
    dir: 'Agentic Coding Training/Agentics Videos/2025-08-22 AI Hackerspace',
    files: ['2025-08-22 AI Hackerspace.srt'],
  },
  {
    date: '2025-09-11', type: 'hackerspace', priority: 'medium',
    title: 'Office Hours Sep 11: rUv Q&A on Agent Architecture',
    dir: 'Agentic Coding Training/Agentics Videos/2025-09-11 Office Hours',
    files: ['2025-09-11 Office Hours.srt'],
  },
  {
    date: '2025-09-19', type: 'hackerspace', priority: 'medium',
    title: 'AI Hackerspace Sep 19: Community Projects & Architecture Discussion',
    dir: 'Agentic Coding Training/Agentics Videos/2025-09-19 AI Hackerspace',
    files: ['2025-09-19 AI Hackerspace.srt'],
  },
  {
    date: '2025-09-26', type: 'hackerspace', priority: 'medium',
    title: 'AI Hackerspace Sep 26: Navigating AI Frontier — Industry Insights',
    dir: 'Agentic Coding Training/Agentics Videos/2025-09-26 AI Hackerspace',
    files: ['AI Hackerspace Live Sept 26 - Navigating the AI Frontier_ Insights from Industry Events and Innovative Projects.srt'],
  },
  {
    date: '2025-10-24', type: 'hackerspace', priority: 'medium',
    title: 'AI Hackerspace Oct 24: AI Productivity & Community Innovations',
    dir: 'Agentic Coding Training/Agentics Videos/2025-10-24 Hacker',
    files: ['FriOct24 Agentics Call — Exploring AI Productivity, Community Events, and Innovations in Tech 🚀.srt'],
  },
];

// ── SRT parser — strips timing codes, handles 3 speaker label formats ───────
function parseSrt(text) {
  text = text.replace(/^\uFEFF/, '');  // Remove BOM

  const lines = text.split('\n');
  const turns = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip blank, sequence numbers, timing lines, and header info before first "1"
    if (!line) continue;
    if (/^\d+$/.test(line)) continue;
    if (/^\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->/.test(line)) continue;
    // Skip "Meeting created at: ..." header lines
    if (/^Meeting created/i.test(line)) continue;

    // Format 1: "<v Speaker>Text"
    const vMatch = line.match(/^<v ([^>]+)>(.*)/);
    if (vMatch) {
      const speaker = vMatch[1].trim();
      const utterance = vMatch[2].trim();
      if (!utterance) continue;
      if (current && current.speaker === speaker) {
        current.text += ' ' + utterance;
      } else {
        if (current) turns.push(current);
        current = { speaker, text: utterance };
      }
      continue;
    }

    // Format 2: "Speaker Name: Text"
    const colonMatch = line.match(/^([A-Z][A-Za-z ]{1,30}):\s+(.+)/);
    if (colonMatch) {
      const speaker = colonMatch[1].trim();
      const utterance = colonMatch[2].trim();
      if (current && current.speaker === speaker) {
        current.text += ' ' + utterance;
      } else {
        if (current) turns.push(current);
        current = { speaker, text: utterance };
      }
      continue;
    }

    // Format 3: plain text (no speaker labels) — accumulate as rUv's voice
    if (current) {
      current.text += ' ' + line;
    } else {
      current = { speaker: 'rUv', text: line };
    }
  }
  if (current) turns.push(current);
  return turns;
}

// ── TXT parser — format: "MM:SS - Speaker\nText\n" ─────────────────────────
function parseTxt(text) {
  // Remove BOM
  text = text.replace(/^\uFEFF/, '');

  const turns = [];
  // Match patterns like "0:01 - rUv\nText" or "Thu, Oct 2, 2025\n\n0:01 - rUv\nText"
  const timeLineRe = /^(\d+:\d+(?::\d+)?)\s+-\s+(.+)$/;
  const lines = text.split('\n');
  let current = null;
  let skipHeader = true;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const m = line.match(timeLineRe);
    if (m) {
      skipHeader = false;
      if (current) turns.push(current);
      current = { speaker: m[2].trim(), text: '', time: m[1] };
    } else if (!skipHeader && current) {
      current.text += (current.text ? ' ' : '') + line;
    }
    // Skip header lines (date, title) before first timestamp
  }
  if (current) turns.push(current);
  return turns;
}

// ── Chunk speaker turns into KB entries (~800 chars, ~8 turns per chunk) ───
function chunkTurns(turns, sessionMeta, chunkSize = 800) {
  const chunks = [];
  let buf = '';
  let bufTurns = [];

  const flush = () => {
    if (!buf.trim()) return;
    const ruvLines = bufTurns.filter(t => /^ruv$/i.test(t.speaker));
    const ruvText = ruvLines.map(t => t.text).join(' ');
    const hasRuvTeaching = ruvText.length > 100;

    let title = sessionMeta.title;
    if (hasRuvTeaching) {
      const firstSentence = ruvText.match(/[^.!?]+[.!?]/);
      if (firstSentence && firstSentence[0].length > 20 && firstSentence[0].length < 100) {
        title = `rUv: ${firstSentence[0].trim()}`;
      }
    }

    chunks.push({
      title: title.substring(0, 200),
      content: buf.trim(),
      quality: hasRuvTeaching ? 88 : 75,
      hasRuvContent: hasRuvTeaching,
      ruvTeachingText: ruvText,
    });
    buf = '';
    bufTurns = [];
  };

  for (const turn of turns) {
    // Split very large single turns (e.g. Format 3 SRTs with no speaker labels)
    if (turn.text.length > chunkSize * 2) {
      flush();
      const words = turn.text.split(' ');
      let subBuf = '';
      for (const word of words) {
        if (subBuf.length + word.length + 1 > chunkSize && subBuf.length > 200) {
          bufTurns.push({ speaker: turn.speaker, text: subBuf.trim() });
          buf = `${turn.speaker}: ${subBuf.trim()}\n\n`;
          flush();
          subBuf = word;
        } else {
          subBuf += (subBuf ? ' ' : '') + word;
        }
      }
      if (subBuf.trim()) {
        buf = `${turn.speaker}: ${subBuf.trim()}\n\n`;
        bufTurns.push({ speaker: turn.speaker, text: subBuf.trim() });
      }
      continue;
    }

    const line = `${turn.speaker}: ${turn.text}\n\n`;
    if (buf.length + line.length > chunkSize && buf.length > 200) {
      flush();
    }
    buf += line;
    bufTurns.push(turn);
  }
  flush();
  return chunks;
}

// ── Hash-based pseudo-embedding (no external dependency) ───────────────────
function hashEmbedding(text, dim = 384) {
  const hash = crypto.createHash('sha256').update(text).digest();
  const vector = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    vector[i] = (hash[i % 32] / 255.0) * 2 - 1;
  }
  let mag = 0;
  for (let i = 0; i < dim; i++) mag += vector[i] * vector[i];
  mag = Math.sqrt(mag) || 1;
  for (let i = 0; i < dim; i++) vector[i] /= mag;
  return Array.from(vector);
}

// Try to use real ONNX embeddings via ruvector
async function getEmbedding(text) {
  try {
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    const ruvector = require('ruvector');
    if (ruvector?.embeddingService?.embed) {
      return await ruvector.embeddingService.embed(text);
    }
  } catch {}
  return hashEmbedding(text, 384);
}

// ── Parse a single file ─────────────────────────────────────────────────────
function parseFile(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    console.warn(`  ⚠ Cannot read: ${filePath} — ${e.message}`);
    return [];
  }

  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.srt') return parseSrt(text);

  // .txt files — check if they look like SRT (has sequence numbers + timing)
  if (/^\d+\n\d{2}:\d{2}:\d{2}/m.test(text)) return parseSrt(text);

  return parseTxt(text);
}

// ── Ingest one session ──────────────────────────────────────────────────────
async function ingestSession(session) {
  const sessionDir = path.join(BASE, session.dir);
  console.log(`\n📂 ${session.date} [${session.type}] ${session.title}`);

  let allTurns = [];

  for (const filename of session.files) {
    const filePath = path.join(sessionDir, filename);
    if (!fs.existsSync(filePath)) {
      console.log(`  ⚠ Missing: ${filename}`);
      continue;
    }
    const turns = parseFile(filePath);
    const isSummary = filename.toLowerCase().includes('summary');

    if (isSummary) {
      // Summaries get special treatment — ingest as a single high-quality entry
      const rawText = fs.readFileSync(filePath, 'utf-8');
      await ingestSummary(rawText, filePath, session);
      console.log(`  ✓ Summary: ${filename}`);
      continue;
    }

    console.log(`  ✓ Transcript: ${filename} (${turns.length} turns)`);
    allTurns = allTurns.concat(turns);
  }

  if (allTurns.length === 0) return 0;

  const chunks = chunkTurns(allTurns, session);
  console.log(`  → ${chunks.length} chunks to ingest`);

  let count = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const docId = `session-${session.date}-${session.type}-${i}`;

    // Build rich content with session context header
    const content = `## Session: ${session.title}
Date: ${session.date} | Type: ${session.type} | Priority: ${session.priority}

${chunk.content}`;

    const topics = buildTopics(session, chunk);
    const embedding = await getEmbedding(chunk.content);

    const embStr = '[' + embedding.join(',') + ']';
    await pool.query(`
      INSERT INTO ${SCHEMA}.architecture_docs
        (doc_id, title, content, file_path, section_index, file_hash,
         package_name, package_version, doc_type, category, quality_score, topics, embedding)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::ruvector(384))
      ON CONFLICT (doc_id) DO UPDATE SET
        content = EXCLUDED.content,
        title = EXCLUDED.title,
        quality_score = EXCLUDED.quality_score,
        embedding = EXCLUDED.embedding,
        updated_at = NOW()
    `, [
      docId,
      chunk.title,
      content,
      `sessions/${session.date}/${session.type}/${i}`,
      i,
      crypto.createHash('md5').update(content).digest('hex'),
      'ruv-sessions',
      session.date,
      session.type,
      'coaching',
      chunk.quality,
      topics,
      embStr,
    ]);
    count++;
  }

  console.log(`  ✅ Ingested ${count} entries`);
  return count;
}

async function ingestSummary(text, filePath, session) {
  const docId = `session-summary-${session.date}-${session.type}`;
  const content = `## Session Summary: ${session.title}
Date: ${session.date} | Type: ${session.type}

${text.trim()}`;

  const embedding = await getEmbedding(content);
  const topics = buildTopics(session, { hasRuvContent: true });

  const embStr = '[' + embedding.join(',') + ']';
  await pool.query(`
    INSERT INTO ${SCHEMA}.architecture_docs
      (doc_id, title, content, file_path, section_index, file_hash,
       package_name, package_version, doc_type, category, quality_score, topics, embedding)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::ruvector(384))
    ON CONFLICT (doc_id) DO UPDATE SET
      content = EXCLUDED.content,
      quality_score = EXCLUDED.quality_score,
      embedding = EXCLUDED.embedding,
      updated_at = NOW()
  `, [
    docId,
    `Summary: ${session.title}`,
    content,
    `sessions/${session.date}/${session.type}/summary`,
    0,
    crypto.createHash('md5').update(content).digest('hex'),
    'ruv-sessions',
    session.date,
    'summary',
    'coaching',
    95,
    topics,
    embStr,
  ]);
}

function buildTopics(session, chunk) {
  const base = ['ruv-teaching', 'agentic-ai', 'ruflo', 'ruvnet'];
  const typeMap = {
    'ruv-coaching': ['ruv-coaching', 'mentorship', 'architecture-coaching'],
    'ruv-vibecast': ['ruv-vibecast', 'live-teaching', 'community'],
    'vibe-coding':  ['vibe-coding', 'live-build', 'practical'],
    'hackerspace':  ['hackerspace', 'community', 'live-session'],
  };
  const typeTopics = typeMap[session.type] || [];

  // Keyword topics based on content
  const contentTopics = [];
  const text = (chunk.ruvTeachingText || '').toLowerCase();
  if (/vector|embedding|hnsw/.test(text)) contentTopics.push('vector-search');
  if (/agent|swarm|spawn/.test(text)) contentTopics.push('agent-systems');
  if (/memory|reasoning.?bank/.test(text)) contentTopics.push('memory-systems');
  if (/claude.?flow|cf v3|hooks/.test(text)) contentTopics.push('ruflo');
  if (/security|aimds|defense/.test(text)) contentTopics.push('security');
  if (/deploy|railway|render|docker/.test(text)) contentTopics.push('deployment');
  if (/wasm|browser|offline/.test(text)) contentTopics.push('wasm');

  return [...new Set([...base, ...typeTopics, ...contentTopics])];
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 Ingesting ALL Ruv Sessions into RuVector KB\n');
  console.log(`Sessions to process: ${SESSIONS.length}`);
  console.log('Priority order: ruv-coaching > ruv-vibecast > vibe-coding > hackerspace\n');

  // Verify DB connection
  try {
    await pool.query('SELECT 1');
    console.log('✓ PostgreSQL connected (port 5435)\n');
  } catch (e) {
    console.error('✗ Cannot connect to PostgreSQL:', e.message);
    process.exit(1);
  }

  // Check current count before
  const before = await pool.query(`SELECT COUNT(*) FROM ${SCHEMA}.architecture_docs WHERE category = 'coaching'`);
  console.log(`Current coaching entries in DB: ${before.rows[0].count}\n`);

  let totalIngested = 0;
  let sessionsDone = 0;
  let sessionsFailed = 0;

  // Process by priority
  const byPriority = ['critical', 'high', 'medium'];
  for (const priority of byPriority) {
    const batch = SESSIONS.filter(s => s.priority === priority);
    if (!batch.length) continue;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Priority: ${priority.toUpperCase()} (${batch.length} sessions)`);
    console.log('='.repeat(60));

    for (const session of batch) {
      try {
        const count = await ingestSession(session);
        totalIngested += count;
        sessionsDone++;
      } catch (e) {
        console.error(`  ✗ Failed: ${e.message}`);
        sessionsFailed++;
      }
    }
  }

  // Final count
  const after = await pool.query(`SELECT COUNT(*) FROM ${SCHEMA}.architecture_docs WHERE category = 'coaching'`);

  console.log(`\n${'='.repeat(60)}`);
  console.log('✅ INGESTION COMPLETE');
  console.log('='.repeat(60));
  console.log(`Sessions processed: ${sessionsDone} ✓  ${sessionsFailed} ✗`);
  console.log(`Total entries ingested: ${totalIngested}`);
  console.log(`Coaching entries in DB: ${before.rows[0].count} → ${after.rows[0].count}`);

  await pool.end();
}

main().catch(e => {
  console.error('Fatal error:', e);
  pool.end();
  process.exit(1);
});
