#!/usr/bin/env node
/**
 * KB Batch Ingest - Ingest all markdown from RuvNet repos
 */

const { Pool } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  pg: {
    host: 'localhost',
    port: 5435,
    database: 'postgres',
    user: 'postgres',
    password: process.env.RUVECTOR_PASSWORD || ''
  },
  schema: 'ask_ruvnet',
  repoDir: '/tmp/ruvnet-repos',
  batchSize: 50
};

const CATEGORY_RULES = [
  { pattern: /agent/i, category: 'agents' },
  { pattern: /swarm|hive/i, category: 'swarms' },
  { pattern: /memory|reasoning/i, category: 'memory' },
  { pattern: /deploy|docker|railway/i, category: 'deployment' },
  { pattern: /consensus|byzantine|raft/i, category: 'consensus' },
  { pattern: /neural|fann/i, category: 'neural' },
  { pattern: /vector|ruvector|embed/i, category: 'vector-db' },
  { pattern: /mcp/i, category: 'mcp' },
  { pattern: /sparc/i, category: 'sparc' },
  { pattern: /security|auth/i, category: 'security' },
  { pattern: /github|pr/i, category: 'github' },
  { pattern: /wasm|simd|perf/i, category: 'performance' },
  { pattern: /llm/i, category: 'llm' },
];

function detectCategory(text) {
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(text)) return rule.category;
  }
  return 'general';
}

function calculateQuality(content) {
  let score = 0;
  if (content.length > 500) score += 20;
  if (content.includes('```')) score += 25;
  if (/^#+ /m.test(content)) score += 15;
  if (content.includes('|')) score += 10;
  if (/^[-*] /m.test(content)) score += 10;
  return Math.min(100, score);
}

function contentHash(content) {
  return crypto.createHash('sha256')
    .update(content.toLowerCase().replace(/\s+/g, ' ').trim())
    .digest('hex');
}

function walkDir(dir) {
  const results = [];
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
        results.push(...walkDir(filePath));
      } else if (file.endsWith('.md')) {
        results.push(filePath);
      }
    }
  } catch (e) {}
  return results;
}

async function main() {
  console.log('═'.repeat(60));
  console.log('📚 KB BATCH INGEST - All RuvNet Repos');
  console.log('═'.repeat(60));

  const pool = new Pool(CONFIG.pg);
  const files = walkDir(CONFIG.repoDir);
  console.log(`\n📁 Found ${files.length} markdown files\n`);

  let inserted = 0, skipped = 0, errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (content.length < 50) { skipped++; continue; }

      const hash = contentHash(content);
      const title = path.basename(filePath, '.md');
      const relPath = filePath.replace(CONFIG.repoDir + '/', '');
      const category = detectCategory(relPath + ' ' + title);
      const quality = calculateQuality(content);

      // Check duplicate
      const existing = await pool.query(
        `SELECT id FROM ${CONFIG.schema}.architecture_docs WHERE file_hash = $1`,
        [hash]
      );

      if (existing.rows.length > 0) {
        skipped++;
      } else {
        await pool.query(`
          INSERT INTO ${CONFIG.schema}.architecture_docs
          (doc_id, title, content, file_path, file_hash, category, quality_score, is_duplicate, embedding)
          VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, ruvector_embed(LEFT($2 || ' ' || $3, 1500))::real[])
        `, [hash.slice(0, 8), title, content, relPath, hash, category, quality]);
        inserted++;
      }
    } catch (e) {
      errors++;
    }

    if ((i + 1) % 100 === 0 || i === files.length - 1) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = (i + 1) / elapsed;
      const eta = (files.length - i - 1) / rate;
      process.stdout.write(`\r   Progress: ${i + 1}/${files.length} | Inserted: ${inserted} | Skipped: ${skipped} | ${rate.toFixed(1)}/sec | ETA: ${Math.round(eta)}s   `);
    }
  }

  console.log('\n\n═'.repeat(60));
  console.log('✅ COMPLETE');
  console.log(`   Inserted: ${inserted}`);
  console.log(`   Skipped (duplicate/small): ${skipped}`);
  console.log(`   Errors: ${errors}`);
  console.log('═'.repeat(60));

  // Update view stats
  const viewCount = await pool.query(`SELECT COUNT(*) FROM ${CONFIG.schema}.kb`);
  console.log(`   High-quality entries in view: ${viewCount.rows[0].count}`);

  await pool.end();
}

main().catch(console.error);
