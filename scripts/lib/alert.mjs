/**
 * alert.mjs — the SINGLE shared alert channel for the KB pipeline.
 *
 * One consistent path used by BOTH the watchdog (pipeline-health-check.mjs) and the
 * self-heal supervisor (kb-self-heal.mjs), so alerting can never diverge between them.
 *   - severity 'critical' -> macOS notification + ntfy phone push + Slack (if set) + Gmail email
 *   - severity 'warn'/'info' -> macOS + ntfy + Slack only (NO email — avoid alert fatigue)
 *
 * Secrets/topic come from env (sourced by the launch wrappers from .env); the ntfy topic
 * has a hardcoded non-secret fallback so phone alerts survive .env rewrites.
 *
 * Created: 2026-06-24 | Version 1.0.0
 */
import { execFileSync } from 'child_process';

const NTFY_TOPIC = process.env.NTFY_TOPIC || 'askruvnet-pipeline-7b6dab563168';
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';
const GMAIL_USER = process.env.PERSONAL_GMAIL_USER || 'sikerr@gmail.com';
// Gmail shows app passwords with spaces; SMTP needs them stripped to 16 chars.
const GMAIL_APP_PASSWORD = (process.env.PERSONAL_GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
const EMAIL_RECIPIENTS = ['stuart@isovision.ai', 'sikerr@gmail.com'];

function macNotify(title, msg) {
  try {
    execFileSync('osascript', ['-e', `display notification "${String(msg).replace(/"/g, '\\"')}" with title "${String(title).replace(/"/g, '\\"')}"`]);
    return true;
  } catch { return false; }
}

function ntfyPush(title, body) {
  if (!NTFY_TOPIC) return false;
  try { execFileSync('curl', ['-sf', '--max-time', '10', '-H', `Title: ${title}`, '-d', body, `https://ntfy.sh/${NTFY_TOPIC}`]); return true; }
  catch { return false; }
}

function slackPush(title, body) {
  if (!SLACK_WEBHOOK_URL) return false;
  try { execFileSync('curl', ['-sf', '--max-time', '10', '-H', 'Content-Type: application/json', '-d', JSON.stringify({ text: `${title}\n${body}` }), SLACK_WEBHOOK_URL]); return true; }
  catch { return false; }
}

function emailSend(subject, body) {
  if (!GMAIL_APP_PASSWORD) return false;
  let any = false;
  for (const rcpt of EMAIL_RECIPIENTS) {
    try {
      const content = `From: Ask-RuvNet Pipeline <${GMAIL_USER}>\r\nTo: ${rcpt}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`;
      execFileSync('curl', ['--ssl-reqd', '--url', 'smtps://smtp.gmail.com:465', '--user', `${GMAIL_USER}:${GMAIL_APP_PASSWORD}`,
        '--mail-from', GMAIL_USER, '--mail-rcpt', rcpt, '-T', '-', '--max-time', '15'],
        { input: content, timeout: 20000, stdio: ['pipe', 'pipe', 'pipe'] });
      any = true;
    } catch { /* per-recipient failure is non-fatal */ }
  }
  return any;
}

/**
 * The ONE alert entrypoint. Returns a delivery report {mac,ntfy,slack,email}.
 * @param {'critical'|'warn'|'info'} severity
 */
export function alert(severity, title, body) {
  const mac = macNotify(title, body);            // always — on-device
  let ntfy = false, slack = false, email = false;
  if (severity === 'critical') {                 // full escalation
    ntfy = ntfyPush(title, body); slack = slackPush(title, body); email = emailSend(title, body);
  } else if (severity === 'info') {              // positive notice (e.g. auto-healed) — phone, no email
    ntfy = ntfyPush(title, body);
  }                                              // 'warn' -> macOS only (avoid alert fatigue)
  return { mac, ntfy, slack, email };
}
