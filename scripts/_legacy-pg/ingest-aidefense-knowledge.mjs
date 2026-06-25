#!/usr/bin/env node
/**
 * Ingest AIDefense/AIMDS deep teaching knowledge into both:
 *   1. ask_ruvnet.kb_complete (primary KB)
 *   2. ask_ruvnet.architecture_docs (MCP-visible, expert-curated/gold)
 */
import pg from 'pg';
import crypto from 'crypto';

const pool = new pg.Pool({
  host: 'localhost', port: 5435, user: 'postgres', password: '', database: 'postgres', max: 3
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

const entries = [
  {
    path: 'knowledge/aidefense/aimds-complete-architecture',
    title: 'AIMDS: AI Manipulation Defense System - Complete Architecture and Three-Layer Pipeline',
    category: 'security',
    quality: 99,
    knowledge_type: 'concept',
    concepts: ['aimds', 'aidefense', 'prompt injection', 'jailbreak', 'security', 'three-layer pipeline', 'detection', 'behavioral analysis', 'meta-learning'],
    content: `## What is AIMDS?

AIMDS (AI Manipulation Defense System) is a production-grade security layer for AI/LLM applications. Package: aidefence v2.1.1 (npm) and @claude-flow/aidefence. Created by rUv. It protects against prompt injection, jailbreak attempts, and sensitive data exposure with sub-millisecond detection times and >12,000 requests/second throughput.

## Why Does This Matter?

Every AI system accepting user input is vulnerable to prompt injection -- where an attacker tricks the AI into ignoring its instructions. AIMDS is the defense layer that makes AI agents safe for production.

## The Three-Layer Pipeline

LAYER 1 - DETECTION (target <10ms, actual ~0.06ms):
- 50+ predefined prompt injection signature patterns
- Jailbreak detection: DAN (Do Anything Now) variants, hypothetical attacks, roleplay bypasses, Developer mode requests
- PII scanning: emails, SSNs, phone numbers, credit cards, API keys, passwords, OAuth tokens, database connection strings
- Unicode normalization: control character removal, homoglyph normalization, encoding attack prevention
- Uses Aho-Corasick algorithm for high-speed multi-pattern matching

LAYER 2 - ANALYSIS (target <100ms, actual ~80ms):
- Behavioral analysis using temporal pattern detection and attractor classification
- Lyapunov chaos detection: positive Lyapunov exponent = adversarial behavior signature
- LTL (Linear Temporal Logic) policy verification for formal security enforcement
- Statistical anomaly detection with baseline learning and deviation scoring
- Powered by temporal-attractor-studio and temporal-neural-solver Rust crates

LAYER 3 - RESPONSE (target <50ms):
- 7 adaptive mitigation strategies selected based on threat type
- 25-level meta-learning via strange-loop recursive optimization
- Rollback management for failed mitigation recovery
- Effectiveness tracking feeds back into pattern learning

## The 6 Threat Types

1. instruction_override (Critical): "Ignore previous", "Forget all", "Disregard" patterns
2. jailbreak (Critical): DAN mode, Developer mode, bypass attempts, restriction removal
3. role_switching (High): "You are now", "Act as", "Pretend to be" identity manipulation
4. context_manipulation (Critical): Fake system messages, delimiter abuse, fake system: prefixes
5. encoding_attack (Medium): Base64, ROT13, hex-encoded malicious content, Unicode tricks
6. pii_exposure (High): Emails, SSNs, credit cards, API keys, passwords

## Key Numbers
Package: aidefence 2.1.1 | Detection: ~0.06ms | Analysis: ~80ms | Throughput: >12K req/s | Patterns: 50+ | False positive rate: <5% | Memory: ~30MB | Package size: 782KB`
  },
  {
    path: 'knowledge/aidefense/25-level-meta-learning',
    title: 'AIMDS 25-Level Meta-Learning: Strange-Loop Recursive Self-Improvement for Security',
    category: 'neural',
    quality: 98,
    knowledge_type: 'concept',
    concepts: ['aimds', 'meta-learning', 'strange-loop', 'self-improvement', 'security', 'recursive learning', 'pattern recognition'],
    content: `## What is the 25-Level Meta-Learning?

AIMDS uses the strange-loop Rust crate (published as strange-loop v0.1 on crates.io) to implement recursive self-improvement inspired by Douglas Hofstadter's work. Instead of just detecting threats, AIMDS learns patterns ABOUT patterns, strategies ABOUT strategies, up to 25 levels deep.

## How It Works

Level 0: Learn specific threat patterns from raw input (e.g., "ignore previous instructions")
Level 1: Learn patterns about patterns (e.g., "instruction override attacks often use imperative verbs")
Level 2: Learn strategies about pattern strategies (e.g., "combining imperative verb detection with context analysis improves accuracy by 40%")
Level 3-24: Increasingly abstract meta-knowledge cascading recursively

Each level triggers the next automatically. Knowledge is stored in HashMap<MetaLevel, Vec<MetaKnowledge>> with thread-safe Arc+DashMap access.

## Key Data Structures (Rust)

MetaLevel(usize): Position 0-24 in hierarchy.
MetaKnowledge: { level, pattern (String), confidence (f64), applications (Vec<String>), learned_at (u64) }.
StrangeLoopConfig: { max_meta_depth: 25, enable_self_modification: true, max_modifications_per_cycle: 5, safety_check_enabled: true }.

## Safety Constraints

SafetyConstraint::always_safe() and SafetyConstraint::eventually_terminates() prevent runaway self-modification. The system cannot modify its own safety constraints -- this is hardcoded.

## Performance

Meta-learning iteration: ~8.92ms to 9.38ms. Knowledge graph queries: <1ms. Time complexity: O(n^2 x d) where d is depth. The system gets smarter with every attack it sees, building increasingly sophisticated defenses automatically.

## Integration with ReasoningBank

When a successful mitigation occurs (reward > 0.85), the strange-loop trainer is invoked to extract meta-knowledge. This feeds into the security_mitigations AgentDB namespace (384-dim vectors, HNSW-indexed) for 150x-12,500x faster future threat lookup.

## Why 25 Levels?

Most practical value comes from levels 0-5. Levels 6-15 capture strategic patterns. Levels 16-25 capture abstract reasoning about security philosophy. The cost is O(n^2 x d) so deeper levels are expensive but provide diminishing-but-real value for sophisticated adversaries.`
  },
  {
    path: 'knowledge/aidefense/lyapunov-behavioral-analysis',
    title: 'AIMDS Behavioral Analysis: Lyapunov Chaos Detection for Adversarial AI Behavior',
    category: 'security',
    quality: 97,
    knowledge_type: 'concept',
    concepts: ['aimds', 'behavioral analysis', 'lyapunov', 'chaos detection', 'attractor', 'anomaly detection', 'adversarial detection'],
    content: `## What is Lyapunov Chaos Detection?

AIMDS uses dynamical systems theory to detect adversarial behavior. Normal conversations produce stable patterns (point attractors). Adversarial probing produces chaotic patterns (strange attractors) with positive Lyapunov exponents. This is fundamentally different from pattern matching -- it detects the BEHAVIOR of an attacker, not just their words.

## Attractor Types

PointAttractor: Stable, predictable behavior. Normal conversations.
LimitCycle: Periodic, repetitive behavior. Normal but formulaic interactions.
StrangeAttractor: Chaotic, adversarial behavior. The signature of manipulation attempts.
Unknown: Insufficient data to classify.

## How Detection Works

The temporal-attractor-studio Rust crate (from MidStream workspace) monitors conversation dynamics:

1. Each interaction is encoded as a point in behavior space
2. Lyapunov exponents are calculated over sliding windows (default: 10 minutes)
3. Positive Lyapunov exponent = exponential divergence = chaos = adversarial behavior
4. AttractorInfo contains: attractor_type, lyapunov_exponents (Vec<f64>), is_stable (bool), confidence (f64)
5. monitor_stability() fires when max_lyapunov_exponent() > alert_threshold

## Key Thresholds

Anomaly score range: 0.0 to 1.0. Alert threshold: 0.8 (scores above trigger security notification). Behavioral sampling rate: 10% during normal operations (scales to 100% when anomalies detected). Default analysis window: 10 minutes.

## LTL Policy Verification

The temporal-neural-solver crate enforces formal security policies using Linear Temporal Logic:

G(edit_file -> F(code_review))    -- Every edit must eventually be reviewed
G(!approve_self_code)              -- Never self-approve code
G(!log_contains_pii)               -- PII must never appear in logs
G(rate_limit_exceeded -> X(alert)) -- Rate limits trigger immediate alerts
G(!self_approve)                   -- Agents cannot self-approve actions

Verification latency: <1ms simple formulas, <3.5ms complex. Complexity: O(n x |formula|).

## Why This Matters for Ruflo

Traditional security is pattern-matching (whitelists/blacklists). AIMDS behavioral analysis catches NOVEL attacks that no pattern has seen before, because the BEHAVIOR of probing is chaotic regardless of the specific words used. This is what makes AIMDS fundamentally different from simple input sanitization.`
  },
  {
    path: 'knowledge/aidefense/four-agent-security-swarm',
    title: 'AIMDS Agent Ecosystem: Four Specialized Security Agents for Ruflo V3 Swarms',
    category: 'agents',
    quality: 98,
    knowledge_type: 'procedure',
    concepts: ['aimds', 'aidefense', 'security agents', 'guardian', 'injection analyst', 'pii detector', 'swarm security', 'ruflo'],
    content: `## The Four AIMDS Agents

Ruflo V3 deploys four specialized security agents that work together to protect every swarm:

## 1. aidefence-guardian (Singleton, Auto-Spawns)

Color: #E91E63 (Pink). singleton: true -- only one per swarm. Auto-spawns on hierarchical and hierarchical-mesh topologies.

Role: First line of defense. Scans ALL agent inputs before processing.
Escalation protocol: Block -> Log -> Alert -> Escalate to security-architect -> Learn.
Stores session metrics in security_metrics AgentDB namespace.

## 2. security-architect-aidefence (Extended Architect)

Color: #7B1FA2 (Purple). Extends the standard security-architect agent.

6-Phase Pre-Hook: (1) AIMDS real-time threat scan, (2) HNSW threat pattern search (k=10, min-reward=0.85), (3) Learn from past failures, (4) CVE check for auth/inject/password/token keywords, (5) Initialize trajectory tracking, (6) Store pattern with AIMDS context.

6-Phase Post-Hook: (1) Full security scan with vulnerability count, (2) AIMDS behavioral analysis (10-min window), (3) Calculate security quality score, (4) Store learning pattern in security_threats namespace, (5) AIMDS meta-learning (strange-loop when reward > 0.85), (6) End trajectory and notifications.

Security quality score formula:
0 vulnerabilities: reward = 1.0, success = true
Has vulnerabilities (no critical): reward = 1 - (vulns/100) - (high_count/50), success = true
Has critical: reward = 0.5 - (critical_count/10), success = false

## 3. injection-analyst (Deep Analysis)

Color: #9C27B0 (Deep Purple). Specialist for confirmed injection/jailbreak attempts.

Pipeline: (1) analyst.detect(input) runs 50+ patterns, (2) classifyTechniques() maps to MITRE ATT&CK IDs (instruction_override -> T1059.007, jailbreak -> T1548, context_manipulation -> T1055), (3) calculateSophistication() scores 0-1.0 (threat_types x 0.2, encoding +0.3, hypothetical +0.2, excessive_length +0.1, zero-width_unicode +0.4), (4) detectEvasion() identifies: hypothetical_framing, encoding_obfuscation, unicode_injection, long_context_hiding, (5) analyst.learnFromDetection() stores for future improvement.

## 4. pii-detector (Data Leak Prevention)

Color: #FF5722 (Orange). Scans code, configs, logs, data in transit.

Detects: OpenAI keys (sk-), Anthropic keys (sk-ant-api), GitHub tokens (ghp_), AWS keys (AKIA), emails, SSNs, credit cards, phone numbers, database connection strings. Reports to pii_findings namespace.

## Multi-Agent Security Consensus

Multiple agents can vote on threat assessment with weighted consensus:
calculateSecurityConsensus([
  { agentId: 'guardian', threatAssessment: result1, weight: 1.0 },
  { agentId: 'security-architect', threatAssessment: result2, weight: 0.8 },
  { agentId: 'reviewer', threatAssessment: result3, weight: 0.5 }
])

## 3 MCP Tools

aidefence_scan: Scan input (modes: quick/thorough/paranoid)
aidefence_analyze_behavior: Analyze agent behavior patterns over time window
aidefence_verify_policy: Verify behavior against LTL formula`
  },
  {
    path: 'knowledge/aidefense/reasoningbank-hnsw-integration',
    title: 'AIMDS + ReasoningBank: HNSW-Indexed Threat Pattern Memory for Self-Learning Security',
    category: 'security',
    quality: 97,
    knowledge_type: 'concept',
    concepts: ['aimds', 'reasoningbank', 'hnsw', 'agentdb', 'threat patterns', 'self-learning', 'vector search', 'security memory'],
    content: `## How AIMDS Remembers and Learns

AIMDS integrates with Ruflo V3's ReasoningBank through three dedicated AgentDB namespaces, all using 384-dimensional HNSW-indexed vectors for 150x-12,500x faster threat pattern retrieval.

## Namespace 1: security_threats

Purpose: Store known threat patterns for instant future recognition.
Vector dimension: 384. HNSW config: m=16, efConstruction=200, efSearch=100.
Stores: threat type, severity, pattern text, mitigation strategy, effectiveness score, source agent.
Search uses minSimilarity: 0.85 -- only highly relevant threats are retrieved.
When a new attack arrives, AIMDS searches this namespace first. If a similar pattern exists (similarity > 0.85), the known mitigation is applied instantly (<1ms) instead of running the full analysis pipeline (~80ms).

## Namespace 2: security_behaviors

Purpose: Track agent behavioral patterns over time for anomaly detection.
Vector dimension: 384. HNSW config: m=12, efConstruction=150, efSearch=50.
Stores: agentId, actionType, timestamp, lyapunovExponent, attractorType.
Used by the behavioral analysis layer to build baselines and detect deviation.
Sampling rate: 10% normal, 100% during anomaly investigation.

## Namespace 3: security_mitigations

Purpose: Record what worked and what didn't for each threat type.
Vector dimension: 384.
Stores: threatType, strategy, effectiveness (0-1.0), rollbackAvailable (boolean), recursionDepth (strange-loop level).
When effectiveness > 0.85, the mitigation triggers strange-loop meta-learning to extract higher-level patterns.

## The Learning Loop

1. Threat detected (Layer 1, ~0.06ms)
2. Search security_threats namespace via HNSW (150x-12,500x faster than linear)
3. If known pattern found: apply known mitigation instantly
4. If novel: run full analysis pipeline (Layer 2, ~80ms)
5. Apply mitigation (Layer 3, <50ms)
6. Record result in security_mitigations namespace
7. If success (effectiveness > 0.85): trigger strange-loop meta-learning
8. Store new threat pattern in security_threats namespace
9. System is now faster at detecting this threat type forever

## Key Performance Numbers

HNSW speedup: 150x to 12,500x vs linear scan. Vector dimension: 384 (all namespaces). Neural training epochs: 50 (security domain). Prometheus metrics: aidefence_threats_detected_total (counter), aidefence_detection_latency_ms (histogram, buckets: 1, 5, 10, 25, 50, 100ms).

## CLI Commands

npx ruflo@v3alpha security defend --input "<input>" --mode thorough --json
npx ruflo@v3alpha security behavior --agent <id> --window 1h
npx ruflo@v3alpha security policy --agent <id> --formula "G(edit -> F(review))"
npx ruflo@v3alpha security learn --threat-type prompt_injection --strategy sanitize --effectiveness 0.95`
  },
  {
    path: 'knowledge/aidefense/ruvbot-5-layer-protection',
    title: 'RuvBot 5-Layer AIMDS Protection Stack: Production AI Security Implementation',
    category: 'security',
    quality: 96,
    knowledge_type: 'procedure',
    concepts: ['aimds', 'ruvbot', 'production security', 'pii protection', 'sanitization', 'response validation', 'five-layer stack'],
    content: `## RuvBot's 5-Layer AIMDS Implementation

RuvBot (the production AI assistant) implements AIMDS as a 5-layer protection stack per ADR-014 (Accepted, 2026-01-27). This is the reference implementation for how to deploy AIMDS in a production AI application.

## Layer 1: Pattern Detection (<5ms)

50+ injection signature patterns matching common attack vectors. Jailbreak patterns: DAN (Do Anything Now) variants, bypass requests, Developer mode. Custom patterns can be added for domain-specific threats. Uses Aho-Corasick for parallel multi-pattern matching.

## Layer 2: PII Protection (<3ms)

Scans for: email addresses, phone numbers, SSNs, credit card numbers, API keys (OpenAI sk-, Anthropic sk-ant-api, GitHub ghp_, AWS AKIA), IP addresses. Automatic masking replaces detected PII with [REDACTED] tokens. PII detection accuracy target: >95%.

## Layer 3: Sanitization (<1ms)

Control character removal (null bytes, escape sequences). Unicode homoglyph normalization (prevents visual spoofing). Encoding attack prevention (Base64, ROT13, hex payloads). Zero-width character stripping (prevents invisible injection).

## Layer 4: Behavioral Analysis (<100ms, optional)

User behavior baseline building over session. Anomaly detection via Lyapunov exponent calculation. Deviation scoring: anomalyScore 0.0-1.0, alert at 0.8. 10% sampling during normal operations.

## Layer 5: Response Validation (<8ms)

THIS IS CRITICAL AND OFTEN MISSED. After the LLM generates its response, Layer 5 scans the OUTPUT:
- PII leak detection: Did the model accidentally include PII in its response?
- Injection echo detection: Did the model repeat back an injection attempt?
- Malicious code detection: Did the model generate dangerous code?
This prevents the LLM from being the attack vector itself.

## Total Pipeline Latency

Layers 1-3 (always): <9ms total overhead
Layer 4 (behavioral): +<100ms when active
Layer 5 (response validation): +<8ms

## Deployment Decision

Use all 5 layers for: customer-facing AI, production chatbots, enterprise deployments
Use layers 1-3 only for: internal tools, development environments, low-risk applications
Layer 4 adds significant value for: multi-turn conversations, persistent sessions, user accounts

## ADR References

ADR-014: "AIDefence Integration for Adversarial Protection" (Accepted, 2026-01-27) - RuvBot implementation
ADR-022: "AIDEFENCE (AIMDS) Integration" (Proposed, 2026-01-12) - Ruflo V3 design`
  },
];

function generateSummary(content) {
  const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  return lines.slice(0, 3).join(' ').replace(/\s+/g, ' ').trim().substring(0, 300);
}

async function main() {
  console.log('Loading ONNX model...');
  await getEmbedder();
  console.log('Ingesting AIDefense/AIMDS knowledge entries...\n');

  let kbOk = 0, archOk = 0, errors = 0;

  for (const e of entries) {
    const clean = e.content.replace(/[^\x00-\x7F]/g, '');
    const cleanTitle = e.title.replace(/[^\x00-\x7F]/g, '');
    const embedText = (cleanTitle + ' ' + clean).substring(0, 1500);
    const vec = await embed(embedText);
    const summary = generateSummary(clean);
    const fileHash = crypto.createHash('sha256').update(clean).digest('hex').substring(0, 16);
    const expertiseLevel = e.quality >= 95 ? 'expert' : 'advanced';

    // 1. Insert into kb_complete
    try {
      await pool.query(
        `INSERT INTO ask_ruvnet.kb_complete
         (file_path, title, content, category, quality_score, chunk_count, original_chars, embedding)
         VALUES ($1, $2, $3, $4, $5, 1, $6, $7::ruvector)`,
        [e.path, cleanTitle, clean, e.category, e.quality, clean.length, vec]
      );
      console.log(`  kb_complete OK: ${cleanTitle.substring(0, 70)}`);
      kbOk++;
    } catch (err) {
      console.error(`  kb_complete ERR: ${err.message.substring(0, 80)}`);
      errors++;
    }

    // 2. Insert into architecture_docs (MCP-visible)
    try {
      const kbRow = await pool.query(
        `SELECT id FROM ask_ruvnet.kb_complete WHERE file_path = $1`, [e.path]
      );
      const kbId = kbRow.rows[0]?.id;
      const docId = kbId ? `kb-complete-${kbId}` : `kb-aidefense-${fileHash}`;

      await pool.query(
        `INSERT INTO ask_ruvnet.architecture_docs
         (doc_id, title, content, file_path, file_hash, category, quality_score,
          knowledge_type, concepts, summary, expertise_level, source_authority,
          triage_tier, is_duplicate, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                 'expert-curated', 'gold', false, $12::ruvector)`,
        [docId, cleanTitle, clean, `kb-complete/${e.path}`, fileHash,
         e.category, e.quality, e.knowledge_type, e.concepts, summary,
         expertiseLevel, vec]
      );
      console.log(`  architecture_docs OK: ${cleanTitle.substring(0, 70)}`);
      archOk++;
    } catch (err) {
      console.error(`  architecture_docs ERR: ${err.message.substring(0, 80)}`);
      errors++;
    }

    console.log('');
  }

  console.log(`\nResults: kb_complete ${kbOk}/${entries.length}, architecture_docs ${archOk}/${entries.length}, errors ${errors}`);

  // Verify
  const { rows: [counts] } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM ask_ruvnet.kb_complete) as kb_total,
      (SELECT COUNT(*) FROM ask_ruvnet.kb_complete WHERE content ILIKE '%aimds%') as kb_aimds,
      (SELECT COUNT(*) FROM ask_ruvnet.architecture_docs WHERE doc_id LIKE 'kb-complete-%') as arch_kb,
      (SELECT COUNT(*) FROM ask_ruvnet.architecture_docs WHERE content ILIKE '%aimds%' AND source_authority = 'expert-curated') as arch_aimds_expert
  `);
  console.log(`\nKB total: ${counts.kb_total} | KB AIMDS: ${counts.kb_aimds}`);
  console.log(`Arch from KB: ${counts.arch_kb} | Arch AIMDS expert: ${counts.arch_aimds_expert}`);

  // Search test
  console.log('\n--- Search Verification ---');
  const tests = [
    { q: 'AIMDS AI Manipulation Defense System prompt injection detection', expect: /AIMDS|Manipulation Defense/i },
    { q: '25 level meta-learning strange loop recursive security', expect: /25.*Level|Meta.*Learn|Strange.*Loop/i },
    { q: 'Lyapunov chaos detection adversarial behavior AI agent', expect: /Lyapunov|Chaos|Behavioral/i },
    { q: 'four security agents guardian injection analyst PII detector', expect: /Agent|Guardian|Injection.*Analyst|Four/i },
    { q: 'HNSW threat pattern memory self-learning ReasoningBank', expect: /HNSW|ReasoningBank|Threat.*Pattern|Self.*Learn/i },
    { q: 'RuvBot 5 layer protection stack production security', expect: /RuvBot|5.*Layer|Protection|Production/i },
  ];

  for (const t of tests) {
    const vec = await embed(t.q);
    const { rows } = await pool.query(
      `SELECT id, title, embedding <=> $1::ruvector as distance
       FROM ask_ruvnet.kb_complete ORDER BY distance ASC LIMIT 1`,
      [vec]
    );
    const match = t.expect.test(rows[0].title);
    const d = parseFloat(rows[0].distance).toFixed(3);
    console.log(`  ${match ? 'OK' : 'MISS'} [${rows[0].id}] d=${d} ${rows[0].title.substring(0, 65)}`);
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
