/**
 * Triage Prompt — Stage 2
 * Sent to Groq llama-3.3-70b for each merge group
 */
function buildTriagePrompt(mergeGroup) {
  return `You are a knowledge base quality evaluator. You are reviewing entries from a technical knowledge base about the RuvNet AI ecosystem (vector databases, agent frameworks, reinforcement learning, LLM tooling).

TASK: Evaluate whether this content is worth keeping as educational material.
A good KB entry teaches someone something specific and actionable.

CONTENT TO EVALUATE:
---
Title: ${mergeGroup.title}
Source file: ${mergeGroup.file_path}
Number of fragments: ${mergeGroup.fragmentCount}
Combined content (may be truncated):

${mergeGroup.combinedContent.substring(0, 3000)}
---

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "action": "KEEP" | "MERGE" | "REWRITE" | "DELETE",
  "reason": "<one sentence explaining your decision>",
  "topic": "<the main topic, e.g. 'HNSW indexing', 'AgentDB memory system'>",
  "facts": ["<1-5 key facts this content contains>"],
  "teaching_potential": <1-10>
}

DECISION CRITERIA:
- DELETE if: content is a changelog, git diff, CI output, table fragment with no context, ASCII diagram with no explanation, fewer than 2 complete sentences, or metadata/config with no explanation
- KEEP if: content is already a coherent explanation with 3+ paragraphs, contains both explanation AND examples, would be useful as-is to someone learning
- MERGE if: content is a fragment that contains real information but is incomplete — it covers part of a topic and other fragments from the same file cover the rest. This is VERY COMMON for chunked README files.
- REWRITE if: content contains valuable facts or code but is poorly organized, missing context, or raw reference material rather than teaching content

When in doubt between MERGE and REWRITE, choose MERGE.
When in doubt between DELETE and REWRITE, check if there are at least 2 concrete facts — if yes, REWRITE; if no, DELETE.`;
}

module.exports = { buildTriagePrompt };
