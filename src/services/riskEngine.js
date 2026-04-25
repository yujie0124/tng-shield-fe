// Mock AI risk engine. Produces a "risk report" the guardian can read on
// the ShieldReview screen. It is intentionally rule-based but shaped like
// what a real model would emit: score, level, factors, matched scam pattern,
// and a natural-language summary + recommendation.

const SEVERITY_WEIGHT = {
  low: 5,
  medium: 15,
  high: 25,
  critical: 40,
};

function pickLevel(score) {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}

function isKnownRecipient(db, userId, recipientPhone) {
  const ct = (db.contacts?.[userId] || []).some((c) => c.phone === recipientPhone);
  if (ct) return true;
  return (db.transactions?.[userId] || []).some(
    (t) => t.type === 'transfer_out' && t.recipientPhone === recipientPhone,
  );
}

function usualSpend(db, userId) {
  const txs = (db.transactions?.[userId] || []).filter(
    (t) => t.type === 'transfer_out' || t.type === 'payment',
  );
  if (!txs.length) return 50;
  return txs.reduce((m, t) => Math.max(m, t.amount), 0);
}

function matchScamPattern(db, { note, recipientName, ward, link, merchantId }) {
  const text = [note, recipientName, merchantId].filter(Boolean).join(' ').toLowerCase();
  const patterns = db.scamPatterns || [];

  if (link?.wardType === 'child' || ward?.wardType === 'child') {
    const child = patterns.find((p) => p.id === 'child_impulse_purchase');
    const merchant = (db.merchants || []).find((m) => m.id === merchantId);
    if (child && (merchant?.category === 'Gaming' || /robux|v-?bucks|skin|battle pass/i.test(text))) {
      return child;
    }
  }

  for (const p of patterns) {
    if (p.id === 'child_impulse_purchase') continue;
    if (p.keywords?.some((k) => text.includes(k.toLowerCase()))) return p;
  }
  return null;
}

export function generateRiskReport({ ward, link, recipientPhone, amount, note, merchantId, db }) {
  const factors = [];

  // Above threshold
  if (link?.threshold && amount >= link.threshold) {
    const ratio = amount / link.threshold;
    const severity = ratio >= 5 ? 'critical' : ratio >= 2 ? 'high' : 'medium';
    factors.push({
      id: 'above_threshold',
      label: `RM ${amount.toLocaleString()} — ${ratio.toFixed(1)}× the RM ${link.threshold} threshold`,
      severity,
      weight: SEVERITY_WEIGHT[severity],
    });
  }

  // Above usual spend
  const usual = usualSpend(db, ward.id);
  if (amount > usual * 5) {
    const factor = Math.round(amount / Math.max(usual, 1));
    factors.push({
      id: 'unusual_amount',
      label: `${factor}× larger than ${ward.shortName || 'ward'}'s usual spend`,
      severity: factor >= 10 ? 'high' : 'medium',
      weight: factor >= 10 ? SEVERITY_WEIGHT.high : SEVERITY_WEIGHT.medium,
    });
  }

  // New recipient
  if (recipientPhone && !merchantId && !isKnownRecipient(db, ward.id, recipientPhone)) {
    factors.push({
      id: 'new_recipient',
      label: 'Never transferred to this number before',
      severity: 'medium',
      weight: SEVERITY_WEIGHT.medium,
    });
  }

  // Blacklist
  const isBlacklistedPhone = (db.blacklist?.phones || []).includes(recipientPhone);
  const isBlacklistedMerchant = merchantId && (db.blacklist?.merchants || []).includes(merchantId);
  if (isBlacklistedPhone || isBlacklistedMerchant) {
    factors.push({
      id: 'blacklisted',
      label: 'Recipient on TNG fraud blacklist',
      severity: 'critical',
      weight: SEVERITY_WEIGHT.critical,
    });
  }

  // Active call
  if (db.flags?.scamCallActive) {
    factors.push({
      id: 'active_call',
      label: 'Initiated during an incoming phone call',
      severity: 'high',
      weight: SEVERITY_WEIGHT.high,
    });
  }

  // Merchant trust
  const merchant = merchantId ? (db.merchants || []).find((m) => m.id === merchantId) : null;
  if (merchant && merchant.trusted === false) {
    factors.push({
      id: 'untrusted_merchant',
      label: `Untrusted merchant: ${merchant.name}`,
      severity: 'medium',
      weight: SEVERITY_WEIGHT.medium,
    });
  }

  // Time-of-day for kids
  const hour = new Date().getHours();
  if ((link?.wardType === 'child') && (hour >= 22 || hour < 6)) {
    factors.push({
      id: 'late_hour',
      label: `Initiated at ${String(hour).padStart(2, '0')}:00 — outside typical hours`,
      severity: 'low',
      weight: SEVERITY_WEIGHT.low,
    });
  }

  // Match scam pattern
  const pattern = matchScamPattern(db, {
    note,
    recipientName: recipientPhone,
    ward,
    link,
    merchantId,
  });

  // Score: sum factor weights, clamp 0-100
  let score = factors.reduce((s, f) => s + (f.weight || 0), 0);
  if (pattern && pattern.severity === 'critical') score = Math.max(score, 90);
  score = Math.min(100, Math.max(0, Math.round(score)));

  const level = pickLevel(score);
  const summary = buildSummary({ ward, link, amount, factors, pattern, level });
  const recommendation = buildRecommendation({ level, pattern, link });
  const recipientName = merchant?.name || null;

  return {
    score,
    level,
    summary,
    matchedScamPattern: pattern?.id || null,
    matchedScamPatternLabel: pattern?.label || null,
    factors,
    recommendation,
    recipientName,
    generatedAt: new Date().toISOString(),
  };
}

function buildSummary({ ward, link, amount, factors, pattern, level }) {
  const parts = [];
  if (pattern) {
    parts.push(`Looks like a ${pattern.label.toLowerCase()}.`);
  } else if (level === 'critical') {
    parts.push('Multiple critical risk signals detected.');
  } else if (level === 'high') {
    parts.push('Several high-risk signals on this transfer.');
  } else if (level === 'medium') {
    parts.push('A few unusual signals — worth confirming.');
  } else {
    parts.push('Looks routine, just above the threshold.');
  }

  if (link?.threshold && amount >= link.threshold) {
    parts.push(`RM ${amount.toLocaleString()} is above ${ward?.shortName || 'the ward'}'s RM ${link.threshold} threshold.`);
  }
  const top = [...factors].sort((a, b) => (b.weight || 0) - (a.weight || 0))[0];
  if (top) parts.push(`Top factor: ${top.label.toLowerCase()}.`);
  return parts.join(' ');
}

function buildRecommendation({ level, pattern, link }) {
  if (pattern?.id === 'police_impersonation') {
    return 'Block immediately and call the ward. Police never ask for transfers to verify identity.';
  }
  if (pattern?.id === 'child_impulse_purchase') {
    return 'Talk to your child first. Consider approving a smaller, age-appropriate amount.';
  }
  if (level === 'critical') return 'Block. Then call the ward to confirm they are safe.';
  if (level === 'high') return 'Clarify with the ward before approving.';
  if (level === 'medium') return 'Send a quick clarification message before deciding.';
  return `Likely safe. Approve if ${link ? 'the ward' : 'they'} confirms.`;
}
