#!/usr/bin/env node
/**
 * Fast video knowledge ingestion pipeline
 * Converts video digest metadata + topic extractions into searchable KB entries
 * Uses ONNX embeddings for speed (~50ms/entry after warmup)
 */
import pg from 'pg';
import crypto from 'crypto';
import { readFileSync } from 'fs';

const pool = new pg.Pool({
  host: 'localhost', port: 5435, user: 'postgres', password: '', database: 'postgres', max: 2
});

let embedder;
async function getEmbedder() {
  if (!embedder) {
    const { pipeline } = await import('@xenova/transformers');
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return embedder;
}

async function embed(text) {
  const e = await getEmbedder();
  const out = await e(text, { pooling: 'mean', normalize: true });
  return '[' + Array.from(out.data).join(',') + ']';
}

async function ingestEntry(entry, idx, total) {
  const clean = entry.content.replace(/[^\x00-\x7F]/g, '');
  const cleanTitle = entry.title.replace(/[^\x00-\x7F]/g, '');
  const embedText = (cleanTitle + ' ' + clean).substring(0, 1500);
  const vec = await embed(embedText);

  const { rows } = await pool.query(
    `INSERT INTO ask_ruvnet.kb_complete
     (file_path, title, content, category, quality_score, chunk_count, original_chars, embedding)
     VALUES ($1, $2, $3, $4, $5, 1, $6, $7::ruvector)
     ON CONFLICT (file_path) DO NOTHING RETURNING id`,
    [entry.path, cleanTitle, clean, entry.category, entry.quality, clean.length, vec]
  );

  let kbId;
  if (rows.length > 0) {
    kbId = rows[0].id;
  } else {
    const { rows: [existing] } = await pool.query(
      `SELECT id FROM ask_ruvnet.kb_complete WHERE file_path = $1`, [entry.path]
    );
    kbId = existing.id;
  }

  const docId = `kb-complete-${kbId}`;
  const summary = clean.split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(0, 3).join(' ').replace(/\s+/g, ' ').trim().substring(0, 300);
  const fileHash = crypto.createHash('sha256').update(clean).digest('hex').substring(0, 16);

  await pool.query(
    `INSERT INTO ask_ruvnet.architecture_docs
     (doc_id, title, content, file_path, file_hash, category, quality_score,
      knowledge_type, concepts, summary, expertise_level, source_authority,
      triage_tier, is_duplicate, embedding)
     SELECT $1, $2, kc.content, $3, $4, $5, kc.quality_score,
            $6, $7::text[], $8, 'expert',
            'expert-curated', 'gold', false, kc.embedding
     FROM ask_ruvnet.kb_complete kc WHERE kc.id = $9
     ON CONFLICT (doc_id) DO NOTHING`,
    [docId, cleanTitle, `kb-complete/${entry.path}`, fileHash,
     entry.category, entry.knowledge_type, entry.concepts, summary, kbId]
  );

  const status = rows.length > 0 ? 'INSERTED' : 'EXISTS';
  console.log(`[${idx}/${total}] ${status} | ${cleanTitle.substring(0, 65)}`);
}

// Load digest
const digest = JSON.parse(readFileSync('docs/agentics-video-digest.json', 'utf8'));
const videos = digest.videos;
const topics = digest.key_topics_extracted;

// Build entries from videos with rich data
const entries = [];

// === INDIVIDUAL VIDEO ENTRIES (high/critical relevance only) ===
for (const v of videos) {
  if (!v.relevance || v.relevance === 'low') continue;

  const hasContent = v.description || (v.chapters && v.chapters.length > 0) || v.tags;
  if (!hasContent && v.relevance !== 'critical') continue;

  let content = `## Video: ${v.title}\n\n`;
  content += `Source: Agentics Foundation (${v.url})\n`;
  if (v.date) content += `Date: ${v.date}\n`;
  if (v.duration) content += `Duration: ${v.duration}\n`;
  content += `Relevance: ${v.relevance}\n\n`;

  if (v.description) {
    content += `## Summary\n${v.description}\n\n`;
  }

  if (v.chapters && v.chapters.length > 0) {
    content += `## Session Chapters\n`;
    v.chapters.forEach((ch, i) => { content += `${i + 1}. ${ch}\n`; });
    content += '\n';
  }

  if (v.tags && v.tags.length > 0) {
    content += `## Key Topics\n${v.tags.join(', ')}\n\n`;
  }

  if (v.transcript_preview) {
    content += `## Transcript Notes\n${v.transcript_preview}\n\n`;
  }

  const concepts = (v.tags || []).slice(0, 10).map(t => t.toLowerCase());
  if (concepts.length === 0) concepts.push('agentics', 'video');

  entries.push({
    path: `knowledge/videos/${v.id}`,
    title: v.title,
    category: 'videos',
    quality: v.relevance === 'critical' ? 95 : v.relevance === 'high' ? 90 : 80,
    knowledge_type: 'reference',
    concepts,
    content
  });
}

// === TOPIC SYNTHESIS ENTRIES (the extracted knowledge) ===

entries.push({
  path: 'knowledge/videos/topic-ruflo-v3-from-videos',
  title: 'Ruflo V3: Everything Revealed in Agentics Foundation Sessions',
  category: 'videos', quality: 97, knowledge_type: 'concept',
  concepts: ['claude flow', 'v3', 'architecture', 'agents', 'swarm', 'hooks', 'wasm', 'learning'],
  content: `## Ruflo V3 - Comprehensive Knowledge from Agentics Videos

Ruflo V3 has achieved ${topics.claude_flow_v3.downloads} downloads and ${topics.claude_flow_v3.github_stars} GitHub stars.

## Key Features (from video sessions)
${topics.claude_flow_v3.key_features.map(f => `- ${f}`).join('\n')}

## Architecture
- Core: ${topics.claude_flow_v3.architecture.core}
- Coordination: ${topics.claude_flow_v3.architecture.coordination}
- Memory: ${topics.claude_flow_v3.architecture.memory}
- Learning: ${topics.claude_flow_v3.architecture.learning}
- Visualization: ${topics.claude_flow_v3.architecture.visualization}
- Math: ${topics.claude_flow_v3.architecture.math}

## vs Competitors
${topics.claude_flow_v3.vs_competitors}

## Agent Limits and Workarounds
${topics.claude_flow_v3.agent_limits}

## Skills System
${topics.claude_flow_v3.skills_system}

## Source
Compiled from multiple Agentics Foundation video sessions (Oct 2025 - Jan 2026). Key sessions: "Claude-flow v3 Release" (1_xlre6ukc), "Building Intelligent Agents with Self-Learning Vector Systems" (1_392oe5oa), "Hive-Mind Intelligence" (1_nvkgdvm8).`
});

entries.push({
  path: 'knowledge/videos/topic-root-vector',
  title: 'Root Vector: The Intelligent Database Replacing pgvector',
  category: 'videos', quality: 95, knowledge_type: 'concept',
  concepts: ['root vector', 'ruvector', 'database', 'attention', 'learning', 'pgvector'],
  content: `## Root Vector - From Agentics Foundation Videos

${topics.root_vector.description}

## Features
${topics.root_vector.features.map(f => `- ${f}`).join('\n')}

## Technology Stack
${topics.root_vector.tech.map(t => `- ${t}`).join('\n')}

## Why It Matters
Root Vector (now RuVector) is not just a vector database -- it is an intelligent database with attention mechanisms that learns from queries. Unlike pgvector which just stores and searches vectors, Root Vector understands relationships between entries and improves its search quality over time.

## Source
From "Root Vector: Building the World's Fastest AI Search" and Global AI Hackathon sessions.`
});

entries.push({
  path: 'knowledge/videos/topic-prime-radiant',
  title: 'Prime Radiant: The Coherence Engine for AI Anti-Hallucination',
  category: 'videos', quality: 95, knowledge_type: 'concept',
  concepts: ['prime radiant', 'coherence', 'hallucination', 'verification', 'mathematical', 'rust'],
  content: `## Prime Radiant - From Agentics Foundation Videos

${topics.prime_radiant.description}

## Approach
${topics.prime_radiant.approach}

## Features
${topics.prime_radiant.features.map(f => `- ${f}`).join('\n')}

## Why It Matters
AI hallucination is one of the biggest unsolved problems. Models confidently state things that are false. The Prime Radiant solves this by replacing probabilistic confidence with mathematical determinism -- it can PROVE whether an output is correct, not just guess. This is critical for production AI systems where incorrect answers have real consequences.

## Source
From "Building the Prime Radiant: A Coherence Engine for AI Anti-Hallucination" (1_dxehuvpf).`
});

entries.push({
  path: 'knowledge/videos/topic-ai-symbolic-protocol',
  title: 'AI Symbolic Protocol: Reducing AI Spec Ambiguity from 40% to Under 2%',
  category: 'videos', quality: 93, knowledge_type: 'concept',
  concepts: ['symbolic protocol', 'ambiguity', 'specification', 'validation', 'lean4'],
  content: `## AI Symbolic Protocol - From Agentics Foundation Videos

Creator: ${topics.ai_symbolic_protocol.creator}
Purpose: ${topics.ai_symbolic_protocol.purpose}
Symbol Count: ${topics.ai_symbolic_protocol.symbols}

## Implementations
${topics.ai_symbolic_protocol.implementations.map(i => `- ${i}`).join('\n')}

## Why It Matters
When you write a specification for AI to implement, about 40% of the meaning is ambiguous -- the AI interprets it differently than you intended. The AI Symbolic Protocol uses 512 mathematical symbols to create specifications where less than 2% is ambiguous. This means AI implements what you ACTUALLY want, not its best guess.

## Source
From "Claude-flow v3 Release" session, presented by Brad Ross.`
});

entries.push({
  path: 'knowledge/videos/topic-beacon-disaster-rescue',
  title: 'Beacon: Wi-Fi Mesh Network for Disaster Rescue',
  category: 'videos', quality: 90, knowledge_type: 'concept',
  concepts: ['beacon', 'disaster', 'rescue', 'mesh', 'wifi', 'quantum'],
  content: `## Beacon Project - From Agentics Foundation Videos

Purpose: ${topics.beacon_project.purpose}

## Capabilities
${topics.beacon_project.capabilities.map(c => `- ${c}`).join('\n')}

## Specifications
- Cost: ${topics.beacon_project.cost}
- Security: ${topics.beacon_project.security}

## Why It Matters
Using commodity Wi-Fi hardware ($5-20 per device), Beacon can detect life signs through rubble after disasters -- breathing, heartbeat, movement at 0.1Hz resolution. The mesh network self-organizes without internet. Quantum-resistant algorithms protect the communication. This is AI technology saving lives.

## Source
From "Claude-flow v3 Release" session.`
});

entries.push({
  path: 'knowledge/videos/topic-emily-os',
  title: 'Emily OS: Orchestration Platform Scaling 2 to 100K Agents',
  category: 'videos', quality: 90, knowledge_type: 'concept',
  concepts: ['emily os', 'orchestration', 'agents', 'scaling', 'llm agnostic'],
  content: `## Emily OS - From Agentics Foundation Videos

${topics.emily_os.description}

## Features
${topics.emily_os.features.map(f => `- ${f}`).join('\n')}

## Why It Matters
Most agent orchestration systems top out at 10-15 agents. Emily OS scales from 2 to 100,000 agents by being LLM-agnostic (works with any AI model) and using one-to-many swarm communication patterns. It uses PostgreSQL with vector DB for state and Celery for task distribution. This is the scale needed for enterprise AI deployment.

## Source
From "Claude-flow v3 Release" session.`
});

entries.push({
  path: 'knowledge/videos/topic-fox-flow-database',
  title: 'Fox Flow: 12.8 Million QPS Vector Database (4,000x Redis)',
  category: 'videos', quality: 93, knowledge_type: 'concept',
  concepts: ['fox flow', 'database', 'performance', 'vector', 'quantization'],
  content: `## Fox Flow Database - From Agentics Foundation Videos

${topics.fox_flow_database.description}

## Performance
- QPS: ${topics.fox_flow_database.performance}
- Previous best: 3,000 QPS (Redis)
- Improvement: ~4,000x over Redis

## Features
${topics.fox_flow_database.features.map(f => `- ${f}`).join('\n')}

## Why It Matters
12.8 million queries per second is unprecedented for a vector database. For context, most vector databases handle thousands of QPS. Fox Flow achieves this through 1-bit quantization and "nuclear mode with shadow fox" -- techniques that compress vectors to their absolute minimum while maintaining search quality. Built by Colby, a community member.

## Source
From Agentics Foundation sessions.`
});

entries.push({
  path: 'knowledge/videos/topic-community-projects',
  title: 'Agentics Foundation: Community Projects and Global Chapters',
  category: 'videos', quality: 88, knowledge_type: 'reference',
  concepts: ['agentics', 'community', 'chapters', 'hackathon', 'global'],
  content: `## Agentics Foundation Community - From Video Sessions

## Global Chapters
${topics.community.chapters.map(c => `- ${c}`).join('\n')}

## Events
${topics.community.events}

## Hackathon Stats
${topics.community.hackathon_stats}

## Notable Community Projects

### Universe Simulation
${topics.universe_simulation.description}
Specs: ${topics.universe_simulation.specs}
Vectors: ${topics.universe_simulation.vectors}
Performance: ${topics.universe_simulation.performance}

### Neural Trading (NeuroTrader)
${topics.neural_trading.description}
Accuracy: ${topics.neural_trading.accuracy}
Latency: ${topics.neural_trading.latency}

### Multiverse Oracle
${topics.multiverse_oracle.description}
Specs: ${topics.multiverse_oracle.specs}

### Drone Swarm Mapping
${topics.drone_swarm.description}
Specs: ${topics.drone_swarm.specs}

### Smart City Traffic
${topics.smart_city_traffic.description}
Specs: ${topics.smart_city_traffic.specs}

### Microbiome Analysis
${topics.microbiome_analysis.description}
Specs: ${topics.microbiome_analysis.specs}
Discoveries: ${topics.microbiome_analysis.discoveries}

### QE Fleet
${topics.qe_fleet.description}
Specs: ${topics.qe_fleet.specs}

### OS Optimizer
${topics.os_optimizer.description}
Features: ${topics.os_optimizer.features.join(', ')}
Size: ${topics.os_optimizer.size}
Platforms: ${topics.os_optimizer.platforms}

## Source
Compiled from all Agentics Foundation video sessions (Oct 2025 - Jan 2026).`
});

entries.push({
  path: 'knowledge/videos/topic-hive-mind-architecture',
  title: 'Hive Mind Architecture: 1000+ Agent Distributed Superintelligence',
  category: 'videos', quality: 93, knowledge_type: 'concept',
  concepts: ['hive mind', 'distributed', 'superintelligence', 'agents', 'shared memory'],
  content: `## Hive Mind Architecture - From Agentics Foundation Videos

${topics.hive_mind_architecture.description}

## Specifications
${topics.hive_mind_architecture.specs}

## Why It Matters
The hive mind architecture breaks through the fundamental limitation of single AI models -- the context window. By distributing cognition across 1,000+ agents with shared memory and sub-millisecond latency, the system achieves "superintelligent" behavior where the whole is dramatically greater than any individual agent. No single agent needs to hold everything in context because the swarm collectively knows everything.

## How It Connects to Ruflo
Ruflo's hive-mind consensus system (available via the hive-mind CLI commands) implements a practical version of this architecture. Byzantine fault tolerance ensures correct decisions even if some agents malfunction. The queen-led hierarchical-mesh topology coordinates the distributed cognition.

## Source
From "Ruflo V3: Building AI Systems with Hive-Mind Intelligence" (1_nvkgdvm8).`
});

async function main() {
  console.log(`=== Video Knowledge Ingestion: ${entries.length} entries ===\n`);
  console.log('Loading ONNX model...');
  await getEmbedder();
  console.log('Ready.\n');

  const start = Date.now();
  let inserted = 0, skipped = 0, errors = 0;

  for (let i = 0; i < entries.length; i++) {
    try {
      await ingestEntry(entries[i], i + 1, entries.length);
      inserted++;
    } catch (err) {
      if (err.message.includes('duplicate') || err.message.includes('already exists')) {
        console.log(`[${i + 1}/${entries.length}] EXISTS | ${entries[i].title.substring(0, 65)}`);
        skipped++;
      } else {
        console.error(`[${i + 1}/${entries.length}] ERROR | ${err.message.substring(0, 100)}`);
        errors++;
      }
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const perEntry = ((Date.now() - start) / entries.length / 1000).toFixed(2);

  const { rows: [counts] } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM ask_ruvnet.kb_complete WHERE category = 'videos') as kb_videos,
      (SELECT COUNT(*) FROM ask_ruvnet.kb_complete WHERE category = 'teaching') as kb_teaching,
      (SELECT COUNT(*) FROM ask_ruvnet.kb_complete) as kb_total,
      (SELECT COUNT(*) FROM ask_ruvnet.architecture_docs WHERE doc_id LIKE 'kb-complete-%' AND source_authority = 'expert-curated') as arch_expert
  `);

  console.log(`\n=== Video Ingestion Complete ===`);
  console.log(`Time: ${elapsed}s (${perEntry}s per entry)`);
  console.log(`Inserted: ${inserted} | Skipped: ${skipped} | Errors: ${errors}`);
  console.log(`\nKB Totals:`);
  console.log(`  Videos: ${counts.kb_videos}`);
  console.log(`  Teaching: ${counts.kb_teaching}`);
  console.log(`  Total kb_complete: ${counts.kb_total}`);
  console.log(`  Expert-curated in architecture_docs: ${counts.arch_expert}`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
