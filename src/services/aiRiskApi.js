import apiClient from './apiClient';
import { getDb, setDb } from './mockBackend';

// In dev, hit the same-origin proxy path defined in vite.config.ts (so the
// browser doesn't trip CORS against the AWS host). In prod, hit the AWS
// production endpoint directly. Override either with VITE_RISK_API_BASE_URL.
const PROD_RISK_API =
  'http://ec2-13-215-207-167.ap-southeast-1.compute.amazonaws.com/api';
const RISK_API_BASE =
  import.meta.env.VITE_RISK_API_BASE_URL ||
  (import.meta.env.DEV ? '/risk-api' : PROD_RISK_API);
const RISK_API_PATH =
  import.meta.env.VITE_RISK_API_PATH || '/run-risk-score';
const RISK_API_TIMEOUT_MS = 15000;

const LEVEL_MAP = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
};

const SIGNAL_LABELS = {
  verified_tng_merchant: 'Verified TNG merchant',
  ssm_registered_business: 'SSM registered business',
  account_age: 'Account age',
  transaction_history_volume: 'Transaction history volume',
  sender_prior_history_with_recipient: 'Prior history with recipient',
  network_reputation: 'Network reputation',
  blacklist_match: 'Blacklist match',
  mule_pattern_signals: 'Mule-pattern signals',
  recent_fraud_reports: 'Recent fraud reports',
  suspicious_naming: 'Suspicious naming',
};

function humanizeSignal(key) {
  return SIGNAL_LABELS[key] || key.replace(/_/g, ' ');
}

function pickLevelFromScore(s) {
  if (s >= 80) return 'critical';
  if (s >= 60) return 'high';
  if (s >= 35) return 'medium';
  return 'low';
}

// API `risk_score` is actually a trust score (low = risky, see model_raw_text).
// Invert to a 0-100 risk score for the gauge UI.
function toRiskScore(trustScore) {
  if (typeof trustScore !== 'number') return 50;
  return Math.max(0, Math.min(100, 100 - trustScore));
}

function severityFromMagnitude(mag) {
  if (mag >= 80) return 'critical';
  if (mag >= 40) return 'high';
  if (mag >= 15) return 'medium';
  return 'low';
}

function toFactors(signalBreakdown = {}) {
  return Object.entries(signalBreakdown)
    .filter(([, v]) => typeof v === 'number' && v !== 0)
    .map(([key, value]) => {
      const mag = Math.abs(value);
      const isPenalty = value < 0;
      return {
        id: key,
        label: isPenalty
          ? `${humanizeSignal(key)} (penalty)`
          : humanizeSignal(key),
        severity: severityFromMagnitude(mag),
        weight: Math.min(40, mag),
        rawWeight: value,
      };
    })
    .sort((a, b) => Math.abs(b.rawWeight) - Math.abs(a.rawWeight));
}

// Maps decision_band + action → app's three-way flow.
// Live API uses bands: TRUSTED / SAFE (approve), SUSPICIOUS (review),
// HIGH_RISK / BLOCKED / CRITICAL (block); actions: ALLOW / APPROVE,
// COOL_OFF_OR_GUARDIAN_VERIFICATION, BLOCK.
function decisionFromResponse(res) {
  const action = (res.action || '').toUpperCase();
  const band = (res.decision_band || '').toUpperCase();
  const level = (res.risk_level || '').toUpperCase();

  if (
    action === 'BLOCK' ||
    band === 'BLOCKED' ||
    band === 'HIGH_RISK' ||
    band === 'CRITICAL'
  ) {
    return 'block';
  }
  if (
    action === 'COOL_OFF_OR_GUARDIAN_VERIFICATION' ||
    action === 'COOL_OFF' ||
    action === 'GUARDIAN_VERIFICATION' ||
    band === 'SUSPICIOUS'
  ) {
    return 'pending_review';
  }
  if (
    action === 'APPROVE' ||
    action === 'ALLOW' ||
    band === 'SAFE' ||
    band === 'TRUSTED'
  ) {
    return 'approve';
  }

  if (level === 'CRITICAL') return 'block';
  if (level === 'HIGH' || level === 'MEDIUM') return 'pending_review';
  return 'approve';
}

// Normalize the live API response into the shape the UI already expects
// (ShieldReview, TransferProcessing). `extras` lets callers inject things
// the API doesn't return (recipientName, blacklist sources, etc.).
export function normalizeRiskResponse(apiRes, extras = {}) {
  const trustScore = typeof apiRes.risk_score === 'number' ? apiRes.risk_score : 50;
  const riskScore = toRiskScore(trustScore);
  const level =
    LEVEL_MAP[(apiRes.risk_level || '').toUpperCase()] || pickLevelFromScore(riskScore);
  const factors = toFactors(apiRes.signal_breakdown);
  const decision = decisionFromResponse(apiRes);
  const reasons = Array.isArray(apiRes.reasons) ? apiRes.reasons : [];

  return {
    transactionId: apiRes.transaction_id || null,
    score: riskScore,
    trustScore,
    level,
    decisionBand: apiRes.decision_band || null,
    action: apiRes.action || null,
    decision,
    summary: reasons[0] || apiRes.recommendation || 'Risk assessment received.',
    reasons,
    factors,
    signalBreakdown: apiRes.signal_breakdown || {},
    recommendation: apiRes.recommendation || '',
    matchedScamPattern: null,
    matchedScamPatternLabel: null,
    recipientName: extras.recipientName || null,
    sources: extras.sources || [],
    generatedAt: new Date().toISOString(),
    rawResponse: apiRes,
  };
}

// The AWS /run-risk-score endpoint rejects non-ASCII bytes in the JSON
// body with a 400 "error parsing the body". Strip them — `·`, smart
// quotes, em-dashes, etc. — and replace with safe ASCII equivalents
// before serialising.
const ASCII_REPLACEMENTS = [
  [/[‘’‚‛′]/g, "'"],
  [/[“”„‟″]/g, '"'],
  [/[–—−]/g, '-'],
  [/[•·]/g, '-'],
  [/…/g, '...'],
  [/ /g, ' '],
];

function toAscii(value) {
  if (value == null) return value;
  if (typeof value !== 'string') return value;
  let out = value;
  for (const [re, rep] of ASCII_REPLACEMENTS) out = out.replace(re, rep);
  // Drop anything still outside printable ASCII to avoid future surprises.
  return out.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
}

// Build the API request body from app state. Returns the payload exactly
// in the shape the /run-risk-score endpoint expects (snake_case).
//
// Three demo scenarios drive distinct API responses:
//   - known-good (TNB, 99 Speedmart): high network rep, trusted=true,
//     verified_by set → API returns TRUSTED/ALLOW.
//   - grey-zone (Kak Siti, Carousell): mid-range rep, no verification →
//     API returns SUSPICIOUS/COOL_OFF_OR_GUARDIAN_VERIFICATION.
//   - known-bad (QUICK CASH, EZ MONEY): blacklisted_by populated, low
//     rep, high fraud reports → API returns HIGH_RISK/BLOCK.
export function buildRiskPayload({
  user,
  merchant,
  contact,
  txId,
  amount,
  recipientPhone,
  channel = 'wallet_transfer',
  currency = 'MYR',
  notes,
}) {
  const recipientType =
    merchant?.recipientType ||
    (merchant ? 'merchant' : contact ? 'individual' : 'individual');
  const priorHistory =
    contact?.priorHistoryWithRecipient ?? !!contact ?? false;

  const merchantName = merchant?.name || contact?.name || recipientPhone;
  const contextNotes =
    notes ||
    merchant?.contextNote ||
    (contact ? `Saved contact (${contact.name}).` : 'Manual phone entry.');

  // Pass blacklist + verification signals through context so the model
  // sees the same scenario hints the UI shows. Non-ASCII chars (middle
  // dots, em-dashes from merchants.json) crash the API parser, so
  // sanitise every string field that hits the wire.
  const context = {
    network_reputation_score: merchant?.networkReputationScore ?? 50,
    recent_fraud_reports: merchant?.recentFraudReports ?? 0,
    notes: toAscii(contextNotes),
  };
  if (merchant?.blacklistedBy?.length) {
    context.blacklisted_by = merchant.blacklistedBy.map(toAscii);
  }
  if (merchant?.blacklistedNote) {
    context.blacklist_reason = toAscii(merchant.blacklistedNote);
  }
  if (merchant?.verifiedBy) {
    context.verified_by = toAscii(merchant.verifiedBy);
  }
  if (merchant?.trusted != null || contact?.trusted != null) {
    context.trusted = merchant?.trusted ?? contact?.trusted ?? null;
  }

  return {
    transaction_id: txId,
    transaction: {
      merchant_name: toAscii(merchantName),
      amount,
      currency,
      channel,
      recipient_account_id:
        merchant?.accountId || `acc-${(recipientPhone || 'unknown').replace(/\D/g, '')}`,
      recipient_type: recipientType,
      recipient_phone: recipientPhone || null,
      timestamp: new Date().toISOString(),
      device_id: user?.deviceId || 'device-unknown',
      ip_address: user?.ipAddress || '0.0.0.0',
    },
    customer_profile: {
      customer_id: user?.customerId || user?.id,
      kyc_level: user?.kycLevel || 'basic',
      account_age_days: user?.accountAgeDays ?? 0,
      avg_txn_amount_30d: user?.avgTxnAmount30d ?? 0,
      txn_count_30d: user?.txnCount30d ?? 0,
      prior_history_with_recipient: priorHistory,
    },
    context,
    use_sc_investor_alert_check: true,
  };
}

// Hits the live AWS /run-risk-score endpoint. `options` is reserved
// (e.g. for a future `merchant`/`contact` enrichment hook) but no longer
// gates a mock branch — the live API is the only source of truth.
// eslint-disable-next-line no-unused-vars
export async function requestRiskReport(payload, options = {}) {
  // Live API on AWS. Bypasses the in-app apiClient because the risk
  // service runs on a different host than the wallet backend.
  const url = `${RISK_API_BASE.replace(/\/$/, '')}${RISK_API_PATH}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RISK_API_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Risk API error ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`,
      );
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Keep apiClient referenced so eslint doesn't complain if it stays imported
// for future authenticated endpoints.
void apiClient;

// Find the transaction (by tx id or by API's transaction_id) in any user
// bucket. Returns { userId, list, index } or null.
function locateTransaction(db, txId, apiTxId) {
  const buckets = db.transactions || {};
  for (const userId of Object.keys(buckets)) {
    const list = buckets[userId] || [];
    const ix = list.findIndex((t) => t.id === txId || t.id === apiTxId);
    if (ix !== -1) return { userId, list, index: ix };
  }
  return null;
}

function statusFromDecision(decision) {
  switch (decision) {
    case 'block':
      return { status: 'blocked', type: 'blocked' };
    case 'pending_review':
      return { status: 'pending_review' };
    case 'approve':
    default:
      return { status: 'completed' };
  }
}

// Apply an API response: normalize it, update the matching transaction's
// status in the mock DB, and return both. Used after `requestRiskReport`
// resolves (or when replaying a stored response).
//
//   const apiRes = await requestRiskReport(payload);
//   const { report, tx } = applyRiskResponse({ txId, apiResponse: apiRes });
//
export function applyRiskResponse({ txId, apiResponse, userId, extras }) {
  const report = normalizeRiskResponse(apiResponse, extras);
  const db = getDb();

  let target;
  if (userId && db.transactions?.[userId]) {
    const list = db.transactions[userId];
    const ix = list.findIndex(
      (t) => t.id === txId || t.id === apiResponse.transaction_id,
    );
    target = ix === -1 ? null : { userId, list, index: ix };
  } else {
    target = locateTransaction(db, txId, apiResponse.transaction_id);
  }

  if (!target) {
    return { report, tx: null, updated: false };
  }

  const { status, type } = statusFromDecision(report.decision);
  const existing = target.list[target.index];
  const updated = {
    ...existing,
    ...(type ? { type } : {}),
    status,
    aiRiskReport: report,
    riskDecision: report.decision,
    riskUpdatedAt: new Date().toISOString(),
  };
  target.list[target.index] = updated;
  db.transactions[target.userId] = target.list;
  setDb(db);

  return { report, tx: updated, updated: true };
}

// Convenience: call the API and apply the response in one step.
export async function runRiskCheckForTransaction({ txId, payload, userId, extras }) {
  const apiResponse = await requestRiskReport(payload);
  return applyRiskResponse({ txId, apiResponse, userId, extras });
}
