/**
 * Rewrite Prompt — Stage 3 (v3.0)
 *
 * v3.0 changes (Stuart's "helpful, not just accurate" directive):
 * - Added "When to Use This" section (use cases, decision criteria)
 * - Added "Getting Started" section (first steps, minimal code)
 * - "How It Works" now includes WHY and implementation guidance
 * - Connected section now mentions package/system context even without cross-refs
 * - Tighter banned word enforcement with examples
 * - Summary bullets must be actionable, not just factual
 *
 * v2.0 changes (quality audit response):
 * - Banned "Think of it" pattern
 * - Required qualifying language for performance claims
 * - Explicit banned word list
 * - Required cross-references section
 */
function buildRewritePrompt(fragments, topic, facts) {
  return `You are rewriting fragmented technical documentation into a single, high-quality TEACHING document for the Ask RuvNet knowledge base.

CRITICAL CONTEXT: Your audience is engineers who have NEVER heard of this technology before. Many of these algorithms, tools, and patterns are so new that no one outside the RuvNet ecosystem knows they exist. Your job is not just to describe what something IS — you must teach them:
- WHY they should care (what problem does this solve that they currently struggle with?)
- WHEN to reach for it (what signals tell them this is the right tool?)
- HOW to get started (what does the first real implementation look like?)
- WHAT goes wrong (common mistakes, gotchas, things that aren't obvious)

A reader should finish your document and think: "I know what this is, I know when I'd use it, and I know how to start."

TARGET FORMAT (follow exactly — omit sections ONLY if source material truly doesn't support them):
---
# [Topic Name]: What It Is and Why It Matters

## Overview
[2-3 sentences in plain English. Answer: What is this? What problem does it solve?
A reader who has never heard of this should understand the first paragraph.
Do NOT use "Think of it as..." as an opener. Instead, start with one of these:
- The problem: "[Topic] solves the problem of..."
- A definition: "[Topic] is a [what] that [does what]..."
- What it replaces: "Before [Topic], developers had to..."
- The key insight: "The core idea behind [Topic] is..."]

## When to Use This
[Help the reader decide if this is relevant to them. Answer:
- What use cases does this serve? Be specific — name the scenario.
- What signals tell you this is the right tool? (e.g., "If your dataset exceeds 100K vectors...")
- What alternatives exist and when would you choose those instead?
Only include what the source material supports. Do NOT fabricate use cases.]

## How It Works
[Technical explanation with specifics. This section must contain:
- Architecture details: what data structures, algorithms, or patterns are used
- WHY those choices were made (if the source explains the reasoning)
- At least 3 bullet points with specific technical details
- Implementation-relevant notes: what an engineer needs to know to use this correctly
Use bullet points. Name the data structures, protocols, and patterns.]

## Key Numbers
[Performance stats, limits, benchmarks — anything quantitative from the source material.
EVERY number MUST include context:
  - What was measured (workload type, dataset size)
  - What it was compared against (baseline)
  - Under what conditions (hardware, config)
If source doesn't provide context for a number, say: "reported as X (benchmark details not specified in source)"
Never present a number without qualification.]

## Getting Started
[The minimum viable path to using this. Answer: "If I wanted to try this right now, what would I do?"
- Prerequisites (what needs to be installed/configured)
- First 5-10 lines of real code showing basic usage
- Expected output or behavior
Only include if source material has enough for realistic guidance. Do NOT fabricate setup steps.]

## Code Example
[A more complete, realistic code example from the source material.
Show a real use case, not a trivial hello-world. Add comments explaining WHY each step matters.
Only include if source has code.]

## Common Pitfalls
[What goes wrong? What's not obvious? What will trip up a first-time user?
- Specific mistakes to avoid
- Non-obvious configuration requirements
- Performance traps (e.g., "Using X without Y will cause...")
Only include if source material contains warnings, error handling, or known issues.]

## Related Tools
[How this connects to other tools in the RuvNet ecosystem.
- Name the package this code belongs to (e.g., "@ruvector/core v0.1.30")
- Describe what broader system or architecture it is part of
- If source mentions other tools (AgentDB, RuVector, Ruflo, Agentic Flow, AIMDS, RVF, SONA, MinCut, etc.), explain the specific relationship
- If no explicit integrations are documented, write: "Part of the [package_name] package. No explicit integrations with other RuvNet tools are documented in the source material."
Do NOT fabricate connections that aren't in the source.]

## Summary
[3-5 bullet point TL;DR. Each bullet must be:
- A concrete, verifiable fact (not a vague claim)
- Actionable: tell the reader what to DO, not just what exists
  BAD: "Supports multiple distance metrics"
  GOOD: "Use cosine distance for text embeddings, L2 for image embeddings — configure via the 'metric' parameter"]
---

SOURCE MATERIAL (${fragments.length} fragments about "${topic}"):
${fragments.map((f, i) => `--- Fragment ${i + 1} (from: ${f.title}) ---
${f.content}
`).join('\n')}

KEY FACTS IDENTIFIED DURING TRIAGE:
- ${facts.join('\n- ')}

RULES (MANDATORY — violation = rejection):
1. ONLY include information from the source fragments. Do not hallucinate features, numbers, capabilities, or use cases.
2. If source material is insufficient for a section, omit that section entirely. A shorter accurate document is ALWAYS better than a longer one with fabricated content.
3. Write at intermediate level — assume the reader knows APIs and databases but has NEVER heard of this specific tool or concept.
4. Title must be descriptive: "RuVector HNSW Indexing: What It Is and Why It Matters", not "README Part 14".
5. Target: 800-2500 words. Shorter is fine for narrow topics.
6. Strip GitHub formatting (badges, CI links, contribution guidelines, license sections).
7. Do NOT wrap the output in markdown code fences. Return the document directly.
8. The document MUST contain at least 2 concrete facts (a number with units, a CLI command, a config snippet, or a benchmark). If the source doesn't have any, state that explicitly.

WRITING QUALITY RULES (MANDATORY):
9. NEVER start the Overview with "Think of it as..." or any variation. This phrase is BANNED.
10. BANNED WORDS — do not use these ANYWHERE in the document. Not even once:
    seamlessly, seamless, leverage, cutting-edge, cutting edge, revolutionary,
    game-changing, game changer, next-generation, next generation,
    state-of-the-art, state of the art, best-in-class, holistic, synergy,
    streamline, empower, intelligent (when describing software), robust (without
    saying what makes it robust), powerful (without describing the capability)
    If you are about to write one of these words, STOP and use a specific description instead.
11. ALL performance claims MUST be qualified with measurement context.
12. Each Summary bullet must name a specific tool, number, protocol, data structure, or action. No subjective assessments.
13. How It Works must contain at least 3 bullet points with specific technical details.`;
}

module.exports = { buildRewritePrompt };
