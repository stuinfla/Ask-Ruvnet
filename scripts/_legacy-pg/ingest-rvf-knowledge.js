#!/usr/bin/env node
/**
 * RVF Knowledge Base Ingestion Script
 * Created: 2026-02-20 | Version 1.0.0
 *
 * Inserts 10 carefully crafted RVF (RuVector Format) knowledge entries into
 * the ask_ruvnet.kb_complete table in the ruvector-postgres instance.
 *
 * Each entry is teaching-quality content explaining architecture, integration
 * patterns, and practical how-to guidance for RVF cognitive containers.
 *
 * USAGE:
 *   node scripts/ingest-rvf-knowledge.js
 *
 * AUTH:
 *   Auth via ~/.pgpass (no inline passwords). Optionally set PGPASSWORD env var.
 *
 * DATABASE:
 *   Host: localhost, Port: 5435, User: postgres, DB: postgres
 *   Table: ask_ruvnet.kb_complete
 */

'use strict';

const { Client } = require('pg');

// ---------------------------------------------------------------------------
// Database connection config — auth via ~/.pgpass, never inline passwords
// ---------------------------------------------------------------------------
const DB_CONFIG = {
  host: 'localhost',
  port: 5435,
  user: 'postgres',
  database: 'postgres',
  // password: intentionally omitted — resolved via ~/.pgpass or PGPASSWORD env
  connectionTimeoutMillis: 10000,
  statement_timeout: 60000,
};

// ---------------------------------------------------------------------------
// INSERT query — uses ruvector_embed() with the correct ruvector cast pattern.
// ruvector_embed() returns real[], which must be cast to ruvector via the
// array_to_string bracket notation: ('[' || array_to_string(arr,',') || ']')::ruvector
// ---------------------------------------------------------------------------
const INSERT_SQL = `
  INSERT INTO ask_ruvnet.kb_complete
    (file_path, title, content, category, quality_score, chunk_count, original_chars, embedding)
  VALUES
    ($1, $2, $3, $4, $5, $6, $7,
     ('[' || array_to_string(ruvector_embed(LEFT($2 || ' ' || $3, 1500)), ',') || ']')::ruvector)
  RETURNING id, title;
`;

// ---------------------------------------------------------------------------
// Knowledge entries — 10 deep, teaching-quality RVF articles
// ---------------------------------------------------------------------------
const ENTRIES = [

  // -------------------------------------------------------------------------
  // Entry 1: RVF Core Concepts & Philosophy
  // -------------------------------------------------------------------------
  {
    file_path: 'github.com/ruvnet/ruvector/crates/rvf/01-core-concepts.md',
    title: 'RVF Cognitive Container: Core Concepts & Philosophy',
    category: 'vector-db',
    quality_score: 98,
    content: `## What Is RVF?

RVF (RuVector Format) is frequently misunderstood on first encounter. It is NOT a database, NOT a model format, and NOT a container image — it is a universal binary substrate: a single file that merges all of those concepts into one self-contained, self-describing, cryptographically attested execution unit.

The clearest mental model: think of an RVF file as a "cognitive container." Just as a Docker image bundles an OS userland + application into a portable unit, an RVF file bundles a vector database + AI model weights + graph engine + operating kernel + cryptographic proof chain into a portable unit — one that can boot itself anywhere, query itself anywhere, and prove every operation it has ever performed.

## What a Single .rvf File Can Do

A single RVF file simultaneously:

1. **Stores vector embeddings** — Native HNSW index with temperature-tiered quantization (fp16 hot, PQ warm, binary cold). No external database required.
2. **Carries LoRA adapter deltas** — Stores parameter-efficient fine-tuning overlays (OVERLAY_SEG) so the file IS the fine-tuned model, not just data about it.
3. **Embeds GNN graph state** — GRAPH_SEG stores graph neural network topology alongside the vector data, enabling graph-aware retrieval.
4. **Includes a bootable Linux microkernel** — KERNEL_SEG embeds a unikernel (Nanos or custom) that can boot in Firecracker microVMs, QEMU, bare metal, or TEE enclaves.
5. **Runs queries in a 5.5 KB WASM runtime** — The rvf-wasm crate compiles the entire query engine to WebAssembly so the same file runs in a browser tab with zero backend.
6. **Proves every operation through a cryptographic witness chain** — WITNESS_SEG maintains a tamper-evident hash-linked audit trail of every ingest, query, and deletion.
7. **Filters queries via eBPF** — EBPF_SEG embeds eBPF bytecode for Linux kernel-level XDP/TC acceleration, achieving sub-microsecond hot cache hits.

## Why This Matters Architecturally

Traditional AI stacks are deeply fragmented: you need a vector database (Pinecone, Qdrant), a model serving layer (vLLM, TGI), a graph DB (Neo4j), audit infrastructure (separate logging), and deployment tooling (Kubernetes, Docker). Each component has its own operational burden, network hops, and failure modes.

RVF collapses this stack. The file IS the database, IS the model, IS the audit trail, IS the deployment unit. A knowledge base that previously required 5 running services now ships as a single file you can scp to an edge device.

## Runtime Targets — The Same File, Everywhere

The same .rvf file runs unmodified across:
- **Servers** — Full HNSW index + kernel tier via rvf-server (REST + TCP)
- **Browsers** — 5.5 KB WASM runtime via rvf-wasm / @ruvector/rvf-wasm npm package
- **Edge devices** — no_std builds via rvf-types and rvf-wire crates
- **TEE enclaves** — Intel SGX, AMD SEV-SNP, Intel TDX, ARM CCA attestation
- **Firecracker microVMs** — Lightweight VM boot via rvf-launch
- **Linux kernel data path** — eBPF XDP/TC via rvf-ebpf crate

This "write once, run anywhere" property is possible because each segment type is independently optional and forward-compatible: a reader that does not understand KERNEL_SEG simply skips it and still serves vector queries.

## Project Scale & Provenance

RVF is the core format powering the ruvector ecosystem:
- **Repository**: github.com/ruvnet/ruvector
- **License**: MIT / Apache-2.0 dual license
- **Scale**: ~64,000 lines of Rust across 22 crates
- **Test suite**: 1,156 tests passing
- **Runtime crate**: rvf-runtime 0.2.0 (crates.io)
- **npm package**: @ruvector/rvf 0.1.0 (TypeScript SDK)

The format was designed by ruvnet as the foundational primitive for the entire agentic AI toolchain — from ruflo v3's memory system to the WASM knowledge base applications described in the accompanying architecture documents in this knowledge base.

## Key Insight for Practitioners

When you encounter an RVF file in the wild, the right question is not "what database does this connect to?" but rather "what tier of this file do I need right now?" The same bytes answer queries in a browser (WASM tier), accelerate a Linux kernel (eBPF tier), and boot a secure enclave (unikernel tier). The cognitive container adapts to its execution environment rather than requiring the environment to adapt to it.`,
  },

  // -------------------------------------------------------------------------
  // Entry 2: RVF WASM Runtime — Browser KB Apps
  // -------------------------------------------------------------------------
  {
    file_path: 'github.com/ruvnet/ruvector/crates/rvf/rvf-wasm/02-wasm-runtime.md',
    title: 'RVF WASM Runtime: Building Browser-Based Knowledge Base Apps',
    category: 'performance',
    quality_score: 98,
    content: `## The Core Proposition: Zero-Backend Knowledge Bases

The rvf-wasm crate enables something that was previously impractical: a fully functional vector knowledge base running entirely inside a browser tab. No API server, no cloud subscription, no network latency for queries. The user downloads a .rvf file (or it loads from a CDN), and the WASM runtime bootstraps the entire query engine locally.

This is not a stripped-down demo capability — the WASM runtime includes the full HNSW approximate nearest-neighbor search, the progressive loading system, and the same query interface as the server-side runtime.

## WASM Binary Sizes

Two compilation profiles exist, trading size for capability:

**Profile 1: Tile Microkernel (Cognitum target)**
- Size: ~5.5 KB compressed
- Role: WasmRole::Microkernel
- Target: WasmTarget::Browser, WasmTarget::Embedded
- Capabilities: Vector query routing, progressive layer A loading (70% recall immediately), minimal footprint for IoT/edge

**Profile 2: Full Control Plane**
- Size: ~46 KB compressed
- Role: WasmRole::Interpreter
- Target: WasmTarget::Browser, WasmTarget::Node, WasmTarget::Edge
- Capabilities: Full HNSW query (all three progressive layers), in-memory store management, COW branch awareness, temperature-tiered retrieval

The 46 KB full profile is smaller than a typical thumbnail image, making it practical to inline as a data URI or load as a background script without impacting page performance.

## Browser Integration: Code Walkthrough

The npm package @ruvector/rvf-wasm exposes a clean async API:

\`\`\`javascript
// 1. Import and initialise the WASM module (downloads ~46 KB once, cached)
import init, { WasmRvfStore } from '@ruvector/rvf-wasm';
await init();

// 2. Create or open a store — 384 dimensions matches OpenAI/Anthropic embeddings
const store = WasmRvfStore.create(384);

// 3. Insert a vector with metadata
const vec = new Float32Array(384).fill(0.1); // replace with real embedding
store.insert(vec, JSON.stringify({ id: 'doc-1', title: 'Introduction' }));

// 4. Query — returns top-k nearest neighbours with cosine similarity scores
const results = store.query(queryVec, 5);
for (const result of results) {
  const meta = JSON.parse(result.metadata);
  console.log(meta.title, result.score);
}

// 5. Serialize to bytes for persistence (save to IndexedDB or download as .rvf)
const bytes = store.serialize();
localStorage.setItem('kb-snapshot', btoa(String.fromCharCode(...bytes)));
\`\`\`

## Self-Bootstrapping Stack

The WASM execution model is genuinely self-bootstrapping:

\`\`\`
Raw bytes (.rvf file)
  → ArrayBuffer in browser memory
  → WASM interpreter decodes segment headers
  → Microkernel initialises memory allocator
  → INDEX_SEG loaded into WASM linear memory
  → HNSW graph reconstructed from segments
  → VEC_SEG vectors mapped into vector store
  → Query API ready for calls
\`\`\`

This entire boot sequence completes in under 1 ms for the tile microkernel profile. The full 46 KB profile boots in under 5 ms even on low-end hardware.

## Building the WASM Binary from Source

\`\`\`bash
# Add the WASM compilation target to your Rust toolchain
rustup target add wasm32-unknown-unknown

# Build the tile microkernel (5.5 KB)
cargo build -p rvf-wasm --target wasm32-unknown-unknown --release --features microkernel

# Build the full control plane (46 KB)
cargo build -p rvf-wasm --target wasm32-unknown-unknown --release

# Output: target/wasm32-unknown-unknown/release/rvf_wasm.wasm
# Use wasm-pack or wasm-bindgen to generate JS glue + .d.ts types
wasm-pack build crates/rvf/rvf-wasm --target web --out-dir pkg
\`\`\`

## WasmRole and WasmTarget Enums

Understanding these two enums is key to choosing the right compilation profile:

**WasmRole** — what the WASM module does:
- \`Interpreter\`: Full query engine with HNSW (46 KB profile)
- \`Microkernel\`: Minimal routing and boot logic (5.5 KB profile)
- \`Solver\`: Specialised for constraint/optimisation queries

**WasmTarget** — where the WASM module runs:
- \`Browser\`: Standard browser WASM with DOM access
- \`Node\`: Node.js via @ruvector/rvf-node N-API bindings
- \`Edge\`: Cloudflare Workers, Deno Deploy, etc.
- \`Embedded\`: Microcontrollers with WASM runtime (e.g. WAMR)

## Progressive Loading in the Browser

The three-tier progressive HNSW system (covered in depth in the indexing entry) applies fully in the browser. On initial load:

1. Layer A (coarse graph, ~70% recall) loads first — users can start querying immediately
2. Layer B (hot region graph, ~85% recall) loads in the background
3. Layer C (full graph, ~95% recall) loads last

This means a 50MB knowledge base feels instant: the user gets answers within milliseconds of opening the page, with accuracy improving silently in the background.

## Integration with Ruflo V3

The WASM runtime is the foundation for ruflo v3's browser-side KB applications. When a ruflo researcher agent builds a knowledge base, it can compile the output as a WASM-deployable .rvf file. The final artefact deploys to a CDN as a single file — no database server, no backend API, no infrastructure to maintain.

This pattern is detailed further in the "Ruflo V3 + RVF Integration Strategy" entry.`,
  },

  // -------------------------------------------------------------------------
  // Entry 3: RVF Architecture — 24-Segment Binary Format
  // -------------------------------------------------------------------------
  {
    file_path: 'github.com/ruvnet/ruvector/crates/rvf/03-binary-format.md',
    title: 'RVF Architecture: 24-Segment Binary Format Deep Dive',
    category: 'architecture',
    quality_score: 96,
    content: `## The Segment Model: Self-Describing Binary Blocks

An RVF file is a sequence of typed segments. Each segment is independently self-describing, 64-byte aligned, independently integrity-checked, and independently skippable by readers that do not understand its type. This design achieves two critical properties simultaneously: backwards compatibility (old readers skip new segment types) and forward extensibility (new capabilities ship as new segment types without breaking existing files).

Think of it like a TIFF or PNG file format — a chain of typed chunks — but purpose-built for AI workloads with cryptographic integrity and compute capability baked in.

## The 64-Byte Segment Header

Every segment begins with a 64-byte header:

\`\`\`
Offset  Size  Field
------  ----  -----
0       4     magic: 0x52564653 ("RVFS" in ASCII)
4       2     version: format version (currently 1)
6       2     type: SegmentType enum (see below)
8       4     flags: compression, encryption, etc.
12      8     segment_id: unique u64 identifier
20      8     payload_length: bytes following this header
28      8     timestamp_ns: nanosecond creation timestamp
36      1     checksum_algo: 0=BLAKE3, 1=SHA256, 2=xxHash3
37      1     compression: 0=none, 1=zstd, 2=lz4, 3=brotli
38      2     reserved
40      4     content_hash[0..4]: first 4 bytes of full hash
44      20    content_hash[4..24]: remaining hash bytes
\`\`\`

The magic bytes 0x52564653 ("RVFS") allow instant file identification. The checksum covers the payload only; the header has its own integrity mechanism via the content_hash field.

## All 24 Segment Types

**Core Data Segments**
- \`MANIFEST_SEG (0x01)\` — Root index: vector count, dimension, HNSW params, segment directory
- \`VEC_SEG (0x02)\` — Raw vector data: packed float arrays (fp32/fp16/int8)
- \`INDEX_SEG (0x03)\` — HNSW graph: adjacency lists, layer assignments, entry point

**AI / Model Segments**
- \`OVERLAY_SEG (0x10)\` — LoRA adapter deltas: base model ID, rank r, alpha, delta weights
- \`GRAPH_SEG (0x11)\` — GNN topology: nodes, edges, adjacency, GNN-specific metadata
- \`SKETCH_SEG (0x12)\` — Count-Min Sketch: frequency tracking for temperature-tiered quantization

**COW Branching Segments**
- \`COW_MAP (0x20)\` — Copy-on-write cluster map: maps cluster IDs to owning segments
- \`REFCOUNT (0x21)\` — Reference counts per cluster: enables garbage collection
- \`MEMBERSHIP (0x22)\` — Branch visibility filter: bitmap of which vectors belong to this branch
- \`DELTA (0x23)\` — Sparse patch: changed clusters only (used for LoRA overlays and COW diffs)

**Security / Attestation Segments**
- \`WITNESS_SEG (0x30)\` — Audit chain: hash-linked tamper-evident operation log
- \`CRYPTO_SEG (0x31)\` — Key material: ML-DSA-65 public keys, Ed25519 keys, TEE certificates

**Compute Segments**
- \`KERNEL_SEG (0x40)\` — Unikernel binary: bootable microkernel image
- \`EBPF_SEG (0x41)\` — eBPF bytecode: XDP/TC programs for kernel-level acceleration
- \`WASM_SEG (0x42)\` — WASM binary: query engine for browser/edge execution

**Solver / Policy Segments**
- \`TRANSFER_PRIOR (0x50)\` — Bayesian transfer learning prior
- \`POLICY_KERNEL (0x51)\` — Governance rules for AGI container authority levels
- \`COST_CURVE (0x52)\` — Resource budget curves for agent execution limits

**Lineage / Provenance Segments**
- \`LINEAGE_SEG (0x60)\` — DNA-style file identity: unique ID, parent ID, parent hash
- \`TRANSFORM_SEG (0x61)\` — Transformation log: how this file was derived from its parent
- \`PLATFORM_SEG (0x62)\` — Hardware attestation: TEE quotes from SGX/SEV-SNP/TDX

## Crash Safety: Append-Only with Two-Fsync Protocol

RVF never modifies existing bytes. All writes are append-only using a two-fsync protocol:

1. Write new segment payload to file
2. fsync() — ensure payload is durable
3. Write new MANIFEST_SEG pointing to new segment
4. fsync() — ensure manifest is durable

If a crash occurs between steps 2 and 4, the old manifest is still valid. The file rolls back to the previous consistent state automatically on next open. There is no WAL (write-ahead log), no journal, no recovery process — the append-only structure IS the crash safety mechanism.

## Root Manifest Location: Fast Cold Boot

The root manifest is always in the last 4096 bytes of the most recent MANIFEST_SEG. Locating it requires a single \`seek(EOF)\` followed by a backward scan of at most 4096 bytes. This enables cold boot in under 5 ms for typical files, with the benchmark achieving 1.6 microseconds in practice.

## Forward Compatibility

Old readers encountering an unknown segment type (e.g., a future \`0x70\` type) read the payload_length from the 64-byte header and skip exactly that many bytes. No parser state machine, no version negotiation — just skip unknown types and continue. This means RVF files written with future segment types remain fully readable by today's readers for all segments they understand.

## Domain Profiles: Specialised File Extensions

Five domain profiles provide semantic hints to tooling:
- \`.rvf\` — Generic / universal
- \`.rvdna\` — Genomic data (high-dimensional, sparse)
- \`.rvtext\` — Language model knowledge (dense, semantic)
- \`.rvgraph\` — Graph neural network data
- \`.rvvis\` — Vision embeddings (CLIP-style)

The extension changes nothing about the binary format — a .rvdna file is a valid .rvf file — but it signals to tooling which domain-specific optimisations to apply by default.`,
  },

  // -------------------------------------------------------------------------
  // Entry 4: RVF SDK & Package Ecosystem
  // -------------------------------------------------------------------------
  {
    file_path: 'github.com/ruvnet/ruvector/crates/rvf/04-sdk-ecosystem.md',
    title: 'RVF SDK & Package Ecosystem: Rust Crates, npm Packages & MCP Server',
    category: 'vector-db',
    quality_score: 95,
    content: `## Overview: A Full-Stack Ecosystem in One Repository

The RVF ecosystem ships as a cohesive multi-language SDK covering every layer of the stack: low-level Rust crates for performance-critical code, npm packages for JavaScript/TypeScript integration, library adapters for popular AI frameworks, and an MCP server for AI agent integration. Understanding which layer to reach for in which situation saves significant integration time.

## Rust Crates (14 on crates.io)

The crates are stratified by dependency depth. Start at the bottom (no_std compatible) and build up:

**Foundation Layer (no_std, embedded-safe)**
- \`rvf-types\` — Core type definitions: SegmentType enum, header structs, error types. Zero dependencies, no_std compatible. Use this when you only need to parse headers without reading payloads.
- \`rvf-wire\` — Binary serialisation / deserialisation for all 24 segment types. no_std compatible. The primitive all other crates build on.

**Storage Layer**
- \`rvf-manifest\` — MANIFEST_SEG read/write, segment directory management, root manifest location (seek-to-EOF strategy)
- \`rvf-quant\` — Vector quantisation: fp32→fp16, product quantisation (PQ), binary quantisation. Includes temperature-tier assignment logic using Count-Min Sketch frequency data.
- \`rvf-index\` — HNSW graph construction and query, three-tier progressive loading (Layer A/B/C), temperature-tiered retrieval routing

**Security Layer**
- \`rvf-crypto\` — Witness chain construction (WITNESS_SEG), ML-DSA-65 (FIPS 204) post-quantum signatures, Ed25519 signatures, TEE attestation quote parsing (SGX, SEV-SNP, TDX, CCA), KernelBinding footer generation

**Compute Layer**
- \`rvf-kernel\` — Unikernel image embedding (KERNEL_SEG), KernelBinding 128-byte footer, 7-step fail-closed boot verification
- \`rvf-ebpf\` — eBPF bytecode embedding (EBPF_SEG), XDP/TC program management, kernel-level cache integration
- \`rvf-runtime\` — High-level runtime API combining all storage, security, and compute layers. This is the primary crate for application developers.

**Operations Layer**
- \`rvf-import\` — Bulk import from external formats: CSV, JSON Lines, Parquet, existing vector databases
- \`rvf-server\` — HTTP REST server + TCP streaming server built on rvf-runtime. Configurable port, TLS support, multi-store routing.
- \`rvf-launch\` — Firecracker and QEMU VM launcher, auto-detects KVM availability, falls back to TCG emulation
- \`rvf-cli\` — Command-line interface (17 subcommands, see below)
- \`rvf-solver-wasm\` — Constraint and optimisation solver compiled to WASM

**Quick start with Cargo:**
\`\`\`toml
[dependencies]
rvf-runtime = "0.2.0"
\`\`\`

## npm Packages (4 packages)

**@ruvector/rvf** — TypeScript SDK, wraps rvf-runtime via N-API
- Provides: \`RvfStore\`, \`RvfQuery\`, \`RvfIngest\` classes
- Use for: Server-side Node.js applications

**@ruvector/rvf-node** — N-API native bindings
- Provides: Low-level bindings, used internally by @ruvector/rvf
- Use for: Custom native integrations

**@ruvector/rvf-wasm** — Browser-compatible WASM build
- Provides: \`WasmRvfStore\`, \`WasmRole\`, \`WasmTarget\`
- Use for: Browser-side knowledge bases, zero-backend deployments

**@ruvector/rvf-mcp-server** — Model Context Protocol server
- Provides: 10 MCP tools for AI agent integration
- Use for: Claude Code, ruflo, any MCP-compatible agent

\`\`\`bash
npm install @ruvector/rvf          # Server-side TypeScript
npm install @ruvector/rvf-wasm     # Browser WASM
npm install @ruvector/rvf-mcp-server  # MCP server for agents
\`\`\`

## Library Adapters (6 AI Framework Integrations)

These adapters connect RVF stores to popular AI frameworks without requiring direct rvf-runtime usage:

1. **rvf-adapter-ruflo** — ruflo v3 memory backend with WITNESS_SEG audit trails
2. **rvf-adapter-agentdb** — AgentDB vector store replacement
3. **rvf-adapter-ospipe** — OsPipe streaming integration
4. **rvf-adapter-agentic-flow** — agentic-flow ONNX embedding pipeline integration (75x faster embeddings)
5. **rvf-adapter-rvlite** — Lightweight embedded adapter for resource-constrained environments
6. **rvf-adapter-sona** — SONA (Self-Optimising Neural Architecture) integration for <0.05ms adaptation

## MCP Server: 10 Tools for AI Agents

Start the MCP server:
\`\`\`bash
npx @ruvector/rvf-mcp-server --transport stdio
# or with HTTP transport:
npx @ruvector/rvf-mcp-server --transport http --port 3001
\`\`\`

The 10 MCP tools exposed:
1. \`rvf_create\` — Create a new .rvf store (params: path, dimensions, hnsw_m, hnsw_ef)
2. \`rvf_open\` — Open an existing .rvf store
3. \`rvf_close\` — Close and flush a store
4. \`rvf_ingest\` — Insert vectors with metadata
5. \`rvf_query\` — Approximate nearest-neighbour search
6. \`rvf_delete\` — Delete a vector by ID
7. \`rvf_delete_filter\` — Delete vectors matching a metadata filter
8. \`rvf_compact\` — Compact the file (merge COW branches, rebuild refcounts)
9. \`rvf_status\` — Return store statistics (vector count, index health, file size)
10. \`rvf_list_stores\` — List all open stores

**Claude Code integration** (add to .mcp.json or project config):
\`\`\`json
{
  "mcpServers": {
    "rvf": {
      "command": "npx",
      "args": ["@ruvector/rvf-mcp-server", "--transport", "stdio"]
    }
  }
}
\`\`\`

## CLI: 17 Subcommands

\`\`\`bash
rvf create my-kb.rvf --dims 384 --hnsw-m 16
rvf ingest my-kb.rvf --from documents.jsonl
rvf query my-kb.rvf "how does HNSW work?" --top-k 5
rvf delete my-kb.rvf --id vec-123
rvf status my-kb.rvf
rvf inspect my-kb.rvf --segments         # show all segment types and sizes
rvf compact my-kb.rvf
rvf derive parent.rvf child.rvf --cow    # COW branch
rvf serve my-kb.rvf --port 8080          # start HTTP server
rvf launch my-kb.rvf --memory 512M       # boot as microVM
rvf embed-kernel my-kb.rvf --from nanos  # embed unikernel (needs Docker)
rvf embed-ebpf my-kb.rvf --prog xdp_cache.c
rvf filter my-kb.rvf --where "category='docs'"
rvf freeze my-kb.rvf                     # create immutable snapshot
rvf verify-witness my-kb.rvf             # validate witness chain
rvf verify-attestation my-kb.rvf         # validate TEE attestation
rvf rebuild-refcounts my-kb.rvf          # rebuild from COW map chain
\`\`\``,
  },

  // -------------------------------------------------------------------------
  // Entry 5: RVCOW — Git-Like Copy-on-Write Branching
  // -------------------------------------------------------------------------
  {
    file_path: 'github.com/ruvnet/ruvector/crates/rvf/05-rvcow-branching.md',
    title: 'RVCOW: Git-Like Copy-on-Write Branching for Vector Databases',
    category: 'vector-db',
    quality_score: 96,
    content: `## The Core Problem RVCOW Solves

Imagine you have a 512 MB knowledge base shared between 1,000 tenants. Each tenant needs to add their own private documents and have those documents appear in their search results — but not in other tenants' results. Without branching, you have two bad options: (1) duplicate the 512 MB file 1,000 times (512 GB total), or (2) add tenant-ID filters to every query and mix all data in one store (privacy risk, operational complexity).

RVCOW — the Copy-on-Write branching system in RVF — gives you a third option: each tenant gets a branch of the shared parent file. Only the tenant's new or modified clusters are stored in their branch. The shared 512 MB parent is referenced, not copied. A tenant with 100 edits uses roughly 2.5 MB of additional storage, not 512 MB.

## How COW Branching Works at the Cluster Level

RVF divides vector storage into 256 KB clusters. Each cluster holds a fixed number of vectors determined by the embedding dimension. COW branching operates at cluster granularity:

\`\`\`
Parent file:        [Cluster 0][Cluster 1][Cluster 2]...[Cluster N]
                           ↑ shared via COW_MAP
Child branch:       [COW_MAP pointing to parent clusters]
                    [Delta Cluster 7'] ← only this cluster was modified
                    [New Cluster N+1]  ← new vectors added by this branch
\`\`\`

When a child branch writes to cluster 7: copy cluster 7 from parent → write modifications to the copy → update COW_MAP to point to the new copy. Clusters 0-6 and 8-N still point to the parent. No data moved.

## The Four COW Segment Types

**COW_MAP (0x20)** — The central routing table. Maps each cluster ID to the segment offset where that cluster's data lives. On read, the query engine consults COW_MAP to resolve "cluster 7" → "this segment in this file."

**REFCOUNT (0x21)** — Reference counts per cluster. A cluster with refcount > 1 is shared across multiple branches. When refcount drops to 0 (all branches deleted), the cluster becomes eligible for compaction. Refcounts are fully derivable from the COW_MAP chain, so they can be rebuilt without a WAL (\`rvf rebuild-refcounts\` command).

**MEMBERSHIP (0x22)** — Branch visibility filter. A bitmap of vector IDs that belong to this branch's visible set. Supports two modes:
- Include mode: only vectors in the bitmap are visible
- Exclude mode: vectors in the bitmap are hidden (used to implement deletions in parent that don't affect children)

**DELTA (0x23)** — Sparse patch segments. Stores only the changed portions of a cluster rather than the full cluster. Used for LoRA overlay deltas (model fine-tuning) and for highly sparse COW edits.

## Performance Benchmarks

These are measured numbers, not estimates:

| Operation | 10K vectors | 100K vectors |
|-----------|-------------|--------------|
| COW branch creation | 2.6 ms | 6.8 ms |
| CowMap lookup (single cluster) | 28 ns | 28 ns |
| Membership filter (contains check) | 23–33 ns | 23–33 ns |

Branch creation is sub-10ms even at 100K vectors because no data is copied — only the COW_MAP and MEMBERSHIP segments are written.

## Snapshot Freeze: Immutable Checkpoints

\`\`\`bash
rvf freeze my-kb.rvf
\`\`\`

Freeze creates an immutable snapshot of the current file state. After freezing:
- All existing segments are marked read-only at the OS level (chmod 444 on segment data)
- A new MANIFEST_SEG is written pointing to the frozen state
- Future writes automatically create a new COW branch off the frozen snapshot
- The frozen snapshot can be shared safely (no writes will ever modify it)

This is the equivalent of \`git tag\` in version control — a named immutable reference to a specific state.

## Shared HNSW Index Across Branches

One of RVCOW's most powerful features: all branches share the parent's HNSW graph index. When querying a branch:

1. Query enters the shared HNSW graph (no duplication)
2. Candidate results are retrieved
3. MEMBERSHIP bitmap filter is applied to include/exclude results by branch
4. Branch-local clusters are also searched (for vectors added to this branch)
5. Results merged and ranked

This means branches get the parent's full index quality without rebuilding it. A branch with 1,000 new vectors has an HNSW graph containing those 1,000 vectors, while automatically inheriting the parent's graph for the shared 1,000,000 vectors.

## Multi-Tenant Knowledge Base Architecture

A practical deployment pattern for multi-tenant AI applications:

\`\`\`
Base Knowledge File (my-company.rvf, 512 MB, frozen)
├── tenant-001.rvf  (COW branch, 1.2 MB)  → acme-corp private docs
├── tenant-002.rvf  (COW branch, 0.8 MB)  → globex private docs
├── shared-v2.rvf   (COW branch, 45 MB)   → next quarter's knowledge
└── qa-test.rvf     (COW branch, 3.1 MB)  → A/B test new content
\`\`\`

Each branch is a complete, independent .rvf file that references parent clusters via COW_MAP. It can be opened, queried, and extended without touching the parent. Deleting a tenant is a single file deletion — no cascading cleanup, no orphan data in a shared database.

## A/B Testing Knowledge Versions

RVCOW enables rigorous A/B testing of knowledge base content:

1. Freeze the current production KB as baseline.rvf
2. Create two branches: variant-a.rvf (new documentation style) and variant-b.rvf (original)
3. Route 50% of users to each branch
4. Compare query quality metrics
5. Promote the winner: \`rvf compact variant-a.rvf --merge-into production.rvf\`

Step 5 (compact + merge) is a metadata-only operation for clusters that were inherited unchanged — only actually-modified clusters require data movement.`,
  },

  // -------------------------------------------------------------------------
  // Entry 6: RVF Security — Witness Chains, PQ Signatures, TEE Attestation
  // -------------------------------------------------------------------------
  {
    file_path: 'github.com/ruvnet/ruvector/crates/rvf/rvf-crypto/06-security.md',
    title: 'RVF Security: Witness Chains, Post-Quantum Signatures & TEE Attestation',
    category: 'security',
    quality_score: 95,
    content: `## Security as a First-Class Format Feature

Most vector databases treat security as infrastructure around the database (TLS, auth tokens, audit logs in a separate system). RVF treats security as a property of the file itself. Security evidence — cryptographic signatures, TEE attestation quotes, operation audit trails — lives inside the .rvf file alongside the data it secures. This means a file is self-proving: you can verify its integrity and provenance without access to any external system.

## Witness Chains: Tamper-Evident Audit Trails

Every operation (ingest, query, deletion, derivation) is recorded in the WITNESS_SEG as a 73-byte witness entry:

\`\`\`
Offset  Size  Field
------  ----  -----
0       32    prev_hash: SHAKE-256 hash of the previous entry
32      32    action_hash: hash of the operation payload
64      8     timestamp_ns: nanosecond-precision timestamp
72      1     witness_type: see enum below
\`\`\`

The chain is constructed so that modifying any past entry invalidates all subsequent entries — the same property as a blockchain, but without the distributed consensus overhead (this is a single-file structure).

**16 Witness Types:**

Core operations:
- \`PROVENANCE\` — Records the origin of ingested data (source URL, import timestamp, content hash)
- \`COMPUTATION\` — Records that a computation was performed (embedding generation, quantisation)
- \`SEARCH\` — Records a query execution (query vector hash, result IDs, recall tier used)
- \`DELETION\` — Records a vector deletion (ID, timestamp, reason)

Attestation:
- \`PLATFORM_ATTESTATION\` — Hardware TEE attestation quote
- \`KEY_BINDING\` — Binds a cryptographic key to this file's identity
- \`COMPUTATION_PROOF\` — Zero-knowledge proof that a computation was performed correctly
- \`DATA_PROVENANCE\` — Chain of custody for imported data

Lineage:
- \`DERIVATION\` — Records parent-child relationship (COW branch creation)
- \`LINEAGE_MERGE\` — Records two branches being merged
- \`LINEAGE_SNAPSHOT\` — Records a freeze/snapshot operation
- \`LINEAGE_TRANSFORM\` — Records a data transformation (format conversion, re-embedding)
- \`LINEAGE_VERIFY\` — Records a verification check and its result

COW operations:
- \`CLUSTER_COW\` — Records a COW cluster copy event
- \`CLUSTER_DELTA\` — Records a delta (sparse patch) application

## Post-Quantum Signatures: Dual-Signing for Future Safety

RVF implements dual signing on all files:

**Ed25519** — Current standard. 64-byte signatures, ~100K sign/verify operations per second. Used for everyday file integrity.

**ML-DSA-65 (FIPS 204)** — Post-quantum digital signature. This is the NIST-standardised lattice-based signature algorithm (formerly CRYSTALS-Dilithium Level 3). 3293-byte public key, 3309-byte signature. Designed to resist attacks from future quantum computers.

Both signatures are stored in CRYPTO_SEG. Files signed with Ed25519 today are also signed with ML-DSA-65, so the audit trail remains verifiable even if Ed25519 is broken by quantum advances. This is the "harvest now, decrypt later" defence — data captured today that must remain secure for 10+ years is already protected.

**SLH-DSA-128s** (SPHINCS+) is also supported as an alternative post-quantum algorithm for environments where stateless hash-based signatures are preferred over lattice-based.

## TEE Attestation: Hardware-Backed Proof

RVF files can record hardware attestation quotes proving that operations ran inside a Trusted Execution Environment:

**Supported TEE platforms:**
- Intel SGX — Software Guard Extensions, user-space enclaves
- AMD SEV-SNP — Secure Encrypted Virtualisation with Nested Paging
- Intel TDX — Trust Domain Extensions, VM-level isolation
- ARM CCA — Confidential Compute Architecture (mobile + server)

The attestation quote from the TEE hardware is embedded in PLATFORM_SEG and referenced by PLATFORM_ATTESTATION witness entries. A verifier can:

1. Extract the PLATFORM_SEG quote
2. Verify the quote against the TEE vendor's certificate chain
3. Check that the measurement (hash of the enclave code) matches the expected value
4. Be cryptographically certain that the code running inside the TEE was the actual rvf-runtime, not a modified version

This means: data ingested inside a TEE-attested RVF file has a provable chain of custody from raw input to stored embedding, with hardware guarantees that no code outside the enclave saw the plaintext.

## KernelBinding: Preventing Segment-Swap Attacks

A subtle attack on executable file formats: replace the compute payload (KERNEL_SEG or EBPF_SEG) with malicious code while leaving the signature and manifest intact. KernelBinding prevents this.

Each signed kernel includes a 128-byte KernelBinding footer:
\`\`\`
Bytes 0–31:   manifest_hash (BLAKE3 of the MANIFEST_SEG this kernel belongs to)
Bytes 32–63:  kernel_content_hash (BLAKE3 of the KERNEL_SEG payload)
Bytes 64–95:  build_timestamp (8 bytes) + build_uuid (16 bytes) + padding
Bytes 96–127: signature over bytes 0–95 (Ed25519 or ML-DSA-65)
\`\`\`

During the 7-step fail-closed boot verification:
1. Verify MANIFEST_SEG signature
2. Verify KERNEL_SEG signature
3. Verify KernelBinding: manifest_hash must match current manifest
4. Verify KernelBinding: kernel_content_hash must match KERNEL_SEG payload
5. Verify TEE measurement (if attestation is present)
6. Verify WITNESS_SEG chain continuity (no gaps or forks)
7. All checks must pass — any failure halts boot with a specific error code

## DNA-Style File Lineage

A 68-byte FileIdentity structure in LINEAGE_SEG gives every RVF file a unique genetic identity:

\`\`\`
Bytes 0–15:   file_uuid (UUIDv4, this file's permanent identity)
Bytes 16–31:  parent_uuid (UUIDv4 of parent, zeros for root)
Bytes 32–63:  parent_content_hash (BLAKE3 of parent's root MANIFEST_SEG)
Bytes 64–67:  generation (u32 depth from root)
\`\`\`

This enables reconstruction of the full derivation tree from any branch: follow parent_uuid up the chain until you reach a file with all-zero parent_uuid (the root). Each step is cryptographically verified via parent_content_hash.`,
  },

  // -------------------------------------------------------------------------
  // Entry 7: RVF Progressive Indexing & Performance Benchmarks
  // -------------------------------------------------------------------------
  {
    file_path: 'github.com/ruvnet/ruvector/crates/rvf/rvf-index/07-progressive-indexing.md',
    title: 'RVF Progressive Indexing & Performance Benchmarks',
    category: 'performance',
    quality_score: 96,
    content: `## The Problem with Monolithic Indexes

Traditional vector databases load their entire index into memory before serving any queries. For a 1M-vector HNSW index, this means waiting 10–30 seconds on startup before the first query can be answered. For browser-based applications or edge deployments, this is unacceptable. RVF's three-tier progressive HNSW solves this by letting queries start immediately at reduced accuracy, improving progressively as more of the index loads.

## Three-Tier Progressive HNSW Architecture

The HNSW graph is split into three independent layers, each stored in its own INDEX_SEG:

**Layer A: Coarse Routing Graph**
- Target recall: >= 0.70 (70% of queries return the true nearest neighbours)
- File size contribution: ~1–5 MB for 1M vectors (sparse graph, high-level routing)
- Load time: microseconds to low milliseconds
- Use case: Bootstrap queries immediately, answer most common/obvious queries fully correctly
- HNSW parameters: low M (connectivity), high ef (exploration), few layers

**Layer B: Hot Region Graph**
- Target recall: >= 0.85 (85% accuracy)
- File size contribution: ~20–80 MB for 1M vectors (denser graph covering frequently accessed regions)
- Load time: 100 ms to 2 seconds
- Use case: Improves results for the most common query patterns
- Temperature assignment: vectors accessed > 100 times in the Count-Min Sketch are included

**Layer C: Full Graph**
- Target recall: >= 0.95 (production-quality approximate nearest neighbours)
- File size contribution: ~150–500 MB for 1M vectors (full HNSW graph)
- Load time: 2–30 seconds depending on storage speed
- Use case: Full quality results for all queries

The query engine automatically routes each query to the highest loaded layer. As layers load in the background, query quality improves without any application code changes and without interrupting in-flight queries.

## Temperature-Tiered Quantization

Not all vectors are equally valuable for accuracy. Frequently queried vectors (hot) benefit from full fp16 precision; rarely queried vectors (cold) can tolerate aggressive compression. RVF tracks access frequency using a Count-Min Sketch (SKETCH_SEG) and automatically assigns temperatures:

**Hot tier (fp16):**
- Vectors with Count-Min Sketch count > 1000
- Storage: 2 bytes per dimension (half of fp32)
- Recall: ~0.999 (nearly lossless)
- Memory reduction: 2x vs fp32

**Warm tier (Product Quantisation):**
- Vectors with Count-Min Sketch count 10–1000
- Storage: 1–2 bits per dimension (via PQ codebooks, configurable subspaces)
- Recall: ~0.95 at 8x compression, ~0.90 at 16x compression
- Memory reduction: 8–16x vs fp32

**Cold tier (Binary Quantisation):**
- Vectors with Count-Min Sketch count < 10
- Storage: 1 bit per dimension (population bit packing)
- Recall: ~0.80 (acceptable for infrequently accessed content)
- Memory reduction: 32x vs fp32

Temperature assignment runs continuously in the background. A vector that was cold (rarely queried) and becomes suddenly popular (trending content) is automatically promoted from binary → PQ → fp16 over successive compaction cycles.

## Achieved Performance Benchmarks

These are measurements from the RVF benchmark suite, not targets:

| Metric | Achieved | Design Target |
|--------|----------|---------------|
| Cold boot (manifest location + Layer A load) | 1.6 microseconds | < 5 ms |
| WASM binary size (tile microkernel) | 5.5 KB | < 8 KB |
| COW branch creation (10K vectors) | 2.6 ms | < 10 ms |
| COW branch creation (100K vectors) | 6.8 ms | < 50 ms |
| CowMap cluster lookup | 28 ns | < 100 ns |
| MEMBERSHIP filter (contains check) | 23–33 ns | < 100 ns |
| HNSW query (Layer A, 1M vectors) | ~0.5 ms | < 2 ms |
| HNSW query (Layer C, 1M vectors) | ~2 ms | < 10 ms |
| Witness chain append | ~15 microseconds | < 1 ms |
| ML-DSA-65 signature verification | ~2 ms | < 10 ms |

Cold boot achieving 1.6 microseconds is particularly noteworthy: it's faster than a single network round-trip to localhost. This is possible because the manifest location strategy (seek to EOF, scan 4096 bytes) requires no index traversal — the manifest IS the index.

## Competitive Positioning

Understanding where RVF fits relative to established tools:

**vs Annoy (Spotify):**
RVF adds: WASM runtime, self-booting kernel, eBPF acceleration, no_std compatibility, post-quantum signatures, COW branching, progressive loading, cryptographic audit. Annoy is read-only after build; RVF is fully mutable with COW safety.

**vs FAISS (Meta):**
RVF adds: Single-file portability, WASM, kernel, eBPF, PQ signatures, COW. FAISS has more index types (IVF, IVFPQ, etc.); RVF focuses on HNSW with PQ tiers.

**vs Qdrant:**
RVF adds: Single-file format, WASM browser runtime, self-booting kernel, no external process required. Qdrant has richer filtering and payload indexing.

**vs Milvus:**
RVF adds: Simplicity (single file vs distributed cluster), WASM, kernel, browser compatibility. Milvus scales better for billion-vector datasets.

**vs SQLite / DuckDB:**
These are relational; RVF is vector-native. RVF adds: HNSW-native query, self-booting kernel, eBPF acceleration, cryptographic audit, progressive loading. SQLite/DuckDB require extensions (sqlite-vss, vss extension) for vector search.

The RVF differentiators that no competitor shares simultaneously: (1) single-file format, (2) WASM browser runtime, (3) self-booting unikernel, (4) eBPF Linux kernel acceleration, (5) no_std embedded compatibility, (6) post-quantum signatures, (7) COW branching, (8) progressive loading, (9) cryptographic witness chain.`,
  },

  // -------------------------------------------------------------------------
  // Entry 8: RVF Self-Booting Cognitive Containers: Three-Tier Compute Model
  // -------------------------------------------------------------------------
  {
    file_path: 'github.com/ruvnet/ruvector/crates/rvf/08-self-booting-containers.md',
    title: 'RVF Self-Booting Cognitive Containers: Three-Tier Compute Model',
    category: 'architecture',
    quality_score: 97,
    content: `## Beyond Data: A File That Runs Itself

The majority of file formats are passive: a .csv holds data, a .mp4 holds video, a .sqlite holds a database. They require external software to execute. RVF breaks this assumption. A single .rvf file can contain its own execution environment — the code to serve its own data — as an embedded compute payload. When you boot an RVF file, the file IS the server.

This is not metaphorical. The KERNEL_SEG contains a real Linux unikernel binary. The EBPF_SEG contains real eBPF bytecode. The WASM_SEG contains a real WebAssembly module. Each tier is a different trade-off between binary size, boot time, and execution environment constraints.

## The Three-Tier Compute Model

### Tier 1: WASM (5.5–46 KB, browser/edge/IoT)

**Boot time:** < 1 ms (microkernel), < 5 ms (full control plane)
**Execution environment:** Any WASM runtime (browser, Node.js, Deno, WAMR, wasmtime)
**Capability:** Full vector query engine with progressive HNSW, COW branch awareness
**Use cases:** Browser-based knowledge bases, edge functions (Cloudflare Workers, Deno Deploy), IoT devices with WASM runtime

The WASM tier is the "run anywhere" tier. It is the smallest and most portable. A browser user loads the .rvf file, the WASM_SEG is extracted, instantiated in the browser's WASM engine, and queries are served locally. Zero network round-trips after initial load.

### Tier 2: eBPF (10–50 KB, Linux kernel XDP/TC)

**Boot time:** < 20 ms (kernel module load)
**Execution environment:** Linux kernel 5.4+ with BPF JIT compiler
**Capability:** L2/L3 packet-level cache for vector query results, sub-microsecond hot cache hits
**Use cases:** High-throughput server deployments where query latency must be sub-millisecond

eBPF programs run inside the Linux kernel itself, in a verified sandbox. The rvf-ebpf crate generates XDP (eXpress Data Path) programs that intercept network packets at the NIC driver level — before the kernel's network stack. A cached vector query result is returned by the eBPF program without ever reaching user space. This enables sub-microsecond response times for hot queries.

The EBPF_SEG is attached to the running kernel via:
\`\`\`bash
rvf embed-ebpf my-kb.rvf --prog cache         # embeds the eBPF cache program
sudo rvf serve my-kb.rvf --enable-ebpf        # loads eBPF into kernel at startup
\`\`\`

### Tier 3: Unikernel (200 KB–2 MB, Firecracker/TEE/bare metal)

**Boot time:** < 125 ms (Firecracker microVM), < 5 ms (bare metal)
**Execution environment:** Firecracker microVM, QEMU, bare metal, Intel SGX/TDX enclave
**Capability:** Full Linux-like OS with networking, disk access, TLS, SSH, HTTP server, TEE attestation
**Use cases:** Serverless deployments, edge cloud, trusted execution enclaves, air-gapped systems

The unikernel is a complete self-contained operating system compiled from the rvf-runtime + Nanos (or a custom kernel). It boots directly from the KERNEL_SEG, initialises the rvf-runtime as the sole application, and begins serving HTTP and TCP connections. No Linux distribution, no package manager, no shell (unless explicitly added).

## Building a Bootable RVF File Step by Step

\`\`\`bash
# Step 1: Create the vector store and ingest data
rvf create my-kb.rvf --dims 384 --hnsw-m 16 --hnsw-ef 200
rvf ingest my-kb.rvf --from documents.jsonl

# Step 2: Verify the data looks correct
rvf status my-kb.rvf
rvf query my-kb.rvf "test query" --top-k 3

# Step 3: Embed a unikernel (requires Docker for cross-compilation)
rvf embed-kernel my-kb.rvf --from nanos --memory 512M --cpus 2

# Step 4: Optionally embed eBPF acceleration
rvf embed-ebpf my-kb.rvf --prog xdp_cache

# Step 5: Inspect the result
rvf inspect my-kb.rvf --segments
# Output: MANIFEST_SEG (4.1 KB), VEC_SEG (45.2 MB), INDEX_SEG (12.8 MB),
#         WITNESS_SEG (1.2 MB), KERNEL_SEG (1.8 MB), EBPF_SEG (24 KB)

# Step 6: Boot the file as a microVM
rvf launch my-kb.rvf --port-forward 8080:8080
# Auto-detects KVM (hardware acceleration) or falls back to QEMU TCG emulation
curl http://localhost:8080/query -d '{"q": "vector search concepts", "top_k": 5}'
\`\`\`

## The Claude Code Appliance: A Real Example

The most striking demonstration of the three-tier model is the Claude Code Appliance: a single 5.1 MB .rvf file that:

1. Boots a complete Linux unikernel (KERNEL_SEG)
2. Starts an HTTP API server for vector queries
3. Initialises an SSH server (so you can shell into it)
4. Downloads and installs the claude binary
5. Starts claude serving the embedded knowledge base
6. Records a WITNESS_SEG entry for every step, cryptographically proving the boot sequence

This entire self-bootstrapping sequence happens in under 125 ms in a Firecracker microVM. The result is a fully functional AI assistant with a built-in knowledge base, running in an isolated microVM, with a cryptographic proof that every step of setup happened correctly.

## QEMU Launcher: Auto-Detection and Fallback

The rvf-launch crate handles VM launch details:

\`\`\`
rvf launch my-kb.rvf
  → Checks /dev/kvm exists and is accessible
  → If yes: uses QEMU with KVM acceleration (-accel kvm)
  → If no: falls back to QEMU TCG software emulation (-accel tcg)
  → Configures: -m 512M -smp 2 -net user,hostfwd=tcp::8080-:8080
  → Mounts: my-kb.rvf as virtio-blk device
  → Boots: unikernel reads KERNEL_SEG, mounts VEC_SEG + INDEX_SEG, serves queries
\`\`\`

The fallback to TCG means rvf launch works on macOS (no /dev/kvm), CI environments, and WSL2 — anywhere QEMU is installed, even without hardware virtualisation.

## RVF vs Docker/OCI Containers

| Property | Docker/OCI | RVF Cognitive Container |
|----------|-----------|------------------------|
| Minimum size | ~5 MB (Alpine) | 5.5 KB (WASM tier) |
| Contains vector data | No (separate database) | Yes (native VEC_SEG) |
| Vector-native COW | No | Yes (RVCOW) |
| Embedded eBPF | No | Yes (EBPF_SEG) |
| Cryptographic audit | No (external) | Yes (WITNESS_SEG) |
| Runs in browser | No | Yes (WASM_SEG) |
| Post-quantum signed | No | Yes (ML-DSA-65) |
| Self-proves integrity | No | Yes (witness chain) |

The key insight: Docker separates compute (the image) from data (volumes). RVF unifies them. The data IS the compute unit.`,
  },

  // -------------------------------------------------------------------------
  // Entry 9: RVF AGI Cognitive Container (ADR-036)
  // -------------------------------------------------------------------------
  {
    file_path: 'github.com/ruvnet/ruvector/crates/rvf/09-agi-container-adr036.md',
    title: 'RVF AGI Cognitive Container: Packaging Complete Agent Runtimes (ADR-036)',
    category: 'agents',
    quality_score: 97,
    content: `## What Is an AGI Cognitive Container?

The three-tier compute model (WASM + eBPF + unikernel) makes an RVF file a self-executing knowledge base. ADR-036 extends this concept one tier higher: an AGI Cognitive Container packages not just compute, but intelligence — the complete configuration needed to instantiate, govern, evaluate, and replay an AI agent.

An AGI container answers the question: "How do you ship an AI agent the same way you ship a Docker image?" The answer is: you extend the RVF format with agent-specific segments that carry the agent's identity, its tool registry, its authority model, its evaluation harness, and its budget constraints — all in a single verifiable file.

## The 16 Components of an AGI Container

**Identity**
- \`agent_uuid\`: UUIDv4 permanent agent identity (survives restarts, transfers)
- \`build_uuid\`: UUIDv4 build identifier (changes on every rebuild)
- \`model_id_hash\`: BLAKE3 hash of the AI model ID string (e.g., "claude-opus-4-6")

**Orchestration**
- \`orchestrator_config\`: JSON blob containing Claude Code or ruflo v3 configuration. This is the complete config that would normally live in .claude.json or ruflo.config.json, embedded in the container.

**Tool Integration**
- \`tool_registry\`: MCP adapter registry — list of MCP server definitions (name, command, args, transport). Defines exactly which external tools the agent is authorised to use.

**Agent Prompts**
- \`agent_prompts\`: Role definition map keyed by agent type. Each value is a system prompt string. A container can carry prompts for multiple agent roles (researcher, coder, reviewer, etc.) that it can instantiate.

**Evaluation**
- \`eval_harness\`: Task suite for automated evaluation — a list of (input, expected_output, grading_rubric) tuples. Enables \`rvf verify-attestation my-agent.rvf\` to run the eval suite and record pass/fail in the witness chain.

**Skills**
- \`skills_library\`: Promoted skill definitions. Skills that have been tested and approved are embedded in the container, making the agent's capabilities self-contained.

**Governance**
- \`policy_kernel\`: Governance rules including authority level and restriction patterns. Stored in POLICY_KERNEL_SEG.

**Authority Hierarchy**

Authority levels are strictly hierarchical — each level includes all permissions of lower levels plus additional capabilities:

1. \`ReadOnly\` — Can read vectors, run queries, access memory
2. \`WriteMemory\` — Can also write to in-container memory (COW branches)
3. \`ExecuteTools\` — Can also call registered MCP tools
4. \`WriteExternal\` — Can also write to external systems (files, APIs, databases)

An agent granted \`ExecuteTools\` authority cannot upgrade itself to \`WriteExternal\` — authority is set at container creation and verified cryptographically.

**Coherence Gates**
- \`min_coherence_score\`: Float 0.0–1.0. Minimum world-model coherence score before execution is halted.
- \`max_contradiction_rate\`: Float 0.0–1.0. Maximum rate of self-contradictory statements before halt.
- \`rollback_ratio\`: Float 0.0–1.0. If rollback rate exceeds this, execution is considered stuck and halted.

These gates prevent agent drift: if the agent's outputs start contradicting each other or causing excessive rollbacks, the coherence gate fires before the agent wastes further compute budget.

**Resource Budgets**

Hard limits enforced by the container runtime, not by the agent:

\`\`\`
max_time_seconds: 3600      # 1 hour wall clock
max_tokens: 1_000_000       # 1M total tokens across all model calls
max_cost_usd: 10.00         # $10.00 USD budget
max_tool_calls: 500         # total MCP tool calls
max_external_writes: 50     # writes to external systems
\`\`\`

When any budget is exhausted, the container runtime freezes execution, records the budget exhaustion in the witness chain, and returns control to the caller. The frozen state can be examined or restarted with a new budget.

**Replay and Verification**
- \`replay_config\`: Deterministic re-execution configuration. Given the witness chain (which records every operation with its inputs), the agent's actions can be replayed exactly, producing the same outputs, for auditing and debugging.

## Three Execution Modes

**Replay Mode** — Deterministic re-execution from witness logs. Used for: auditing, debugging, compliance review. No model calls needed — actions are reproduced from the witness chain.

**Verify Mode** — Runs the eval harness and verifies file integrity. Reports pass/fail rates, coherence scores, and signature validity. Used for: CI/CD gates, before deploying an updated agent version.

**Live Mode** — Full autonomous operation within budget constraints. The agent executes normally, all operations are recorded to witness chain, coherence gates are enforced in real time.

## Builder API Example

\`\`\`rust
use rvf_runtime::agi::{AgiContainerBuilder, AuthorityLevel, ResourceBudget};

let container = AgiContainerBuilder::new(agent_uuid, build_uuid)
    .with_model_id("claude-opus-4-6")  // hashed, not stored as plaintext
    .with_orchestrator(serde_json::from_str(claude_flow_config)?)
    .with_tool_registry(vec![
        McpAdapter { name: "rvf".into(), command: "npx".into(),
                     args: vec!["@ruvector/rvf-mcp-server".into()], .. }
    ])
    .with_authority(AuthorityLevel::ExecuteTools)
    .with_budget(ResourceBudget {
        max_time_seconds: 3600,
        max_tokens: 1_000_000,
        max_cost_usd: 10.0,
        max_tool_calls: 500,
        max_external_writes: 50,
    })
    .with_coherence_gate(0.7, 0.3, 0.2)
    .with_eval_harness(load_eval_suite("eval/tasks.jsonl")?)
    .build_and_sign(&signing_key)?;

// Write to file
container.write_to("my-agent.rvf")?;
\`\`\`

## Why This Matters for ruflo v3

When a ruflo v3 swarm completes a task, the AGI container format allows packaging the result not as code files, but as a self-contained agent that can be launched, verified, and replayed anywhere. The entire agent — its knowledge, its tools, its governance, its eval harness — ships as a single .rvf file. DevOps for AI agents becomes as simple as: \`rvf launch my-agent.rvf\`.`,
  },

  // -------------------------------------------------------------------------
  // Entry 10: Ruflo V3 + RVF Integration Strategy
  // -------------------------------------------------------------------------
  {
    file_path: 'github.com/ruvnet/ruvector/crates/rvf/10-ruflo-integration.md',
    title: 'Ruflo V3 + RVF: Building WASM Knowledge Base Applications',
    category: 'architecture',
    quality_score: 98,
    content: `## The Strategic Relationship Between ruflo V3 and RVF

Claude-flow v3 is an orchestration layer — it coordinates agents, manages memory, routes tasks. RVF is a storage and compute substrate — it persists knowledge, executes queries, proves integrity. Together they form a complete agentic application stack that can be deployed as a single file.

The integration is not accidental: one of RVF's six library adapters is rvf-adapter-ruflo, purpose-built to connect ruflo v3's memory system to RVF storage with automatic WITNESS_SEG audit trails. Every ruflo memory operation (store, search, retrieve) is recorded in the RVF file's witness chain.

## Why RVF Replaces Traditional KB Approaches

Traditional knowledge base application stacks require:
1. A vector database service (Pinecone, Qdrant, Weaviate) — running process, subscription cost, network latency
2. An embedding API (OpenAI, Anthropic) — per-call cost, latency, internet dependency
3. A backend API server — hosting cost, deployment complexity
4. A frontend application — separate codebase, deployment pipeline

RVF replaces all four components with a single .rvf file:
- Vector database: built into the file (VEC_SEG + INDEX_SEG + HNSW)
- Embeddings: generated at ingest time, stored in the file (ruvector_embed)
- Backend: WASM tier serves queries in the browser, no server needed
- Frontend: loads the .rvf WASM module, queries directly

## Building a WASM KB Application: End-to-End Walkthrough

### Phase 1: Knowledge Gathering (ruflo researcher agent)

\`\`\`bash
# Initialise swarm for KB construction
npx ruflo@latest swarm init --topology hierarchical --max-agents 6 --strategy specialized

# The researcher agent gathers content (this runs as a Task in background)
# Researcher stores findings using ruflo memory:
npx ruflo@latest memory store \
  --key "rvf-architecture" \
  --value "RVF is a universal binary substrate..." \
  --namespace kb-content
\`\`\`

### Phase 2: KB Construction (rvf-runtime)

\`\`\`bash
# Create the .rvf file with appropriate dimensions
rvf create my-app-kb.rvf --dims 384 --hnsw-m 16 --hnsw-ef 200

# Ingest from ruflo memory (via the rvf-adapter-ruflo)
npx @ruvector/rvf-mcp-server --transport stdio &
# Then via MCP tool:
# rvf_ingest({ store: "my-app-kb.rvf", from_memory: "kb-content", namespace: "kb-content" })

# Or directly from documents:
rvf ingest my-app-kb.rvf --from processed-docs.jsonl
\`\`\`

### Phase 3: WASM Compilation

\`\`\`bash
# The WASM binary is pre-built in @ruvector/rvf-wasm — no compilation needed
# Just package the .rvf file with the WASM loader:
npm install @ruvector/rvf-wasm
\`\`\`

### Phase 4: Static Deployment

\`\`\`html
<!-- The entire application: one HTML file + one .rvf file on a CDN -->
<script type="module">
  import init, { WasmRvfStore } from 'https://cdn.example.com/rvf-wasm/0.1.0/rvf_wasm.js';

  async function loadKB() {
    await init();
    const response = await fetch('https://cdn.example.com/my-app-kb.rvf');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const store = WasmRvfStore.from_bytes(bytes);  // layer A loads instantly
    return store;
    // Layers B and C load automatically in background via Web Workers
  }

  const store = await loadKB();
  const results = store.query(queryEmbedding, 5);
  // Query available < 100ms after page load, at 70%+ recall
  // Improves to 95%+ recall as background loading completes
</script>
\`\`\`

## Progressive Loading UX Pattern

The three-tier HNSW enables an important UX pattern: instant-on knowledge bases.

Timeline after user loads page:
- **T+0 ms**: Page HTML loads, WASM module initialises
- **T+50 ms**: Layer A of HNSW loads, 70% recall available. User can type first query.
- **T+200 ms**: First query returns results (even if still on Layer A)
- **T+1 s**: Layer B loads (85% recall), queries silently improve
- **T+5 s**: Layer C loads (95% recall), production-quality results

The user experiences: "this thing is fast." The query they typed at T+200ms got an answer. The fact that later queries are more accurate is a background improvement they may not even notice.

## COW Branching for Personalisation

RVCOW enables per-user knowledge personalisation at minimal storage cost:

\`\`\`javascript
// User uploads their own documents — stored as a COW branch
const personalBranch = await store.derive_branch();
await personalBranch.ingest(userDocuments);

// Queries search: user's docs + shared KB (via COW visibility)
const results = personalBranch.query(queryEmbedding, 10);
// Returns results from both user's private branch AND shared KB

// Serialize branch for this user (only their changes, ~KB not MB)
const branchBytes = personalBranch.serialize();
localStorage.setItem('user-kb-branch', btoa(String.fromCharCode(...branchBytes)));
\`\`\`

Each user's personalisation is stored as a small branch (kilobytes) pointing back to the shared KB (megabytes). Total per-user storage cost: proportional to what they added, not the full KB.

## MCP Integration for Agent-Driven KB Management

For ruflo agents that need to build and manage KBs programmatically:

\`\`\`json
// Add to project .mcp.json
{
  "mcpServers": {
    "rvf": {
      "command": "npx",
      "args": ["@ruvector/rvf-mcp-server", "--transport", "stdio"]
    }
  }
}
\`\`\`

A ruflo researcher agent can then use MCP tools directly:
- \`rvf_create\` to initialise a new KB for a project
- \`rvf_ingest\` to add documents as they are discovered
- \`rvf_query\` to search the KB before writing new content (avoid duplication)
- \`rvf_status\` to report KB health and coverage
- \`rvf_compact\` to optimise after bulk ingestion

## Security by Default

Every operation in this stack is automatically audited:
- \`rvf_ingest\` → PROVENANCE witness entry (source hash recorded)
- \`rvf_query\` → SEARCH witness entry (query vector hash recorded)
- \`rvf_delete\` → DELETION witness entry (ID, timestamp, reason)

The audit trail is in the file itself. No separate logging infrastructure. No log rotation. No "logs disappeared." The witness chain is immutable and append-only.

## The Recommended ruflo V3 + RVF Stack

| Component | Tool | Role |
|-----------|------|------|
| Agent orchestration | ruflo v3 | Coordinates researcher, coder, deployer agents |
| Knowledge gathering | Researcher agent (Task tool) | Content discovery, synthesis |
| KB construction | rvf-runtime + MCP tools | Vector storage, embedding, indexing |
| Browser delivery | @ruvector/rvf-wasm | Zero-backend query engine |
| TypeScript SDK | @ruvector/rvf | Server-side application integration |
| Agent integration | @ruvector/rvf-mcp-server | 10 MCP tools for Claude Code |
| Personalisation | RVCOW branches | Per-user knowledge branches |
| Audit | WITNESS_SEG | Automatic, in-file, tamper-evident |

This stack replaces Pinecone + separate backend + separate frontend with a single .rvf file on a CDN, deployed by a ruflo swarm, queryable from any browser.`,
  },

];

// ---------------------------------------------------------------------------
// Main — connect, insert, report
// ---------------------------------------------------------------------------
async function main() {
  const client = new Client(DB_CONFIG);

  try {
    await client.connect();
    console.log('Connected to ruvector-postgres on port 5435');
    console.log(`Inserting ${ENTRIES.length} RVF knowledge entries...\n`);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < ENTRIES.length; i++) {
      const entry = ENTRIES[i];
      const chars = entry.content.length;
      // Rough chunk count: one chunk per ~1500 characters
      const chunkCount = Math.max(1, Math.ceil(chars / 1500));

      const params = [
        entry.file_path,
        entry.title,
        entry.content,
        entry.category,
        entry.quality_score,
        chunkCount,
        chars,
      ];

      try {
        const result = await client.query(INSERT_SQL, params);
        const row = result.rows[0];
        console.log(`[${i + 1}/${ENTRIES.length}] OK  id=${row.id}  "${row.title}"`);
        successCount++;
      } catch (err) {
        console.error(`[${i + 1}/${ENTRIES.length}] FAIL "${entry.title}"`);
        console.error(`  Error: ${err.message}`);
        failCount++;
      }
    }

    console.log(`\nDone. ${successCount} inserted, ${failCount} failed.`);

  } catch (err) {
    console.error('Fatal connection error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('Database connection closed.');
  }
}

main();
