import { getDb, setDb, makeId } from './mockBackend';
import { authService } from './authService';
import { generateRiskReport } from './riskEngine';
import {
  buildRiskPayload,
  normalizeRiskResponse,
  requestRiskReport,
} from './aiRiskApi';

function findGuardianLink(db, wardId) {
  return (db.guardianLinks || []).find((l) => l.wardId === wardId) || null;
}

function failure(message) {
  const err = new Error(message);
  err.response = { data: { message } };
  return err;
}

function pushNotification(db, userId, note) {
  if (!userId) return;
  db.notifications = db.notifications || {};
  db.notifications[userId] = db.notifications[userId] || [];
  db.notifications[userId].unshift({
    id: makeId('nt'),
    createdAt: new Date().toISOString(),
    read: false,
    ...note,
  });
}

function notifyAutoBlock(db, { ward, link, merchant, recipientPhone, amount, txId, report }) {
  const recipientLabel = merchant?.name || recipientPhone;
  pushNotification(db, ward.id, {
    type: 'auto_block_alert',
    title: `We blocked ${recipientLabel}`,
    body:
      report.recommendation ||
      report.reasons?.[0] ||
      'TNGD² blocked this transfer for your safety. Your money is still in your wallet.',
    txId,
    severity: 'critical',
  });
  if (link?.guardianId) {
    pushNotification(db, link.guardianId, {
      type: 'auto_block_alert',
      title: `Auto-blocked: ${recipientLabel}`,
      body: `${ward.shortName || ward.name} tried to send RM ${amount.toLocaleString()} to ${recipientLabel}. We blocked it automatically.`,
      txId,
      wardId: ward.id,
      severity: 'critical',
      aiRiskReport: report,
      recipientName: merchant?.name || null,
      recipientPhone,
      amount,
    });
  }
}

function notifyAutoApprove(
  db,
  { ward, link, merchant, recipientPhone, amount, txId, report, aboveThreshold },
) {
  const recipientLabel = merchant?.name || recipientPhone;
  const thresholdLabel = link?.threshold ? `RM ${link.threshold.toLocaleString()}` : null;

  pushNotification(db, ward.id, {
    type: 'auto_approve',
    title: aboveThreshold ? `Paid ${recipientLabel} (high value)` : `Paid ${recipientLabel}`,
    body: aboveThreshold
      ? `RM ${amount.toLocaleString()} sent. ${recipientLabel} is verified, but this is above your ${thresholdLabel} limit — your guardian has been notified.`
      : `RM ${amount.toLocaleString()} sent. TNGD² verified the recipient — ${report.reasons?.[0] || 'all trust signals pass.'}`,
    txId,
    severity: aboveThreshold ? 'warn' : 'info',
    aboveThreshold: !!aboveThreshold,
  });
  if (link?.guardianId) {
    pushNotification(db, link.guardianId, {
      type: aboveThreshold ? 'high_value_auto_approve' : 'auto_approve',
      title: aboveThreshold
        ? `Heads-up: ${ward.shortName || ward.name} sent RM ${amount.toLocaleString()}`
        : `${ward.shortName || ward.name} sent RM ${amount.toLocaleString()}`,
      body: aboveThreshold
        ? `Above ${ward.shortName || 'ward'}'s ${thresholdLabel} threshold, but auto-approved because ${recipientLabel} is verified. ${report.reasons?.[0] || ''}`.trim()
        : `Auto-approved to ${recipientLabel}. ${report.reasons?.[0] || 'Verified merchant.'}`,
      txId,
      wardId: ward.id,
      severity: aboveThreshold ? 'warn' : 'info',
      aboveThreshold: !!aboveThreshold,
      threshold: link?.threshold || null,
      aiRiskReport: aboveThreshold ? report : undefined,
      recipientName: merchant?.name || null,
      recipientPhone,
      amount,
    });
  }
}

function notifyPendingReview(db, { ward, link, merchant, recipientPhone, amount, txId, reviewId }) {
  const recipientLabel = merchant?.name || recipientPhone;
  pushNotification(db, ward.id, {
    type: 'pending_review',
    title: 'Cool-off review started',
    body: `Your RM ${amount.toLocaleString()} transfer to ${recipientLabel} is paused for guardian review.`,
    txId,
    reviewId,
    severity: 'warn',
  });
  if (link?.guardianId) {
    pushNotification(db, link.guardianId, {
      type: 'pending_review',
      title: `Action needed: review RM ${amount.toLocaleString()}`,
      body: `${ward.shortName || ward.name} wants to send RM ${amount.toLocaleString()} to ${recipientLabel}. Review now.`,
      txId,
      reviewId,
      wardId: ward.id,
      severity: 'warn',
    });
  }
}

export const walletService = {
  async getBalance() {
    await new Promise((r) => setTimeout(r, 80));
    const u = authService.getStoredUser();
    if (!u) return { balance: 0 };
    const db = getDb();
    return { balance: db.wallets[u.id]?.balance ?? 0 };
  },

  async reload(amount, method) {
    const u = authService.getStoredUser();
    if (!u) throw failure('Not authenticated');
    const db = getDb();
    db.wallets[u.id] = db.wallets[u.id] || { balance: 0 };
    db.wallets[u.id].balance = (db.wallets[u.id].balance || 0) + amount;
    db.wallets[u.id].lastUpdated = new Date().toISOString();
    db.transactions[u.id] = db.transactions[u.id] || [];
    db.transactions[u.id].unshift({
      id: makeId('tx'),
      userId: u.id,
      type: 'reload',
      title: `Reload via ${(method || 'fpx').toUpperCase()}`,
      amount,
      createdAt: new Date().toISOString(),
    });
    setDb(db);
    return { ok: true };
  },

  async transfer({ recipientPhone, amount, note }) {
    const u = authService.getStoredUser();
    if (!u) throw failure('Not authenticated');
    const db = getDb();

    const merchant =
      (db.merchants || []).find((m) => m.phone && m.phone === recipientPhone) || null;
    const contact =
      (db.contacts?.[u.id] || []).find((c) => c.phone === recipientPhone) || null;
    const link = findGuardianLink(db, u.id);
    const txId = makeId('tx');

    // 1. Build payload + call the live AWS /run-risk-score endpoint.
    //    Same call drives all three demo scenarios (known-good /
    //    grey-zone / known-bad) — `merchants.json` carries the
    //    network-rep, blacklist and verification signals the model
    //    needs to differentiate them.
    const payload = buildRiskPayload({
      user: u,
      merchant,
      contact,
      txId,
      amount,
      recipientPhone,
      notes: note,
    });

    let apiResponse;
    let apiError = null;
    try {
      apiResponse = await requestRiskReport(payload, { merchant, contact });
    } catch (err) {
      // Local rule-based engine is a last-resort fallback so the demo
      // doesn't dead-end if the AWS host is unreachable. Tag the report
      // so the UI / debugger can tell it didn't come from the live API.
      console.error('[aiRiskApi] live risk API failed:', err);
      apiError = err;
      apiResponse = null;
    }

    let report;
    if (apiResponse) {
      report = normalizeRiskResponse(apiResponse, {
        recipientName: merchant?.name || contact?.name || null,
        sources: merchant?.blacklistedBy || [],
      });
      report.reportSource = 'live_api';
    } else {
      report = generateRiskReport({
        ward: u,
        link,
        recipientPhone,
        amount,
        note,
        db,
      });
      // Coerce engine output into a decision for the switch below.
      if (!report.decision) {
        if (report.level === 'critical') report.decision = 'block';
        else if (report.score >= 35) report.decision = 'pending_review';
        else report.decision = 'approve';
      }
      report.reportSource = 'local_fallback';
      report.reportSourceError = apiError?.message || 'unknown';
    }

    const recipientLabel = merchant?.name || contact?.name || recipientPhone;

    // 2. Scenario 1 — known-bad: hard block, notify both ward + guardian.
    if (report.decision === 'block') {
      db.transactions[u.id] = db.transactions[u.id] || [];
      db.transactions[u.id].unshift({
        id: txId,
        userId: u.id,
        type: 'blocked',
        title: merchant?.name
          ? `Blocked · ${merchant.name}`
          : `Blocked transfer · ${recipientPhone}`,
        amount,
        recipientPhone,
        note: note || '',
        status: 'blocked',
        reason: 'ai_blocked',
        aiRiskReport: report,
        createdAt: new Date().toISOString(),
      });

      notifyAutoBlock(db, {
        ward: u,
        link,
        merchant,
        recipientPhone,
        amount,
        txId,
        report,
      });

      setDb(db);
      return { status: 'blocked', txId, aiRiskReport: report };
    }

    // 3. Scenario 3 — grey zone: cool-off + guardian review.
    //    Only applies to wards that have a guardian link; guardians acting
    //    on their own account collapse to auto-approve below.
    if (report.decision === 'pending_review' && u.role === 'ward' && link) {
      const now = Date.now();
      const coolOffMs = (link.coolOffMinutes || 5) * 60 * 1000;
      const reviewId = makeId('rv');
      const review = {
        id: reviewId,
        fromUserId: u.id,
        fromName: u.name,
        fromShortName: u.shortName || u.name,
        wardType: link.wardType || u.wardType || 'elderly',
        guardianId: link.guardianId,
        recipientPhone,
        recipientName: report.recipientName || merchant?.name || null,
        amount,
        note: note || '',
        thresholdAtRequest: link.threshold,
        coolOffMinutes: link.coolOffMinutes || 5,
        createdAt: new Date(now).toISOString(),
        coolOffEndsAt: new Date(now + coolOffMs).toISOString(),
        aiRiskReport: report,
        clarifications: [],
        status: 'pending',
        decidedAt: null,
        guardianMessage: '',
        txId,
      };
      db.pendingReviews = db.pendingReviews || [];
      db.pendingReviews.unshift(review);

      db.transactions[u.id] = db.transactions[u.id] || [];
      db.transactions[u.id].unshift({
        id: txId,
        userId: u.id,
        type: 'transfer_out',
        title: report.recipientName
          ? `To ${report.recipientName}`
          : `Transfer to ${recipientLabel}`,
        amount,
        recipientPhone,
        note: note || '',
        status: 'pending_review',
        reviewId,
        aiRiskReport: report,
        createdAt: new Date(now).toISOString(),
      });

      notifyPendingReview(db, {
        ward: u,
        link,
        merchant,
        recipientPhone,
        amount,
        txId,
        reviewId,
      });

      setDb(db);
      return {
        status: 'pending_review',
        reviewId,
        aiRiskReport: report,
      };
    }

    // 4. Scenario 2 — known-good (or guardian's own grey-zone): auto-approve.
    //    If the ward is over threshold, the transfer still auto-approves
    //    (recipient is verified) but we tag the notification so the guardian
    //    sees a heads-up with the full risk report attached.
    const wallet = db.wallets[u.id] || { balance: 0 };
    if (wallet.balance < amount) throw failure('Insufficient balance');

    const aboveThreshold =
      u.role === 'ward' && !!link?.threshold && amount >= link.threshold;

    wallet.balance -= amount;
    wallet.lastUpdated = new Date().toISOString();
    db.wallets[u.id] = wallet;
    db.transactions[u.id] = db.transactions[u.id] || [];
    db.transactions[u.id].unshift({
      id: txId,
      userId: u.id,
      type: 'transfer_out',
      title: report.recipientName
        ? `To ${report.recipientName}`
        : `Transfer to ${recipientLabel}`,
      amount,
      recipientPhone,
      note: note || '',
      status: 'completed',
      aiRiskReport: report,
      aboveThreshold,
      thresholdAtRequest: aboveThreshold ? link.threshold : null,
      guardianAlerted: aboveThreshold && !!link?.guardianId,
      createdAt: new Date().toISOString(),
    });

    notifyAutoApprove(db, {
      ward: u,
      link,
      merchant,
      recipientPhone,
      amount,
      txId,
      report,
      aboveThreshold,
    });

    setDb(db);
    return {
      status: 'completed',
      txId,
      aiRiskReport: report,
      aboveThreshold,
      threshold: aboveThreshold ? link.threshold : null,
      guardianAlerted: aboveThreshold && !!link?.guardianId,
    };
  },

  async pay({ merchantId, amount }) {
    const u = authService.getStoredUser();
    if (!u) throw failure('Not authenticated');
    const db = getDb();

    if (u.role === 'ward') {
      const link = findGuardianLink(db, u.id);
      if (link) {
        const aiRiskReport = generateRiskReport({
          ward: u,
          link,
          merchantId,
          amount,
          db,
        });
        const aboveThreshold = amount >= link.threshold;
        const aiTriggers = aiRiskReport.score >= 50;

        if (aboveThreshold || aiTriggers) {
          const now = Date.now();
          const coolOffMs = (link.coolOffMinutes || 5) * 60 * 1000;
          const merchant = (db.merchants || []).find((m) => m.id === merchantId);
          const reviewId = makeId('rv');
          const txId = makeId('tx');
          const review = {
            id: reviewId,
            fromUserId: u.id,
            fromName: u.name,
            fromShortName: u.shortName || u.name,
            wardType: link.wardType || u.wardType || 'elderly',
            guardianId: link.guardianId,
            recipientPhone: merchantId,
            recipientName: merchant?.name || merchantId,
            amount,
            note: '',
            thresholdAtRequest: link.threshold,
            coolOffMinutes: link.coolOffMinutes || 5,
            createdAt: new Date(now).toISOString(),
            coolOffEndsAt: new Date(now + coolOffMs).toISOString(),
            aiRiskReport,
            clarifications: [],
            status: 'pending',
            kind: 'payment',
            merchantId,
            decidedAt: null,
            guardianMessage: '',
            txId,
          };
          db.pendingReviews = db.pendingReviews || [];
          db.pendingReviews.unshift(review);

          db.transactions[u.id] = db.transactions[u.id] || [];
          db.transactions[u.id].unshift({
            id: txId,
            userId: u.id,
            type: 'payment',
            title: merchant?.name || merchantId,
            merchantId,
            amount,
            status: 'pending_review',
            reviewId,
            createdAt: new Date(now).toISOString(),
          });

          setDb(db);
          return {
            status: 'pending_review',
            reviewId,
            aboveThreshold,
            aiRiskReport,
          };
        }
      }
    }

    const wallet = db.wallets[u.id] || { balance: 0 };
    if (wallet.balance < amount) throw failure('Insufficient balance');
    const merchant = (db.merchants || []).find((m) => m.id === merchantId);
    wallet.balance -= amount;
    wallet.lastUpdated = new Date().toISOString();
    db.wallets[u.id] = wallet;
    db.transactions[u.id] = db.transactions[u.id] || [];
    db.transactions[u.id].unshift({
      id: makeId('tx'),
      userId: u.id,
      type: 'payment',
      title: merchant?.name || merchantId,
      merchantId,
      amount,
      status: 'completed',
      createdAt: new Date().toISOString(),
    });
    setDb(db);
    return { status: 'completed' };
  },
};
