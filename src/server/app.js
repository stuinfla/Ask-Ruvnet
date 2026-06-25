const startupTime = Date.now();
const express = require('express');
process.env.FORCE_TRANSFORMERS = 'true';
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
// RVF Native: embedded vector search via knowledge.rvf + content sidecar
const StoreClass = require('../core/RvfStore');
const HybridSearch = require('../core/HybridSearch');
const TextChunker = require('../core/TextChunker');
const QueryExpander = require('../core/QueryExpander');
const ReRanker = require('../core/ReRanker');
const ContextCompressor = require('../core/ContextCompressor');
const MultiHopRetriever = require('../core/MultiHopRetriever');
const ResponseValidator = require('../core/ResponseValidator');
const { OpenAI } = require('openai');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// Version from single source of truth (package.json)
const { version: APP_VERSION } = require('../../package.json');

// ============================================================================
// Input Sanitization & Prompt Injection Protection
// ============================================================================
const PROMPT_INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?previous\s+instructions/i,
    /you\s+are\s+now/i,
    /system\s+prompt\s*:/i,
    /forget\s+(all\s+)?your\s+instructions/i,
    /disregard\s+(all\s+)?(above|previous|prior)/i,
    /new\s+instructions\s*:/i,
    /\bact\s+as\s+(if\s+)?you\s+are\b/i,
    /\bpretend\s+(to\s+be|you\s+are)\b/i,
    /\boverride\s+(your|all|the)\s+(instructions|rules|system)\b/i,
    /\bdo\s+not\s+follow\s+(your|the|any)\s+(instructions|rules|guidelines)\b/i,
];

/**
 * Sanitize user input text before it enters any processing pipeline.
 * - Strips HTML tags
 * - Removes control characters (preserves newlines and tabs)
 * - Detects and strips prompt injection attempts (logs warning)
 * - Truncates to 10,000 characters
 * @param {string} text - Raw user input
 * @returns {string} Cleaned text safe for pipeline consumption
 */
function sanitizeInput(text) {
    if (typeof text !== 'string') return '';

    let cleaned = text;

    // 1. Strip HTML tags
    cleaned = cleaned.replace(/<[^>]*>/g, '');

    // 2. Remove control characters except newline (\n), carriage return (\r), tab (\t)
    // eslint-disable-next-line no-control-regex
    cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // 3. Detect and strip prompt injection patterns
    for (const pattern of PROMPT_INJECTION_PATTERNS) {
        if (pattern.test(cleaned)) {
            // Log the attempt with a truncated sample for forensic review
            const sample = cleaned.substring(0, 200).replace(/\n/g, '\\n');
            console.warn(`[SECURITY] Prompt injection attempt detected and stripped. Pattern: ${pattern.source} | Sample: "${sample}"`);
            // Remove the offending phrase
            cleaned = cleaned.replace(pattern, '[redacted]');
        }
    }

    // 4. Truncate to 10,000 characters
    if (cleaned.length > 10000) {
        cleaned = cleaned.substring(0, 10000);
    }

    return cleaned.trim();
}

// ============================================================================
// Live npm version cache (refreshes every hour)
// ============================================================================
const NPM_PACKAGES = {
    'ruflo':          'ruflo',
    'agentic-flow':   'agentic-flow',
    'ruvector':       'ruvector',
    'ruvllm':         '@ruvector/ruvllm',
    'ruv-swarm':      'ruv-swarm',
    'agentic-synth':  '@ruvector/agentic-synth',
};
let npmVersionCache = {};
let npmCacheExpiry = 0;

async function refreshNpmVersions() {
    const now = Date.now();
    if (now < npmCacheExpiry) return npmVersionCache;
    const results = {};
    await Promise.all(Object.entries(NPM_PACKAGES).map(async ([repoName, pkg]) => {
        try {
            const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`, { signal: AbortSignal.timeout(5000) });
            if (res.ok) {
                const d = await res.json();
                results[repoName] = d.version;
            }
        } catch (err) {
                console.warn(`[npm-versions] Failed to fetch ${pkg}:`, err.message);
            }
    }));
    npmVersionCache = results;
    npmCacheExpiry = now + 3600_000; // 1 hour
    console.log('📦 npm versions refreshed:', results);
    return results;
}

// ============================================================================
// NotebookLM Resource Map — maps query topics to available media assets
// Built from actual files in src/ui/public/assets/docs/
// ============================================================================
const NLM_RESOURCES = [
    // --- Videos (NotebookLM Studios) ---
    {
        topics: ['architecture', 'system design', 'how it works', 'components', 'technical architecture', 'stack'],
        type: 'video',
        title: 'Architecture That Changes Everything',
        url: '/assets/docs/Architecture_That_Changes_Everything.mp4',
        emoji: '\ud83d\udcfa',
        description: 'Deep-dive video on the RuVector/Ruflo architecture and why it matters'
    },
    {
        topics: ['ruflo', 'orchestration', 'agents', 'swarm', 'how ruflo works', 'agent coordination'],
        type: 'video',
        title: 'How Ruflo Actually Works',
        url: '/assets/docs/How_Ruflo_Actually_Works.mp4',
        emoji: '\ud83d\udcfa',
        description: 'Video walkthrough of Ruflo agent orchestration internals'
    },
    {
        topics: ['getting started', 'setup', 'tutorial', 'first project', 'quickstart', 'hello world', 'production'],
        type: 'video',
        title: 'From Zero to Production: Getting Started',
        url: '/assets/docs/From_Zero_to_Production_Getting_Started.mp4',
        emoji: '\ud83d\udcfa',
        description: 'Step-by-step video guide from installation to production deployment'
    },
    {
        topics: ['use cases', 'applications', 'what can i build', 'examples', 'impossible', 'real world'],
        type: 'video',
        title: 'Impossible Apps with RuvNet',
        url: '/assets/docs/Impossible_Apps_RuvNet.mp4',
        emoji: '\ud83d\udcfa',
        description: 'Video showcase of applications that become possible with the RuvNet stack'
    },
    {
        topics: ['wifi sensing', 'ruview', 'iot', 'esp32', 'hardware', 'edge', 'sensing'],
        type: 'video',
        title: 'RuView WiFi Sensing',
        url: '/assets/docs/RuView_WiFi_Sensing.mp4',
        emoji: '\ud83d\udcfa',
        description: 'Video on WiFi-based sensing and edge AI with RuView'
    },
    {
        topics: ['new features', 'updates', 'changelog', 'march 2026', 'whats new', 'release', 'latest'],
        type: 'video',
        title: "What's New in the RuvNet Stack (March 2026)",
        url: '/assets/docs/Whats_New_RuvNet_Stack_March2026.mp4',
        emoji: '\ud83d\udcfa',
        description: 'Video overview of the latest features and improvements'
    },
    {
        topics: ['migration', 'switch', 'why switch', 'developer teams', 'adoption', 'comparison', 'vs'],
        type: 'video',
        title: 'Why Dev Teams Should Switch',
        url: '/assets/docs/Why_Dev_Teams_Should_Switch.mp4',
        emoji: '\ud83d\udcfa',
        description: 'Video making the case for developer teams to adopt the RuvNet stack'
    },
    {
        topics: ['agentic', 'ai stack', 'toolkit', 'framework', 'agentic stack'],
        type: 'video',
        title: 'The Agentic Stack',
        url: '/assets/docs/The_Agentic_Stack.mp4',
        emoji: '\ud83d\udcfa',
        description: 'Video deep-dive into the complete agentic AI technology stack'
    },
    // --- PDFs (Decks & Reports) ---
    {
        topics: ['ceo', 'investment', 'roi', 'business case', 'executive', 'investor', 'fundraising', 'valuation'],
        type: 'pdf',
        title: 'Ruflo v3.5 CEO Investment Deck',
        url: '/assets/docs/CEO-Deck-RuvNet-2026-v2.pdf',
        emoji: '\ud83d\udcc4',
        description: 'Executive overview with ROI analysis, market opportunity, and investment thesis'
    },
    {
        topics: ['cto', 'technical deck', 'benchmarks', 'developer experience', 'engineering'],
        type: 'pdf',
        title: 'Ruflo v3.5 CTO Technical Deck',
        url: '/assets/docs/CTO-Deck-RuvNet-2026-v2.pdf',
        emoji: '\ud83d\udcc4',
        description: 'Technical architecture, benchmarks, and developer experience overview'
    },
    {
        topics: ['business', 'why invest', 'company needs', 'enterprise', 'cost savings'],
        type: 'pdf',
        title: 'Business Case: Why Your Company Needs This',
        url: '/assets/docs/Business_Case_Why_Your_Company_Needs_This.pdf',
        emoji: '\ud83d\udcc4',
        description: 'Business justification with cost analysis and competitive advantages'
    },
    {
        topics: ['ceo', 'investment', 'enterprise ai', '2026', 'executive summary', 'ruvnet'],
        type: 'pdf',
        title: 'CEO Deck: RuvNet 2026 (Visual Redesign)',
        url: '/assets/docs/CEO-Deck-RuvNet-2026-v2.pdf',
        emoji: '\ud83d\udcc4',
        description: '21-slide executive deck — DIKW positioning, "2 Generations Ahead" timeline, case studies, $180B TAM'
    },
    {
        topics: ['cto', 'architecture', 'ruvnet architecture', 'technical overview', '2026', 'deep dive'],
        type: 'pdf',
        title: 'CTO Deck: Technical Architecture 2026 (Visual Redesign)',
        url: '/assets/docs/CTO-Deck-RuvNet-2026-v2.pdf',
        emoji: '\ud83d\udcc4',
        description: '23-slide architecture deep dive — PaperBanana diagrams, benchmark charts, WASM proof, swarm topology'
    },
    {
        topics: ['ceo', 'investment', 'agentic intelligence', 'executive summary'],
        type: 'pdf',
        title: 'CEO Deck: Agentic Intelligence',
        url: '/assets/docs/CEO-Deck-RuvNet-2026-v2.pdf',
        emoji: '\ud83d\udcc4',
        description: 'Executive deck on the agentic intelligence vision and market opportunity'
    },
    {
        topics: ['cto', 'architecture', 'ruvnet architecture', 'technical overview'],
        type: 'pdf',
        title: 'CTO Deck: RuvNet Architecture',
        url: '/assets/docs/CTO-Deck-RuvNet-2026-v2.pdf',
        emoji: '\ud83d\udcc4',
        description: 'Technical deep-dive deck on the RuvNet system architecture'
    },
    {
        topics: ['agentic engineering', 'engineering stack', 'development patterns'],
        type: 'pdf',
        title: 'Agentic Engineering Stack',
        url: '/assets/docs/Agentic_Engineering_Stack.pdf',
        emoji: '\ud83d\udcc4',
        description: 'Comprehensive guide to the agentic engineering stack and patterns'
    },
    {
        topics: ['agentic intelligence', 'frameworks', 'ai frameworks', 'orchestration frameworks'],
        type: 'pdf',
        title: 'Agentic Intelligence Frameworks',
        url: '/assets/docs/Agentic_Intelligence_Frameworks.pdf',
        emoji: '\ud83d\udcc4',
        description: 'Analysis of agentic intelligence frameworks and their capabilities'
    },
    {
        topics: ['swarm', 'ruflo', 'claude flow', 'platform', 'multi-agent', 'coordination'],
        type: 'pdf',
        title: 'Ruflo v3 Swarm Platform',
        url: '/assets/docs/Claude-Flow_v3_Swarm_Platform.pdf',
        emoji: '\ud83d\udcc4',
        description: 'Complete guide to the Ruflo v3 swarm orchestration platform'
    },
    {
        topics: ['agentic toolkit', 'creation', 'tools', 'redefining'],
        type: 'pdf',
        title: 'The Agentic Toolkit: Redefining Creation',
        url: '/assets/docs/The_Agentic_Toolkit_Redefining_Creation.pdf',
        emoji: '\ud83d\udcc4',
        description: 'How the agentic toolkit redefines software creation and development'
    },
    // --- Audio Deep Dives (NotebookLM Podcast-Style) ---
    {
        topics: ['architecture', 'overview', 'deep dive', 'how it all works', 'listen', 'audio', 'podcast'],
        type: 'audio',
        title: 'Architecture Deep Dive (Audio)',
        url: '/assets/docs/Architecture_That_Changes_Everything_Audio.mp4',
        emoji: '\ud83c\udfa7',
        description: 'AI-hosted podcast deep dive on the RuVector/Ruflo architecture — listen while you work'
    },
    {
        topics: ['new features', 'updates', 'march 2026', 'whats new', 'latest', 'changelog', 'audio'],
        type: 'audio',
        title: "What's New — March 2026 (Audio)",
        url: '/assets/docs/Whats_New_March2026_Audio.mp4',
        emoji: '\ud83c\udfa7',
        description: 'AI-hosted audio overview of the latest features and improvements'
    },
    // --- Infographics ---
    {
        topics: ['ecosystem', 'overview', 'map', 'all components', 'full picture', 'ecosystem map'],
        type: 'image',
        title: 'RuvNet Ecosystem Map',
        url: '/assets/docs/RuvNet_Ecosystem_Map.png',
        emoji: '\ud83d\uddfa\ufe0f',
        description: 'Visual map of the entire RuvNet ecosystem and component relationships'
    },
    {
        topics: ['ecosystem', 'architecture', 'infographic', 'visual map', '2026'],
        type: 'image',
        title: 'RuvNet Architecture 2026 (Infographic)',
        url: '/assets/docs/RuvNet_Ecosystem_Map_2026.png',
        emoji: '\ud83d\uddfa\ufe0f',
        description: 'Updated 2026 ecosystem infographic generated by NotebookLM Studio'
    },
];

/**
 * Match user query against NLM_RESOURCES using keyword overlap scoring.
 * Returns an array of matched resources sorted by relevance (best first).
 * Each match must exceed a minimum score threshold to avoid noise.
 */
function matchNlmResources(query, maxResults = 4) {
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

    const scored = NLM_RESOURCES.map(resource => {
        let score = 0;

        for (const topic of resource.topics) {
            if (queryLower.includes(topic)) {
                // Full phrase match — high value; longer phrases score higher
                score += 3 + topic.split(/\s+/).length;
            } else {
                // Partial word overlap
                const topicWords = topic.split(/\s+/);
                const overlap = topicWords.filter(tw =>
                    queryWords.some(qw => qw.includes(tw) || tw.includes(qw))
                );
                if (overlap.length > 0) {
                    score += overlap.length;
                }
            }
        }

        return { ...resource, score };
    });

    return scored
        .filter(r => r.score >= 2)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);
}

/**
 * Format matched NLM resources into a markdown section for LLM context injection.
 */
function formatNlmResourcesSection(matched) {
    if (!matched || matched.length === 0) return '';
    const lines = matched.map(r =>
        `- ${r.emoji} [${r.title}](${r.url}) — ${r.description}`
    );
    return `\n\n### Related Media\n${lines.join('\n')}`;
}

// Initialize OpenAI client for special endpoints (if API key available)
let openai = null;
if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// Initialize Gemini client for image generation (visualize endpoint)
const { GoogleGenAI } = require('@google/genai');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const geminiClient = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

// ============================================================================
// MULTI-PROVIDER LLM — automatic fallback chain for chat
// Default chain: anthropic (Claude 4.6) first, then fallbacks
// Claude Sonnet 4.6 is the primary — prompt is optimized specifically for it.
// Fallbacks only if Anthropic API is down.
// Override order with LLM_PROVIDER env var if desired.
// ============================================================================
const LLM_PROVIDERS = [];

function registerProviders() {
    const preferred = (process.env.LLM_PROVIDER || '').toLowerCase();

    // All supported providers — order matters (this is the default fallback chain)
    // OpenRouter → Claude 4.6 FIRST — prompt is optimized for Claude's XML-tag processing.
    // OpenRouter provides Claude access via OpenAI-compatible API (simplest integration).
    // Direct Anthropic as second option. Groq/OpenAI as speed fallbacks.
    const all = [
        { name: 'openrouter', key: process.env.OPENROUTER_API_KEY, url: 'https://openrouter.ai/api/v1/chat/completions',      model: process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4-6', timeout: 60000 },
        { name: 'anthropic',  key: process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY, url: null, /* uses native SDK format */ model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6', timeout: 60000 },
        { name: 'groq-free',  key: process.env.GROQ_API_KEY,       url: 'https://api.groq.com/openai/v1/chat/completions',    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile', timeout: 10000 },
        { name: 'openai',     key: process.env.OPENAI_API_KEY,     url: 'https://api.openai.com/v1/chat/completions',         model: process.env.OPENAI_MODEL || 'gpt-4o', timeout: 20000 },
        { name: 'deepseek',   key: process.env.DEEPSEEK_API_KEY,   url: 'https://api.deepseek.com/v1/chat/completions',       model: process.env.DEEPSEEK_MODEL || 'deepseek-chat', timeout: 35000 },
    ];

    // Filter to providers with keys set
    const available = all.filter(p => p.key);

    // If user sets LLM_PROVIDER, put that provider family first
    if (preferred) {
        // Match both exact name and family (e.g. "groq" matches "groq-free" and "groq-paid")
        const matchIdx = available.findIndex(p => p.name === preferred || p.name.startsWith(preferred + '-'));
        if (matchIdx > 0) {
            const [pref] = available.splice(matchIdx, 1);
            available.unshift(pref);
        }
    }

    LLM_PROVIDERS.length = 0;
    LLM_PROVIDERS.push(...available);

    if (LLM_PROVIDERS.length === 0) {
        console.error('❌ No LLM API keys configured! Set at least one: GROQ_API_KEY, OPENAI_API_KEY, CLAUDE_API_KEY, etc.');
    } else {
        console.log(`🤖 LLM fallback chain (${LLM_PROVIDERS.length}): ${LLM_PROVIDERS.map(p => p.name).join(' → ')}`);
    }
}

async function callAnthropicAPI(provider, messages, temperature, maxTokens) {
    // Anthropic uses a different API format than OpenAI-compatible providers
    const systemMsg = messages.find(m => m.role === 'system');
    const nonSystemMsgs = messages.filter(m => m.role !== 'system');
    const timeoutMs = provider.timeout || 20000;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
            'x-api-key': provider.key,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: provider.model,
            max_tokens: maxTokens,
            temperature,
            system: systemMsg ? systemMsg.content : undefined,
            messages: nonSystemMsgs
        })
    });

    const data = await response.json();
    if (data.error) throw new Error(`Anthropic: ${data.error.message}`);
    if (!data.content || !data.content[0]) throw new Error('Anthropic: empty response');
    return data.content[0].text;
}

async function callOpenAICompatible(provider, messages, temperature, maxTokens) {
    const timeoutMs = provider.timeout || 20000;
    const response = await fetch(provider.url, {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
            'Authorization': `Bearer ${provider.key}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: provider.model,
            messages,
            temperature,
            max_tokens: maxTokens
        })
    });

    const data = await response.json();
    if (data.error) throw new Error(`${provider.name}: ${data.error.message}`);
    if (!data.choices || !data.choices[0]) throw new Error(`${provider.name}: empty response`);
    return data.choices[0].message.content;
}

async function llmChat(messages, { temperature = 0.3, maxTokens = 8192 } = {}) {
    if (LLM_PROVIDERS.length === 0) {
        throw new Error('No LLM providers configured');
    }

    const errors = [];
    const totalStart = Date.now();
    for (const provider of LLM_PROVIDERS) {
        try {
            const providerStart = Date.now();
            console.log(`🤖 Trying ${provider.name} (${provider.model}, timeout ${provider.timeout || 20000}ms)...`);
            let answer;
            if (provider.name === 'anthropic') {
                answer = await callAnthropicAPI(provider, messages, temperature, maxTokens);
            } else {
                answer = await callOpenAICompatible(provider, messages, temperature, maxTokens);
            }
            const elapsed = Date.now() - providerStart;
            console.log(`✅ ${provider.name} responded in ${elapsed}ms (${answer.length} chars)`);
            return { answer, provider: provider.name, model: provider.model };
        } catch (err) {
            const elapsed = Date.now() - (Date.now());
            console.warn(`⚠️ ${provider.name} failed after ${Date.now() - totalStart}ms: ${err.message}`);
            errors.push(`${provider.name}: ${err.message}`);
        }
    }

    console.error(`❌ All LLM providers failed after ${Date.now() - totalStart}ms`);
    throw new Error(`All LLM providers failed:\n${errors.join('\n')}`);
}

// ============================================================================
// SSE Streaming: stream tokens from OpenAI-compatible or Anthropic providers
// ============================================================================
async function* llmChatStream(messages, { temperature = 0.3, maxTokens = 8192 } = {}) {
    if (LLM_PROVIDERS.length === 0) throw new Error('No LLM providers configured');

    const errors = [];
    for (const provider of LLM_PROVIDERS) {
        try {
            console.log(`🤖 Streaming from ${provider.name} (${provider.model})...`);
            if (provider.name === 'anthropic') {
                yield* streamAnthropicAPI(provider, messages, temperature, maxTokens);
            } else {
                yield* streamOpenAICompatible(provider, messages, temperature, maxTokens);
            }
            return; // Successfully streamed, stop trying providers
        } catch (err) {
            console.warn(`⚠️ ${provider.name} stream failed: ${err.message}`);
            errors.push(`${provider.name}: ${err.message}`);
        }
    }
    throw new Error(`All LLM providers failed:\n${errors.join('\n')}`);
}

async function* streamOpenAICompatible(provider, messages, temperature, maxTokens) {
    const timeoutMs = provider.timeout || 20000;
    const response = await fetch(provider.url, {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
            'Authorization': `Bearer ${provider.key}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: provider.model,
            messages,
            temperature,
            max_tokens: maxTokens,
            stream: true
        })
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`${provider.name}: HTTP ${response.status} - ${text.substring(0, 200)}`);
    }

    const reader = response.body;
    const decoder = new TextDecoder();
    let buffer = '';

    for await (const chunk of reader) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);
            if (data === '[DONE]') return;
            try {
                const parsed = JSON.parse(data);
                const token = parsed.choices?.[0]?.delta?.content;
                if (token) yield token;
            } catch (err) {
                console.warn(`[stream-openai] Failed to parse SSE chunk:`, err.message);
            }
        }
    }
}

async function* streamAnthropicAPI(provider, messages, temperature, maxTokens) {
    const systemMsg = messages.find(m => m.role === 'system');
    const nonSystemMsgs = messages.filter(m => m.role !== 'system');
    const timeoutMs = provider.timeout || 20000;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
            'x-api-key': provider.key,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: provider.model,
            max_tokens: maxTokens,
            temperature,
            stream: true,
            system: systemMsg ? systemMsg.content : undefined,
            messages: nonSystemMsgs
        })
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Anthropic: HTTP ${response.status} - ${text.substring(0, 200)}`);
    }

    const reader = response.body;
    const decoder = new TextDecoder();
    let buffer = '';

    for await (const chunk of reader) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            try {
                const parsed = JSON.parse(trimmed.slice(6));
                if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                    yield parsed.delta.text;
                }
            } catch (err) {
                console.warn(`[stream-anthropic] Failed to parse SSE chunk:`, err.message);
            }
        }
    }
}

registerProviders();

// ============================================================================
// OPTIMIZED: Initialize all RAG enhancement modules
// ============================================================================
let hybridSearch = null;
const textChunker = new TextChunker({ chunkSize: 2000, overlap: 200 });
const queryExpander = new QueryExpander();
const reRanker = new ReRanker({
    semanticWeight: 0.35,
    keywordWeight: 0.25,
    alignmentWeight: 0.20,
    recencyWeight: 0.10,
    diversityWeight: 0.10
});
const contextCompressor = new ContextCompressor({
    maxContextLength: 24000,  // Phase 2 H-2: increased from 16K for richer context
    maxPerSource: 6000,       // Phase 2 H-2: increased from 4K per source
    preserveCode: true
});
const multiHopRetriever = new MultiHopRetriever({
    maxHops: 2,
    minConfidence: 0.3
});
const responseValidator = new ResponseValidator();

// ============================================================================
// ============================================================================
// Generate clean, human-readable source title from available metadata
// ============================================================================
function cleanSourceTitle(s) {
    // Try title from the data pipeline
    const rawTitle = s.title || s.metadata?.title;

    // Validate the title is actually usable (not garbage/fragment)
    if (rawTitle && typeof rawTitle === 'string') {
        const t = rawTitle.trim();
        // Reject: too short, table chars, path-like, 'Untitled', sentence fragments, code snippets
        const isGarbage = t.length < 3 || t === 'Untitled' ||
            /[│├└┌┐┘─┤┬┴┼|]/.test(t) ||             // table/box drawing chars
            t.startsWith('postgresql:') || t.startsWith('ask_ruvnet:') ||
            /^[a-z]/.test(t) ||                        // starts lowercase = mid-sentence fragment
            /^[\s\-\*\>\#]/.test(t) ||                 // starts with markdown formatting
            /\.\s*$/.test(t) && t.length > 60 ||       // long sentence ending in period = content fragment
            /^(const|let|var|function|import|export|return|if|for|while)\b/.test(t) || // code
            t.split(' ').length > 12;                   // too many words = content, not a title
        if (!isGarbage) {
            return t.charAt(0).toUpperCase() + t.slice(1);
        }
    }

    // Fallback: build from package_name + doc_type
    const pkg = s.package_name || s.metadata?.package_name;
    const docType = s.doc_type || s.metadata?.doc_type;
    if (pkg) {
        const label = docType ? `${pkg} (${docType})` : pkg;
        return label.charAt(0).toUpperCase() + label.slice(1);
    }

    // Fallback: extract category from source path
    const src = s.source || s.metadata?.source || '';
    const categoryMatch = src.match(/ask_ruvnet[:/](.+)/);
    if (categoryMatch) {
        const cat = categoryMatch[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return `Knowledge Base: ${cat}`;
    }

    // Fallback: first meaningful line of content
    const content = s.content || '';
    if (content.length > 10) {
        const firstLine = content.split('\n')[0].trim().substring(0, 80);
        if (firstLine.length > 10) return firstLine + (firstLine.length >= 80 ? '…' : '');
    }

    return `KB Entry #${s.id || 'unknown'}`;
}

// OPTIMIZED: Diversity Filter to avoid redundant context from similar sources
// ============================================================================
function applyDiversityFilter(sources, maxSources = 6) {
    if (sources.length <= maxSources) return sources;

    const diverse = [];
    const seenPrefixes = new Set();

    for (const source of sources) {
        // Extract source prefix (e.g., video name, repo name) for diversity check
        const sourceId = source.source || source.id || '';
        const prefix = sourceId.split('/').slice(0, 2).join('/'); // First 2 path segments

        // Calculate content fingerprint using first 200 chars
        const contentFingerprint = (source.content || '').substring(0, 200).toLowerCase().replace(/\s+/g, ' ');

        // Check if we already have very similar content
        let isDuplicate = false;
        for (const existing of diverse) {
            const existingFingerprint = (existing.content || '').substring(0, 200).toLowerCase().replace(/\s+/g, ' ');
            const similarity = calculateJaccardSimilarity(contentFingerprint, existingFingerprint);
            if (similarity > 0.7) {
                isDuplicate = true;
                break;
            }
        }

        if (!isDuplicate) {
            diverse.push(source);
            seenPrefixes.add(prefix);
        }

        if (diverse.length >= maxSources) break;
    }

    return diverse;
}

// Simple Jaccard similarity for content deduplication
function calculateJaccardSimilarity(str1, str2) {
    const words1 = new Set(str1.split(/\s+/).filter(w => w.length > 3));
    const words2 = new Set(str2.split(/\s+/).filter(w => w.length > 3));

    if (words1.size === 0 || words2.size === 0) return 0;

    const intersection = [...words1].filter(w => words2.has(w)).length;
    const union = new Set([...words1, ...words2]).size;

    return intersection / union;
}

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Railway's load balancer for accurate IP-based rate limiting
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
    contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false
}));
app.use(cors({
    origin: process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'production' ? false : '*')
}));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: process.env.NODE_ENV === 'production' ? 100 : 500, standardHeaders: true }));

// Stricter rate limit for /api/special — user content is injected directly into LLM prompts
const specialEndpointLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    message: { error: 'Too many special action requests. Try again later.' }
});

app.use(express.json({ limit: '1mb' }));
const fs = require('fs');
app.use(express.static(path.join(__dirname, '../ui/dist'))); // Serve frontend

// Initialize RuVector Native Components (replaces SQLite-based HybridReasoningBank)
let modelRouter;
let reasoningBank; // RvfStore instance with reflexion-compatible API

// ============================================================================
// Startup readiness flag — blocks /api/chat* until all subsystems are loaded
// ============================================================================
let isReady = false;

// ============================================================================
// In-memory LRU cache for RAG pipeline results (avoids redundant retrieval)
// Cache key: hash of (message + mode). TTL: 5 min. Max entries: 100.
// Only caches the RAG retrieval (context, sources, systemPrompt) — the LLM
// call still runs fresh every time to produce varied responses.
// ============================================================================
const RAG_CACHE_TTL_MS = 300_000;  // 5 minutes
const RAG_CACHE_MAX_ENTRIES = 100;
const ragCache = new Map();

function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + ch;
        hash |= 0; // Convert to 32-bit integer
    }
    return String(hash);
}

function ragCacheKey(message, mode) {
    return simpleHash(`${message}||${mode || 'Balanced'}`);
}

function ragCacheGet(key) {
    const entry = ragCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > RAG_CACHE_TTL_MS) {
        ragCache.delete(key);
        return null;
    }
    // Move to end (LRU refresh) — delete and re-set to maintain insertion order
    ragCache.delete(key);
    ragCache.set(key, entry);
    return entry.value;
}

function ragCacheSet(key, value) {
    // Evict oldest entries if at capacity
    if (ragCache.size >= RAG_CACHE_MAX_ENTRIES) {
        const firstKey = ragCache.keys().next().value;
        ragCache.delete(firstKey);
    }
    ragCache.set(key, { value, timestamp: Date.now() });
}

async function initAgenticFlow() {
    try {
        // Dynamic import for ESM router module (optional - for LLM routing)
        try {
            const routerModule = await import('agentic-flow/router');
            modelRouter = new routerModule.ModelRouter();
            console.log('✅ Agentic Flow Router initialized');
        } catch {
            console.log('⚠️ Agentic Flow Router not available (optional)');
        }

        // RVF native store — single source of truth, no external database dependency
        const store = new StoreClass();
        await store.initialize();
        reasoningBank = store;

        const rvStats = store.getStats();
        console.log(`✅ ${rvStats.backend || 'Knowledge store'} loaded (${rvStats.vectorCount.toLocaleString()} entries)`);
        console.log(`📊 Knowledge Backend: ${rvStats.backend || 'RVF'}`);

        // OPTIMIZED: Initialize hybrid search index for BM25 + semantic fusion
        await initHybridSearchIndex();
    } catch (error) {
        console.error('❌ Failed to initialize RuVector:', error);
    }
}

// ============================================================================
// OPTIMIZED: Initialize BM25 hybrid search index from existing knowledge base
// ============================================================================
async function initHybridSearchIndex() {
    try {
        if (!reasoningBank || !reasoningBank.reflexion) {
            console.log('⚠️ ReasoningBank not ready, skipping hybrid search initialization');
            return;
        }

        hybridSearch = new HybridSearch({
            semanticWeight: 0.55,  // 55% weight for semantic (embedding) search
            bm25Weight: 0.45       // 45% weight for keyword (BM25) search
        });

        console.log('🔍 Building comprehensive BM25 hybrid search index...');

        const allDocuments = new Map();

        // Load all documents from RVF store metadata (no external DB needed)
        if (reasoningBank && reasoningBank.db && reasoningBank.db.getAllMetadata) {
            const allMeta = reasoningBank.db.getAllMetadata();
            const limit = Math.min(allMeta.length, 100000); // Phase 2 M-6: raised from 50K to 100K for fuller BM25 coverage
            for (let i = 0; i < limit; i++) {
                const entry = allMeta[i];
                const meta = entry.metadata || {};
                const title = meta.title || meta.name || '';
                const content = (meta.content || '').substring(0, 2000);
                allDocuments.set(entry.id, {
                    id: entry.id,
                    input: `${title}\n${content}`,
                    task: title,
                    metadata: { docId: entry.id, source: meta.source || 'rvf', content, title }
                });
            }
            console.log(`📊 Loaded ${allDocuments.size} documents from RVF store for BM25`);
        }

        // Fallback: use embedding-based sampling if metadata load failed
        if (allDocuments.size === 0) {
            const batch1 = await reasoningBank.reflexion.retrieveRelevant({ task: '', k: 2000 });
            batch1.forEach(r => allDocuments.set(r.id, r));

            const technicalQueries = ['code', 'function', 'api', 'install', 'config'];
            for (const term of technicalQueries) {
                try {
                    const batch = await reasoningBank.reflexion.retrieveRelevant({ task: term, k: 500 });
                    batch.forEach(r => allDocuments.set(r.id, r));
                } catch (e) {
                    console.warn(`[hybrid-search] Query "${term}" failed:`, e.message);
                }
            }
        }

        if (allDocuments.size > 0) {
            const documents = Array.from(allDocuments.values()).map(r => ({
                id: r.metadata?.docId || r.id,
                content: r.input || r.task || '',
                metadata: r.metadata,
                source: r.metadata?.source
            }));

            hybridSearch.buildIndex(documents);
            console.log(`✅ Hybrid search initialized with ${documents.length} documents (comprehensive index)`);
        } else {
            console.log('⚠️ No documents found for hybrid search index');
        }
    } catch (error) {
        console.error('❌ Failed to initialize hybrid search:', error.message);
        hybridSearch = null;  // Fall back to pure semantic search
    }
}

initAgenticFlow().then(async () => {
    isReady = true;
    console.log(`Server ready in ${Date.now() - startupTime}ms`);
    // Warmup: pre-load the first LLM provider connection to avoid cold-start on first query
    try {
        const warmupStart = Date.now();
        await llmChat([{ role: 'system', content: 'You are a test.' }, { role: 'user', content: 'Say OK' }], { maxTokens: 10, temperature: 0 });
        console.log(`🔥 LLM warmup complete in ${Date.now() - warmupStart}ms`);
    } catch (e) {
        console.warn('⚠️ LLM warmup failed (first query may be slow):', e.message?.substring(0, 80));
    }
}).catch((err) => {
    console.error('Startup failed, server NOT marked ready:', err.message);
});

// ============================================================================
// Phase 2 C-2: Shared RAG Pipeline — single source of truth for both /api/chat
// and /api/chat/stream. Returns { context, sources, systemPrompt, messages }.
// ============================================================================
async function runRAGPipeline(message, mode, conversationHistory) {
    let context = '';
    let sources = [];
    let kbStatus = 'ok'; // Track KB health for every response

    if (!reasoningBank || !reasoningBank.reflexion) {
        console.error('🚨 KB NOT INITIALIZED — returning degraded response with warning');
        kbStatus = 'not_initialized';
        // Do NOT silently fall through — surface the problem clearly
        const { RUV_PERSONA } = require('./RuvPersona');
        const warnPrompt = `${RUV_PERSONA}\n\n🚨 CRITICAL: The RuvNet knowledge base failed to load. You MUST start your response with:\n"⚠️ **Knowledge Base Unavailable** — The RuvNet knowledge base is not loaded on this server. My answers below are from general AI knowledge and may be incomplete or inaccurate. Please notify the administrator."\n\nThen answer to the best of your ability.`;
        return {
            context: '',
            sources: [],
            systemPrompt: warnPrompt,
            messages: [
                { role: 'system', content: warnPrompt },
                { role: 'user', content: message }
            ],
            confidence: 'none',
            kbStatus: 'not_initialized',
            queryRequirements: { diagram: false, code: false, comparison: false },
        };
    }

    if (reasoningBank && reasoningBank.reflexion) {
        console.log(`Searching ReasoningBank for: "${message}"`);
        try {
            // ================================================================
            // STAGE 0: Query Intent Detection — bias broad/vague queries
            // toward on-topic RuVector/Ruflo content so retrieval doesn't
            // return noise from the 103K-entry KB.
            // ================================================================
            const BROAD_QUERY_PATTERNS = [
                /^(get|getting)\s+started/i,
                /^what\s+(is|are|does)/i,
                /^why\s+(should|would|do|does|is)/i,
                /^how\s+(do|does|can|to|should)/i,
                /^tell\s+me\s+about/i,
                /^explain/i,
                /^(show|give)\s+me/i,
                /^(can|could)\s+you\s+(explain|tell|show|describe)/i,
                /^(intro|introduction|overview|summary|basics)/i,
                /^who\s+(is|are|should)/i,
            ];
            const DOMAIN_TERMS_RE = /\b(ruvector|ruflo|claude.?flow|hnsw|rvf|sona|min.?cut|mcp|swarm|agent|embedding|vector|aimds)\b/i;
            let biasedMessage = message;
            const isBroadQuery = BROAD_QUERY_PATTERNS.some(p => p.test(message.trim()));
            const alreadyOnTopic = DOMAIN_TERMS_RE.test(message);
            if (isBroadQuery && !alreadyOnTopic) {
                biasedMessage = `RuVector Ruflo agentic AI: ${message}`;
                console.log(`🎯 Broad query detected — biased to: "${biasedMessage}"`);
            }

            // ================================================================
            // STAGE 1: Query Expansion - Generate multiple query variants
            // ================================================================
            const expandedQueries = queryExpander.expand(biasedMessage);
            const adaptiveK = queryExpander.getRecommendedK(message);
            console.log(`📝 Query expanded to ${expandedQueries.length} variants, adaptive k=${adaptiveK}`);

            // ================================================================
            // STAGE 2: Define search function for retrieval
            // ================================================================
            const semanticSearchFn = async (query, k) => {
                const semanticResults = await reasoningBank.reflexion.retrieveRelevant({
                    task: query,
                    k: k
                });
                return semanticResults.map(r => ({
                    id: r.metadata?.docId || r.id,
                    title: r.metadata?.title || r.title || null,
                    content: r.input || r.task || '',
                    score: r.similarity || 0,
                    similarity: r.similarity || 0,
                    source: r.metadata?.source,
                    metadata: r.metadata,
                    timestamp: r.metadata?.timestamp
                }));
            };

            // ================================================================
            // STAGE 3: Multi-hop retrieval for complex queries
            // ================================================================
            let allResults = [];

            if (multiHopRetriever.needsMultiHop(message)) {
                console.log('🔄 Complex query detected - using multi-hop retrieval...');
                const searchFn = hybridSearch
                    ? async (q, k) => await hybridSearch.hybridSearch(q, semanticSearchFn, k)
                    : semanticSearchFn;
                allResults = await multiHopRetriever.retrieve(message, searchFn, adaptiveK);
            } else {
                // Standard retrieval with query expansion
                const resultsMap = new Map();

                // Run all expanded queries in parallel for lower latency
                const queryPromises = expandedQueries.map(query => {
                    if (hybridSearch) {
                        console.log('🔀 Using hybrid search (semantic + BM25)...');
                        return hybridSearch.hybridSearch(query, semanticSearchFn, adaptiveK);
                    } else {
                        console.log('🔍 Using semantic search only...');
                        return semanticSearchFn(query, adaptiveK);
                    }
                });
                const batchResults = await Promise.all(queryPromises);

                // Aggregate results (boost for appearing in multiple query variants)
                for (const queryResults of batchResults) {
                    for (const result of queryResults) {
                        const id = result.id;
                        if (resultsMap.has(id)) {
                            const existing = resultsMap.get(id);
                            existing.score = Math.max(existing.score, result.score) + 0.05;
                            existing.queryMatches = (existing.queryMatches || 1) + 1;
                        } else {
                            resultsMap.set(id, { ...result, queryMatches: 1 });
                        }
                    }
                }

                allResults = Array.from(resultsMap.values());
            }

            console.log(`Retrieved ${allResults.length} total results from search`);

            // ================================================================
            // STAGE 4: Re-ranking with cross-encoder style scoring
            // ================================================================
            const rerankedResults = reRanker.rerank(message, allResults, { maxResults: 12 });
            console.log(`📊 Re-ranked to ${rerankedResults.length} results`);

            // ================================================================
            // STAGE 4b: Recency boost — coaching & video entries are our
            // freshest knowledge (Oct 2025 – Jan 2026 sessions). Boost their
            // scores so they surface ahead of older generic docs.
            // ================================================================
            const NOW_MS = Date.now();
            const RECENCY_BOOST_MAX = 0.25; // up to +25% score boost
            const applyRecencyBoost = (r) => {
                const src = (r.source || r.metadata?.source || '').toLowerCase();
                const isCoaching = src.includes('/coaching') || src.includes('coaching');
                const isVideo = src.includes('/videos') || src.includes('video');
                const rawDate = r.metadata?.package_version || r.metadata?.session_date || r.timestamp || null;
                let ageDays = null;
                if (rawDate) {
                    const parsed = Date.parse(String(rawDate));
                    if (!isNaN(parsed)) {
                        ageDays = (NOW_MS - parsed) / (24 * 60 * 60 * 1000);
                    }
                }
                let boost = 0;
                if (ageDays !== null) {
                    const freshness = Math.max(0, 1 - ageDays / 60);
                    boost = RECENCY_BOOST_MAX * freshness;
                } else if (isCoaching) {
                    boost = 0.15;
                } else if (isVideo) {
                    boost = 0.10;
                }
                if (boost > 0) {
                    const base = r.rerankedScore || r.score || 0;
                    r.rerankedScore = Math.min(1.0, base + base * boost);
                }
                return r;
            };
            const boostedResults = rerankedResults.map(applyRecencyBoost);

            // ================================================================
            // STAGE 4c: Gold/curated entry DOMINATION — kb_ entries are
            // expert-curated and MUST dominate results for broad queries.
            // Uses multiplicative boost (3x-5x) instead of small additive.
            // ================================================================
            boostedResults.forEach(r => {
                const id = r.id || '';
                const isCurated = r.metadata?.is_curated || id.startsWith('kb_');
                const qualityScore = r.metadata?.quality_score || r.quality_score || 0;
                const base = r.rerankedScore || r.score || 0;

                // Penalize entries with generic duplicate titles first
                const title = (r.title || r.metadata?.title || '').toLowerCase();
                if (/^\w+\s*\(\w+(-\w+)?\)$/.test(title)) {
                    r.rerankedScore = base * 0.6;
                }

                // Multiplicative gold boost — gold entries get 4x, high-quality
                // get 2x, good quality get 1.5x. This ensures 323 gold entries
                // dominate over 103K noisy architecture docs.
                if (isCurated) {
                    r.rerankedScore = (r.rerankedScore || base) * 4.0;
                } else if (qualityScore >= 95) {
                    r.rerankedScore = (r.rerankedScore || base) * 2.0;
                } else if (qualityScore >= 88) {
                    r.rerankedScore = (r.rerankedScore || base) * 1.5;
                }
            });

            // Re-sort after boost so higher-scored recent/gold entries bubble up
            boostedResults.sort((a, b) => (b.rerankedScore || b.score || 0) - (a.rerankedScore || a.score || 0));
            console.log(`📅 Recency boost applied to ${boostedResults.filter(r => (r.source || '').includes('coaching') || (r.source || '').includes('video')).length} coaching/video results`);

            // ================================================================
            // STAGE 4d: Implementation intent detection + Golden Path boost
            // ADR-002: When users ask HOW to do something, prescriptive
            // implementation-path entries dominate over encyclopedic ones.
            // ================================================================
            const IMPLEMENTATION_INTENT = [
                /^how\s+(do|can|should|to|would)/i,
                /^(get|getting)\s+started/i,
                /^(build|create|implement|set\s*up|install|configure|deploy|add|use|integrate)/i,
                /^I\s+(want|need)\s+to/i,
                /^(quick|fast|best|right)\s+(start|way|path|approach)/i,
                /^what('s| is)\s+the\s+(best|right|recommended)/i,
                /^(step|steps|guide|tutorial|walkthrough|example)/i,
            ];
            const hasImplementationIntent = IMPLEMENTATION_INTENT.some(p => p.test(message.trim()));
            if (hasImplementationIntent) {
                let goldenPathCount = 0;
                boostedResults.forEach(r => {
                    const category = r.metadata?.category || '';
                    if (category === 'implementation-path') {
                        const base = r.rerankedScore || r.score || 0;
                        r.rerankedScore = base * 5.0;
                        r.isGoldenPath = true;
                        goldenPathCount++;
                    }
                });
                if (goldenPathCount > 0) {
                    boostedResults.sort((a, b) => (b.rerankedScore || b.score || 0) - (a.rerankedScore || a.score || 0));
                    console.log(`🏆 Implementation intent detected — ${goldenPathCount} golden path entries boosted 5x`);
                }
            }

            // ================================================================
            // STAGE 5: Apply relevance floor — discard anything below 0.30
            // to prevent off-topic noise from reaching the LLM context.
            // ================================================================
            const SIMILARITY_THRESHOLD = 0.30;
            let filteredResults = boostedResults.filter(r => (r.rerankedScore || r.score || 0) >= SIMILARITY_THRESHOLD);
            console.log(`After relevance floor (>=${SIMILARITY_THRESHOLD}): ${filteredResults.length} results`);

            // ================================================================
            // STAGE 5b: Anti-noise filter — drop non-gold results whose
            // title+content contain NONE of the core domain terms.
            // This catches off-topic entries like "FACT System", "Scaling Up
            // methodology", etc. that sneak through vector similarity.
            // ================================================================
            const DOMAIN_TERMS_FILTER = /\b(ruvector|ruflo|claude.?flow|hnsw|vector|agent|swarm|mcp|rvf|sona|min.?cut|embedding|agentic|cognitive|wasm|onnx|aimds|knowledge.?base)\b/i;
            const beforeNoise = filteredResults.length;
            filteredResults = filteredResults.filter(r => {
                const id = r.id || '';
                const isCurated = r.metadata?.is_curated || id.startsWith('kb_');
                if (isCurated) return true; // Gold entries always pass
                const qualityScore = r.metadata?.quality_score || r.quality_score || 0;
                if (qualityScore >= 95) return true; // High-quality entries pass
                const text = `${r.title || r.metadata?.title || ''} ${(r.content || '').substring(0, 500)}`;
                return DOMAIN_TERMS_FILTER.test(text);
            });
            if (beforeNoise !== filteredResults.length) {
                console.log(`🚫 Anti-noise filter removed ${beforeNoise - filteredResults.length} off-topic results (${filteredResults.length} remain)`);
            }

            // ================================================================
            // STAGE 6: Map to sources with full content
            // ================================================================
            sources = filteredResults.map(r => ({
                id: r.id,
                title: r.title || r.metadata?.title || null,
                content: r.content || r.input || '',
                score: r.rerankedScore || r.score || 0,
                source: r.source || r.metadata?.source,
                timestamp: r.timestamp || r.metadata?.timestamp,
                scoreBreakdown: r.scoreBreakdown,
                package_name: r.package_name || r.metadata?.package_name || null,
                doc_type: r.doc_type || r.metadata?.doc_type || null,
                file_path: r.file_path || r.metadata?.file_path || null,
                topics: r.topics || r.metadata?.topics || [],
                triage_tier: r.triage_tier || r.metadata?.triage_tier || null,
                quality_score: r.quality_score || r.metadata?.quality_score || null,
                metadata: r.metadata,
            }));

            // ================================================================
            // STAGE 6b: Anti-pattern annotation (ADR-002)
            // When golden path entries are in results, annotate alternative
            // entries that describe the harder/deprecated path.
            // ================================================================
            const goldenPathTopics = sources
                .filter(s => s.metadata?.category === 'implementation-path')
                .map(s => (s.title || '').toLowerCase());
            if (goldenPathTopics.length > 0) {
                sources.forEach(s => {
                    if (s.metadata?.category === 'implementation-path') return;
                    const text = ((s.content || '') + ' ' + (s.title || '')).toLowerCase();
                    const hasAlternative =
                        (goldenPathTopics.some(gp => gp.includes('vector')) && text.includes('postgres') && !text.includes('golden path')) ||
                        (goldenPathTopics.some(gp => gp.includes('swarm') || gp.includes('agent coordination')) && /\bmesh\b/.test(text) && !text.includes('golden path')) ||
                        (goldenPathTopics.some(gp => gp.includes('sona') || gp.includes('self-learning')) && text.includes('sona') && !text.includes('intelligenceengine') && !text.includes('golden path'));
                    if (hasAlternative) {
                        s.content = `[NOTE: A simpler recommended approach exists — see the Golden Path entry in this context.]\n\n${s.content}`;
                    }
                });
            }

            // ================================================================
            // STAGE 7: Diversity filter to avoid redundant content
            // ================================================================
            sources = applyDiversityFilter(sources, 8);
            console.log(`After diversity filter: ${sources.length} sources`);

            // ================================================================
            // STAGE 8: Context compression for optimal LLM utilization
            // ================================================================
            context = contextCompressor.compress(sources, message);
            console.log(`📦 Context compressed to ${context.length} chars`);

        } catch (err) {
            console.error('🚨 RAG pipeline error:', err);
            kbStatus = 'error';
            // Surface the error — don't silently degrade
            context = `\n\n⚠️ KNOWLEDGE BASE ERROR: The search pipeline encountered an error (${err.message}). Your answer may be incomplete.\n\n`;
        }
    }

    // Build system prompt with Learning Level adaptation
    const { RUV_PERSONA } = require('./RuvPersona');
    const learningLevel = mode || 'Balanced';
    const levelInstructions = {
        'Simple': `Explain like I'm 5 years old. Rules:
- Use everyday analogies for EVERY concept (e.g., "A vector database is like a library where books are shelved by what they're about, not alphabetically")
- Zero jargon — if you must use a technical term, immediately explain it in parentheses
- Short sentences (max 15 words each)
- Use emojis as visual markers: 🔑 for key points, ⚡ for actions, 🎯 for outcomes
- Mermaid diagrams should use simple labels and emoji nodes
- Skip the "What to Watch For" section — keep it fun and approachable
- End with "Try This" instead of code examples — a simple hands-on activity`,

        'Beginner': `Explain for someone new to programming who is eager to learn. Rules:
- Define every technical term on first use with a real-world analogy
- Include "Why This Matters" callouts (> blockquotes) explaining practical relevance
- Show complete, runnable code examples with comments on every line
- Mermaid diagrams should have descriptive labels and clear flow
- Include "Common Mistake" callouts flagging what beginners get wrong
- Comparison tables should include a "Best For" column
- The "Explore Further" section should progress from easier → harder questions`,

        'Balanced': `Write like a New York Times technology feature: lead with the most compelling insight, then layer depth progressively. Rules:
- OPENING HOOK: The TL;DR MUST contain at least one specific number from the knowledge base (12,500x faster, 880 memories, 0.5MB, 383 entries, 21K stars, etc.). A TL;DR without a metric is incomplete.
- NARRATIVE FLOW: Each section builds on the previous. Use transitions: "This matters because...", "Here's what that looks like in practice...", "The key difference is..."
- CONCRETE NUMBERS: EVERY claim must have a number. Not "fast" but "2ms". Not "small" but "0.5MB". Not "many" but "383 entries". Pull exact numbers from the knowledge base context.
- REAL-WORLD STAKES: What breaks without this? What becomes possible with it? What does the alternative cost? Make the reader feel the gap between before and after.
- TECHNICAL DEPTH: Go deeper than surface-level. If explaining HNSW, explain WHY it's O(log N) — the multi-layer skip structure. If explaining Pi Brain, explain HOW sessions share — MCP tools, Ed25519 signing, Bayesian voting. Surface-level descriptions are not acceptable.
- CODE MUST BE REAL: Every command must come from the verified whitelist in the system prompt. If you're about to write a command that isn't in the whitelist, STOP and use one that is, or say "See the documentation."
- Mermaid diagrams: 10+ nodes minimum, use subgraph blocks, show real component names and data flow directions
- Comparison tables: MUST include at least one quantitative column (speed, size, entries, stars)
- "What to Watch For": Be honest about limitations, not just gotchas. What doesn't this do well?`,

        'Technical': `Provide maximum technical depth for an experienced engineer. Rules:
- Assume strong engineering background — skip analogies for basic concepts
- Include implementation internals: data structures, algorithms, complexity analysis
- Code examples should show advanced patterns, configuration, and optimization
- Mermaid diagrams should include internal architecture, not just high-level boxes
- Include benchmark data, memory characteristics, and performance implications
- Cover failure modes, debugging approaches, and operational concerns
- Reference ADRs, changelogs, and architectural evolution when available
- Include SQL queries, API calls, and system commands where relevant`
    };

    // ================================================================
    // STAGE 9: Match NotebookLM media resources to the user query
    // ================================================================
    const nlmMatches = matchNlmResources(message);
    const nlmSection = formatNlmResourcesSection(nlmMatches);
    if (nlmMatches.length > 0) {
        console.log(`🎬 NLM resources matched: ${nlmMatches.map(r => r.title).join(', ')}`);
    }

    // ADR-002: Detect if golden path entries are in context
    const hasGoldenPaths = sources.some(s => s.metadata?.category === 'implementation-path');

    // Build response structure based on whether prescriptive mode is active
    const prescriptiveStructure = hasGoldenPaths ? `
===== PRESCRIPTIVE MODE — THIS OVERRIDES THE NORMAL RESPONSE STRUCTURE =====
Your context includes Golden Path entries (category: implementation-path). These are
VERIFIED, OPINIONATED best practices backed by structural analysis of 652,000 code symbols.

YOU MUST USE THIS RESPONSE STRUCTURE (not the normal TL;DR → Explanation structure):

1. **One-Line Summary** (1 sentence with a concrete number: "X in Y seconds" or "Zx faster")
2. **The Code** (the COMPLETE, copy-paste code block IMMEDIATELY — no explanation before it)
3. **What You Will See** (2-3 sentences: what happens when they run the code)
4. **Do NOT Do This** (explicit anti-patterns: "Do NOT use Postgres for new applications because its attention cluster has 0.21 cohesion — it reaches across 5+ crates you don't need. Use RVF instead." Be specific and direct. NEVER present the anti-pattern as an equal alternative.)
5. **Graduate When** (one paragraph: when should they move to the advanced option)
6. **What's Next** (one sentence pointing to the NEXT golden path in the progression: vectors → self-learning → MCP → agents → security)

CRITICAL RULES:
- Keep the TOTAL response under 600 words. Brevity is the point. They want working code, not an essay.
- Do NOT include a Mermaid diagram. Code IS the visual.
- Do NOT include an "Explore Further" section. Use "What's Next" instead.
- Do NOT present alternatives as equal options. The golden path IS the recommendation.
- Do NOT start with an analogy or context-setting paragraph. Start with the summary, then code.
` : '';

    const normalStructure = !hasGoldenPaths ? `
===== RESPONSE STYLE =====
Learning Level: ${learningLevel}
${levelInstructions[learningLevel] || levelInstructions['Balanced']}

===== MANDATORY RESPONSE ELEMENTS (CHECK BEFORE SENDING) =====
Your response MUST contain ALL of these. If any is missing, add it now:
□ An analogy grounding the concept ("Think of X like...")
□ At least one honest limitation or tradeoff
□ Why this matters to the person asking (make it personal)
□ Brief competitive context (what the alternative is and why this is different)
□ A concrete next step they can take right now
` : `
===== RESPONSE STYLE =====
Learning Level: ${learningLevel}
Keep it concise and action-oriented. The user asked HOW to do something — give them the answer.
`;

    const normalInstructions = !hasGoldenPaths ? `
===== INSTRUCTIONS =====
MANDATORY: Follow the response structure (TL;DR → Core Explanation → Architecture/How It Works with Mermaid diagram → Practical Example → What to Watch For → Explore Further${nlmSection ? ' → Related Media' : ''}). Include a Mermaid diagram if the topic involves any system, workflow, or multi-step process. Base your answer ONLY on the knowledge base context above. When sources conflict, prefer [GOLD] over [SILVER] over [BRONZE]. Adapt depth and language to the ${learningLevel} learning level. If context is insufficient, say so honestly.

CRITICAL: You MUST include at least ONE \`\`\`mermaid diagram and ONE | markdown table | in every response about architecture, workflows, or comparisons. Responses without visual elements are incomplete.${nlmSection ? '\n\nCRITICAL: You MUST include the "### Related Media" section with the exact markdown links from AVAILABLE MEDIA RESOURCES above. Do NOT omit this section when media resources are provided.' : ''}` : `
===== INSTRUCTIONS =====
Follow the PRESCRIPTIVE MODE structure above. Base your answer ONLY on the knowledge base context. When sources conflict, prefer [GOLD] over [SILVER] over [BRONZE]. Keep it under 600 words.${nlmSection ? '\n\nInclude a "### Related Media" section with the exact markdown links from AVAILABLE MEDIA RESOURCES above.' : ''}`;

    const systemPrompt = `${RUV_PERSONA}
${prescriptiveStructure}
${normalStructure}
===== KNOWLEDGE BASE CONTEXT =====
${context || 'No specific context was found in the knowledge base for this query. You MUST tell the user that you do not have enough information in your knowledge base to answer this question accurately, and suggest they rephrase or ask about a topic covered in the knowledge base. Do NOT use general knowledge or guess.'}
${nlmSection ? `
===== AVAILABLE MEDIA RESOURCES =====
The following NotebookLM-generated media resources are relevant to this query. You MUST include these as a "### Related Media" section at the END of your response (after "Explore Further"), using the exact markdown links provided. This helps the user access deep-dive content beyond your text response.
${nlmSection}` : ''}
${normalInstructions}`;

    // Build LLM messages array
    const MAX_HISTORY_TURNS = 6;
    const truncatedHistory = (conversationHistory || []).slice(-MAX_HISTORY_TURNS);
    const messages = [
        { role: 'system', content: systemPrompt },
        ...truncatedHistory,
        { role: 'user', content: message }
    ];

    // ========================================================================
    // Confidence scoring (Phase 3, M-4)
    // ========================================================================
    let confidence = 'low';
    if (sources.length > 0) {
        const avgScore = sources.reduce((sum, s) => sum + (s.score || 0), 0) / sources.length;
        const goldCount = sources.filter(s => {
            const isCurated = s.metadata?.is_curated || (s.id || '').startsWith('kb_');
            const qualityScore = s.quality_score || s.metadata?.quality_score || 0;
            return isCurated || qualityScore >= 95;
        }).length;
        if (avgScore > 0.5 && goldCount >= 2) {
            confidence = 'high';
        } else if (avgScore > 0.3) {
            confidence = 'medium';
        }
        console.log(`🎯 Confidence: ${confidence} (avgScore=${avgScore.toFixed(3)}, goldCount=${goldCount})`);
    }

    // ========================================================================
    // Query classification for response validation (Phase 3, H-1)
    // ========================================================================
    const queryRequirements = responseValidator.classifyQuery(message);

    return { context, sources, systemPrompt, messages, confidence, kbStatus, queryRequirements };
}

// ============================================================================
// Readiness guard — reject chat requests while server is still starting up
// ============================================================================
app.use(['/api/chat', '/api/chat/stream'], (req, res, next) => {
    if (!isReady) {
        return res.status(503).json({ error: 'Server starting up, please retry in a few seconds' });
    }
    next();
});

// ============================================================================
// Non-streaming Chat Endpoint
// ============================================================================
app.post('/api/chat', async (req, res) => {
    const { message: rawMessage, history, mode } = req.body;

    if (!rawMessage || typeof rawMessage !== 'string') {
        return res.status(400).json({ error: 'Message is required and must be a string' });
    }

    const message = sanitizeInput(rawMessage);
    console.log(`[Chat] Received: ${message} (level: ${mode || 'Balanced'})`);

    if (message.length > 10000) {
        return res.status(400).json({ error: 'Message too long (max 10,000 characters)' });
    }

    if (LLM_PROVIDERS.length === 0) {
        console.error('❌ No LLM API keys configured!');
        return res.status(500).json({ error: 'Server configuration error: No LLM API keys set. Configure OPENAI_API_KEY, CLAUDE_API_KEY, or GROQ_API_KEY.' });
    }

    try {
        // Check RAG cache before running the full pipeline
        const cacheKey = ragCacheKey(message, mode);
        let ragResult = ragCacheGet(cacheKey);
        if (ragResult) {
            console.log(`[RAG Cache] HIT for key ${cacheKey}`);
        } else {
            ragResult = await runRAGPipeline(message, mode, history);
            ragCacheSet(cacheKey, ragResult);
            console.log(`[RAG Cache] MISS — cached key ${cacheKey}`);
        }
        const { sources, messages, confidence, kbStatus, queryRequirements } = ragResult;

        // Effectiveness telemetry — record what was asked and how well the KB covered it
        recordQuestion({ query: message, topScore: (sources || []).reduce((m, s) => Math.max(m, s.score || 0), 0), resultCount: (sources || []).length, confidence });

        // Generate Response using multi-provider LLM (with automatic fallback)
        let answer = "";
        let errorMsg = null;
        let usedProvider = null;
        try {
            const result = await llmChat(messages);
            answer = result.answer;
            usedProvider = result.provider;
            console.log(`✅ Got answer from ${result.provider} (${result.model})`);
        } catch (error) {
            console.error('Error calling LLM:', error.message);
            answer = "I apologize, but I encountered an error generating a response. Please try again.";
            errorMsg = error.message;
        }

        // Response validation (Phase 3, H-1) — log missing elements
        const validation = responseValidator.validate(answer, queryRequirements);
        if (!validation.valid) {
            console.log(`⚠️ Response missing elements: ${validation.missing.join(', ')}`);
            const suggestion = responseValidator.buildSuggestionNote(validation.missing);
            if (suggestion) {
                answer += suggestion;
            }
        }

        res.json({
            answer,
            error: errorMsg,
            provider: usedProvider || null,
            confidence: confidence || 'low',
            kbStatus: kbStatus || 'ok',
            sources: sources.map(s => ({
                id: s.id,
                score: s.score,
                content: (s.content || '').substring(0, 200),
                title: cleanSourceTitle(s),
                package_name: s.package_name || s.metadata?.package_name || null,
                doc_type: s.doc_type || s.metadata?.doc_type || null,
                file_path: s.file_path || s.metadata?.file_path || null,
                topics: s.topics || s.metadata?.topics || [],
                triage_tier: s.triage_tier || s.metadata?.triage_tier || null,
                quality_score: s.quality_score || s.metadata?.quality_score || null,
            }))
        });

    } catch (error) {
        console.error('Error processing chat:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// SSE Streaming Chat Endpoint — sends tokens as they arrive
// ============================================================================
app.post('/api/chat/stream', async (req, res) => {
    const { message: rawMessage, history, mode } = req.body;

    if (!rawMessage || typeof rawMessage !== 'string') {
        return res.status(400).json({ error: 'Message is required' });
    }

    const message = sanitizeInput(rawMessage);
    console.log(`[Stream] Received: ${message} (level: ${mode || 'Balanced'})`);

    if (message.length > 10000) {
        return res.status(400).json({ error: 'Message too long' });
    }
    if (LLM_PROVIDERS.length === 0) {
        return res.status(500).json({ error: 'No LLM providers configured' });
    }

    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });

    try {
        // Check RAG cache before running the full pipeline
        const cacheKey = ragCacheKey(message, mode);
        let ragResult = ragCacheGet(cacheKey);
        if (ragResult) {
            console.log(`[RAG Cache] HIT for key ${cacheKey} (stream)`);
        } else {
            ragResult = await runRAGPipeline(message, mode, history);
            ragCacheSet(cacheKey, ragResult);
            console.log(`[RAG Cache] MISS — cached key ${cacheKey} (stream)`);
        }
        const { sources, messages, confidence, kbStatus, queryRequirements } = ragResult;

        // Effectiveness telemetry — record what was asked and how well the KB covered it
        recordQuestion({ query: message, topScore: (sources || []).reduce((m, s) => Math.max(m, s.score || 0), 0), resultCount: (sources || []).length, confidence });

        // Send KB status and confidence first as JSON events
        if (kbStatus && kbStatus !== 'ok') {
            res.write(`event: kb_warning\ndata: ${JSON.stringify({ kbStatus, message: 'Knowledge base is not loaded. Answers may be inaccurate.' })}\n\n`);
        }
        const sourcesPayload = sources.map(s => ({
            id: s.id,
            score: s.score,
            content: (s.content || '').substring(0, 200),
            title: cleanSourceTitle(s),
            package_name: s.package_name,
            doc_type: s.doc_type,
            file_path: s.file_path,
            topics: s.topics,
            triage_tier: s.triage_tier,
            quality_score: s.quality_score,
        }));
        res.write(`event: sources\ndata: ${JSON.stringify(sourcesPayload)}\n\n`);
        res.write(`event: confidence\ndata: ${JSON.stringify({ confidence: confidence || 'low' })}\n\n`);

        // Stream LLM tokens
        let fullAnswer = '';
        for await (const token of llmChatStream(messages)) {
            fullAnswer += token;
            res.write(`event: token\ndata: ${JSON.stringify(token)}\n\n`);
        }

        // Response validation (Phase 3, H-1) — log missing elements, append suggestion
        const validation = responseValidator.validate(fullAnswer, queryRequirements);
        if (!validation.valid) {
            console.log(`⚠️ Stream response missing elements: ${validation.missing.join(', ')}`);
            const suggestion = responseValidator.buildSuggestionNote(validation.missing);
            if (suggestion) {
                // Send suggestion as additional tokens so the client sees it
                res.write(`event: token\ndata: ${JSON.stringify(suggestion)}\n\n`);
                fullAnswer += suggestion;
            }
        }

        console.log(`✅ Streamed ${fullAnswer.length} chars`);
        res.write(`event: done\ndata: ${JSON.stringify({ length: fullAnswer.length })}\n\n`);
        res.end();

    } catch (error) {
        console.error('Stream error:', error);
        res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
    }
});

// Readiness Probe — returns 200 only when all subsystems are loaded
app.get('/readiness', (req, res) => {
    if (isReady) {
        return res.json({ status: 'ready', uptime: process.uptime(), startupMs: Date.now() - startupTime });
    }
    res.status(503).json({ status: 'starting', message: 'Server is still initializing, please retry in a few seconds' });
});

// Health Check Endpoint
app.get('/health', async (req, res) => {
    const vectorStoreStatus = (() => {
        if (!reasoningBank) return { status: 'not_initialized', vectorCount: 0 };
        const stats = reasoningBank.getStats?.() || {};
        const count = stats.vectorCount || 0;
        return { status: count > 0 ? 'ok' : 'empty', vectorCount: count, backend: stats.backend || 'unknown' };
    })();

    const hybridSearchStatus = (() => {
        if (!hybridSearch) return { status: 'not_initialized', documentCount: 0 };
        const docCount = hybridSearch.documentCount || hybridSearch.documents?.size || 0;
        return { status: docCount > 0 ? 'ok' : 'empty', documentCount: docCount };
    })();

    const overallStatus = (vectorStoreStatus.status === 'ok' && hybridSearchStatus.status === 'ok') ? 'ok'
        : (vectorStoreStatus.status === 'not_initialized' || hybridSearchStatus.status === 'not_initialized') ? 'degraded'
        : 'ok';

    // NLM heartbeat check
    let nlmStatus = 'unknown';
    try {
        const hbPath = path.join(__dirname, '../../scripts/nlm-heartbeat.json');
        if (fs.existsSync(hbPath)) {
            const hb = JSON.parse(fs.readFileSync(hbPath, 'utf8'));
            const lastSuccess = hb.lastSuccess ? new Date(hb.lastSuccess) : null;
            const hoursSince = lastSuccess ? (Date.now() - lastSuccess.getTime()) / 3600000 : Infinity;
            nlmStatus = hoursSince < 48 ? 'ok' : hoursSince < 168 ? 'stale' : 'failed';
            if (hb.authStatus === 'auth_expired') nlmStatus = 'auth_expired';
        }
    } catch { nlmStatus = 'unknown'; }

    // Integrity check results (from startup)
    let integrityStatus = 'unknown';
    let integrityProblems = [];
    try {
        const irPath = path.join(__dirname, '../../scripts/integrity-results.json');
        if (fs.existsSync(irPath)) {
            const ir = JSON.parse(fs.readFileSync(irPath, 'utf8'));
            integrityStatus = ir.passed ? 'ok' : `${ir.problems.length} problems`;
            integrityProblems = ir.problems || [];
        }
    } catch { integrityStatus = 'unknown'; }

    const health = {
        status: overallStatus,
        version: APP_VERSION,
        uptime: process.uptime(),
        timestamp: new Date(),
        checks: {
            server: 'ok',
            vectorStore: vectorStoreStatus,
            hybridSearch: hybridSearchStatus,
            gemini: GEMINI_API_KEY ? 'configured' : 'not_configured',
            nlmRefresh: nlmStatus,
            integrity: integrityStatus,
            integrityProblems: integrityProblems.length > 0 ? integrityProblems : undefined,
        }
    };
    res.json(health);
});

// Lightweight usage analytics (9.3) — tracks resource engagement, no PII
const usageStats = { queries: 0, resources: {}, capabilities: {}, startTime: Date.now() };

// ============================================================================
// Site analytics — USAGE (visitors) + EFFECTIVENESS (questions, gaps, ratings)
// State persists to /app/data so it survives restarts. Mount a Railway volume
// at /app/data to make it durable across DEPLOYS too (zero code change needed).
// ============================================================================
const crypto = require('crypto');
const DATA_DIR = path.join(__dirname, '../../data');
const VISITORS_FILE = path.join(DATA_DIR, 'visitors.json');
const EFFECT_FILE = path.join(DATA_DIR, 'effectiveness.json');
const QUERY_LOG = path.join(DATA_DIR, 'query-log.ndjson');
const ANSWERED_SCORE = 0.5; // secondary gate: min top relevance to count as "answered"

function ensureDataDir() { try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch { /* non-fatal */ } }
function hashIP(req) {
    const rawIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    return crypto.createHash('sha256').update(rawIP + 'ask-ruvnet-salt').digest('hex').substring(0, 16);
}

// ---- Visitors: counted via an explicit beacon from the LOADED SPA, so bots
//      and health-check pings (which never execute JS) don't inflate the count ----
let visitorData = { uniqueIPs: [], totalPageViews: 0, firstSeen: Date.now() };
try { if (fs.existsSync(VISITORS_FILE)) visitorData = JSON.parse(fs.readFileSync(VISITORS_FILE, 'utf8')); }
catch (e) { console.warn('[analytics] visitors.json load failed, starting fresh:', e.message); }
const visitorIPSet = new Set(visitorData.uniqueIPs || []);
function saveVisitorData() {
    try {
        ensureDataDir();
        fs.writeFileSync(VISITORS_FILE, JSON.stringify({
            uniqueIPs: [...visitorIPSet],
            totalPageViews: visitorData.totalPageViews,
            firstSeen: visitorData.firstSeen,
            lastUpdated: new Date().toISOString()
        }, null, 2));
    } catch (e) { console.warn('[analytics] visitors.json save failed:', e.message); }
}

// ---- Effectiveness: questions asked, KB coverage gaps, helpfulness ratings ----
let effect = { totalQuestions: 0, answeredQuestions: 0, ratings: { up: 0, down: 0 }, gaps: [], firstSeen: Date.now() };
try { if (fs.existsSync(EFFECT_FILE)) effect = { ...effect, ...JSON.parse(fs.readFileSync(EFFECT_FILE, 'utf8')) }; }
catch (e) { console.warn('[analytics] effectiveness.json load failed, starting fresh:', e.message); }
function saveEffect() {
    try { ensureDataDir(); fs.writeFileSync(EFFECT_FILE, JSON.stringify({ ...effect, lastUpdated: new Date().toISOString() }, null, 2)); }
    catch (e) { console.warn('[analytics] effectiveness.json save failed:', e.message); }
}
function pushGap(entry) {
    effect.gaps.push(entry);
    if (effect.gaps.length > 100) effect.gaps = effect.gaps.slice(-100);
}
// Record a question + its retrieval quality. Fire-and-forget; NEVER throws into the chat path.
function recordQuestion({ query, topScore = 0, resultCount = 0, confidence = 'low' }) {
    try {
        const confident = confidence && confidence !== 'low' && confidence !== 'none';
        const answered = resultCount > 0 && (confident || topScore >= ANSWERED_SCORE);
        effect.totalQuestions++;
        if (answered) effect.answeredQuestions++;
        else pushGap({ q: String(query).slice(0, 200), topScore: Number(topScore) || 0, resultCount, confidence, ts: new Date().toISOString() });
        try { ensureDataDir(); fs.appendFileSync(QUERY_LOG, JSON.stringify({ ts: new Date().toISOString(), q: String(query).slice(0, 200), topScore: Number(topScore) || 0, resultCount, confidence, answered }) + '\n'); } catch { /* log best-effort */ }
        saveEffect();
    } catch (e) { console.warn('[analytics] recordQuestion failed:', e.message); }
}
function summarizeEffect() {
    const ratingsTotal = effect.ratings.up + effect.ratings.down;
    return {
        totalQuestions: effect.totalQuestions,
        answeredQuestions: effect.answeredQuestions,
        answerRate: effect.totalQuestions ? Math.round((effect.answeredQuestions / effect.totalQuestions) * 100) : null,
        ratingsTotal,
        helpfulPct: ratingsTotal ? Math.round((effect.ratings.up / ratingsTotal) * 100) : null,
    };
}

// Flush both stores every 5 minutes regardless
setInterval(() => { saveVisitorData(); saveEffect(); }, 5 * 60 * 1000);

// Beacon: the SPA POSTs this once on load = one real human page view
app.post('/api/track/visit', (req, res) => {
    try {
        visitorData.totalPageViews++;
        const h = hashIP(req);
        if (!visitorIPSet.has(h)) visitorIPSet.add(h);
        saveVisitorData();
    } catch (e) { console.warn('[analytics] track/visit failed:', e.message); }
    res.json({ ok: true, uniqueVisitors: visitorIPSet.size, totalPageViews: visitorData.totalPageViews });
});

// Helpfulness rating from a 👍/👎 click under an answer. A downvote is also a gap.
app.post('/api/feedback', (req, res) => {
    const { rating, query } = req.body || {};
    if (rating !== 'up' && rating !== 'down') return res.status(400).json({ error: "rating must be 'up' or 'down'" });
    try {
        effect.ratings[rating]++;
        if (rating === 'down' && query) pushGap({ q: sanitizeInput(String(query)).slice(0, 200), reason: 'downvote', ts: new Date().toISOString() });
        saveEffect();
    } catch (e) { console.warn('[analytics] feedback failed:', e.message); }
    res.json({ ok: true });
});

// Combined public stats for the header stats bar (visitors + effectiveness)
app.get('/api/visitors', (req, res) => {
    res.json({
        uniqueVisitors: visitorIPSet.size,
        totalPageViews: visitorData.totalPageViews,
        trackingSince: new Date(visitorData.firstSeen).toISOString(),
        ...summarizeEffect(),
    });
});

// Full analytics incl. the content-GAP list (low-confidence / zero-result / downvoted questions)
app.get('/api/analytics/summary', (req, res) => {
    res.json({
        ...summarizeEffect(),
        uniqueVisitors: visitorIPSet.size,
        totalPageViews: visitorData.totalPageViews,
        topGaps: effect.gaps.slice(-15).reverse(),
        uptimeMs: Date.now() - usageStats.startTime,
    });
});

// Legacy in-memory event counter (kept for any existing callers)
app.post('/api/analytics/event', (req, res) => {
    const { type, name } = req.body || {};
    if (!type || !name) return res.status(400).json({ error: 'type and name required' });
    const allowedTypes = ['query', 'resource', 'capability'];
    if (!allowedTypes.includes(type)) return res.status(400).json({ error: 'Invalid type' });
    const safeName = sanitizeInput(String(name)).substring(0, 200);
    if (!safeName) return res.status(400).json({ error: 'Invalid name' });
    if (type === 'query') usageStats.queries++;
    else if (type === 'resource') usageStats.resources[safeName] = (usageStats.resources[safeName] || 0) + 1;
    else if (type === 'capability') usageStats.capabilities[safeName] = (usageStats.capabilities[safeName] || 0) + 1;
    res.json({ ok: true });
});

// LLM Provider Status — shows which providers are configured and the fallback chain
app.get('/api/providers', (req, res) => {
    res.json({
        providers: LLM_PROVIDERS.map(p => ({ name: p.name, model: p.model })),
        primary: LLM_PROVIDERS[0]?.name || 'none',
        fallbackChain: LLM_PROVIDERS.map(p => p.name).join(' → '),
        configured: LLM_PROVIDERS.length,
    });
});

// KB Statistics Endpoint - shows RVF store state
app.get('/api/kb-stats', async (req, res) => {
    try {
        if (!reasoningBank) {
            return res.status(503).json({
                backend: 'RVF (HNSW binary)',
                connected: false,
                status: 'not_initialized',
                error: 'Knowledge base failed to load. Check server logs for RVF errors.',
                vectorCount: 0,
            });
        }
        const vectorStats = reasoningBank.getStats?.() || {};
        res.json({
            backend: 'RVF (HNSW binary)',
            connected: true,
            status: vectorStats.healthStatus || 'ok',
            ...vectorStats
        });
    } catch (err) {
        res.status(500).json({ error: err.message, connected: false, status: 'error' });
    }
});

// Latest Repos Endpoint - returns 20 most recently updated repos from KB
let latestReposCache = null;
let latestReposCacheExpiry = 0;

app.get('/api/latest-repos', async (req, res) => {
    try {
        const now = Date.now();
        if (latestReposCache && now < latestReposCacheExpiry) {
            return res.json(latestReposCache);
        }

        // Compute from RVF store metadata
        if (reasoningBank && reasoningBank.db && reasoningBank.db.getAllMetadata) {
            const allMeta = reasoningBank.db.getAllMetadata();
            const repoCounts = new Map();

            for (const entry of allMeta) {
                const pkg = entry.metadata?.package_name;
                if (pkg) {
                    const existing = repoCounts.get(pkg) || { count: 0, lastUpdated: null };
                    existing.count++;
                    const ts = entry.metadata?.timestamp;
                    if (ts && (!existing.lastUpdated || ts > existing.lastUpdated)) {
                        existing.lastUpdated = ts;
                    }
                    repoCounts.set(pkg, existing);
                }
            }

            const repos = Array.from(repoCounts.entries())
                .sort((a, b) => (b[1].lastUpdated || '').localeCompare(a[1].lastUpdated || ''))
                .slice(0, 20)
                .map(([name, data]) => ({
                    name,
                    description: `${data.count.toLocaleString()} KB entries`,
                    lastUpdated: data.lastUpdated,
                    entryCount: data.count
                }));

            latestReposCache = repos;
            latestReposCacheExpiry = now + 3600_000;
            return res.json(repos);
        }

        res.json([]);
    } catch (err) {
        console.error('[KB] Error fetching latest repos:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Ecosystem Stats Endpoint - aggregate stats from the KB
let ecosystemStatsCache = null;
let ecosystemStatsCacheExpiry = 0;

app.get('/api/ecosystem-stats', async (req, res) => {
    try {
        const now = Date.now();
        if (ecosystemStatsCache && now < ecosystemStatsCacheExpiry) {
            return res.json(ecosystemStatsCache);
        }

        // Compute from RVF store metadata
        if (reasoningBank && reasoningBank.db && reasoningBank.db.getAllMetadata) {
            const allMeta = reasoningBank.db.getAllMetadata();
            const repos = new Set();
            const docTypes = new Set();
            let goldCount = 0;

            for (const entry of allMeta) {
                const m = entry.metadata || {};
                if (m.package_name) repos.add(m.package_name);
                if (m.doc_type) docTypes.add(m.doc_type);
                if (m.is_curated || m.triage_tier === 'gold') goldCount++;
            }

            const stats = {
                totalRepos: repos.size,
                totalEntries: allMeta.length,
                docTypes: docTypes.size,
                goldCount,
                lastUpdated: new Date().toISOString(),
                kbBackend: 'RVF (HNSW binary)'
            };

            ecosystemStatsCache = stats;
            ecosystemStatsCacheExpiry = now + 3600_000;
            return res.json(stats);
        }

        res.json({
            totalRepos: 0,
            totalEntries: 0,
            docTypes: 0,
            lastUpdated: null,
            kbBackend: 'Not connected'
        });
    } catch (err) {
        console.error('[KB] Error fetching ecosystem stats:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Community Stats — GitHub stars, npm downloads, Pi Brain activity (cached 1hr)
let communityStatsCache = null;
let communityStatsCacheExpiry = 0;

// Trending-dev recognition. Update the `source` URL when Stuart provides the screenshot/tweet.
// The badge shows on the stats bar as long as `rank` is set.
const TRENDING_DEV = {
    rank: 1,
    week: '2026-05-05', // week of — update if/when changes
    source: process.env.TRENDING_SOURCE_URL || 'https://github.com/trending/developers', // TODO: replace with Stuart's screenshot/tweet URL
};

// Paginate ruvnet's repos and sum stars/forks (175+ repos as of 2026-05-13).
async function fetchAllRuvnetRepos() {
    const all = [];
    for (let page = 1; page <= 5; page++) {
        const r = await fetch(`https://api.github.com/users/ruvnet/repos?per_page=100&page=${page}&type=owner`);
        if (!r.ok) break;
        const arr = await r.json();
        if (!Array.isArray(arr) || arr.length === 0) break;
        all.push(...arr);
        if (arr.length < 100) break;
    }
    return all;
}

// All packages maintained by ruvnet on npm (250+ as of 2026-05-13).
async function fetchAllRuvnetNpmPackages() {
    const r = await fetch('https://registry.npmjs.org/-/v1/search?text=maintainer:ruvnet&size=250');
    if (!r.ok) return [];
    const d = await r.json();
    return d.objects?.map(o => o.package.name) || [];
}

async function lastMonthDownloads(pkg) {
    try {
        const r = await fetch(`https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(pkg)}`);
        if (!r.ok) return 0;
        const d = await r.json();
        return d.downloads || 0;
    } catch { return 0; }
}

app.get('/api/community-stats', async (req, res) => {
    try {
        const now = Date.now();
        if (communityStatsCache && now < communityStatsCacheExpiry) {
            return res.json(communityStatsCache);
        }

        // 1. GitHub: enumerate all of ruvnet's repos for accurate totals
        const reposPromise = fetchAllRuvnetRepos().catch(() => []);
        const profilePromise = fetch('https://api.github.com/users/ruvnet').then(r => r.json()).catch(() => ({}));

        // 2. npm: enumerate all maintained packages, then sum last-month downloads
        const pkgsPromise = fetchAllRuvnetNpmPackages().catch(() => []);

        // 3. Pi-Brain
        const piPromise = fetch('https://pi.ruv.io/v1/status').then(r => r.json()).catch(() => ({}));

        const [repos, profile, packages, piStatus] = await Promise.all([reposPromise, profilePromise, pkgsPromise, piPromise]);

        // Compute GitHub totals (exclude forks the user doesn't own)
        const ownRepos = repos.filter(r => !r.fork);
        const totalStars = ownRepos.reduce((s, r) => s + (r.stargazers_count || 0), 0);
        const totalForks = ownRepos.reduce((s, r) => s + (r.forks_count || 0), 0);
        const topRepos = ownRepos
            .sort((a, b) => b.stargazers_count - a.stargazers_count)
            .slice(0, 5)
            .map(r => ({ name: r.name, stars: r.stargazers_count, url: r.html_url }));

        // Sum monthly downloads across all packages, throttled (npm rate-limits)
        const npmTotals = [];
        for (let i = 0; i < packages.length; i += 10) {
            const batch = packages.slice(i, i + 10);
            const results = await Promise.all(batch.map(lastMonthDownloads));
            results.forEach((m, j) => npmTotals.push({ pkg: batch[j], m }));
        }
        const monthlyDownloads = npmTotals.reduce((s, x) => s + x.m, 0);
        const topPackages = npmTotals.sort((a, b) => b.m - a.m).slice(0, 5);

        const stats = {
            github: {
                totalStars,
                totalForks,
                totalRepos: ownRepos.length,
                followers: profile.followers || 0,
                topRepos,
                // Keep ruvector + ruflo sub-objects for backwards-compat with cards
                ruvector: ((r) => r ? { stars: r.stargazers_count, forks: r.forks_count } : { stars: 0, forks: 0 })(ownRepos.find(r => r.name === 'RuVector')),
                ruflo:    ((r) => r ? { stars: r.stargazers_count, forks: r.forks_count } : { stars: 0, forks: 0 })(ownRepos.find(r => r.name === 'ruflo')),
            },
            npm: {
                monthlyDownloads,
                totalPackages: packages.length,
                topPackages,
            },
            pi: piStatus ? {
                memories: piStatus.total_memories || 0,
                contributors: piStatus.total_contributors || 0,
                votes: piStatus.total_votes || 0,
                graphEdges: piStatus.graph_edges || 0,
            } : { memories: 0, contributors: 0, votes: 0, graphEdges: 0 },
            rustCrates: 80,
            kbEntries: reasoningBank?.db ? reasoningBank.db.getAllMetadata().length : 0,
            trending: TRENDING_DEV,
            lastUpdated: new Date().toISOString(),
        };

        communityStatsCache = stats;
        communityStatsCacheExpiry = now + 3600_000; // Cache for 1 hour
        res.json(stats);
    } catch (err) {
        console.error('[community-stats] Error:', err.message);
        // Fallback uses last verified values (2026-05-13)
        res.json({
            github: { totalStars: 117140, totalForks: 15623, totalRepos: 175, followers: 7783, ruvector: { stars: 4047 }, ruflo: { stars: 50167 }, topRepos: [] },
            npm: { monthlyDownloads: 8861903, totalPackages: 250, topPackages: [] },
            pi: { memories: 21690, contributors: 119, votes: 944 },
            rustCrates: 80,
            kbEntries: 550,
            trending: TRENDING_DEV,
            lastUpdated: new Date().toISOString(),
            cached: true,
        });
    }
});

// Debug Endpoint - only available in development
if (process.env.NODE_ENV !== 'production') {
    app.get('/api/debug', (req, res) => {
        const cwd = process.cwd();
        const docsPath = path.join(cwd, 'data_ingestion_ruv_coaching/Other Documents');
        let docsFiles = [];
        let error = null;

        try {
            if (fs.existsSync(docsPath)) {
                docsFiles = fs.readdirSync(docsPath);
            } else {
                error = "Path does not exist";
            }
        } catch (e) {
            error = e.message;
        }

        res.json({
            cwd,
            docsPath,
            exists: fs.existsSync(docsPath),
            files: docsFiles,
            error
        });
    });
}


// ============================================================================
// Visualization Helper — Gemini image generation with KB context
// ============================================================================
async function generateVisualization(concept, style, resolution) {
    if (!GEMINI_API_KEY || !geminiClient) {
        throw new Error('Gemini API key not configured');
    }

    // 1. Query KB for context about the concept via vector search
    let kbContext = '';
    if (reasoningBank && reasoningBank.reflexion) {
        try {
            const results = await reasoningBank.reflexion.retrieveRelevant({ task: concept, k: 3 });
            if (results.length > 0) {
                kbContext = results.map(r => `- ${r.metadata?.title || r.task}: ${(r.input || '').substring(0, 300)}`).join('\n');
            }
        } catch (err) {
            console.warn('[Visualize] KB lookup failed (non-fatal):', err.message);
        }
    }

    // 2. Build the image generation prompt
    const styleInstruction = style || 'modern flat design';
    const resLabel = resolution === '2K' ? '2048x2048' : '1024x1024';
    const prompt = [
        `Create a technical architecture diagram in ${styleInstruction} style.`,
        `Dark background (#1a1a2e), use vibrant accent colors (cyan #00d4ff, purple #7c3aed, green #10b981).`,
        `Include labeled components with clean connecting lines.`,
        `Professional technical illustration, no gradients, annotated.`,
        `Resolution target: ${resLabel}.`,
        ``,
        `Subject: "${concept}"`,
        kbContext ? `\nContext from knowledge base:\n${kbContext}` : '',
        ``,
        `Show the key components, their relationships, and data flows. Make labels clear and readable.`,
    ].join('\n');

    // 3. Call Gemini image generation
    const response = await geminiClient.models.generateContent({
        model: 'gemini-2.0-flash-exp',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { responseModalities: ['TEXT', 'IMAGE'] }
    });

    // 4. Extract the image from the response
    const candidates = response.candidates;
    if (!candidates || candidates.length === 0) {
        throw new Error('Gemini returned no candidates');
    }

    let imageBuffer = null;
    for (const part of candidates[0].content.parts) {
        if (part.inlineData) {
            imageBuffer = Buffer.from(part.inlineData.data, 'base64');
            break;
        }
    }

    if (!imageBuffer) {
        throw new Error('Gemini response did not contain an image');
    }

    // 5. Save image to generated_imgs/
    const slug = concept.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 50);
    const timestamp = Date.now();
    const filename = `viz-${slug}-${timestamp}.png`;
    const imgDir = path.join(__dirname, '../../generated_imgs');

    // Ensure directory exists
    if (!fs.existsSync(imgDir)) {
        fs.mkdirSync(imgDir, { recursive: true });
    }

    const filePath = path.join(imgDir, filename);
    fs.writeFileSync(filePath, imageBuffer);
    console.log(`[Visualize] Saved: ${filePath} (${imageBuffer.length} bytes)`);

    return {
        imageUrl: `/generated_imgs/${filename}`,
        prompt,
        concept
    };
}

// POST /api/visualize — Generate architectural diagram images via Gemini
app.post('/api/visualize', async (req, res) => {
    const { concept: rawConcept, style, resolution } = req.body;

    if (!rawConcept || typeof rawConcept !== 'string') {
        return res.status(400).json({ error: 'concept is a required string' });
    }

    const concept = sanitizeInput(rawConcept);

    const validResolutions = ['1K', '2K'];
    if (resolution && !validResolutions.includes(resolution)) {
        return res.status(400).json({ error: 'resolution must be "1K" or "2K"' });
    }

    console.log(`[Visualize] Concept: "${concept}", Style: ${style || 'default'}, Resolution: ${resolution || '1K'}`);

    try {
        const result = await generateVisualization(concept, style, resolution);
        res.json(result);
    } catch (error) {
        console.error('[Visualize] Error:', error);
        res.status(500).json({ error: `Visualization failed: ${error.message}` });
    }
});

// Special Actions Endpoint (simplify, code, diagram, visualize)
// Stricter rate limit: user content is injected directly into LLM prompts
app.post('/api/special', specialEndpointLimiter, async (req, res) => {
    const { action, content: rawContent } = req.body;

    if (!action || !rawContent || typeof action !== 'string' || typeof rawContent !== 'string') {
        return res.status(400).json({ error: 'action and content are required strings' });
    }

    const content = sanitizeInput(rawContent);

    if (!content) {
        return res.status(400).json({ error: 'content was empty after sanitization' });
    }

    if (!['simplify', 'code', 'diagram', 'visualize'].includes(action)) {
        return res.status(400).json({ error: 'Invalid action. Must be: simplify, code, diagram, or visualize' });
    }

    console.log(`[Special] Action: ${action} `);

    // Visualize action uses Gemini, not OpenAI — handle separately
    if (action === 'visualize') {
        try {
            const vizResult = await generateVisualization(content);
            return res.json({ result: vizResult.imageUrl, imageUrl: vizResult.imageUrl, concept: vizResult.concept });
        } catch (error) {
            console.error('[Special/Visualize] Error:', error);
            return res.status(500).json({ error: `Visualization failed: ${error.message}` });
        }
    }

    // Check if OpenAI is configured (required for simplify, code, diagram)
    if (!openai) {
        return res.status(503).json({
            error: 'OpenAI API not configured. Set OPENAI_API_KEY environment variable.'
        });
    }

    try {
        let result = '';

        switch (action) {
            case 'simplify':
                // Use DeepSeek for simplification
                result = await openai.chat.completions.create({
                    model: "gpt-4o-mini", //  Cheaper, faster for simplification
                    messages: [{
                        role: "system",
                        content: "You are a master simplifier. Take complex technical content and explain it using everyday analogies and simple language. Use metaphors from daily life."
                    }, {
                        role: "user",
                        content: `Simplify this: \n\n${content} `
                    }]
                });
                break;

            case 'code':
                // Generate runnable code example
                result = await openai.chat.completions.create({
                    model: "gpt-4o",
                    messages: [{
                        role: "system",
                        content: "You are a code generator. Given a concept, provide a minimal, runnable code example with comments. Use JavaScript/Node.js unless  otherwise specified."
                    }, {
                        role: "user",
                        content: `Show me code for: \n\n${content} `
                    }]
                });
                break;

            case 'diagram':
                // Generate Mermaid diagram
                result = await openai.chat.completions.create({
                    model: "gpt-4o",
                    messages: [{
                        role: "system",
                        content: "You are a diagram expert. Create a Mermaid.js diagram to visualize the concept. Use flowcharts, sequence diagrams, or architecture diagrams as appropriate."
                    }, {
                        role: "user",
                        content: `Create a diagram for: \n\n${content} `
                    }]
                });
                break;

            default:
                result = { choices: [{ message: { content: "Unknown action" } }] };
        }

        res.json({ result: result.choices[0].message.content });

    } catch (error) {
        console.error('[Special] Error:', error);
        res.status(500).json({ error: 'Failed to process action' });
    }
});

// --- AGENTIC LEARNING LOOP: REMOVED 2026-06-24 ---
// The 6-hourly auto-learner + POST /api/learn route invoked the legacy Postgres
// scripts/kb-incremental-update.sh — a SECOND ingest path that bypassed kb-master.json
// and failed continuously after Postgres was retired. The single canonical ingest path
// is now the nightly LaunchAgent chain (kb-evergreen -> kb-auto-curate ->
// kb-export-pipeline -> self-heal -> watchdog). Do not reintroduce ingest logic here.

// Serve Other Documents (PDFs, video, audio) — with CDN-friendly caching (9.6)
app.use('/assets/docs', express.static(path.join(__dirname, '../ui/dist/assets/docs'), {
  maxAge: '7d',
  setHeaders: (res, filePath) => {
    if (/\.(mp4|mp3|wav)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=604800'); // 7d for media
    } else if (/\.(pdf|pptx)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400'); // 1d for docs
    } else if (/\.(png|jpg|svg)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000'); // 30d for images
    }
  }
}));

// Knowledge Base Inventory Endpoint
app.get('/api/knowledge', async (req, res) => {
    // Resolve project root from this file's location (2 dirs up from src/server/)
    const rootDir = path.resolve(__dirname, '../..');
    const githubDir = path.join(rootDir, 'data_ingestion_github');
    const dataDir = path.join(rootDir, 'data');
    const docsDir = path.join(rootDir, 'data_ingestion_ruv_coaching/Other Documents');

    console.log(`🔍 Scanning Knowledge Base(Root: ${rootDir}): `);
    console.log(`   - GitHub Dir: ${githubDir} `);
    console.log(`   - Data Dir: ${dataDir} `);
    console.log(`   - Docs Dir: ${docsDir} `);

    const knowledge = {
        repos: [],
        websites: [],
        docs: [],
        lastUpdate: new Date().toISOString()
    };

    try {
        const repoFile = path.join(rootDir, 'scripts/ingestion/repo_knowledge.json');
        if (fs.existsSync(repoFile)) {
            console.log(`   - Loading Repos from: ${repoFile}`);
            const repoData = JSON.parse(fs.readFileSync(repoFile, 'utf8'));
            knowledge.repos = Array.isArray(repoData) ? repoData : [repoData];
        } else if (fs.existsSync(githubDir)) {
            const items = fs.readdirSync(githubDir);
            knowledge.repos = items.filter(file => {
                try {
                    return fs.statSync(path.join(githubDir, file)).isDirectory();
                } catch (e) { console.warn(`[knowledge] Failed to stat ${file}:`, e.message); return false; }
            }).map(repo => ({
                name: repo,
                type: 'GitHub Repository',
                status: 'Live Sync 🟢',
                version: 'latest'
            }));
        }
    } catch (e) {
        console.error("Error reading Repo Knowledge:", e);
    }

    try {
        if (fs.existsSync(dataDir)) {
            const items = fs.readdirSync(dataDir);
            knowledge.websites = items.filter(file => {
                return file.endsWith('.txt') || file.endsWith('.md');
            }).map(file => ({
                name: file.replace(/_/g, ' ').replace('.txt', '').replace('.md', ''),
                file: file,
                type: 'Documentation',
                status: 'Indexed 🟢'
            }));
        }
    } catch (e) {
        console.error("Error reading Data dir:", e);
    }

    try {
        if (fs.existsSync(docsDir)) {
            const items = fs.readdirSync(docsDir);
            knowledge.docs = items.filter(file => {
                return !file.startsWith('.'); // Ignore hidden files
            }).map(file => ({
                name: file,
                url: `/assets/docs/${encodeURIComponent(file)}`,
                type: file.endsWith('.pdf') ? 'PDF' : file.endsWith('.mp4') ? 'Video' : 'File',
                status: 'Available 🟢'
            }));
        }
    } catch (e) {
        console.error("Error reading Docs dir:", e);
    }

    // Calculate Video Stats — count only session directories, not stray docs
    let videoCount = 0;
    let sessionDirs = 0;
    try {
        const videoDir1 = path.join(rootDir, 'data_ingestion_ruv_coaching/Agentic Coding Training/Agentics Videos');
        const videoDir2 = path.join(rootDir, 'data_ingestion_ruv_coaching/Ruv Coaching');

        const countSessions = (dir) => {
            if (!fs.existsSync(dir)) return 0;
            return fs.readdirSync(dir).filter(f => !f.startsWith('.') && fs.statSync(path.join(dir, f)).isDirectory()).length;
        };
        sessionDirs = countSessions(videoDir1) + countSessions(videoDir2);
        videoCount = sessionDirs;
    } catch (e) {
        console.error("Error counting videos:", e);
    }
    knowledge.videoStats = { total: videoCount, sessions: sessionDirs };

    // Sort repos by last_update (newest first), with Ruflo prioritized at top
    knowledge.repos.sort((a, b) => {
        // Prioritize Ruflo at the very top (it's the main feature)
        if (a.name === 'ruflo') return -1;
        if (b.name === 'ruflo') return 1;

        // Then prioritize other alpha versions
        const aIsRealAlpha = a.version && a.version.includes('alpha');
        const bIsRealAlpha = b.version && b.version.includes('alpha');
        if (aIsRealAlpha && !bIsRealAlpha) return -1;
        if (!aIsRealAlpha && bIsRealAlpha) return 1;

        // Then sort by last_update date (newest first)
        const dateA = new Date(a.last_update || 0);
        const dateB = new Date(b.last_update || 0);
        return dateB - dateA;
    });

    // Enrich with live npm versions (non-blocking, cached)
    try {
        const liveVersions = await refreshNpmVersions();
        knowledge.repos = knowledge.repos.map(repo => {
            const live = liveVersions[repo.name];
            if (live) {
                return { ...repo, version: live, version_latest: live, version_alpha: live.includes('alpha') ? live : repo.version_alpha };
            }
            return repo;
        });
    } catch (err) {
        console.warn('[knowledge] Failed to enrich repos with live npm versions:', err.message);
    }

    // Add version status indicator to each repo
    knowledge.repos = knowledge.repos.map(repo => ({
        ...repo,
        versionStatus: repo.version_alpha ? 'ALPHA' :
                       repo.version === repo.version_latest ? 'LATEST' :
                       'STABLE'
    }));

    // Add app version to response
    knowledge.version = APP_VERSION;

    // Add RVF store stats
    if (reasoningBank && reasoningBank.getStats) {
        const stats = reasoningBank.getStats();
        knowledge.kb_stats = stats;
        knowledge.kb_backend = 'RVF (HNSW binary)';
        knowledge.kb_total_entries = stats.vectorCount || 0;
    }

    console.log(`   ✅ Returning ${knowledge.repos.length} repos, ${knowledge.websites.length} docs, ${knowledge.docs.length} files, ${videoCount} videos.`);
    res.json(knowledge);
});

// Error handler middleware (must be last)
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

// Start Server (only when run directly, not when imported as a module)
if (require.main === module) {
    const HOST = process.env.HOST || '0.0.0.0';
    const server = app.listen(PORT, HOST, () => {
        console.log(`Server running on ${HOST}:${PORT}`);
        console.log(`Ask rUVnet v${APP_VERSION} initialized.`);
    });

    // Graceful shutdown handler
    const shutdown = async (signal) => {
        console.log(`${signal} received, shutting down gracefully...`);

        // Force exit after 10 seconds if graceful shutdown stalls
        const forceExitTimer = setTimeout(() => {
            console.error('Graceful shutdown timed out after 10s, forcing exit.');
            process.exit(1);
        }, 10000);
        forceExitTimer.unref();

        // Close the RVF/vector store if it has a close method
        if (reasoningBank && typeof reasoningBank.close === 'function') {
            try {
                await reasoningBank.close();
                console.log('Vector store closed.');
            } catch (err) {
                console.error('Error closing vector store:', err.message);
            }
        }

        // Close the HTTP server (stop accepting new connections, drain existing)
        server.close(() => {
            console.log('HTTP server closed.');
            process.exit(0);
        });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

// Export app for testing and module imports
module.exports = app;
