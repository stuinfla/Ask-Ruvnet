import pg from 'pg';
import { pipeline } from '@xenova/transformers';
import crypto from 'crypto';

const pool = new pg.Pool({
  host: 'localhost', port: 5435, user: 'postgres',
  password: 'guruKB2025', database: 'postgres'
});

let embedder;
async function embed(text) {
  if (!embedder) embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  const out = await embedder(text, { pooling: 'mean', normalize: true });
  return '[' + Array.from(out.data).join(',') + ']';
}

// Video chapter data extracted via browser from Agentics Foundation Video Portal
// Each video's AI-generated chapter summaries provide detailed knowledge
const entries = [
  // ═══════════════════════════════════════════════════════════════
  // VIDEO 1: Claude-flow v3 Release (14 chapters) - 1_xlre6ukc
  // ═══════════════════════════════════════════════════════════════
  {
    path: 'videos/cf-v3-release-architecture',
    title: 'Ruflo V3 Architecture: Agents, Workers, and Real-Time Learning',
    content: `From the Claude-flow v3 Release presentation (video.agentics.org):

Ruflo V3 uses a sophisticated architecture with agents and workers operating in latent space. The system features vector and graph implementations for storage and learning. Key architectural components include:

Agent Booster: Reroutes edits locally to save tokens, avoiding unnecessary API calls for simple operations.

Model Routing: Decides between Haiku, Sonnet, and Opus 4.5 in under half a millisecond. Can also route to local models with fine-tuning capabilities. This means the system automatically picks the cheapest model that can handle each specific task.

Micro LoRA Learning: Trains models during actual use, meaning the system gets smarter the more you use it. Small adapter layers are trained on your specific patterns without modifying the base model.

Security Infrastructure: Defense system with threat detection in 0.04 milliseconds. Real-time PII stripping before data hits Claude. Jailbreak monitoring and protection built in.

Hooks System: 27 hooks in different categories (pre, post, edit) that enable learning at every stage. The trajectory learning strategy records outcomes as neural pathways, creating an anti-black-box system where every step is tracked and optimized.

Migration: System preserves memory when migrating from v2 to v3, so you dont lose what the system has already learned.

Workers operate in background without hitting the main LLM directly, using hierarchical mesh coordination between agents. The system provides a constant feedback loop for learning, functioning as a prosthetic to human intelligence.

Source: Agentics Foundation Global AI Hackathon
Tags: ruflo v3, architecture, agents, workers, model routing, LoRA`,
    category: 'videos',
    quality: 98,
    knowledge_type: 'reference',
    concepts: ['ruflo-v3', 'agent-architecture', 'model-routing', 'micro-lora', 'hooks-system']
  },
  {
    path: 'videos/cf-v3-release-security-hooks',
    title: 'Ruflo V3 Security and Self-Learning Hooks System',
    content: `From the Claude-flow v3 Release presentation:

The security and hooks infrastructure forms the learning backbone of Ruflo V3.

Security Layer:
- AI defense system provides real-time threat detection in microseconds
- PII stripping happens before any data reaches Claude, protecting personal information
- Jailbreak monitoring prevents prompt injection attacks
- Obfuscation of personal identifiable information at the system level

Hooks System (27 hooks across categories):
Pre-hooks fire before operations, post-hooks fire after, edit hooks fire during modifications. Each hook can trigger learning. The learn strategy tracks trajectory and outcomes as neural pathways.

What makes this special: Every step is recorded and optimized. When something works, the system remembers the pattern. When something fails, it learns to avoid that path. This creates an anti-black-box system where you can trace exactly how decisions were made.

Background Workers handle:
- Security checks continuously running
- Drift monitoring to catch agents going off-track
- Code quality and repetition detection
- Internal dialogue system for agent guidance

The system also supports export and sharing of features and memories, enabling hybrid learning across multiple repositories. If you solve a problem in one project, that knowledge can transfer to other projects.

Source: Claude-flow v3 Release video, Chapters 3 and 6`,
    category: 'videos',
    quality: 98,
    knowledge_type: 'reference',
    concepts: ['security', 'hooks-system', 'self-learning', 'pii-protection', 'drift-monitoring']
  },
  {
    path: 'videos/cf-v3-release-visualization-math',
    title: 'Hyperbolic Space Visualization and Mathematical Foundations in Ruflo',
    content: `From the Claude-flow v3 Release presentation:

Real-Time AI Visualization:
Ruflo V3 includes a visualization system that represents AI operations in hyperbolic space rather than traditional Euclidean planes. This is significant because hyperbolic space can represent hierarchical relationships more naturally - think of it like a tree that keeps branching, where each level has exponentially more room.

In the visualization:
- Dots represent conceptual groupings and neighborhoods
- The latent space is shown with vector basis points
- Graph neural network interconnections are visible
- The spin represents pi as a grounding constant

Mathematical Foundation:
The system uses prime numbers and odd numbers for optimal quantization. Seven is identified as the optimal number for model shrinking - it provides the best balance between compression and information preservation.

Harmonic relationships between mathematical constants provide the grounding that prevents hallucinations. Time crystals provide frequency-based measurement for temporal operations.

The fractal structure throughout means patterns repeat at different scales - the same coordination principles work whether you have 3 agents or 300.

Why this matters for learning: Traditional AI systems use flat vector spaces. By using hyperbolic geometry, Ruflo can represent complex hierarchies (like code dependencies, organizational structures, or knowledge trees) much more efficiently. A vector in hyperbolic space encodes both the item AND its relationship to everything above and below it in the hierarchy.

Source: Claude-flow v3 Release video, Chapter 7`,
    category: 'videos',
    quality: 98,
    knowledge_type: 'reference',
    concepts: ['hyperbolic-space', 'visualization', 'mathematical-foundations', 'prime-numbers', 'fractals']
  },
  {
    path: 'videos/cf-v3-release-emily-os',
    title: 'Emily OS: Multi-Agent Orchestration Platform',
    content: `From the Claude-flow v3 Release presentation:

Emily OS is an orchestration layer presented by John Martin that manages agents in a one-to-many swarm approach.

Key Architecture:
- Top orchestration layer that sits above individual agents
- Manages agents in swarm-based approach where agents communicate with neighbors
- One-to-many communication: agents talk left and right to their neighbors, not just up to a coordinator
- Handles workload distribution and crash recovery automatically

LLM Agnostic:
- Works with Claude, Gemini, GPT through MCP connections or direct CLI commands
- Can scale from 2 agents to 100,000 agents
- This means you can use whatever AI model works best for each specific task

Technical Stack:
- Complete Python implementation
- PostgreSQL and vector database for memory
- Celery for task orchestration (a distributed task queue)
- JSON tagging for agent identification
- Autonomous task handling without constant human supervision

What makes Emily OS different from Ruflo: Emily OS focuses on being the top-level coordinator that manages MULTIPLE orchestration systems. Ruflo might handle one swarm, but Emily OS can manage multiple swarms, each using different models and strategies. Think of it as the manager of managers.

Source: Claude-flow v3 Release video, Chapter 8`,
    category: 'videos',
    quality: 97,
    knowledge_type: 'reference',
    concepts: ['emily-os', 'orchestration', 'multi-agent', 'llm-agnostic', 'scalability']
  },
  {
    path: 'videos/cf-v3-release-ai-symbolic-protocol',
    title: 'AI Symbolic Protocol: Mathematical Language for Zero-Ambiguity AI Specs',
    content: `From the Claude-flow v3 Release presentation:

Brad Ross presented the AI Symbolic Protocol (AISP), a mathematical language designed to eliminate ambiguity in AI specifications.

The Problem:
English has roughly 40% ambiguity - words have multiple meanings, sentences can be interpreted different ways. When you give an AI instructions in English, there is always room for misinterpretation. Over multiple iterations (like a game of telephone), this ambiguity compounds and outputs drift from the original intent.

The Solution:
AISP uses 512 pure mathematical symbols that ALL LLMs understand natively. Mathematical symbols have single, deterministic meanings. 2+2 always equals 4, no matter who reads it or how many times its copied.

Results:
- Reduces ambiguity from 40% to under 2%
- Object detection efficiency jumped from 30% to 80% when using AISP specs
- Used successfully for a Harvard capstone project
- Deterministic specifications prevent the telephone game problem

Technical Implementation:
- Open source ASP implementation available
- NPM validation package for AISP
- Rust WASM compilation completed for browser use
- Lean 4 integration for formal mathematical proofs
- Supports creativity and short story generation (not just technical specs)

Why you should care: If youre building anything complex with AI agents, ambiguity is your enemy. Every time an instruction passes from one agent to another, ambiguity compounds. AISP ensures that specifications stay precise through any number of handoffs.

Source: Claude-flow v3 Release video, Chapter 9`,
    category: 'videos',
    quality: 98,
    knowledge_type: 'reference',
    concepts: ['ai-symbolic-protocol', 'mathematical-language', 'ambiguity-reduction', 'deterministic-specs']
  },

  // ═══════════════════════════════════════════════════════════════
  // VIDEO 2: Building Agentic Systems at Scale (key chapters from 24)
  // ═══════════════════════════════════════════════════════════════
  {
    path: 'videos/scale-adr-methodology',
    title: 'ADRs: Architectural Decision Records for Building Complex Systems Fast',
    content: `From Building Agentic Systems at Scale presentation:

ADRs (Architectural Decision Records) are Reuvens approach to development that provides guidance for building complex systems quickly.

What is an ADR?
An ADR captures a specific architectural choice - why it was made, what alternatives were considered, and what consequences it has. Unlike PRDs (Product Requirements Documents) that define WHAT to build and WHY, ADRs capture HOW to build it correctly.

How they prevent drift:
- ADRs are linear with dependencies on other ADRs
- Each ADR references previous ones
- This creates anti-drift mechanisms that keep systems focused
- Prevents duplication and encourages code reuse
- Currently on ADR 25 in Ruflo V3

ADR vs PRD vs DDD:
- PRD (Product Requirements Document): Defines what and why
- ADR (Architectural Decision Record): Captures specific architectural choices
- DDD (Document Driven Design): Human-readable descriptions of already-built systems to guide AI implementation

Practical example:
Reuven creates a GitHub branch, spawns a swarm to implement ADRs 13-25 with instructions for full implementation, testing, verification, optimization, and documentation. The swarm watches for regressions, uses modular components and WASM where possible, and conducts deep security reviews.

Why ADRs matter for vibe coders: When you are working with AI to build software, the AI needs clear architectural guidance. Without ADRs, each AI session might make different architectural choices, leading to an inconsistent codebase. ADRs ensure every session builds on the same foundations.

Source: Building Agentic Systems at Scale video, Chapters 8, 11, 13`,
    category: 'videos',
    quality: 98,
    knowledge_type: 'reference',
    concepts: ['adr', 'architecture', 'anti-drift', 'prd', 'ddd']
  },
  {
    path: 'videos/scale-rue-optimizer',
    title: 'Rue Optimizer: Self-Learning OS-Level AI System',
    content: `From Building Agentic Systems at Scale presentation:

The Rue Optimizer is a system that infiltrates the PCs internal workings to provide self-learning, auto-optimizing capabilities.

Technical Implementation:
- 5MB Rust runtime with embedded Three.js and HTML
- Real-time optimization of memory, CPU, and GPU resources
- Works across Windows, Mac, and Linux systems
- Startup optimizer predicts which apps youll need using Markov chains
- Memory leak detection finds and fixes leaks automatically
- Thermal awareness adjusts performance based on device temperature

WASM Technology:
- Cross-platform compatibility with minimal file sizes
- 2KB for simple algorithms
- 850KB for full RueVector systems
- Same code runs on browser, desktop, and embedded devices

Desktop Automation:
- Agentic system can control operating system workings and applications
- Uses visual-based models to learn by watching users
- Autonomously operates applications after observing patterns
- Similar to how Cloud Flow browser system learns websites through trial and error

FlowNexus Integration:
FlowNexus connects all intelligence systems in real-time. It aggregates information from Cloud Flows, computers, and servers using RueVector to compress and extract only the parts that accelerate other work. Essentially a personal knowledge brain that spans all your devices.

Source: Building Agentic Systems at Scale video, Chapters 7, 9, 10, 15`,
    category: 'videos',
    quality: 97,
    knowledge_type: 'reference',
    concepts: ['rue-optimizer', 'wasm', 'self-learning', 'os-optimization', 'flow-nexus']
  },

  // ═══════════════════════════════════════════════════════════════
  // VIDEO 3: Prime Radiant (key chapters from 16)
  // ═══════════════════════════════════════════════════════════════
  {
    path: 'videos/prime-radiant-coherence-engine',
    title: 'The Prime Radiant: A Coherence Engine That Prevents AI Hallucinations',
    content: `From the Building the Prime Radiant presentation:

The Prime Radiant is a mathematical system that answers one question: Does everything still fit together logically?

The Problem with Traditional AI:
Traditional AI uses confidence scores to tell you how sure it is about an answer. But confidence scores can be wrong - an AI can be 99% confident about something completely false. This is the hallucination problem.

The Prime Radiant Approach:
Instead of asking "how confident am I?", the Prime Radiant asks "does this answer fit with everything else I know?" It checks structural coherence - like checking if a puzzle piece fits by looking at all its edges, not just guessing.

How it works:
- Uses mathematical principles based on prime numbers and pi constants
- Grounds confidence in mathematics rather than asking the language model
- Takes a different approach by checking if everything makes sense together through a web of interconnected proofs
- Each step of thinking can be verified independently

Named after Isaac Asimov:
In Asimovs Foundation series, the Prime Radiant displays mathematical equations of psychohistory showing how changes propagate through complex systems. Similarly, this Prime Radiant shows how changes in one part of your AI system affect everything else.

Practical Implementation:
- Deployed using a swarm of 12 agents to implement, test, validate, benchmark, and optimize
- Generated approximately 35,000 lines of code
- Uses hierarchical mesh strategy for agent coordination
- Integrated with RUV LLM for 100% verifiable results

The Recursive Language Model (RLM):
Built on Mistral RS backend, RLM breaks down complex questions and searches memory for answers by replacing the context window with custom vector and graph storage. This provides infinite context without the limitations of a fixed context window.

Source: Building the Prime Radiant video, Chapters 3, 4, 5, 8, 10, 11, 12`,
    category: 'videos',
    quality: 99,
    knowledge_type: 'reference',
    concepts: ['prime-radiant', 'coherence-engine', 'anti-hallucination', 'mathematical-verification', 'rlm']
  },
  {
    path: 'videos/prime-radiant-transformers',
    title: 'Novel Transformer Architectures from Coherence Engine Principles',
    content: `From the Building the Prime Radiant presentation:

Reuven has created dozens of new transformer architectures using the intersection of attention and MinCut-style attention. These are not standard transformers - they are built from coherence engine principles.

Coherence Transformer:
- Optimizes for edge computing and energy efficiency
- Most tokens do NOT need full attention - coherence energy decides what computation to skip
- Token-level routing determines which tokens actually need processing
- Attention sparsity inspired by mathematical coherence theory

Why this matters:
Traditional transformers process every token with equal computational effort. But most of a sentence is predictable context - only a few tokens carry the actual new information. The coherence transformer identifies which tokens matter and focuses compute there, dramatically reducing energy and cost.

Efficiency Philosophy:
The Agentic Foundation focuses on being computationally minimal rather than throwing massive GPU resources at problems. As Reuven explains: OpenAI, Anthropic, and others use a lazy approach by throwing massive computational resources at problems. The foundation focuses on being efficient at the mathematical and algorithmic level.

Routing Accuracy:
The Rue Ultra agent learns from outcomes and improves over time. The routing accuracy benchmark works by:
1. Embedding the task description
2. Using HNSW to find similar past tasks
3. Picking the right agent through keyword routing
4. Learning from outcomes to improve future routing

Source: Building the Prime Radiant video, Chapters 9, 13, 14, 15`,
    category: 'videos',
    quality: 97,
    knowledge_type: 'reference',
    concepts: ['transformer-architecture', 'coherence-transformer', 'edge-computing', 'attention-sparsity', 'routing']
  },

  // ═══════════════════════════════════════════════════════════════
  // VIDEO 4: Network Topologies and Skills
  // ═══════════════════════════════════════════════════════════════
  {
    path: 'videos/network-topologies-skills',
    title: 'Network Topologies, Skill Aggregation, and QE Fleet Deep Dive',
    content: `From Building Agentic Systems: Network Topologies presentation:

Network Topology Analysis:
Detailed analysis of star, mesh, ring, and hierarchical architectures for agent communication. Different topologies affect throughput, latency, and system efficiency across workflows including swarms, orchestrators, and debate scenarios.

Skill Aggregation (Ryan Smith):
Ryan Smiths innovative tool curates over 14,000 vetted skills from GitHub repositories. This enables intelligent skill discovery and composition - instead of building from scratch, you find and combine existing skills.

QE Fleet (Dragon):
A comprehensive quality engineering system built on Ruflo that orchestrates 51 specialized agents across 12 domains. Each domain is lazily loaded only when needed, significantly reducing resource usage.

Key Technical Insights:
- Pre-training and tiny dancer routing optimize agent selection
- Prime Radiant mathematics power coherence layers
- Opus outperforms Sonnet for complex tasks despite higher costs
- AVX-512 instructions optimize hardware performance
- Custom firmware development for thermal management
- Publishing research as prior art protection for IP

Model Selection Strategy:
The presentation demonstrates why using the most expensive model isnt always the answer, but for complex tasks (architecture, security, debugging), Opus significantly outperforms cheaper models. The tiny dancer router automatically picks the right model tier for each task.

Source: Building Agentic Systems: Network Topologies video`,
    category: 'videos',
    quality: 98,
    knowledge_type: 'reference',
    concepts: ['network-topology', 'skill-aggregation', 'qe-fleet', 'model-selection', 'avx-512']
  },

  // ═══════════════════════════════════════════════════════════════
  // VIDEO 5: Root Vector (key chapters from 21)
  // ═══════════════════════════════════════════════════════════════
  {
    path: 'videos/root-vector-gnn-system',
    title: 'Root Vector: Graph Neural Networks That Replace Traditional LLMs',
    content: `From the Root Vector: Building the Worlds Fastest AI Search presentation:

Root Vector is a groundbreaking system combining hypergraph structures with ultra-fast vector systems. Unlike language models that predict the next token, Root Vector uses mathematical graph structures for learning and adaptation.

Core Innovation:
- Hypergraph + vector hybrid: Combines the relationship-modeling power of graphs with the speed of vector operations
- Does NOT predict tokens like an LLM - uses mathematical relationships instead
- Episodic memory compresses data by up to 96%
- Processes 3 billion DNA base pairs in under 100 milliseconds
- Query responses in microseconds

Cost Revolution:
Using Root Vector architecture reduces monthly operational costs from $30-40 million to just $1.7 million for global-scale learning systems. This is because you dont need massive GPU clusters - the mathematical approach runs efficiently on standard hardware.

GNN Implementation:
- Completely dynamic hidden layers that learn and adapt
- The index itself applies attention mechanisms
- Addresses previous GNN limitations like over-smoothing
- Pruning system removes noise, hallucinated content, and outliers

Federated Learning:
- Respects privacy regulations like GDPR
- Data stays where it is - only patterns and relationships are shared
- Semantic routing through Tiny Dancer components
- Self-verification eliminates hallucinations through mathematical foundations

Security Applications:
Built the worlds fastest CVE security introspection and analysis system. The system applies pattern matching, correlation, and hidden signal detection to security vulnerabilities.

Source: Root Vector video, Chapters 4, 5, 7, 13, 14, 19`,
    category: 'videos',
    quality: 99,
    knowledge_type: 'reference',
    concepts: ['root-vector', 'graph-neural-networks', 'hypergraph', 'federated-learning', 'cve-analysis']
  },
  {
    path: 'videos/root-vector-benchmarking',
    title: 'Root Vector Development: Benchmarking, Integration, and Testing Methodology',
    content: `From the Root Vector presentation:

Benchmarking Methodology:
Reuvens comprehensive benchmarking approach proves system functionality and performance through thousands of test scenarios. The SPARC-driven development methodology includes: Specification, Pseudocode, Architecture, Refinement, Completion.

Rather than relying on peer review, the approach focuses on solving problems reliably multiple times. If the system can solve a problem correctly 1000 times in a row, thats more reliable than one human reviewing it once.

Agentic Flow + Ruflo Integration:
- Agentic Flow provides core intelligence as a module
- Ruflo provides the orchestration layer
- Together they allow spawning agent swarms using different API providers
- Careful management of API keys and cost optimization

Data Input Best Practices:
- Parsing is the computationally heavy part, happening BEFORE the systems ultra-fast processing
- Pre and post-parsing are critical for understanding data workflow
- Millisecond-level performance after parsing is complete
- The system creates pluggable modules that can be mixed and matched

Tensor Compression:
A recently released algorithm distills knowledge while preserving information structure. This enables:
- Faster processing through smaller representations
- Reduced RAM usage
- Better data handling for large datasets
- Compression without losing the relationships between data points

Cache-to-Cache Communication:
Research on cache-to-cache conversation between LLMs where models communicate through KV cache rather than generating tokens. This is a more direct form of model interaction happening in latent space before token generation.

Source: Root Vector video, Chapters 8, 9, 15, 16, 17, 18`,
    category: 'videos',
    quality: 97,
    knowledge_type: 'reference',
    concepts: ['benchmarking', 'sparc', 'agentic-flow', 'tensor-compression', 'cache-communication']
  },

  // ═══════════════════════════════════════════════════════════════
  // VIDEO 6: OS-Level Automation (key chapters from 34)
  // ═══════════════════════════════════════════════════════════════
  {
    path: 'videos/os-automation-skills-deep-dive',
    title: 'Skills Deep Dive: Structure, Composition, and Agent Integration',
    content: `From OS-Level Automation and Agentic Systems presentation (34 chapters):

Skills vs Agents:
Skills are reusable instruction packages that guide agent behavior. Agents are the execution engines that follow those instructions. Think of skills as recipes and agents as chefs.

Skill Design Principles:
- Keep skills narrow and focused for better reusability
- Small, tight skills that agents use to accomplish tasks
- Meta skills can reference other skills for modular composition
- Skills can be transferred between Claude Desktop, Claude Code, and Claude Web via zip files

Skill Optimization:
- Assign appropriate models based on task requirements
- Cheaper models for skills that dont need heavy thinking
- Skill performance is tracked and optimized in real-time
- Structured data directs LLM behavior through skills

Building Skills:
- Anyone can create reusable skills by pointing to repositories
- Skills contain rules, memory, and information within them
- Progressive discovery finds relevant sections within large skill sets
- Skills can reference vectors directly in databases for adaptive grounding

Quality Assurance Through Skills:
Complex skill workflows include context interrogation, pattern guidance, and quality validation. The system uses guides, manifests, and agents to ensure code quality and adherence to standards.

Parallel Agent Execution:
- 15 agent parallel limit in Claude Code
- Sub-agents and headless instances can scale to thousands
- Swarm composition allows agents to coordinate without a central bottleneck

Grounding and Validation:
RueVector and CloudFlow provide mathematical grounding independent of the LLM. The system never asks the LLM to validate its own output - that would be like asking someone to grade their own test.

Source: OS-Level Automation video, Chapters 12-31`,
    category: 'videos',
    quality: 98,
    knowledge_type: 'reference',
    concepts: ['skills', 'agent-composition', 'meta-skills', 'parallel-execution', 'grounding']
  },
  {
    path: 'videos/os-automation-optimizer',
    title: 'OS-Level AI Optimizer: Self-Learning System Management',
    content: `From OS-Level Automation and Agentic Systems presentation:

The comprehensive OS optimizer works on both Mac and Windows with self-learning capabilities.

Features:
- Real-time performance monitoring across CPU, GPU, memory
- Thermal-aware scheduling adjusts workload based on device temperature
- GPU memory optimization for unified RAM systems (especially Mac M-series)
- Application launch prediction using learned patterns
- Registry management on Windows
- Firmware optimization capability

Security Integration:
- Ransomware mitigation through real-time monitoring and rollback
- Sub-millisecond attack detection and response
- Can detect and respond to threats before they execute

Distributed Computing:
- Offload heavy jobs (like Rust builds) to cloud or local machines
- EdgeNet for sharing GPU and CPU compute across networks
- Portable optimization that works across platforms

AGI Inc Computer Use Agents:
Div Garg and Jacob from AGI Inc presented universal computer use agents that control phones, PCs, and browsers. These agents:
- Perform complex tasks like shopping and booking appointments
- Make autonomous decisions to achieve goals
- Handle multi-step processes across multiple websites
- Maintain accuracy through testing and evaluation

Compliance Automation:
Andreas Frederick presented a platform for automating compliance in Europe using agentic systems. The platform monitors regulations, generates knowledge graphs, and helps companies implement complex regulatory requirements with agent-certified specialists.

Source: OS-Level Automation video, Chapters 3-11`,
    category: 'videos',
    quality: 97,
    knowledge_type: 'reference',
    concepts: ['os-optimizer', 'security', 'distributed-computing', 'computer-use', 'compliance']
  },

  // ═══════════════════════════════════════════════════════════════
  // VIDEO 7: CloudFlow V3 community session
  // ═══════════════════════════════════════════════════════════════
  {
    path: 'videos/cloudflow-v3-community-projects',
    title: 'CloudFlow V3 Community: QE Fleet, Beacon, Token Optimization',
    content: `From CloudFlow V3 and Agentic Systems presentation:

Tiny Dancer Token Optimization:
Tiny Dancer reduces CloudFlow token usage by routing requests to local AST editors and local models instead of always using Claude. A custom half-billion parameter model is being trained to handle edits and syntax work locally. The system uses pre-training and neural components to decide which operations need the full LLM and which can be handled cheaply.

Why this matters: Token costs are the biggest expense in running AI systems. By routing 60-80% of operations to local models, you cut costs dramatically while maintaining quality for the operations that actually need it.

Dragons QE Fleet Migration:
Dragon migrated from V2 to V3 using ADRs and DDD principles. He organized 12 quality engineering domains with lazy loading - domains only activate when needed. This significantly reduced memory footprint and startup time.

Beacon Disaster Rescue:
Matt presents Beacon, a Wi-Fi mesh system for locating trapped people in disasters. Uses Wi-Fi sensing to detect vital signs through rubble with half-meter granularity. Can distinguish between multiple people and detect breathing patterns and heartbeat. Operates on solar/battery power for extended deployment.

Bill Sentry Medical Billing:
Mark, a doctor with 30 years in AI, built Bill Sentry to help hospitals maximize reimbursement by properly coding patient severity. Incorporates nearly 100% of billing codes and rules using Claude reasoning.

Theme Sentry WordPress Security:
Lyle built a 4-stage security scanning pipeline for WordPress themes: ClamAV malware detection, custom unified scanner with seeding, WordFence CVE scanning, and AI-powered contextual analysis.

Source: CloudFlow V3 video, Chapters 2-7`,
    category: 'videos',
    quality: 97,
    knowledge_type: 'reference',
    concepts: ['tiny-dancer', 'token-optimization', 'qe-fleet', 'beacon', 'community-projects']
  },

  // ═══════════════════════════════════════════════════════════════
  // VIDEO 8: Super Intelligence and Edge Computing
  // ═══════════════════════════════════════════════════════════════
  {
    path: 'videos/super-intelligence-edge-chips',
    title: 'Edge Computing Revolution: Custom AI Chips and the Nervous System Architecture',
    content: `From Super Intelligence Through Human-AI Integration presentation:

Moving from Software to Hardware:
Reuven presents his work on designing edge-optimized chips with a nervous system architecture. The key insight is that current AI hardware (GPUs) are designed for training, not for the kind of efficient inference that agentic systems need.

Ruflo V3 Stats:
- Complete rewrite with 265,000 lines of code
- Incorporates vector memory and background agents
- Agents learn and optimize without constant human supervision
- Already achieving significant adoption in alpha

Contract-Driven Development (Colin Byrne):
A methodology where specifications are converted into executable tests that BLOCK commits violating contracts. This prevents code drift by making it impossible to merge code that breaks architectural rules. Think of it as guardrails that are enforced automatically.

MinCut Algorithm:
A theoretical breakthrough that enables deterministic analysis by examining the negative space and integrity gaps. Instead of asking what IS in the data, you ask whats MISSING. This differs from probabilistic approaches because it provides definitive answers about system integrity.

Philosophy: Cogito Creo Codex
Latin for "I think, I create, I build" - embedded in the tools themselves. Represents the belief that anything that can be thought can be built, and the tools should make that journey as direct as possible.

Source: Super Intelligence video, Chapters 2-5, 8`,
    category: 'videos',
    quality: 98,
    knowledge_type: 'reference',
    concepts: ['edge-computing', 'chip-design', 'mincut', 'contract-driven-dev', 'nervous-system']
  },

  // ═══════════════════════════════════════════════════════════════
  // VIDEO 9: Additional high-value descriptions (no chapters)
  // ═══════════════════════════════════════════════════════════════
  {
    path: 'videos/cf-v3-self-learning-vectors',
    title: 'Ruflo V3: Self-Learning Vector Systems and Modular Architecture',
    content: `From Ruflo V3: Building Intelligent Agents with Self-Learning Vector Systems:

Ruflo V3 is a complete rebuild featuring modular architecture and integrated self-learning capabilities. It leverages Rue Vector technology - a sophisticated graph-meets-vector learning system - to enable autonomous background agents that optimize code without consuming API credits.

Key innovations covered:
- Status line system tracks development progress through ADRs
- Hook-based architecture for invoking specialized agents
- Pre-training mechanisms learn from historical project data
- Security validation runs continuously
- Performance optimization through self-reinforcement learning
- Swarm-based agent collaboration with internal dialogue systems

Modular Design Philosophy:
The modular approach contains bugs within individual packages, preventing system-wide failures. If one component breaks, only that component is affected. This is critical for production reliability.

Community Features:
- Federation across multiple development environments
- Transfer learning between projects via IPFS
- Community-driven model sharing
- Applications beyond development: Windows optimization, automated system management

With 2,500 downloads in alpha phase, Ruflo V3 represents a significant evolution in AI-assisted development, offering accessibility for general users and deep customization for advanced developers.

Source: Ruflo V3: Building Intelligent Agents video`,
    category: 'videos',
    quality: 97,
    knowledge_type: 'reference',
    concepts: ['self-learning', 'modular-architecture', 'transfer-learning', 'ipfs', 'federation']
  },
  {
    path: 'videos/hyperbolic-vectors-edge',
    title: 'Hyperbolic Vector Spaces and Edge Computing for Efficient AI',
    content: `From Ruflo V3: Building AI Systems with Hyperbolic Vector Spaces:

This presentation covers the architecture behind self-learning systems, mixture-of-experts routing, and hyperbolic vector spaces for efficient information storage and retrieval.

Key demonstrations:
- Bioacoustic signal processing for detecting life under rubble
- Thermal optimization for embedded systems
- Dynamic model selection reducing API usage by up to 250%

Enterprise Adoption:
Enterprises are replacing entire coding toolsets with Ruflo V3. Real examples include legacy system migrations from COBOL to Rust completed in a single afternoon. This demonstrates that the system handles not just new development but migration of decades-old codebases.

Modular Plugin System:
- Hierarchical mesh coordination for multi-agent swarms
- Specialized micro-models optimized for specific tasks
- Production-ready agent swarms that operate independently
- Significantly reduced token consumption and operational costs

The presentation includes live demonstrations of Ruflo V3 installation, configuration, and spawning production-ready agent swarms without continuous monitoring.

Source: Ruflo V3: Hyperbolic Vector Spaces video`,
    category: 'videos',
    quality: 97,
    knowledge_type: 'reference',
    concepts: ['hyperbolic-vectors', 'edge-computing', 'mixture-of-experts', 'enterprise-migration', 'micro-models']
  },
  {
    path: 'videos/robotics-agentdb-neural-trading',
    title: 'Robotics OS Rewrite, AgentDB, and Neural Trading Algorithms',
    content: `From: From Concept to Code presentation:

ROS Rewrite in Rust:
Complete rewrite of ROS (Robotic Operating System) in Rust and MPX, featuring zero-RTT connections for sub-100 millisecond latency - faster than human reaction times. This demonstrates how agentic systems can handle real-time robotics.

AgentDB Capabilities:
AgentDB enables vectorized temporal hypergraph machine learning. This combines:
- Vector operations for fast similarity search
- Temporal awareness for time-series data
- Hypergraph structures for complex multi-way relationships
- All running at microsecond speeds

Claude Deep Research:
Claudes deep research capabilities can generate comprehensive PRDs (Product Requirements Documents) in hours, replacing weeks of manual specification work. The system coordinates millions of concurrent operations.

Practical Open-Source Tools:
- Agentic Flow: Core agent orchestration
- Research Swarm: Multi-agent research coordination
- Neural Trading: Algorithms for financial applications

Key principle: Speed trumps broad expensive brute force GPUs and quantum. The foundation proves that efficient algorithms on standard hardware outperform expensive GPU clusters for many AI workloads.

Source: From Concept to Code video`,
    category: 'videos',
    quality: 96,
    knowledge_type: 'reference',
    concepts: ['robotics', 'agentdb', 'neural-trading', 'rust', 'zero-rtt']
  },
  {
    path: 'videos/agentic-ai-revolution-india',
    title: 'Agentic AI Revolution: Global Community Building and Real-World Applications',
    content: `From Agentic AI Revolution: Building Autonomous Intelligent Systems (19 chapters):

What is Agentic AI:
Agentic AI systems are autonomous, proactive, and can think, reason, adapt, and self-learn without constant human interaction. This is fundamentally different from chatbots that only respond when asked.

Agentics Foundation:
A global non-profit with over 100,000 community members worldwide. Operates on open-source model with MIT license. Organizes hackathons with real-world challenges and educational opportunities.

Real-World Applications Demonstrated:
- Healthcare app supporting 22 languages including Assamese, built with Servan AI
- Education initiatives in Marjuli (worlds biggest river island) for underprivileged areas
- Security architecture audit reports generated automatically
- E-commerce with Stripe integration built in 2 hours
- Property registration with cost accounting

Plot Flow Orchestration:
An orchestration engine that enables building swarms of agents with memory and learning loops. Provides the infrastructure for agents to work together, make mistakes, learn from them, and improve.

Skills and Quality Engineering:
Reusable skills created by community members enable building applications without starting from scratch. Quality engineering approaches ensure reliability across all community-built tools.

Key Message: AI problems must be solved locally with local knowledge. The Foundation enables each region to build AI solutions for their own unique needs.

Source: Agentic AI Revolution video, 19 chapters`,
    category: 'videos',
    quality: 96,
    knowledge_type: 'reference',
    concepts: ['agentic-ai', 'community', 'healthcare', 'education', 'plot-flow']
  },

  // ═══════════════════════════════════════════════════════════════
  // VIDEO 10: Hackathon and Media Discovery
  // ═══════════════════════════════════════════════════════════════
  {
    path: 'videos/hackathon-media-discovery-root-vector',
    title: 'Global AI Hackathon: Root Vector, Cinesphere, and Ethical AI',
    content: `From Building the Future: AI-Powered Media Discovery at the Global AI Hackathon:

The inaugural Global AI Hackathon brought 80 registered participants across 29 active forks to tackle intelligent media recommendation systems.

Cinesphere:
A geolocation-based platform that maps where movies were filmed and connects viewers to related content through spatial and cultural contexts. Instead of recommending based on what you watched, it recommends based on WHERE content was created and your physical location.

Root Vector in Action:
An intelligent database system that replaces PostgreSQLs PG Vector extension with advanced attention mechanisms. Enables real-time learning and adaptive recommendations without exposing personal data. Integrated with Samsung Smart TVs for practical demonstration.

Hyperbolic Embeddings + Graph Neural Networks:
Participants developed solutions integrating hyperbolic embeddings and graph neural networks with self-learning mechanisms built directly into database infrastructure. This means the database itself gets smarter over time.

Privacy and Ethics:
- EU regulations on emotional manipulation addressed
- Data sovereignty maintained - personal data never leaves the users device
- Federated learning ensures privacy while enabling personalization
- Ethical AI development principles embedded in architecture

The hackathon demonstrated that AI-powered recommendation systems can be both powerful AND respectful of user autonomy.

Source: Building the Future: AI-Powered Media Discovery video`,
    category: 'videos',
    quality: 96,
    knowledge_type: 'reference',
    concepts: ['hackathon', 'cinesphere', 'root-vector', 'privacy', 'ethical-ai']
  }
];

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
  if (rows.length > 0) { kbId = rows[0].id; }
  else {
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

  console.log(`[${idx+1}/${total}] ${cleanTitle} (${entry.category})`);
}

async function main() {
  console.log(`Starting video chapter ingestion: ${entries.length} entries`);
  const t0 = Date.now();
  for (let i = 0; i < entries.length; i++) {
    await ingestEntry(entries[i], i, entries.length);
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nDone! ${entries.length} entries in ${elapsed}s`);

  const { rows: [{ count }] } = await pool.query('SELECT COUNT(*) as count FROM ask_ruvnet.kb_complete');
  const { rows: [{ vcount }] } = await pool.query("SELECT COUNT(*) as vcount FROM ask_ruvnet.kb_complete WHERE category = 'videos'");
  console.log(`KB total: ${count} entries (${vcount} video entries)`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
