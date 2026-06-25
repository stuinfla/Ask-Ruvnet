/**
 * KB Curation Pipeline — Configuration
 */
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5435'),
  user: process.env.PG_USER || 'postgres',
  database: process.env.PG_DATABASE || 'postgres',
  max: 5,
  idleTimeoutMillis: 30000,
});

// Groq config (free tier for triage)
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_RPM = 25; // conservative for free tier

// Anthropic config (Haiku for rewrites)
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// Batch sizes
const PREFILTER_BATCH = 5000;
const CLUSTER_BATCH = 500;
const TRIAGE_BATCH = 1;  // one group at a time for Groq
const REWRITE_BATCH = 1; // one group at a time for Haiku

module.exports = {
  pool,
  GROQ_API_KEY,
  GROQ_MODEL,
  GROQ_RPM,
  ANTHROPIC_API_KEY,
  HAIKU_MODEL,
  PREFILTER_BATCH,
  CLUSTER_BATCH,
  TRIAGE_BATCH,
  REWRITE_BATCH,
};
