/**
 * Stage 2: LLM Triage — Evaluate each merge group
 *
 * Uses Groq llama-3.3-70b (free tier) to classify each group as:
 * KEEP, MERGE, REWRITE, or DELETE
 *
 * Fully resumable — skips groups already triaged in this run.
 */
const { pool, GROQ_API_KEY, GROQ_MODEL, GROQ_RPM } = require('../config');
const { buildTriagePrompt } = require('../prompts/triage');
const { RateLimiter } = require('../utils/rate-limiter');

async function stage02_triage(runId, { dryRun = false, limit = null, testMode = false } = {}) {
  if (!GROQ_API_KEY) {
    console.error('[Stage 2] ERROR: GROQ_API_KEY not set. Export it first.');
    process.exit(1);
  }

  const client = await pool.connect();
  const limiter = new RateLimiter(GROQ_RPM);

  try {
    // Get all merge groups from Stage 1 that haven't been triaged yet
    const groupsRes = await client.query(`
      SELECT merge_group_id, COUNT(*) as cnt
      FROM ask_ruvnet.curation_decisions
      WHERE run_id = $1 AND stage = 'cluster'
        AND action IN ('MERGE_CANDIDATE', 'STANDALONE')
        AND merge_group_id NOT IN (
          SELECT DISTINCT merge_group_id FROM ask_ruvnet.curation_decisions
          WHERE run_id = $1 AND stage = 'triage' AND merge_group_id IS NOT NULL
        )
      GROUP BY merge_group_id
      ORDER BY cnt DESC
      ${limit ? `LIMIT ${limit}` : ''}
    `, [runId]);

    const totalGroups = groupsRes.rows.length;
    console.log(`[Stage 2] ${totalGroups.toLocaleString()} groups to triage`);

    const stats = { keep: 0, merge: 0, rewrite: 0, delete: 0, errors: 0 };
    let processed = 0;

    for (const groupRow of groupsRes.rows) {
      const groupId = groupRow.merge_group_id;

      // Fetch all entries in this group
      const entriesRes = await client.query(`
        SELECT a.id, a.title, a.content, a.file_path, a.section_header
        FROM ask_ruvnet.curation_decisions d
        JOIN ask_ruvnet.architecture_docs a ON d.entry_id = a.id
        WHERE d.run_id = $1 AND d.stage = 'cluster' AND d.merge_group_id = $2
        ORDER BY a.section_index ASC NULLS LAST, a.id ASC
      `, [runId, groupId]);

      const entries = entriesRes.rows;
      if (entries.length === 0) continue;

      // Build combined content for LLM
      const combinedContent = entries
        .map(e => `### ${e.title}\n${e.content || ''}`)
        .join('\n\n')
        .substring(0, 4000);

      const mergeGroup = {
        title: entries[0].title,
        file_path: entries[0].file_path || 'unknown',
        fragmentCount: entries.length,
        combinedContent,
      };

      const prompt = buildTriagePrompt(mergeGroup);

      try {
        await limiter.wait();

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GROQ_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: GROQ_MODEL,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            max_tokens: 300,
            response_format: { type: 'json_object' },
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          // Rate limited — wait and retry
          if (response.status === 429) {
            console.log(`[Stage 2] Rate limited, waiting 60s...`);
            await new Promise(r => setTimeout(r, 60000));
            // Don't increment processed — will retry on next loop pass
            continue;
          }
          throw new Error(`Groq API ${response.status}: ${errText.substring(0, 200)}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        let decision;

        try {
          decision = JSON.parse(content);
        } catch {
          console.warn(`[Stage 2] Failed to parse JSON for group ${groupId}: ${content?.substring(0, 100)}`);
          decision = { action: 'KEEP', reason: 'Parse error — defaulting to KEEP', topic: 'unknown', facts: [] };
          stats.errors++;
        }

        const action = ['KEEP', 'MERGE', 'REWRITE', 'DELETE'].includes(decision.action)
          ? decision.action : 'KEEP';

        // Record triage decision for all entries in the group
        if (!dryRun) {
          for (const entry of entries) {
            await client.query(`
              INSERT INTO ask_ruvnet.curation_decisions
                (run_id, entry_id, stage, action, reason, topic_extracted, facts_extracted, merge_group_id)
              VALUES ($1, $2, 'triage', $3, $4, $5, $6, $7)
              ON CONFLICT (run_id, entry_id, stage) DO NOTHING
            `, [
              runId, entry.id, action, decision.reason,
              decision.topic || null,
              decision.facts || [],
              groupId,
            ]);
          }
        }

        stats[action.toLowerCase()] = (stats[action.toLowerCase()] || 0) + 1;
        processed++;

        if (processed % 50 === 0) {
          console.log(`[Stage 2] ${processed}/${totalGroups} groups triaged | KEEP:${stats.keep} MERGE:${stats.merge} REWRITE:${stats.rewrite} DELETE:${stats.delete} ERR:${stats.errors}`);
        }

        if (testMode && processed >= 5) {
          console.log('[Stage 2] TEST MODE — stopping after 5 groups');
          break;
        }
      } catch (err) {
        console.error(`[Stage 2] Error triaging group ${groupId}: ${err.message}`);
        stats.errors++;
        // Continue to next group
      }
    }

    console.log(`\n[Stage 2] SUMMARY:`);
    console.log(`  KEEP: ${stats.keep}`);
    console.log(`  MERGE: ${stats.merge}`);
    console.log(`  REWRITE: ${stats.rewrite}`);
    console.log(`  DELETE: ${stats.delete}`);
    console.log(`  Errors: ${stats.errors}`);

    if (!dryRun && !testMode) {
      await client.query(`
        INSERT INTO ask_ruvnet.curation_pipeline (run_id, stage, status, entries_processed, entries_total)
        VALUES ($1, 'triage', 'completed', $2, $3)
      `, [runId, processed, totalGroups]);
    }

    return stats;
  } finally {
    client.release();
  }
}

module.exports = { stage02_triage };
