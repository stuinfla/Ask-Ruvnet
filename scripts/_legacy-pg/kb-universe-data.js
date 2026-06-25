#!/usr/bin/env node
/**
 * KB Universe Data Generator
 * Updated: 2025-12-30 17:35:00 EST | Version 5.0.0
 * Created: 2025-12-30 09:45:00 EST
 *
 * Generates HIERARCHICAL JSON data structure from ruvector-postgres KB
 * for the Knowledge Universe visualization.
 *
 * HIERARCHY:
 * - Level 0: Project (center)
 * - Level 1: Major Themes (6-8 top-level categories)
 * - Level 2: Sub-themes (specific topics)
 * - Level 3: Individual KB entries
 *
 * Usage: node scripts/kb-universe-data.js [--output path]
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Configuration
const KB_PORT = process.env.KB_PORT || 5435;
const KB_PASSWORD = process.env.KB_PASSWORD || process.env.RUVECTOR_PASSWORD || '';

// =============================================================================
// TAXONOMY CONSTRAINTS (Cognitive Science Rules)
// =============================================================================
// Max 9 nodes at any level forces smarter taxonomy and better human comprehension
const MAX_LEVEL1_THEMES = 9;
const MAX_LEVEL2_SUBTHEMES = 9; // Per theme
const MERGE_THRESHOLD = 3; // Themes with fewer items get merged into "General"

// =============================================================================
// HIERARCHICAL TAXONOMY DEFINITION
// =============================================================================

// =============================================================================
// CONCEPTUAL TAXONOMY (Human-Centric)
// =============================================================================
// Organized by WHAT you learn, not WHERE it came from
// Tool names are metadata, not categories

const TAXONOMY = {
    'Agent Systems': {
        color: '#8b5cf6', // violet
        icon: '🤖',
        description: 'How agents work, spawn, coordinate, and form swarms',
        subThemes: [
            'Agent Types & Spawning',   // Types of agents, how to spawn them
            'Swarm Topologies',         // Mesh, hierarchical, ring, star, adaptive
            'Coordination Protocols',   // How agents coordinate and communicate
            'Consensus Mechanisms',     // Byzantine, Raft, CRDT, Gossip
            'Hive Mind Patterns',       // Collective intelligence, shared memory
        ]
    },
    'AI & Learning': {
        color: '#ec4899', // pink
        icon: '🧠',
        description: 'Neural networks, reinforcement learning, and reasoning',
        subThemes: [
            'Neural Networks',          // Training, architectures, transformers
            'Reinforcement Learning',   // RL algorithms, experience replay
            'Knowledge Distillation',   // Model compression, transfer learning
            'Reasoning Patterns',       // Causal, sublinear, strange loop
            'SPARC Methodology',        // Systematic development approach
        ]
    },
    'Data & Storage': {
        color: '#06b6d4', // cyan
        icon: '💾',
        description: 'Vector databases, memory systems, and embeddings',
        subThemes: [
            'Vector Search & HNSW',     // Semantic search, similarity
            'Memory Architectures',     // Episodic, semantic, working memory
            'Embeddings & Indexing',    // How data is encoded and retrieved
            'Tiered Storage',           // Hot/warm/cold, compression
            'Distributed Sync',         // QUIC, federated, multi-node
        ]
    },
    'Infrastructure': {
        color: '#f97316', // orange
        icon: '🚀',
        description: 'Deployment, performance, security, and reliability',
        subThemes: [
            'Deployment Patterns',      // Docker, Railway, Kubernetes, air-gapped
            'Performance & SIMD',       // WASM acceleration, optimization
            'Security & Access',        // Authentication, authorization
            'Reliability & Recovery',   // Error handling, fault tolerance
            'Monitoring & Ops',         // Observability, metrics, logs
        ]
    },
    'Developer Guide': {
        color: '#22c55e', // green
        icon: '📐',
        description: 'APIs, SDKs, skills, and best practices',
        subThemes: [
            'API Reference',            // Complete API documentation
            'SDK & CLI Tools',          // Command-line interfaces
            'Skills & Hooks',           // Claude skills, hooks automation
            'Best Practices',           // Patterns to follow
            'Tutorials & Examples',     // Step-by-step guides
        ]
    },
    'Knowledge Base': {
        color: '#3b82f6', // blue
        icon: '📚',
        description: 'Building, using, and querying knowledge bases',
        subThemes: [
            'KB Construction',          // How to build a KB
            'KB-Gateway & MCP',         // Code generation through KB
            'Quality & Scoring',        // Quality loops, scoring dimensions
            'Visualization',            // Knowledge Universe, navigation
            'Multi-Tenant KB',          // Schema isolation, business separation
        ]
    },
    'Platform Overview': {
        color: '#64748b', // slate
        icon: '🔧',
        description: 'RuvNet ecosystem packages and architecture',
        subThemes: [
            'Ecosystem Architecture',   // How packages fit together
            'Package Guide',            // Which package for what
            'Flow Nexus Cloud',         // Cloud platform features
            'Integration Patterns',     // How to integrate components
        ]
    }
};

// Map sub-themes to their parent theme
const SUB_THEME_TO_THEME = {};
for (const [theme, config] of Object.entries(TAXONOMY)) {
    for (const subTheme of config.subThemes) {
        SUB_THEME_TO_THEME[subTheme] = theme;
    }
}

// Get project info
function getProjectInfo() {
    const repoName = path.basename(process.cwd());
    const pkgPath = path.join(process.cwd(), 'package.json');
    let version = '1.0.0';
    let description = 'Knowledge Base';

    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            version = pkg.version || '1.0.0';
            description = pkg.description || 'Knowledge Base';
        } catch (e) {}
    }

    return { name: repoName, version, description };
}

// Get schema name from project
function getSchemaName() {
    const projectDir = path.basename(process.cwd());
    return projectDir.toLowerCase().replace(/-/g, '_').replace(/ /g, '_');
}

// =============================================================================
// CONCEPTUAL CATEGORY EXTRACTION
// =============================================================================
// Maps content to CONCEPTS, not tools. Asks "What does this teach?"

function extractSubTheme(filePath, title = '', content = '') {
    if (!filePath) return 'General';

    const searchText = `${filePath} ${title} ${content}`.toLowerCase();
    const relativePath = filePath.toLowerCase();

    // Priority 1: Agent Systems - How agents work
    const agentPatterns = [
        { pattern: /agent[- ]?type|agent[- ]?catalog|spawning|spawn[- ]?pattern|agent[- ]?spawn/i, category: 'Agent Types & Spawning' },
        { pattern: /swarm|topology|mesh|ring|star|hierarchical.?swarm/i, category: 'Swarm Topologies' },
        { pattern: /coordination|orchestrat|task.?distribut|load.?balanc/i, category: 'Coordination Protocols' },
        { pattern: /byzantine|raft|crdt|gossip|consensus|quorum/i, category: 'Consensus Mechanisms' },
        { pattern: /hive.?mind|collective|shared.?memory|swarm.?memory/i, category: 'Hive Mind Patterns' },
    ];

    for (const { pattern, category } of agentPatterns) {
        if (pattern.test(searchText)) return category;
    }

    // Priority 2: AI & Learning - Neural, ML, reasoning
    const aiPatterns = [
        { pattern: /neural|transformer|training|model.?train|deep.?learn/i, category: 'Neural Networks' },
        { pattern: /reinforcement|rl[- ]algorithm|actor.?critic|ppo|sac|q-learning|sarsa|decision.?transformer/i, category: 'Reinforcement Learning' },
        { pattern: /distillation|transfer.?learn|ewc|consolidat|compress.?model/i, category: 'Knowledge Distillation' },
        { pattern: /reason|causal|sublinear|strange.?loop|inference/i, category: 'Reasoning Patterns' },
        { pattern: /sparc|specification|pseudocode|refinement/i, category: 'SPARC Methodology' },
    ];

    for (const { pattern, category } of aiPatterns) {
        if (pattern.test(searchText)) return category;
    }

    // Priority 3: Data & Storage - Databases, memory, embeddings
    const dataPatterns = [
        { pattern: /vector|hnsw|similarity|semantic.?search|embedding.?search/i, category: 'Vector Search & HNSW' },
        { pattern: /episodic|semantic.?memory|working.?memory|memory.?architect/i, category: 'Memory Architectures' },
        { pattern: /embedding|index|chunk|tokeniz/i, category: 'Embeddings & Indexing' },
        { pattern: /tiered|compress|hot.?cold|storage.?tier/i, category: 'Tiered Storage' },
        { pattern: /quic|federat|sync|merkle|distributed.?db/i, category: 'Distributed Sync' },
    ];

    for (const { pattern, category } of dataPatterns) {
        if (pattern.test(searchText)) return category;
    }

    // Priority 4: Infrastructure - Ops, security, deployment
    const infraPatterns = [
        { pattern: /deploy|docker|railway|kubernetes|k8s|air.?gap/i, category: 'Deployment Patterns' },
        { pattern: /wasm|simd|accelerat|optimi|performance/i, category: 'Performance & SIMD' },
        { pattern: /security|access.?control|auth|permission|credential/i, category: 'Security & Access' },
        { pattern: /error|recovery|fault|reliab|resilien/i, category: 'Reliability & Recovery' },
        { pattern: /monitor|observ|metric|log|scalab/i, category: 'Monitoring & Ops' },
    ];

    for (const { pattern, category } of infraPatterns) {
        if (pattern.test(searchText)) return category;
    }

    // Priority 5: Developer Guide - APIs, tools, practices
    const devPatterns = [
        { pattern: /api[- ]?reference|endpoint|http|rest|graphql/i, category: 'API Reference' },
        { pattern: /sdk|cli|command.?line|npx|terminal/i, category: 'SDK & CLI Tools' },
        { pattern: /skill|hook|automation|trigger/i, category: 'Skills & Hooks' },
        { pattern: /best.?practice|pattern|guideline|convention/i, category: 'Best Practices' },
        { pattern: /tutorial|example|walkthrough|getting.?start|quickstart/i, category: 'Tutorials & Examples' },
    ];

    for (const { pattern, category } of devPatterns) {
        if (pattern.test(searchText)) return category;
    }

    // Priority 6: Knowledge Base - KB-specific
    const kbPatterns = [
        { pattern: /kb.?construct|build.?kb|knowledge.?base.?creation/i, category: 'KB Construction' },
        { pattern: /kb.?gateway|mcp|code.?gen|citation/i, category: 'KB-Gateway & MCP' },
        { pattern: /quality|score|dimension|loop|iteration/i, category: 'Quality & Scoring' },
        { pattern: /visual|universe|orbit|chart|graph/i, category: 'Visualization' },
        { pattern: /multi.?tenant|schema.?isol|business.?sep/i, category: 'Multi-Tenant KB' },
    ];

    for (const { pattern, category } of kbPatterns) {
        if (pattern.test(searchText)) return category;
    }

    // Priority 7: Platform Overview - Ecosystem docs
    const platformPatterns = [
        { pattern: /ecosystem|architecture.?overview|system.?design/i, category: 'Ecosystem Architecture' },
        { pattern: /package|npm|install|dependency/i, category: 'Package Guide' },
        { pattern: /flow.?nexus|cloud|saas|platform/i, category: 'Flow Nexus Cloud' },
        { pattern: /integrat|connect|combine/i, category: 'Integration Patterns' },
    ];

    for (const { pattern, category } of platformPatterns) {
        if (pattern.test(searchText)) return category;
    }

    // Fallback: Folder-based hints
    if (relativePath.includes('ruvnet') || relativePath.includes('agentic') || relativePath.includes('ruflo')) {
        return 'Ecosystem Architecture';
    }

    return 'General';
}

// Get parent theme for a sub-theme
function getParentTheme(subTheme) {
    return SUB_THEME_TO_THEME[subTheme] || 'Developer Guide';
}

// =============================================================================
// CLUSTER ITEMS INTO SUB-SUB-THEMES (Level 3)
// =============================================================================
// If a sub-theme has too many items, cluster them by source file patterns

const MAX_ITEMS_BEFORE_CLUSTER = 15; // Create clusters when more than this

function clusterItems(items, color) {
    if (items.length <= MAX_ITEMS_BEFORE_CLUSTER) {
        // Small enough - return items directly at level 4
        return items.map(item => ({ ...item, color, level: 4 }));
    }

    // Group by source document (file path)
    const bySource = {};
    for (const item of items) {
        // Extract meaningful file name from path
        const source = item.source || '';
        let clusterName = 'Miscellaneous';

        // Try to extract document name
        const match = source.match(/([^/]+)\.(md|txt|json|js|ts)$/i);
        if (match) {
            clusterName = match[1]
                .replace(/-/g, ' ')
                .replace(/_/g, ' ')
                .replace(/\b\w/g, l => l.toUpperCase())
                .substring(0, 30);
        }

        if (!bySource[clusterName]) {
            bySource[clusterName] = [];
        }
        bySource[clusterName].push(item);
    }

    // Convert to sub-sub-theme nodes (level 3)
    const clusters = Object.entries(bySource)
        .map(([name, clusterItems]) => ({
            id: `cluster_${name}`.replace(/\s+/g, '_').toLowerCase(),
            name: name,
            color: color,
            count: clusterItems.length,
            level: 3,
            children: clusterItems.map(item => ({
                ...item,
                color: color,
                level: 4
            }))
        }))
        .sort((a, b) => b.count - a.count);

    // If too many clusters, merge the smallest
    if (clusters.length > 9) {
        const keep = clusters.slice(0, 8);
        const merge = clusters.slice(8);
        keep.push({
            id: 'cluster_other',
            name: 'Other Documents',
            color: color,
            count: merge.reduce((sum, c) => sum + c.count, 0),
            level: 3,
            children: merge.flatMap(c => c.children)
        });
        return keep;
    }

    return clusters;
}

// =============================================================================
// QUALITY SCORING
// =============================================================================

function calculateScore(rows, themeNodes) {
    const totalItems = rows.length;
    const themeCount = themeNodes.length;
    const subThemeCount = themeNodes.reduce((sum, t) => sum + t.children.length, 0);

    // Score each dimension 1-100
    const dimensions = {
        completeness: Math.min(100, Math.round((totalItems / 500) * 100)),
        depth: Math.min(100, Math.round((subThemeCount / 30) * 100)),
        coverage: Math.min(100, Math.round((themeCount / 7) * 100)),
        structure: totalItems > 0 ? Math.round((subThemeCount / themeCount) * 15) : 0,
        density: Math.min(100, Math.round((totalItems / subThemeCount) * 3))
    };

    // Calculate overall score (weighted average)
    const overall = Math.round(
        dimensions.completeness * 0.25 +
        dimensions.depth * 0.25 +
        dimensions.coverage * 0.20 +
        dimensions.structure * 0.15 +
        dimensions.density * 0.15
    );

    return {
        overall,
        grade: overall >= 90 ? 'A' : overall >= 80 ? 'B' : overall >= 70 ? 'C' : overall >= 60 ? 'D' : 'F',
        dimensions,
        recommendations: generateRecommendations(dimensions, totalItems, themeCount)
    };
}

function generateRecommendations(dimensions, totalItems, themeCount) {
    const recs = [];

    if (dimensions.completeness < 80) {
        recs.push({ priority: 'high', action: 'Add more content', detail: `Currently at ${totalItems} items. Target: 500+` });
    }
    if (dimensions.depth < 70) {
        recs.push({ priority: 'medium', action: 'Improve categorization', detail: 'Add more sub-themes for better navigation' });
    }
    if (dimensions.coverage < 80 && themeCount < 6) {
        recs.push({ priority: 'medium', action: 'Expand topics', detail: 'Cover more domain areas' });
    }

    return recs;
}

// =============================================================================
// HIERARCHICAL STRUCTURE BUILDER (4 Levels)
// =============================================================================

function buildHierarchy(rows, projectInfo) {
    // Step 1: Group by sub-theme
    const subThemeGroups = {};

    for (const row of rows) {
        const subTheme = extractSubTheme(row.source, row.title, row.content);

        if (!subThemeGroups[subTheme]) {
            subThemeGroups[subTheme] = [];
        }

        subThemeGroups[subTheme].push({
            id: `item_${row.id}`,
            name: row.title || 'Untitled',
            description: (row.content || '').substring(0, 150) + '...',
            source: row.source,
            type: row.type || 'document'
        });
    }

    // Step 2: Group sub-themes by parent theme
    const themeGroups = {};

    for (const [subTheme, items] of Object.entries(subThemeGroups)) {
        const theme = getParentTheme(subTheme);

        if (!themeGroups[theme]) {
            themeGroups[theme] = {};
        }

        themeGroups[theme][subTheme] = items;
    }

    // Step 3: Build 4-level hierarchical tree
    const themeNodes = [];

    for (const [themeName, themeConfig] of Object.entries(TAXONOMY)) {
        const subThemes = themeGroups[themeName] || {};

        // Skip empty themes
        const totalItems = Object.values(subThemes).reduce((sum, items) => sum + items.length, 0);
        if (totalItems === 0) continue;

        const subThemeNodes = Object.entries(subThemes).map(([subThemeName, items]) => {
            // IMPORTANT: Cluster large sub-themes into sub-sub-themes (level 3)
            const clusteredChildren = clusterItems(items, themeConfig.color);

            return {
                id: `sub_${subThemeName}`.replace(/\s+/g, '_').toLowerCase(),
                name: subThemeName,
                color: themeConfig.color,
                count: items.length,
                level: 2,
                children: clusteredChildren
            };
        });

        themeNodes.push({
            id: `theme_${themeName}`.replace(/\s+/g, '_').toLowerCase(),
            name: `${themeConfig.icon} ${themeName}`,
            color: themeConfig.color,
            count: totalItems,
            level: 1,
            children: subThemeNodes
        });
    }

    // Handle "General" items that don't fit taxonomy
    if (subThemeGroups['General'] && subThemeGroups['General'].length > 0) {
        const generalItems = subThemeGroups['General'];
        themeNodes.push({
            id: 'theme_general',
            name: '📦 General',
            color: '#6b7280',
            count: generalItems.length,
            level: 1,
            children: [{
                id: 'sub_general',
                name: 'Uncategorized',
                color: '#6b7280',
                count: generalItems.length,
                level: 2,
                children: clusterItems(generalItems, '#6b7280')
            }]
        });
    }

    // Sort themes by item count (largest first)
    themeNodes.sort((a, b) => b.count - a.count);

    // ENFORCE MAX 9 THEMES RULE
    // If more than MAX_LEVEL1_THEMES, merge smallest into "General"
    if (themeNodes.length > MAX_LEVEL1_THEMES) {
        console.log(`\n⚠️  Enforcing max ${MAX_LEVEL1_THEMES} themes rule...`);

        // Find or create General theme
        let generalTheme = themeNodes.find(t => t.name.includes('General'));
        if (!generalTheme) {
            generalTheme = {
                id: 'theme_general',
                name: '📦 General',
                color: '#6b7280',
                count: 0,
                level: 1,
                children: []
            };
            themeNodes.push(generalTheme);
        }

        // Merge themes beyond the limit into General
        while (themeNodes.length > MAX_LEVEL1_THEMES) {
            // Get smallest non-General theme
            const smallestIdx = themeNodes.findIndex(t =>
                !t.name.includes('General') &&
                t.count === Math.min(...themeNodes.filter(x => !x.name.includes('General')).map(x => x.count))
            );

            if (smallestIdx === -1) break;

            const smallest = themeNodes[smallestIdx];
            console.log(`   Merging "${smallest.name}" (${smallest.count} items) into General`);

            // Move its children to General as a sub-theme
            generalTheme.children.push({
                id: smallest.id.replace('theme_', 'sub_merged_'),
                name: smallest.name.replace(/^[^\s]+\s/, ''), // Remove emoji
                color: smallest.color,
                count: smallest.count,
                level: 2,
                children: smallest.children.flatMap(c => c.children || [c])
            });
            generalTheme.count += smallest.count;

            // Remove the merged theme
            themeNodes.splice(smallestIdx, 1);
        }

        // Re-sort after merging
        themeNodes.sort((a, b) => b.count - a.count);
    }

    // Enforce max 9 sub-themes per theme
    for (const theme of themeNodes) {
        if (theme.children.length > MAX_LEVEL2_SUBTHEMES) {
            console.log(`   Theme "${theme.name}" has ${theme.children.length} sub-themes, consolidating to ${MAX_LEVEL2_SUBTHEMES}...`);

            // Sort by count, keep top (MAX-1), merge rest into "Other"
            theme.children.sort((a, b) => b.count - a.count);
            const keep = theme.children.slice(0, MAX_LEVEL2_SUBTHEMES - 1);
            const merge = theme.children.slice(MAX_LEVEL2_SUBTHEMES - 1);

            const otherSubTheme = {
                id: `sub_${theme.name}_other`.replace(/\s+/g, '_').toLowerCase(),
                name: 'Other',
                color: theme.color,
                count: merge.reduce((sum, s) => sum + s.count, 0),
                level: 2,
                children: merge.flatMap(s => s.children)
            };

            theme.children = [...keep, otherSubTheme];
        }
    }

    // Calculate quality score
    const score = calculateScore(rows, themeNodes);

    // Count total clusters (level 3)
    let clusterCount = 0;
    for (const theme of themeNodes) {
        for (const subTheme of theme.children) {
            if (subTheme.children && subTheme.children[0]?.level === 3) {
                clusterCount += subTheme.children.length;
            }
        }
    }

    return {
        id: 'root',
        name: projectInfo.name,
        color: '#64b5f6',
        description: projectInfo.description,
        version: projectInfo.version,
        level: 0,
        children: themeNodes,
        score,  // Include quality scores for the dashboard
        metadata: {
            totalItems: rows.length,
            themeCount: themeNodes.length,
            subThemeCount: themeNodes.reduce((sum, t) => sum + t.children.length, 0),
            clusterCount,
            generatedAt: new Date().toISOString(),
            taxonomy: Object.keys(TAXONOMY),
            levels: 4  // Now 4 levels deep
        }
    };
}

// =============================================================================
// MAIN EXECUTION
// =============================================================================

async function main() {
    const projectInfo = getProjectInfo();
    const schemaName = getSchemaName();

    console.log(`📊 KB Universe Data Generator v5.0.0 (4-Level Hierarchy)`);
    console.log(`   Project: ${projectInfo.name}`);
    console.log(`   Schema: ${schemaName}`);
    console.log(`   Taxonomy: ${Object.keys(TAXONOMY).length} themes\n`);

    const pool = new Pool({
        host: 'localhost',
        port: KB_PORT,
        user: 'postgres',
        password: KB_PASSWORD,
        database: 'postgres'
    });

    try {
        // Check schema exists
        const schemaCheck = await pool.query(`
            SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name = $1)
        `, [schemaName]);

        if (!schemaCheck.rows[0].exists) {
            console.error(`❌ Schema '${schemaName}' not found`);
            process.exit(1);
        }

        // Check for architecture_docs table
        const tableCheck = await pool.query(`
            SELECT EXISTS(
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = $1 AND table_name = 'architecture_docs'
            )
        `, [schemaName]);

        if (!tableCheck.rows[0].exists) {
            console.error(`❌ Table '${schemaName}.architecture_docs' not found`);
            process.exit(1);
        }

        // Fetch all KB entries
        const result = await pool.query(`
            SELECT
                id,
                title,
                LEFT(content, 500) as content,
                file_path as source,
                'document' as type
            FROM ${schemaName}.architecture_docs
            ORDER BY id
        `);

        console.log(`   Found ${result.rows.length} KB entries`);

        // Build hierarchical structure
        const hierarchy = buildHierarchy(result.rows, projectInfo);

        // Output stats
        console.log(`\n📊 4-Level Hierarchy Built:`);
        console.log(`   Level 0 (Center): ${projectInfo.name}`);
        console.log(`   Level 1 (Themes): ${hierarchy.metadata.themeCount}`);
        console.log(`   Level 2 (Sub-themes): ${hierarchy.metadata.subThemeCount}`);
        console.log(`   Level 3 (Clusters): ${hierarchy.metadata.clusterCount}`);
        console.log(`   Level 4 (Items): ${hierarchy.metadata.totalItems}`);

        // Show theme breakdown
        console.log(`\n🎨 Theme Breakdown:`);
        for (const theme of hierarchy.children) {
            const subCount = theme.children.length;
            console.log(`   ${theme.name}: ${theme.count} items in ${subCount} sub-themes`);
        }

        // Write output
        const outputPath = process.argv.includes('--output')
            ? process.argv[process.argv.indexOf('--output') + 1]
            : path.join(process.cwd(), 'public', 'kb-universe-data.json');

        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, JSON.stringify(hierarchy, null, 2));

        console.log(`\n✅ Output written to: ${outputPath}`);

        // Show quality score
        const { score } = hierarchy;
        console.log(`\n📈 KB Quality Score: ${score.overall}/100 (Grade: ${score.grade})`);
        console.log(`   Completeness: ${score.dimensions.completeness}/100`);
        console.log(`   Depth:        ${score.dimensions.depth}/100`);
        console.log(`   Coverage:     ${score.dimensions.coverage}/100`);
        console.log(`   Structure:    ${score.dimensions.structure}/100`);
        console.log(`   Density:      ${score.dimensions.density}/100`);

        if (score.recommendations.length > 0) {
            console.log(`\n💡 Recommendations:`);
            for (const rec of score.recommendations) {
                console.log(`   [${rec.priority.toUpperCase()}] ${rec.action}: ${rec.detail}`);
            }
        }

    } catch (err) {
        console.error(`❌ Error: ${err.message}`);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main().catch(console.error);
