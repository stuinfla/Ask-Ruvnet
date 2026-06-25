/**
 * Ingest AI Defense / AIMDS entries from RuvNet source code
 */
import pg from 'pg';
import { pipeline } from '@xenova/transformers';
import crypto from 'crypto';

const pool = new pg.Pool({
  host: '127.0.0.1', port: 5435, user: 'postgres',
  password: 'guruKB2025', database: 'postgres'
});

let embedder;
async function embed(text) {
  if (!embedder) embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  const out = await embedder(text, { pooling: 'mean', normalize: true });
  return '[' + Array.from(out.data).join(',') + ']';
}

// Entries loaded from JSON file
import { readFileSync } from 'fs';
const jsonFile = process.argv[2] || '/tmp/ai-defense-entries.json';
const entries = JSON.parse(readFileSync(jsonFile, 'utf-8'));

async function main() {
  console.log(`Ingesting ${entries.length} entries from ${jsonFile}...`);
  const t0 = Date.now();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const clean = entry.content.replace(/[^\x00-\x7F]/g, '');
    const cleanTitle = entry.title.replace(/[^\x00-\x7F]/g, '');
    const embedText = (cleanTitle + ' ' + clean).substring(0, 1500);
    const vec = await embed(embedText);

    const { rows } = await pool.query(
      `INSERT INTO ask_ruvnet.kb_complete (file_path, title, content, category, quality_score, chunk_count, original_chars, embedding)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $7::ruvector) ON CONFLICT (file_path) DO NOTHING RETURNING id`,
      [entry.path, cleanTitle, clean, entry.category, entry.quality, clean.length, vec]);

    let kbId;
    if (rows.length > 0) { kbId = rows[0].id; }
    else {
      const { rows: [e] } = await pool.query(`SELECT id FROM ask_ruvnet.kb_complete WHERE file_path = $1`, [entry.path]);
      kbId = e.id;
    }

    const docId = `kb-complete-${kbId}`;
    const summary = clean.split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(0, 3).join(' ').replace(/\s+/g, ' ').trim().substring(0, 300);
    const fileHash = crypto.createHash('sha256').update(clean).digest('hex').substring(0, 16);

    await pool.query(
      `INSERT INTO ask_ruvnet.architecture_docs (doc_id, title, content, file_path, file_hash, category, quality_score, knowledge_type, concepts, summary, expertise_level, source_authority, triage_tier, is_duplicate, embedding)
       SELECT $1, $2, kc.content, $3, $4, $5, kc.quality_score, $6, $7::text[], $8, 'expert', 'expert-curated', 'gold', false, kc.embedding
       FROM ask_ruvnet.kb_complete kc WHERE kc.id = $9 ON CONFLICT (doc_id) DO NOTHING`,
      [docId, cleanTitle, `kb-complete/${entry.path}`, fileHash, entry.category,
       (['example','concept','reference','decision','troubleshooting','pattern','procedure'].includes(entry.knowledge_type) ? entry.knowledge_type : 'reference'),
       entry.concepts, summary, kbId]);

    console.log(`[${i+1}/${entries.length}] ${cleanTitle} (${entry.category})`);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nDone! ${entries.length} entries in ${elapsed}s`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
