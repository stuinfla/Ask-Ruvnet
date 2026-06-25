/**
 * Smart Markdown Chunker — Splits content by semantic boundaries
 *
 * The core fix for over-chunking: instead of fixed-size splits, this
 * parser respects markdown structure. Each top-level section becomes
 * one chunk. Large sections split by sub-headers. Code blocks and
 * paragraphs are never split mid-way.
 *
 * Rules:
 *   - Parse by markdown headers (# ## ### etc.)
 *   - Each top-level section (# or ##) becomes one chunk
 *   - If a section exceeds MAX_CHUNK_CHARS, split by sub-headers
 *   - Never split mid-paragraph or mid-code-block
 *   - Include parent header in each chunk for context
 *   - One file produces at most MAX_CHUNKS_PER_FILE entries
 */

const MAX_CHUNK_CHARS = 5000;
const MAX_CHUNKS_PER_FILE = 30;

/**
 * Parse markdown into a tree of sections keyed by header level.
 * Returns flat array of { header, level, body, children }.
 */
function parseMarkdownSections(markdown) {
  const lines = markdown.split('\n');
  const sections = [];
  let current = null;
  let bodyLines = [];
  let inCodeBlock = false;

  for (const line of lines) {
    // Track code fences so we don't mistake # inside code for headers
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      bodyLines.push(line);
      continue;
    }

    if (inCodeBlock) {
      bodyLines.push(line);
      continue;
    }

    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      // Flush previous section
      if (current) {
        current.body = bodyLines.join('\n').trim();
        sections.push(current);
      }
      current = {
        header: headerMatch[2].trim(),
        level: headerMatch[1].length,
        headerLine: line,
        body: '',
      };
      bodyLines = [];
    } else {
      bodyLines.push(line);
    }
  }

  // Flush last section
  if (current) {
    current.body = bodyLines.join('\n').trim();
    sections.push(current);
  }

  // If no headers found, treat entire content as one section
  if (sections.length === 0 && markdown.trim().length > 0) {
    sections.push({
      header: 'Content',
      level: 1,
      headerLine: '# Content',
      body: markdown.trim(),
    });
  }

  return sections;
}

/**
 * Group sections into top-level chunks. A top-level section (level 1 or 2)
 * absorbs all sub-sections until the next top-level header. If the
 * combined text exceeds MAX_CHUNK_CHARS, sub-sections become their own
 * chunks with the parent header prepended.
 */
function groupSections(sections) {
  if (sections.length === 0) return [];

  const groups = [];
  let currentGroup = null;

  for (const section of sections) {
    if (section.level <= 2) {
      // Start a new top-level group
      if (currentGroup) groups.push(currentGroup);
      currentGroup = {
        parentHeader: section.headerLine,
        parentSection: section,
        subSections: [],
      };
    } else if (currentGroup) {
      currentGroup.subSections.push(section);
    } else {
      // Orphan sub-section before any top-level header
      currentGroup = {
        parentHeader: null,
        parentSection: section,
        subSections: [],
      };
    }
  }
  if (currentGroup) groups.push(currentGroup);

  return groups;
}

/**
 * Assemble a group into one or more chunks. If the combined text is
 * small enough, it becomes a single chunk. Otherwise, sub-sections
 * are split out, each prefixed with the parent header.
 */
function assembleChunks(group) {
  const chunks = [];

  // Build the full combined text for this group
  let fullText = '';
  if (group.parentSection) {
    fullText += group.parentSection.headerLine + '\n\n' + group.parentSection.body;
  }
  for (const sub of group.subSections) {
    fullText += '\n\n' + sub.headerLine + '\n\n' + sub.body;
  }
  fullText = fullText.trim();

  if (fullText.length <= MAX_CHUNK_CHARS || group.subSections.length === 0) {
    // Fits in one chunk, or no sub-sections to split by
    chunks.push({
      header: group.parentSection?.header || 'Untitled',
      content: fullText,
    });
    return chunks;
  }

  // Too large — split by sub-sections
  // First chunk: parent header + its own body (without sub-sections)
  const parentText = group.parentSection.headerLine + '\n\n' + group.parentSection.body;
  if (parentText.trim().length > 0) {
    chunks.push({
      header: group.parentSection.header,
      content: parentText.trim(),
    });
  }

  // Each sub-section becomes its own chunk with parent context
  const parentPrefix = group.parentHeader ? group.parentHeader + '\n\n' : '';
  for (const sub of group.subSections) {
    const subText = parentPrefix + sub.headerLine + '\n\n' + sub.body;
    chunks.push({
      header: sub.header,
      content: subText.trim(),
    });
  }

  return chunks;
}

/**
 * Main entry point. Takes raw markdown, returns an array of chunks:
 *   [{ header: string, content: string }, ...]
 *
 * Guarantees:
 *   - No chunk splits mid-paragraph or mid-code-block
 *   - Each chunk has parent header context
 *   - At most MAX_CHUNKS_PER_FILE chunks returned
 *   - Empty/trivial sections are filtered out
 */
function smartChunk(markdown, { maxChunkChars = MAX_CHUNK_CHARS, maxChunks = MAX_CHUNKS_PER_FILE } = {}) {
  if (!markdown || typeof markdown !== 'string') return [];

  // Strip frontmatter (YAML between --- fences at file start)
  const stripped = markdown.replace(/^---[\s\S]*?---\n*/m, '').trim();
  if (stripped.length === 0) return [];

  const sections = parseMarkdownSections(stripped);
  const groups = groupSections(sections);

  let allChunks = [];
  for (const group of groups) {
    allChunks.push(...assembleChunks(group));
  }

  // Filter out trivially small chunks (less than 80 chars of actual content)
  allChunks = allChunks.filter(c => c.content.replace(/^#+\s+.+$/gm, '').trim().length >= 80);

  // Enforce max chunks limit — merge the smallest tail chunks if over
  if (allChunks.length > maxChunks) {
    // Keep the first maxChunks-1, merge the rest into the last slot
    const kept = allChunks.slice(0, maxChunks - 1);
    const overflow = allChunks.slice(maxChunks - 1);
    const merged = overflow.map(c => c.content).join('\n\n---\n\n');
    kept.push({
      header: `${overflow[0].header} (and ${overflow.length - 1} more)`,
      content: merged,
    });
    allChunks = kept;
  }

  return allChunks;
}

module.exports = { smartChunk, parseMarkdownSections, MAX_CHUNK_CHARS, MAX_CHUNKS_PER_FILE };
