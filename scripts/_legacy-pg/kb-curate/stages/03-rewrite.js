/**
 * Stage 3: Merge + Rewrite — Transform fragments into teaching docs
 *
 * Uses Anthropic Claude Haiku for groups marked MERGE or REWRITE.
 * Each group's fragments are combined and rewritten into a single
 * coherent teaching document following the gold template.
 *
 * New entries are inserted into architecture_docs.
 * Old fragments are marked is_duplicate=true with canonical_id.
 */
const { pool, ANTHROPIC_API_KEY, HAIKU_MODEL } = require('../config');
const { buildRewritePrompt } = require('../prompts/rewrite');
const { RateLimiter } = require('../utils/rate-limiter');
const { scoreRewrite } = require('../utils/quality-gate');

async function stage03_rewrite(runId, { dryRun = false, limit = null, testMode = false, workerId = 0, totalWorkers = 1 } = {}) {
  if (!ANTHROPIC_API_KEY) {
    console.error('[Stage 3] ERROR: ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const client = await pool.connect();
  const limiter = new RateLimiter(50); // Haiku supports high RPM

  try {
    // Get groups marked MERGE or REWRITE in Stage 2, not yet processed
    // Worker partitioning: each worker gets a deterministic slice using hash mod
    const workerFilter = totalWorkers > 1
      ? `AND abs(hashtext(merge_group_id)) % ${totalWorkers} = ${workerId}`
      : '';
    const groupsRes = await client.query(`
      SELECT DISTINCT merge_group_id, topic_extracted, facts_extracted
      FROM ask_ruvnet.curation_decisions
      WHERE run_id = $1 AND stage = 'triage'
        AND action IN ('MERGE', 'REWRITE')
        AND merge_group_id NOT IN (
          SELECT DISTINCT merge_group_id FROM ask_ruvnet.curation_decisions
          WHERE run_id = $1 AND stage = 'rewrite' AND merge_group_id IS NOT NULL
        )
        ${workerFilter}
      ${limit ? `LIMIT ${limit}` : ''}
    `, [runId]);

    const totalGroups = groupsRes.rows.length;
    const wLabel = totalWorkers > 1 ? ` (worker ${workerId + 1}/${totalWorkers})` : '';
    console.log(`[Stage 3${wLabel}] ${totalGroups.toLocaleString()} groups to rewrite`);

    const stats = { rewritten: 0, errors: 0, totalNewChars: 0, qualityRejected: 0 };
    let processed = 0;

    for (const groupRow of groupsRes.rows) {
      const groupId = groupRow.merge_group_id;
      const topic = groupRow.topic_extracted || 'Unknown Topic';
      const facts = groupRow.facts_extracted || [];

      // Fetch all source fragments
      const fragmentsRes = await client.query(`
        SELECT a.id, a.title, a.content, a.file_path, a.package_name, a.doc_type, a.category
        FROM ask_ruvnet.curation_decisions d
        JOIN ask_ruvnet.architecture_docs a ON d.entry_id = a.id
        WHERE d.run_id = $1 AND d.stage = 'cluster' AND d.merge_group_id = $2
        ORDER BY a.section_index ASC NULLS LAST, a.id ASC
      `, [runId, groupId]);

      const fragments = fragmentsRes.rows;
      if (fragments.length === 0) continue;

      // Total content size — if too large, truncate
      let totalChars = fragments.reduce((s, f) => s + (f.content?.length || 0), 0);
      let truncatedFragments = fragments;

      if (totalChars > 15000) {
        // Truncate: keep first 500 chars of each, prioritize first/last fragments
        truncatedFragments = fragments.map((f, i) => ({
          ...f,
          content: i < 3 || i >= fragments.length - 2
            ? f.content?.substring(0, 2000) || ''
            : f.content?.substring(0, 500) || ''
        }));
      }

      const prompt = buildRewritePrompt(truncatedFragments, topic, facts);

      try {
        await limiter.wait();

        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: HAIKU_MODEL,
            max_tokens: 4096,
            messages: [{ role: 'user', content: prompt }],
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          if (response.status === 429) {
            console.log(`[Stage 3] Rate limited, waiting 30s then retrying group ${groupId.substring(0, 40)}...`);
            await new Promise(r => setTimeout(r, 30000));
            // Push group back to end of queue for retry instead of skipping
            groupsRes.rows.push(groupRow);
            continue;
          }
          throw new Error(`Anthropic API ${response.status}: ${errText.substring(0, 200)}`);
        }

        const data = await response.json();
        const newContent = data.content?.[0]?.text;
        if (!newContent || newContent.length < 100) {
          console.warn(`[Stage 3] Empty/short rewrite for group ${groupId}`);
          stats.errors++;
          continue;
        }

        // Check if the LLM refused to rewrite (indicates garbage content)
        const refusalPatterns = /cannot produce|cannot create|I can't make|not enough.*content|does not contain.*explanation/i;
        if (refusalPatterns.test(newContent) && !newContent.match(/^#\s+/m)) {
          console.log(`[Stage 3] LLM refused rewrite (garbage content) for group: ${groupId.substring(0, 60)}`);
          // Mark as DELETE instead of rewriting
          if (!dryRun) {
            for (const frag of fragments) {
              await client.query(`
                INSERT INTO ask_ruvnet.curation_decisions
                  (run_id, entry_id, stage, action, reason, merge_group_id)
                VALUES ($1, $2, 'rewrite', 'DELETE', 'LLM refused: insufficient content for teaching doc', $3)
                ON CONFLICT (run_id, entry_id, stage) DO NOTHING
              `, [runId, frag.id, groupId]);
            }
            // Mark original entries as duplicates (effectively deleting them from search)
            for (const frag of fragments) {
              await client.query(
                `UPDATE ask_ruvnet.architecture_docs SET is_duplicate = true WHERE id = $1`,
                [frag.id]
              );
            }
          }
          stats.llmRefusals = (stats.llmRefusals || 0) + 1;
          processed++;
          continue;
        }

        // Extract title from the rewritten content
        const titleMatch = newContent.match(/^#\s+(.+)/m);
        const newTitle = titleMatch ? titleMatch[1].trim() : `${topic}: What It Is and Why It Matters`;

        // ─── QUALITY GATE: Score rewrite before storing ───
        const quality = scoreRewrite(newContent, fragments);
        if (!quality.pass) {
          console.log(`[Stage 3] QUALITY REJECTED (${quality.score}/10) group: ${groupId.substring(0, 60)}`);
          console.log(`[Stage 3]   Breakdown: ${JSON.stringify(quality.breakdown)}`);
          for (const f of quality.failures) {
            console.log(`[Stage 3]   - ${f}`);
          }
          stats.qualityRejected++;

          if (!dryRun) {
            // Log rejection decision for every fragment in the group
            for (const frag of fragments) {
              await client.query(`
                INSERT INTO ask_ruvnet.curation_decisions
                  (run_id, entry_id, stage, action, reason, merge_group_id)
                VALUES ($1, $2, 'rewrite', 'QUALITY_REJECTED',
                        'Score ' || $3 || '/10 below 7.0 threshold. Failures: ' || $4, $5)
                ON CONFLICT (run_id, entry_id, stage) DO NOTHING
              `, [runId, frag.id, quality.score,
                  quality.failures.join('; '), groupId]);
            }
          }
          processed++;
          continue;
        }
        console.log(`[Stage 3] QUALITY PASSED (${quality.score}/10) — ${newTitle.substring(0, 60)}`);

        // Inherit metadata from first fragment
        const first = fragments[0];
        const packageName = first.package_name;
        const docType = first.doc_type || 'documentation';
        const category = first.category || 'general';
        const filePath = `curated/${groupId.replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 100)}`;

        if (!dryRun) {
          // Generate a unique doc_id for the new entry
          const docId = `curated-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

          // Insert new merged entry
          const insertRes = await client.query(`
            INSERT INTO ask_ruvnet.architecture_docs
              (doc_id, title, content, file_path, file_hash, package_name, doc_type, category,
               knowledge_type, quality_score, triage_tier, source_authority, expertise_level,
               is_duplicate, topics, concepts, summary)
            VALUES ($1, $2, $3, $4, md5($3), $5, $6, $7,
                    'concept', 90, 'gold', 'llm-generated', 'intermediate',
                    false, ARRAY[$8], ARRAY[$8], LEFT($3, 300))
            RETURNING id
          `, [docId, newTitle, newContent, filePath, packageName, docType, category, topic]);

          const newId = insertRes.rows[0].id;

          // Mark old fragments as duplicates pointing to new entry
          for (const frag of fragments) {
            await client.query(`
              UPDATE ask_ruvnet.architecture_docs
              SET is_duplicate = true, canonical_id = $1
              WHERE id = $2
            `, [newId, frag.id]);
          }

          // Record lineage
          for (const frag of fragments) {
            await client.query(`
              INSERT INTO ask_ruvnet.curation_lineage (new_entry_id, source_entry_id, run_id, action)
              VALUES ($1, $2, $3, 'merged_from')
            `, [newId, frag.id, runId]);
          }

          // Record rewrite decision
          for (const frag of fragments) {
            await client.query(`
              INSERT INTO ask_ruvnet.curation_decisions
                (run_id, entry_id, stage, action, reason, merge_group_id)
              VALUES ($1, $2, 'rewrite', 'REWRITTEN', 'Merged into entry ' || $3, $4)
              ON CONFLICT (run_id, entry_id, stage) DO NOTHING
            `, [runId, frag.id, newId, groupId]);
          }

          stats.rewritten++;
          stats.totalNewChars += newContent.length;
        }

        processed++;
        if (processed % 10 === 0) {
          console.log(`[Stage 3] ${processed}/${totalGroups} groups rewritten | ${stats.rewritten} new docs, ${stats.errors} errors, ${Math.round(stats.totalNewChars / 1024)}KB new content`);
        }

        if (testMode && processed >= 3) {
          console.log('[Stage 3] TEST MODE — stopping after 3 rewrites');
          break;
        }
      } catch (err) {
        console.error(`[Stage 3] Error rewriting group ${groupId}: ${err.message}`);
        stats.errors++;
      }
    }

    console.log(`\n[Stage 3] SUMMARY:`);
    console.log(`  Groups rewritten: ${stats.rewritten}`);
    console.log(`  Quality rejected: ${stats.qualityRejected}`);
    console.log(`  LLM refusals: ${stats.llmRefusals || 0}`);
    console.log(`  Total new content: ${Math.round(stats.totalNewChars / 1024)}KB`);
    console.log(`  Errors: ${stats.errors}`);

    if (!dryRun && !testMode) {
      await client.query(`
        INSERT INTO ask_ruvnet.curation_pipeline (run_id, stage, status, entries_processed, entries_total)
        VALUES ($1, 'rewrite', 'completed', $2, $3)
      `, [runId, stats.rewritten, totalGroups]);
    }

    return stats;
  } finally {
    client.release();
  }
}

module.exports = { stage03_rewrite };
