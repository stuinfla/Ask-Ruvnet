#!/usr/bin/env node
/**
 * Ingest npm changelogs and GitHub releases for key RuvNet packages
 * into ask_ruvnet.architecture_docs PostgreSQL table.
 *
 * Packages:
 *   1. @claude-flow/cli  (GitHub: ruvnet/ruflo, npm: @claude-flow/cli)
 *   2. ruvector           (GitHub: ruvnet/ruvector, no npm)
 *   3. agentic-flow       (GitHub: ruvnet/agentic-flow, npm: agentic-flow)
 */
import pg from 'pg';
import crypto from 'crypto';
import { execSync } from 'child_process';

const SCHEMA = 'ask_ruvnet';
const TABLE = 'architecture_docs';
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;
const QUALITY_SCORE = 85;

const pool = new pg.Pool({
  host: 'localhost',
  port: 5435,
  user: 'postgres',
  password: '',
  database: 'postgres',
  max: 4
});

const PACKAGES = [
  { name: '@claude-flow/cli', repo: 'ruflo', npm: '@claude-flow/cli' },
  { name: 'ruvector',         repo: 'ruvector',    npm: null },
  { name: 'agentic-flow',     repo: 'agentic-flow', npm: 'agentic-flow' }
];

// --------------- Embedding Service ---------------

let embedSvc = null;

async function initEmbedding() {
  const embeddingsPath = '/Users/stuartkerr/.npm-global/lib/node_modules/@claude-flow/cli/node_modules/@claude-flow/embeddings/dist/index.js';
  const mod = await import(embeddingsPath);
  embedSvc = await mod.createEmbeddingServiceAsync({
    provider: 'transformers',
    model: 'Xenova/all-MiniLM-L6-v2',
    dimensions: 384
  });
  await embedSvc.embed('warmup');
  console.log('ONNX embedding service ready.');
}

async function getEmbedding(text) {
  if (!embedSvc) return null;
  try {
    const result = await embedSvc.embed(text.slice(0, 2000));
    return Array.isArray(result) ? result : (result.embedding || result);
  } catch {
    return null;
  }
}

// --------------- Helpers ---------------

function md5(text) {
  return crypto.createHash('md5').update(text).digest('hex');
}

function chunkText(text, maxSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  if (!text || text.length <= maxSize) return [text || ''];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxSize, text.length);
    chunks.push(text.slice(start, end));
    start = end - overlap;
    if (start >= text.length - overlap) break;
  }
  return chunks;
}

function sanitize(str) {
  if (!str) return '';
  return str.replace(/\x00/g, '');
}

// --------------- GitHub Releases ---------------
// Note: execSync with hardcoded command strings only (no user input).

function fetchGitHubReleases(repo) {
  try {
    const raw = execSync(
      `gh api repos/ruvnet/${repo}/releases --paginate 2>/dev/null`,
      { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 30000 }
    );
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`  Warning: Could not fetch GitHub releases for ruvnet/${repo}: ${e.message?.slice(0, 120)}`);
    return [];
  }
}

// --------------- npm Registry ---------------

async function fetchNpmVersions(pkgName) {
  try {
    const encodedName = encodeURIComponent(pkgName).replace('%40', '@');
    const url = `https://registry.npmjs.org/${encodedName}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  Warning: npm registry returned ${res.status} for ${pkgName}`);
      return [];
    }
    const data = await res.json();
    const versions = data.versions || {};
    const times = data.time || {};

    return Object.entries(versions).map(([ver, meta]) => ({
      version: ver,
      name: meta.name,
      description: meta.description || '',
      date: times[ver] || '',
      dist: meta.dist || {}
    }));
  } catch (e) {
    console.warn(`  Warning: Could not fetch npm data for ${pkgName}: ${e.message?.slice(0, 120)}`);
    return [];
  }
}

// --------------- Insert ---------------

async function insertRow(client, { docId, title, content, filePath, packageName, packageVersion, docType, category }) {
  const vec = await getEmbedding(content);
  const vecStr = vec ? `'[${vec.join(',')}]'::ruvector(384)` : 'NULL';

  const sql = `
    INSERT INTO ${SCHEMA}.${TABLE}
      (doc_id, title, content, file_path, file_hash, package_name, package_version,
       doc_type, category, quality_score, is_duplicate, embedding)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ${QUALITY_SCORE}, false, ${vecStr})
    ON CONFLICT (doc_id) DO NOTHING
  `;

  const res = await client.query(sql, [
    docId,
    sanitize(title),
    sanitize(content),
    filePath,
    md5(content),
    packageName,
    packageVersion || '',
    docType || 'developer-changelog',
    category || 'releases'
  ]);
  return res.rowCount;
}

// --------------- Main ---------------

async function main() {
  console.log('=== RuvNet Changelog & Release Ingestion ===\n');

  await initEmbedding();

  const client = await pool.connect();
  const stats = {};

  try {
    for (const pkg of PACKAGES) {
      console.log(`\n--- ${pkg.name} (ruvnet/${pkg.repo}) ---`);
      let inserted = 0;
      let skipped = 0;

      // 1. GitHub Releases
      console.log('  Fetching GitHub releases...');
      const releases = fetchGitHubReleases(pkg.repo);
      console.log(`  Found ${releases.length} GitHub releases.`);

      for (const rel of releases) {
        const version = rel.tag_name || rel.name || 'unknown';
        const relName = rel.name || version;
        const body = rel.body || `Release ${version} of ${pkg.name}`;

        const chunks = chunkText(body);
        for (let i = 0; i < chunks.length; i++) {
          const chunkLabel = chunks.length > 1 ? ` (part ${i + 1}/${chunks.length})` : '';
          const title = `${pkg.name} ${version} - ${relName}${chunkLabel}`;
          const docId = `changelog-gh-${pkg.repo}-${version}-${i}`;

          const count = await insertRow(client, {
            docId,
            title,
            content: chunks[i],
            filePath: `github:ruvnet/${pkg.repo}/releases/${version}`,
            packageName: pkg.name,
            packageVersion: version,
            docType: 'developer-changelog',
            category: 'releases'
          });
          if (count > 0) inserted++; else skipped++;
        }
      }

      // 2. npm Changelog (if applicable)
      if (pkg.npm) {
        console.log(`  Fetching npm versions for ${pkg.npm}...`);
        const npmVersions = await fetchNpmVersions(pkg.npm);
        console.log(`  Found ${npmVersions.length} npm versions.`);

        for (const ver of npmVersions) {
          const content = [
            `Package: ${ver.name || pkg.npm}`,
            `Version: ${ver.version}`,
            `Published: ${ver.date}`,
            ver.description ? `Description: ${ver.description}` : '',
            ver.dist?.shasum ? `Shasum: ${ver.dist.shasum}` : ''
          ].filter(Boolean).join('\n');

          const title = `${pkg.name} ${ver.version} - npm release`;
          const docId = `changelog-npm-${pkg.npm.replace('/', '-')}-${ver.version}`;

          const count = await insertRow(client, {
            docId,
            title,
            content,
            filePath: `npm:${pkg.npm}/${ver.version}`,
            packageName: pkg.name,
            packageVersion: ver.version,
            docType: 'developer-changelog',
            category: 'releases'
          });
          if (count > 0) inserted++; else skipped++;
        }
      }

      stats[pkg.name] = { inserted, skipped };
      console.log(`  Result: ${inserted} inserted, ${skipped} skipped (duplicates).`);
    }

    // Summary
    console.log('\n=== Summary ===');
    let totalInserted = 0;
    for (const [name, s] of Object.entries(stats)) {
      console.log(`  ${name}: ${s.inserted} new entries (${s.skipped} skipped)`);
      totalInserted += s.inserted;
    }
    console.log(`\n  Total new entries: ${totalInserted}`);

    // Verify
    const countRes = await client.query(
      `SELECT COUNT(*) as cnt FROM ${SCHEMA}.${TABLE} WHERE doc_type = 'developer-changelog'`
    );
    console.log(`  Total changelog rows in DB: ${countRes.rows[0].cnt}`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
