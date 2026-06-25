/**
 * Stage 1: Topic Clustering — Group fragments by file_path + section
 *
 * Groups remaining entries into merge candidates using:
 * 1. file_path (entries from the same source file)
 * 2. section_header (entries from the same section)
 * 3. section_index ordering (preserve document flow)
 *
 * Each group gets a merge_group_id like: "file_path::section_header"
 * Groups with only 1 entry are marked KEEP (standalone).
 * Groups with 2+ entries are MERGE candidates for Stage 2.
 */
const { pool } = require('../config');

async function stage01_cluster(runId, { dryRun = false, limit = null } = {}) {
  const client = await pool.connect();

  try {
    // Get entries not yet decided in Stage 0
    console.log('[Stage 1] Collecting undecided entries...');

    const undecidedRes = await client.query(`
      SELECT COUNT(*) as cnt FROM ask_ruvnet.architecture_docs a
      WHERE a.is_duplicate = false
        AND a.id NOT IN (
          SELECT entry_id FROM ask_ruvnet.curation_decisions
          WHERE run_id = $1 AND stage = 'prefilter'
        )
        AND a.id NOT IN (
          SELECT entry_id FROM ask_ruvnet.curation_decisions
          WHERE run_id = $1 AND stage = 'cluster'
        )
    `, [runId]);

    const remaining = parseInt(undecidedRes.rows[0].cnt);
    console.log(`[Stage 1] ${remaining.toLocaleString()} entries to cluster`);

    // Get distinct file_paths and their entry counts
    const fileGroups = await client.query(`
      SELECT file_path, COUNT(*) as cnt
      FROM ask_ruvnet.architecture_docs a
      WHERE a.is_duplicate = false
        AND a.id NOT IN (
          SELECT entry_id FROM ask_ruvnet.curation_decisions
          WHERE run_id = $1
        )
      GROUP BY file_path
      ORDER BY cnt DESC
      ${limit ? `LIMIT ${limit}` : ''}
    `, [runId]);

    console.log(`[Stage 1] ${fileGroups.rows.length.toLocaleString()} distinct file paths`);

    // Stats
    let totalGrouped = 0;
    let totalSingles = 0;
    let mergeGroupCount = 0;
    let filesProcessed = 0;

    for (const fileRow of fileGroups.rows) {
      const filePath = fileRow.file_path;
      const fileCount = parseInt(fileRow.cnt);

      // Fetch all entries for this file
      const entries = await client.query(`
        SELECT id, title, section_header, section_index, char_length(content) as chars
        FROM ask_ruvnet.architecture_docs
        WHERE file_path = $1 AND is_duplicate = false
          AND id NOT IN (SELECT entry_id FROM ask_ruvnet.curation_decisions WHERE run_id = $2)
        ORDER BY section_index ASC NULLS LAST, id ASC
      `, [filePath, runId]);

      if (entries.rows.length === 0) continue;

      if (entries.rows.length <= 2) {
        // Small files: each entry is standalone
        if (!dryRun) {
          for (const entry of entries.rows) {
            await client.query(`
              INSERT INTO ask_ruvnet.curation_decisions
                (run_id, entry_id, stage, action, reason, merge_group_id)
              VALUES ($1, $2, 'cluster', 'STANDALONE', 'Single entry from file', $3)
              ON CONFLICT (run_id, entry_id, stage) DO NOTHING
            `, [runId, entry.id, `standalone::${entry.id}`]);
          }
        }
        totalSingles += entries.rows.length;
      } else {
        // Multi-entry files: group by section_header
        const sectionGroups = {};
        for (const entry of entries.rows) {
          const section = entry.section_header || 'no-section';
          if (!sectionGroups[section]) sectionGroups[section] = [];
          sectionGroups[section].push(entry);
        }

        for (const [section, groupEntries] of Object.entries(sectionGroups)) {
          const groupId = `${filePath}::${section}`;

          // If section group is too large (>20 entries), split by chunks of 10
          const chunks = [];
          if (groupEntries.length > 20) {
            for (let i = 0; i < groupEntries.length; i += 10) {
              chunks.push(groupEntries.slice(i, i + 10));
            }
          } else {
            chunks.push(groupEntries);
          }

          for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
            const chunk = chunks[chunkIdx];
            const chunkGroupId = chunks.length > 1 ? `${groupId}::chunk${chunkIdx}` : groupId;

            const action = chunk.length === 1 ? 'STANDALONE' : 'MERGE_CANDIDATE';

            if (!dryRun) {
              for (const entry of chunk) {
                await client.query(`
                  INSERT INTO ask_ruvnet.curation_decisions
                    (run_id, entry_id, stage, action, reason, merge_group_id)
                  VALUES ($1, $2, 'cluster', $3, $4, $5)
                  ON CONFLICT (run_id, entry_id, stage) DO NOTHING
                `, [
                  runId, entry.id, action,
                  `${chunk.length} entries in group (file has ${fileCount} total)`,
                  chunkGroupId
                ]);
              }
            }

            if (chunk.length === 1) totalSingles++;
            else {
              totalGrouped += chunk.length;
              mergeGroupCount++;
            }
          }
        }
      }

      filesProcessed++;
      if (filesProcessed % 1000 === 0) {
        console.log(`[Stage 1] Processed ${filesProcessed.toLocaleString()} / ${fileGroups.rows.length.toLocaleString()} files`);
      }
    }

    console.log(`\n[Stage 1] SUMMARY:`);
    console.log(`  Files processed: ${filesProcessed.toLocaleString()}`);
    console.log(`  Merge groups created: ${mergeGroupCount.toLocaleString()}`);
    console.log(`  Entries in merge groups: ${totalGrouped.toLocaleString()}`);
    console.log(`  Standalone entries: ${totalSingles.toLocaleString()}`);

    // Record completion
    if (!dryRun) {
      await client.query(`
        INSERT INTO ask_ruvnet.curation_pipeline (run_id, stage, status, entries_processed, entries_total)
        VALUES ($1, 'cluster', 'completed', $2, $3)
      `, [runId, totalGrouped + totalSingles, remaining]);
    }

    // Show top 10 largest merge groups
    if (!dryRun) {
      const topGroups = await client.query(`
        SELECT merge_group_id, COUNT(*) as cnt
        FROM ask_ruvnet.curation_decisions
        WHERE run_id = $1 AND stage = 'cluster' AND action = 'MERGE_CANDIDATE'
        GROUP BY merge_group_id ORDER BY cnt DESC LIMIT 10
      `, [runId]);

      console.log(`\n[Stage 1] Top 10 largest merge groups:`);
      for (const row of topGroups.rows) {
        console.log(`  ${parseInt(row.cnt)} entries: ${row.merge_group_id.substring(0, 80)}`);
      }
    }

    return { filesProcessed, mergeGroupCount, totalGrouped, totalSingles };
  } finally {
    client.release();
  }
}

module.exports = { stage01_cluster };
