// Slack alert service.
//
// One channel only (Slack incoming webhook). Triggered exclusively from
// providerHealth's transition-to-disabled branch — see the wasNotDisabled
// guard there. Fire-and-forget at every call site so a slow or failing
// webhook never blocks the proxy's hot path.
//
// Built-in fetch (Node 18+) — no node-fetch dependency.
// No nodemailer / SMTP — Slack-only per finalized rule.
//
// Env:
//   ALERT_SLACK_WEBHOOK   incoming-webhook URL; if unset, sendAlert is
//                         a no-op (zero crash, zero log noise — the
//                         design assumes "no webhook == not configured
//                         for alerting", not "broken").

const logger = require('../utils/logger')

async function sendSlack (msg) {
  if (!process.env.ALERT_SLACK_WEBHOOK) return
  try {
    const res = await fetch(process.env.ALERT_SLACK_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: msg })
    })
    if (!res.ok) {
      logger.warn('Slack alert HTTP error', { status: res.status })
    }
  } catch (err) {
    // Network/DNS/cert errors. Log once at warn so an op can grep for
    // recurring delivery failures, but don't escalate.
    logger.warn('Slack alert failed', { error: err && err.message ? err.message : String(err) })
  }
}

// Public API: fire-and-forget. The .catch absorbs any rejection that
// would otherwise become an UnhandledPromiseRejection — sendSlack
// already catches its own errors, but the .catch here is defence in
// depth in case sendSlack itself throws synchronously (e.g., a bad
// require).
function sendAlert (msg) {
  sendSlack(msg).catch(() => {})
}

module.exports = { sendAlert, sendSlack }
