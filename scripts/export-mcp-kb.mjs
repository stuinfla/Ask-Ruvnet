/**
 * Export RVF Knowledge Base to ask-ruvnet MCP Format
 *
 * Updated: 2026-03-12 19:30:00 EST | Version 1.0.0
 * Created: 2026-03-12 19:30:00 EST
 *
 * Reads the .ruvector/knowledge-base/ binary store (Float32Array vectors +
 * metadata JSON) and outputs the three files the ask-ruvnet MCP server
 * expects:
 *
 *   kb-entries.json      - Array of entry objects with content and metadata
 *   kb-embeddings.bin    - Binary-quantized vectors (384 floats -> 48 bytes)
 *   kb-metadata.json     - Index metadata (version, categories, counts)
 *
 * Usage:
 *   node scripts/export-mcp-kb.mjs [--output <dir>] [--verbose]
 *
 * Flags:
 *   --output <dir>   Output directory (default: ask-ruvnet MCP kb-data/)
 *   --verbose        Print detailed progress and per-entry diagnostics
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const SOURCE_DIR = path.join(PROJECT_ROOT, '.ruvector', 'knowledge-base');
const DEFAULT_OUTPUT_DIR = path.join(PROJECT_ROOT, 'kb-data');

const DIMENSIONS = 384;
const BYTES_PER_FLOAT = 4;
const BYTES_PER_VECTOR_F32 = DIMENSIONS * BYTES_PER_FLOAT;  // 1536
const BYTES_PER_VECTOR_BIN = Math.ceil(DIMENSIONS / 8);      // 48

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseCLIArgs() {
  const { values } = parseArgs({
    options: {
      output: { type: 'string', short: 'o' },
      verbose: { type: 'boolean', short: 'v', default: false },
    },
    strict: true,
  });

  return {
    outputDir: values.output || DEFAULT_OUTPUT_DIR,
    verbose: values.verbose || false,
  };
}

// ---------------------------------------------------------------------------
// Source file readers
// ---------------------------------------------------------------------------

/**
 * Read and validate the manifest.json from .ruvector/knowledge-base/
 */
function readManifest(sourceDir) {
  const manifestPath = path.join(sourceDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  if (manifest.dimensions !== DIMENSIONS) {
    throw new Error(
      `Dimension mismatch: manifest says ${manifest.dimensions}, expected ${DIMENSIONS}`
    );
  }

  return manifest;
}

/**
 * Read and parse metadata.json (contains idIndex array + metadata map).
 *
 * The file can be very large (100K+ entries) so we read it as a stream-friendly
 * single parse. Node handles this fine with the V8 heap.
 */
function readMetadata(sourceDir) {
  const metadataPath = path.join(sourceDir, 'metadata.json');
  if (!fs.existsSync(metadataPath)) {
    throw new Error(`Metadata not found: ${metadataPath}`);
  }

  console.log('  Reading metadata.json (this may take a moment for large KBs)...');
  const raw = fs.readFileSync(metadataPath, 'utf-8');
  const parsed = JSON.parse(raw);

  // Handle both array format (old) and dict format (current .ruvector store)
  let idIndex = parsed.idIndex;
  if (idIndex && !Array.isArray(idIndex) && typeof idIndex === 'object') {
    // Convert { "0": "kb_1", "1": "kb_2", ... } to ["kb_1", "kb_2", ...]
    const maxKey = Math.max(...Object.keys(idIndex).map(Number));
    idIndex = new Array(maxKey + 1);
    for (const [k, v] of Object.entries(parsed.idIndex)) {
      idIndex[Number(k)] = v;
    }
    parsed.idIndex = idIndex;
    console.log(`  Converted idIndex from dict (${Object.keys(parsed.idIndex).length} keys) to array`);
  }
  if (!Array.isArray(parsed.idIndex)) {
    throw new Error('metadata.json missing idIndex (expected array or dict)');
  }

  // Handle metadataIndex vs metadata naming
  const metadata = parsed.metadata || parsed.metadataIndex;
  if (!metadata || typeof metadata !== 'object') {
    throw new Error('metadata.json missing metadata/metadataIndex map');
  }
  parsed.metadata = metadata;

  return parsed;
}

/**
 * Memory-map the vectors.bin file (Float32Array, 384 dims per vector).
 * Returns a Buffer; individual vectors are sliced on demand.
 */
function readVectorsBin(sourceDir) {
  const vectorsPath = path.join(sourceDir, 'vectors.bin');
  if (!fs.existsSync(vectorsPath)) {
    throw new Error(`Vectors binary not found: ${vectorsPath}`);
  }

  console.log('  Reading vectors.bin...');
  return fs.readFileSync(vectorsPath);
}

// ---------------------------------------------------------------------------
// Binary quantization
// ---------------------------------------------------------------------------

/**
 * Quantize a Float32Array vector to binary (1 bit per dimension).
 *
 * Scheme: for each float, if value >= 0 the bit is 1, otherwise 0.
 * Bits are packed MSB-first within each byte:
 *   byte[0] bit7 = dim 0, byte[0] bit6 = dim 1, ... byte[0] bit0 = dim 7
 *
 * This matches the dequantization in kb-loader.js:
 *   bitIdx = 7 - (j % 8)
 *   vector[j] = (byte[byteIdx] & (1 << bitIdx)) ? 1.0 : -1.0
 *
 * @param {Float32Array} vector - Source vector (384 floats)
 * @returns {Uint8Array} - Binary-quantized vector (48 bytes)
 */
function binaryQuantize(vector) {
  const numBytes = Math.ceil(vector.length / 8);
  const quantized = new Uint8Array(numBytes);

  for (let i = 0; i < vector.length; i++) {
    if (vector[i] >= 0) {
      const byteIdx = Math.floor(i / 8);
      const bitIdx = 7 - (i % 8);
      quantized[byteIdx] |= (1 << bitIdx);
    }
  }

  return quantized;
}

// ---------------------------------------------------------------------------
// Entry construction
// ---------------------------------------------------------------------------

/**
 * Build a single MCP kb-entry object from the source metadata.
 *
 * Output schema matches what kb-loader.js expects:
 *   { id, title, content, category, quality }
 *
 * We also include extended fields the user requested for richer querying:
 *   knowledge_type, package_name, concepts, expertise_level, source, is_curated
 */
function buildEntry(entryId, meta, index) {
  // Determine source bucket
  const source = meta.source || (entryId.startsWith('arch_') ? 'architecture_docs' : 'kb_complete');

  // Normalize concepts to an array (may be null or already an array)
  let concepts = meta.concepts || [];
  if (typeof concepts === 'string') {
    concepts = concepts.split(',').map(s => s.trim()).filter(Boolean);
  }

  return {
    id: index,
    title: meta.title || 'Untitled',
    content: meta.content || '',
    category: meta.category || 'general',
    quality: meta.quality_score ?? meta.quality ?? 50,
    knowledge_type: meta.knowledge_type || 'reference',
    package_name: meta.package_name || null,
    concepts: concepts,
    expertise_level: meta.expertise_level || 'intermediate',
    source: source,
    is_curated: meta.is_curated === true,
  };
}

// ---------------------------------------------------------------------------
// Category aggregation
// ---------------------------------------------------------------------------

/**
 * Build the categories array for kb-metadata.json from the entries list.
 * Returns sorted array of { name, count } objects.
 */
function buildCategories(entries) {
  const counts = new Map();
  for (const entry of entries) {
    const cat = entry.category;
    counts.set(cat, (counts.get(cat) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Main export pipeline
// ---------------------------------------------------------------------------

async function main() {
  const args = parseCLIArgs();

  console.log('=== RVF -> MCP KB Export ===');
  console.log(`  Source:  ${SOURCE_DIR}`);
  console.log(`  Output:  ${args.outputDir}`);
  console.log(`  Verbose: ${args.verbose}`);
  console.log('');

  // -----------------------------------------------------------------------
  // Step 1: Read source files
  // -----------------------------------------------------------------------
  console.log('[1/5] Reading source files...');

  const manifest = readManifest(SOURCE_DIR);
  console.log(`  Manifest: ${manifest.vectorCount.toLocaleString()} vectors, ${manifest.dimensions} dims`);

  const { idIndex, metadata: metadataMap } = readMetadata(SOURCE_DIR);
  console.log(`  idIndex:  ${idIndex.length.toLocaleString()} entries`);
  console.log(`  Metadata: ${Object.keys(metadataMap).length.toLocaleString()} entries`);

  const vectorsBuf = readVectorsBin(SOURCE_DIR);
  const expectedVectorBytes = manifest.vectorCount * BYTES_PER_VECTOR_F32;
  if (vectorsBuf.length !== expectedVectorBytes) {
    throw new Error(
      `vectors.bin size mismatch: got ${vectorsBuf.length} bytes, ` +
      `expected ${expectedVectorBytes} (${manifest.vectorCount} x ${BYTES_PER_VECTOR_F32})`
    );
  }

  // Sanity check: idIndex length should match vector count
  if (idIndex.length !== manifest.vectorCount) {
    console.warn(
      `  WARNING: idIndex has ${idIndex.length} entries but manifest says ${manifest.vectorCount} vectors. ` +
      `Using idIndex length as authoritative.`
    );
  }

  const entryCount = idIndex.length;

  // -----------------------------------------------------------------------
  // Step 2: Build kb-entries.json
  // -----------------------------------------------------------------------
  console.log(`\n[2/5] Building ${entryCount.toLocaleString()} entries...`);

  const entries = [];
  let skipped = 0;

  for (let i = 0; i < entryCount; i++) {
    const entryId = idIndex[i];
    // metadataIndex uses numeric keys ("0","1",...), not KB IDs ("kb_1",...)
    const meta = metadataMap[entryId] || metadataMap[String(i)];

    if (!meta) {
      skipped++;
      if (args.verbose) {
        console.warn(`  SKIP: No metadata for ${entryId} (index ${i})`);
      }
      // Still need a placeholder to keep vector alignment
      entries.push({
        id: i,
        title: entryId,
        content: '',
        category: 'general',
        quality: 0,
        knowledge_type: 'unknown',
        package_name: null,
        concepts: [],
        expertise_level: 'intermediate',
        source: entryId.startsWith('arch_') ? 'architecture_docs' : 'kb_complete',
        is_curated: false,
      });
      continue;
    }

    entries.push(buildEntry(entryId, meta, i));

    if (args.verbose && i % 10000 === 0 && i > 0) {
      console.log(`  Processed ${i.toLocaleString()} entries...`);
    }
  }

  if (skipped > 0) {
    console.warn(`  WARNING: ${skipped} entries had no metadata (placeholders inserted)`);
  }

  console.log(`  Built ${entries.length.toLocaleString()} entries (${skipped} placeholders)`);

  // -----------------------------------------------------------------------
  // Step 3: Binary-quantize all vectors
  // -----------------------------------------------------------------------
  console.log(`\n[3/5] Binary-quantizing ${entryCount.toLocaleString()} vectors (${DIMENSIONS} -> ${BYTES_PER_VECTOR_BIN} bytes each)...`);

  const outputBinSize = entryCount * BYTES_PER_VECTOR_BIN;
  const outputBinBuf = Buffer.alloc(outputBinSize);

  // We need to access the raw buffer as Float32Array chunks.
  // Node Buffer shares underlying ArrayBuffer, but offset/length may not
  // align to 4-byte boundary. Copy to a properly aligned ArrayBuffer.
  const alignedBuffer = new ArrayBuffer(vectorsBuf.length);
  const alignedView = new Uint8Array(alignedBuffer);
  alignedView.set(vectorsBuf);
  const allFloats = new Float32Array(alignedBuffer);

  for (let i = 0; i < entryCount; i++) {
    const floatOffset = i * DIMENSIONS;
    const vector = allFloats.subarray(floatOffset, floatOffset + DIMENSIONS);
    const quantized = binaryQuantize(vector);

    const binOffset = i * BYTES_PER_VECTOR_BIN;
    outputBinBuf.set(quantized, binOffset);

    if (args.verbose && i % 10000 === 0 && i > 0) {
      console.log(`  Quantized ${i.toLocaleString()} vectors...`);
    }
  }

  console.log(`  Output binary size: ${(outputBinSize / 1024 / 1024).toFixed(2)} MB`);

  // -----------------------------------------------------------------------
  // Step 4: Build kb-metadata.json
  // -----------------------------------------------------------------------
  console.log('\n[4/5] Building metadata...');

  const categories = buildCategories(entries);
  const kbMetadata = {
    version: '1.0.0',
    schema: 'ask_ruvnet',
    exportedAt: new Date().toISOString(),
    totalEntries: entries.length,
    embeddingDim: DIMENSIONS,
    quantization: 'binary',
    categories: categories,
    contentHash: manifest.savedAt
      ? Buffer.from(manifest.savedAt).toString('hex').substring(0, 16)
      : 'unknown',
  };

  console.log(`  Categories: ${categories.length}`);
  if (args.verbose) {
    for (const cat of categories.slice(0, 10)) {
      console.log(`    ${cat.name}: ${cat.count.toLocaleString()}`);
    }
    if (categories.length > 10) {
      console.log(`    ... and ${categories.length - 10} more`);
    }
  }

  // -----------------------------------------------------------------------
  // Step 5: Write output files
  // -----------------------------------------------------------------------
  console.log(`\n[5/5] Writing output files to ${args.outputDir}...`);

  // Ensure output directory exists
  if (!fs.existsSync(args.outputDir)) {
    fs.mkdirSync(args.outputDir, { recursive: true });
    console.log(`  Created output directory: ${args.outputDir}`);
  }

  // kb-entries.json
  const entriesPath = path.join(args.outputDir, 'kb-entries.json');
  const entriesJson = JSON.stringify(entries);
  fs.writeFileSync(entriesPath, entriesJson, 'utf-8');
  const entriesSizeMB = (Buffer.byteLength(entriesJson) / 1024 / 1024).toFixed(2);
  console.log(`  kb-entries.json:    ${entries.length.toLocaleString()} entries (${entriesSizeMB} MB)`);

  // kb-embeddings.bin
  const embeddingsPath = path.join(args.outputDir, 'kb-embeddings.bin');
  fs.writeFileSync(embeddingsPath, outputBinBuf);
  const embSizeMB = (outputBinBuf.length / 1024 / 1024).toFixed(2);
  console.log(`  kb-embeddings.bin:  ${entryCount.toLocaleString()} vectors (${embSizeMB} MB)`);

  // kb-metadata.json
  const metadataPath = path.join(args.outputDir, 'kb-metadata.json');
  fs.writeFileSync(metadataPath, JSON.stringify(kbMetadata, null, 2), 'utf-8');
  console.log(`  kb-metadata.json:   ${categories.length} categories`);

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log('\n=== Export Complete ===');
  console.log(`  Entries:      ${entries.length.toLocaleString()}`);
  console.log(`  Dimensions:   ${DIMENSIONS}`);
  console.log(`  Quantization: binary (${BYTES_PER_VECTOR_BIN} bytes/vector)`);
  console.log(`  Categories:   ${categories.length}`);
  console.log(`  Output dir:   ${args.outputDir}`);

  // Verify output matches expected format
  const verifyBin = fs.readFileSync(embeddingsPath);
  const expectedBinSize = entries.length * BYTES_PER_VECTOR_BIN;
  if (verifyBin.length !== expectedBinSize) {
    console.error(`\n  VERIFICATION FAILED: kb-embeddings.bin is ${verifyBin.length} bytes, expected ${expectedBinSize}`);
    process.exit(1);
  }
  console.log(`  Verification: PASSED (${verifyBin.length} bytes = ${entries.length} x ${BYTES_PER_VECTOR_BIN})`);

  // Auto-compress entries for MCP distribution
  const { gzipSync } = await import('node:zlib');
  const entriesRaw = fs.readFileSync(entriesPath);
  const entriesGz = gzipSync(entriesRaw, { level: 9 });
  const gzPath = entriesPath + '.gz';
  fs.writeFileSync(gzPath, entriesGz);
  const rawMB = (entriesRaw.length / 1048576).toFixed(1);
  const gzMB = (entriesGz.length / 1048576).toFixed(1);
  console.log(`  kb-entries.json.gz: ${gzMB} MB (compressed from ${rawMB} MB)`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error('\nFATAL:', err.message);
  if (err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
