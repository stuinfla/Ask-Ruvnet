/**
 * Stage 0: Pre-Filter — SQL-only garbage elimination
 *
 * No LLM calls. Identifies entries to DELETE or PROTECT using SQL patterns.
 * Records decisions in curation_decisions table for auditability.
 */
const { pool } = require('../config');

async function stage00_prefilter(runId, { dryRun = false } = {}) {
  const client = await pool.connect();
  const stats = { protected: 0, deleted: 0, kept: 0, total: 0 };

  try {
    // Count total non-duplicate entries
    const totalRes = await client.query(
      "SELECT COUNT(*) as cnt FROM ask_ruvnet.architecture_docs WHERE is_duplicate = false"
    );
    stats.total = parseInt(totalRes.rows[0].cnt);
    console.log(`[Stage 0] Starting prefilter on ${stats.total.toLocaleString()} entries (run: ${runId})`);

    // Check for already-processed entries in this run
    const alreadyRes = await client.query(
      "SELECT COUNT(*) as cnt FROM ask_ruvnet.curation_decisions WHERE run_id = $1 AND stage = 'prefilter'",
      [runId]
    );
    const alreadyDone = parseInt(alreadyRes.rows[0].cnt);
    if (alreadyDone > 0) {
      console.log(`[Stage 0] Resuming — ${alreadyDone} entries already processed`);
    }

    // ---- RULE 1: Protect expert-curated entries ----
    const protectSql = `
      INSERT INTO ask_ruvnet.curation_decisions (run_id, entry_id, stage, action, reason)
      SELECT $1, id, 'prefilter', 'PROTECT', 'Expert-curated entry'
      FROM ask_ruvnet.architecture_docs
      WHERE is_duplicate = false
        AND (source_authority = 'expert-curated' OR id IN (SELECT id FROM ask_ruvnet.kb_complete))
        AND id NOT IN (SELECT entry_id FROM ask_ruvnet.curation_decisions WHERE run_id = $1 AND stage = 'prefilter')
      ON CONFLICT (run_id, entry_id, stage) DO NOTHING
    `;
    if (!dryRun) {
      const r = await client.query(protectSql, [runId]);
      stats.protected += r.rowCount;
      console.log(`[Stage 0] Protected ${r.rowCount} expert-curated entries`);
    }

    // ---- RULE 2: Delete entries with garbage titles ----
    const garbageTitleSql = `
      INSERT INTO ask_ruvnet.curation_decisions (run_id, entry_id, stage, action, reason)
      SELECT $1, id, 'prefilter', 'DELETE', 'Garbage title: ' || LEFT(title, 50)
      FROM ask_ruvnet.architecture_docs
      WHERE is_duplicate = false
        AND id NOT IN (SELECT entry_id FROM ask_ruvnet.curation_decisions WHERE run_id = $1 AND stage = 'prefilter')
        AND (
          title ~ '^[^a-zA-Z]*$'                     -- no letters at all
          OR title ~ '^.{1,3}$'                       -- 1-3 chars
          OR title LIKE '{%'                           -- JSON fragments
          OR title LIKE '---%'                         -- YAML frontmatter
          OR title ~ '^[a-z]+\\([^)]*\\);?$'          -- code fragments like "s();"
          OR title ~ '^\\w{1,2}$'                      -- single/double char words
        )
      ON CONFLICT (run_id, entry_id, stage) DO NOTHING
    `;
    if (!dryRun) {
      const r = await client.query(garbageTitleSql, [runId]);
      stats.deleted += r.rowCount;
      console.log(`[Stage 0] Marked ${r.rowCount} garbage-title entries for deletion`);
    }

    // ---- RULE 3: Delete tiny entries (<100 chars) ----
    const tinySql = `
      INSERT INTO ask_ruvnet.curation_decisions (run_id, entry_id, stage, action, reason)
      SELECT $1, id, 'prefilter', 'DELETE', 'Too short: ' || char_length(content) || ' chars'
      FROM ask_ruvnet.architecture_docs
      WHERE is_duplicate = false
        AND char_length(COALESCE(content, '')) < 100
        AND id NOT IN (SELECT entry_id FROM ask_ruvnet.curation_decisions WHERE run_id = $1 AND stage = 'prefilter')
      ON CONFLICT (run_id, entry_id, stage) DO NOTHING
    `;
    if (!dryRun) {
      const r = await client.query(tinySql, [runId]);
      stats.deleted += r.rowCount;
      console.log(`[Stage 0] Marked ${r.rowCount} tiny entries (<100 chars) for deletion`);
    }

    // ---- RULE 4: Delete pure changelog/commit log entries ----
    const changelogSql = `
      INSERT INTO ask_ruvnet.curation_decisions (run_id, entry_id, stage, action, reason)
      SELECT $1, id, 'prefilter', 'DELETE', 'Changelog/commit fragment'
      FROM ask_ruvnet.architecture_docs
      WHERE is_duplicate = false
        AND id NOT IN (SELECT entry_id FROM ask_ruvnet.curation_decisions WHERE run_id = $1 AND stage = 'prefilter')
        AND (
          (file_path ILIKE '%CHANGELOG%' AND doc_type NOT IN ('adr'))
          OR (doc_type = 'commit-history')
          OR (title ILIKE '%checkpoint%' AND content ILIKE '%checkpoint-%')
        )
      ON CONFLICT (run_id, entry_id, stage) DO NOTHING
    `;
    if (!dryRun) {
      const r = await client.query(changelogSql, [runId]);
      stats.deleted += r.rowCount;
      console.log(`[Stage 0] Marked ${r.rowCount} changelog/commit entries for deletion`);
    }

    // ---- RULE 5: Delete badge/license/CI-only sections ----
    const boilerplateSql = `
      INSERT INTO ask_ruvnet.curation_decisions (run_id, entry_id, stage, action, reason)
      SELECT $1, id, 'prefilter', 'DELETE', 'Boilerplate section'
      FROM ask_ruvnet.architecture_docs
      WHERE is_duplicate = false
        AND id NOT IN (SELECT entry_id FROM ask_ruvnet.curation_decisions WHERE run_id = $1 AND stage = 'prefilter')
        AND (
          (title ILIKE '%license%' AND char_length(content) < 500)
          OR (title ILIKE '%contributing%' AND char_length(content) < 500)
          OR (content ILIKE '%[![%' AND char_length(content) < 300)
          OR (title ILIKE '%badge%')
        )
      ON CONFLICT (run_id, entry_id, stage) DO NOTHING
    `;
    if (!dryRun) {
      const r = await client.query(boilerplateSql, [runId]);
      stats.deleted += r.rowCount;
      console.log(`[Stage 0] Marked ${r.rowCount} boilerplate entries for deletion`);
    }

    // ---- RULE 6: Delete entries in garbage triage tier with quality < 40 ----
    const garbageTierSql = `
      INSERT INTO ask_ruvnet.curation_decisions (run_id, entry_id, stage, action, reason)
      SELECT $1, id, 'prefilter', 'DELETE', 'Garbage tier, quality ' || quality_score
      FROM ask_ruvnet.architecture_docs
      WHERE is_duplicate = false
        AND triage_tier = 'garbage'
        AND quality_score < 40
        AND id NOT IN (SELECT entry_id FROM ask_ruvnet.curation_decisions WHERE run_id = $1 AND stage = 'prefilter')
      ON CONFLICT (run_id, entry_id, stage) DO NOTHING
    `;
    if (!dryRun) {
      const r = await client.query(garbageTierSql, [runId]);
      stats.deleted += r.rowCount;
      console.log(`[Stage 0] Marked ${r.rowCount} garbage-tier (quality<40) entries for deletion`);
    }

    // ---- Summary ----
    const summaryRes = await client.query(`
      SELECT action, COUNT(*) as cnt
      FROM ask_ruvnet.curation_decisions
      WHERE run_id = $1 AND stage = 'prefilter'
      GROUP BY action ORDER BY cnt DESC
    `, [runId]);

    console.log(`\n[Stage 0] SUMMARY:`);
    for (const row of summaryRes.rows) {
      console.log(`  ${row.action}: ${parseInt(row.cnt).toLocaleString()}`);
    }

    const totalDecided = summaryRes.rows.reduce((s, r) => s + parseInt(r.cnt), 0);
    const remaining = stats.total - totalDecided;
    console.log(`  Remaining for clustering: ${remaining.toLocaleString()} / ${stats.total.toLocaleString()}`);

    // Record pipeline stage completion
    if (!dryRun) {
      await client.query(`
        INSERT INTO ask_ruvnet.curation_pipeline (run_id, stage, status, entries_processed, entries_total)
        VALUES ($1, 'prefilter', 'completed', $2, $3)
      `, [runId, totalDecided, stats.total]);
    }

    return { ...stats, remaining, runId };
  } finally {
    client.release();
  }
}

module.exports = { stage00_prefilter };
