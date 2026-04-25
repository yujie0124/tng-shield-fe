import apiClient from './apiClient';
import { getDb, setDb } from './mockBackend';
import samples from '../data/aiRiskApiSamples.json';

const RISK_API_BASE =
  import.meta.env.VITE_RISK_API_BASE_URL || 'http://localhost:8000';
const USE_LIVE_RISK_API = !!import.meta.env.VITE_USE_LIVE_RISK_API;
const MOCK_LATENCY_MS = 600;

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
function decisionFromResponse(res) {
  const action = (res.action || '').toUpperCase();
  const band = (res.decision_band || '').toUpperCase();
  const level = (res.risk_level || '').toUpperCase();

  if (action === 'BLOCK' || band === 'BLOCKED' || band === 'CRITICAL') return 'block';
  if (
    action === 'COOL_OFF_OR_GUARDIAN_VERIFICATION' ||
    action === 'COOL_OFF' ||
    action === 'GUARDIAN_VERIFICATION' ||
    band === 'SUSPICIOUS'
  ) {
    return 'pending_review';
  }
  if (action === 'APPROVE' || band === 'SAFE') return 'approve';

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

// Pick which sample to return based on merchant scenario. Falls back to
// grey-zone for recipients we don't recognise (manual phone entry, etc.).
function pickScenario({ merchant, contact }) {
  if (merchant?.scenario === 'known-bad') return 'known-bad';
  if (merchant?.scenario === 'known-good') return 'known-good';
  if (merchant?.scenario === 'grey-zone') return 'grey-zone';
  // Trusted saved contact → safe; unknown phone → grey zone.
  if (contact?.trusted) return 'known-good';
  return 'grey-zone';
}

// Customise a canned sample with the actual transaction id and merchant
// specifics so the demo feels responsive even without the live API.
function customiseSample(template, { payload, merchant, contact }) {
  const reasons = [...(template.reasons || [])];

  if (merchant?.blacklistedBy?.length) {
    reasons[0] = `Recipient is on ${merchant.blacklistedBy.join(', ')} fraud blacklists`;
  }
  if (merchant?.blacklistedNote) {
    reasons.splice(1, 0, merchant.blacklistedNote);
  }
  if (merchant?.verifiedBy && template.action === 'APPROVE') {
    reasons[0] = `Verified by ${merchant.verifiedBy}`;
  }
  if (merchant?.recentFraudReports > 0 && template.action !== 'APPROVE') {
    reasons.push(
      `${merchant.recentFraudReports} fraud report(s) filed in the last 30 days`,
    );
  }
  if (
    payload?.customer_profile &&
    !payload.customer_profile.prior_history_with_recipient &&
    template.action !== 'APPROVE'
  ) {
    reasons.push('No prior history between customer and recipient');
  }

  return {
    ...template,
    transaction_id: payload?.transaction_id || template.transaction_id,
    reasons: reasons.slice(0, 6),
  };
}

// Mock dispatch — returns a sample-shaped response based on the merchant
// scenario. Used while the live /run-risk-score endpoint is in progress.
export function mockRiskResponse({ payload, merchant, contact }) {
  const scenario = pickScenario({ merchant, contact });
  const template = samples[scenario] || samples['grey-zone'];
  return customiseSample(template, { payload, merchant, contact });
}

// Build the API request body from app state. Returns the payload exactly
// in the shape the /run-risk-score endpoint expects (snake_case).
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

  return {
    transaction_id: txId,
    transaction: {
      merchant_name: merchant?.name || contact?.name || recipientPhone,
      amount,
      currency,
      channel,
      recipient_account_id:
        merchant?.accountId || `acc-${(recipientPhone || 'unknown').replace(/\D/g, '')}`,
      recipient_type: recipientType,
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
    context: {
      network_reputation_score: merchant?.networkReputationScore ?? 50,
      recent_fraud_reports: merchant?.recentFraudReports ?? 0,
      notes:
        notes ||
        merchant?.contextNote ||
        (contact ? `Saved contact (${contact.name}).` : 'Manual phone entry.'),
    },
    use_sc_investor_alert_check: true,
  };
}

export async function requestRiskReport(payload, options = {}) {
  // Mock mode (default while the live endpoint is in progress).
  if (!USE_LIVE_RISK_API && !options.live) {
    if (MOCK_LATENCY_MS > 0) {
      await new Promise((r) => setTimeout(r, MOCK_LATENCY_MS));
    }
    return mockRiskResponse({
      payload,
      merchant: options.merchant,
      contact: options.contact,
    });
  }

  // Live API. Bypasses the in-app apiClient because the risk service runs
  // on a different host (port 8000) than the wallet backend.
  const res = await fetch(`${RISK_API_BASE}/run-risk-score`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Risk API error ${res.status}`);
  }
  return res.json();
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
