import { getDb, setDb, makeId } from './mockBackend';
import { authService } from './authService';

function findLinksForGuardian(db, guardianId) {
  return (db.guardianLinks || []).filter((l) => l.guardianId === guardianId);
}

function findLinkForWard(db, wardId) {
  return (db.guardianLinks || []).find((l) => l.wardId === wardId) || null;
}

// Returns true if the review was just expired by this call (caller should
// persist). Pure read otherwise — important because getReview is polled
// every 1s by the ward's TransferPending screen and any unconditional
// setDb() there would push a stale local cache back to the server,
// clobbering the guardian's decision before the cross-tab sync can land.
function expireIfNeeded(db, review) {
  if (review.status !== 'pending') return false;
  const ends = new Date(review.coolOffEndsAt).getTime();
  if (Date.now() > ends + 24 * 3600 * 1000) {
    review.status = 'expired';
    review.decidedAt = new Date().toISOString();
    review.guardianMessage = 'Auto-blocked — cool-off elapsed without guardian decision.';
    return true;
  }
  return false;
}

export const familyShieldService = {
  async getStatus() {
    const u = authService.getStoredUser();
    if (!u) return null;
    const db = getDb();

    if (u.role === 'guardian') {
      const links = findLinksForGuardian(db, u.id);
      const recentAlerts = [];
      const wards = links.map((link) => {
        const w = db.users.find((x) => x.id === link.wardId);
        const txs = db.transactions[link.wardId] || [];
        const reviews = (db.pendingReviews || []).filter((r) => r.fromUserId === link.wardId);

        // Surface auto-block (known-bad) and high-value auto-approve
        // (known-good above threshold) transactions to the guardian feed.
        // The grey-zone path is already covered by `pending` reviews below.
        for (const t of txs) {
          if (!t.aiRiskReport) continue;
          const isAutoBlock = t.status === 'blocked' && t.reason === 'ai_blocked';
          const isHighValueApprove =
            t.status === 'completed' && t.aboveThreshold && t.guardianAlerted;
          if (!isAutoBlock && !isHighValueApprove) continue;
          recentAlerts.push({
            kind: isAutoBlock ? 'auto_block' : 'high_value_approve',
            txId: t.id,
            wardId: link.wardId,
            wardName: w?.shortName || w?.name || 'Ward',
            wardAvatarColor: w?.avatarColor || null,
            amount: t.amount,
            recipientName: t.aiRiskReport.recipientName || null,
            recipientPhone: t.recipientPhone || null,
            createdAt: t.createdAt,
            decidedAt: t.decidedAt || t.createdAt,
            threshold: t.thresholdAtRequest || link.threshold || null,
            aiRiskReport: t.aiRiskReport,
          });
        }
        const blockedCount = reviews.filter((r) => r.status === 'blocked' || r.status === 'expired').length;
        const blockedSavings = reviews
          .filter((r) => r.status === 'blocked' || r.status === 'expired')
          .reduce((s, r) => s + r.amount, 0);
        const weekAgo = Date.now() - 7 * 86400000;
        const spentThisWeek = txs
          .filter(
            (t) =>
              new Date(t.createdAt).getTime() >= weekAgo &&
              (t.type === 'payment' || t.type === 'transfer_out'),
          )
          .reduce((s, t) => s + t.amount, 0);
        const txCount = txs.filter((t) => new Date(t.createdAt).getTime() >= weekAgo).length;
        const pendingForWard = reviews.find((r) => r.status === 'pending') || null;
        return {
          id: link.wardId,
          name: w?.shortName || w?.name || 'Ward',
          fullName: w?.name || 'Ward',
          avatarColor: w?.avatarColor,
          age: w?.age,
          relationship: link.relationship,
          wardType: link.wardType || w?.wardType || 'elderly',
          threshold: link.threshold,
          coolOffMinutes: link.coolOffMinutes || 5,
          txCount,
          blockedCount,
          blockedSavings,
          spentThisWeek,
          pendingReview: pendingForWard,
        };
      });

      const guardianReviews = (db.pendingReviews || []).filter(
        (r) => r.guardianId === u.id,
      );
      let mutated = false;
      for (const r of guardianReviews) {
        if (expireIfNeeded(db, r)) mutated = true;
      }
      const pending = guardianReviews.filter((r) => r.status === 'pending');
      const blockedReviews = guardianReviews.filter(
        (r) => r.status === 'blocked' || r.status === 'expired',
      );
      const blockedSavings = blockedReviews.reduce((s, r) => s + r.amount, 0);

      if (mutated) setDb(db);
      recentAlerts.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      return {
        role: 'guardian',
        guardian: { id: u.id, name: u.shortName || u.name },
        wards,
        pending,
        blockedSavings,
        blockedCount: blockedReviews.length,
        recentAlerts: recentAlerts.slice(0, 10),
      };
    }

    const link = findLinkForWard(db, u.id);
    const guardian = link ? db.users.find((x) => x.id === link.guardianId) || null : null;
    const myReviews = (db.pendingReviews || []).filter((r) => r.fromUserId === u.id);
    let mutated = false;
    for (const r of myReviews) {
      if (expireIfNeeded(db, r)) mutated = true;
    }
    const latestPending = myReviews.find((r) => r.status === 'pending') || null;
    const latestBlocked = myReviews.find((r) => r.status === 'blocked' || r.status === 'expired') || null;
    if (mutated) setDb(db);
    return {
      role: 'ward',
      wardType: link?.wardType || u.wardType || 'elderly',
      threshold: link?.threshold ?? null,
      coolOffMinutes: link?.coolOffMinutes ?? 5,
      relationship: link?.relationship,
      guardian: guardian
        ? { id: guardian.id, name: guardian.shortName || guardian.name, phone: guardian.phone }
        : null,
      reviews: myReviews,
      latestPending,
      latestBlocked,
    };
  },

  // Used by the guardian's alert detail page (auto-block / high-value
  // auto-approve). Looks up a ward transaction the guardian is allowed
  // to see — i.e. a ward they are linked to.
  async getWardAlert({ wardId, txId }) {
    const u = authService.getStoredUser();
    if (!u) throw new Error('Not authenticated');
    const db = getDb();

    const isLinked = (db.guardianLinks || []).some(
      (l) => l.guardianId === u.id && l.wardId === wardId,
    );
    if (u.role !== 'guardian' || !isLinked) return null;

    const tx = (db.transactions[wardId] || []).find((t) => t.id === txId);
    if (!tx || !tx.aiRiskReport) return null;
    const ward = (db.users || []).find((x) => x.id === wardId) || null;
    const link = (db.guardianLinks || []).find(
      (l) => l.guardianId === u.id && l.wardId === wardId,
    );
    return {
      ...tx,
      ward: ward
        ? {
            id: ward.id,
            name: ward.shortName || ward.name,
            fullName: ward.name,
            phone: ward.phone,
            avatarColor: ward.avatarColor || null,
          }
        : null,
      threshold: tx.thresholdAtRequest || link?.threshold || null,
      kind:
        tx.status === 'blocked' && tx.reason === 'ai_blocked'
          ? 'auto_block'
          : tx.aboveThreshold && tx.guardianAlerted
            ? 'high_value_approve'
            : 'other',
    };
  },

  async getReview(id) {
    const db = getDb();
    const r = (db.pendingReviews || []).find((x) => x.id === id);
    if (!r) return null;
    if (expireIfNeeded(db, r)) setDb(db);
    const ward = (db.users || []).find((u) => u.id === r.fromUserId) || null;
    return {
      ...r,
      fromPhone: ward?.phone || null,
      fromAvatarColor: ward?.avatarColor || null,
    };
  },

  async listReviews({ status } = {}) {
    const db = getDb();
    const all = db.pendingReviews || [];
    return status ? all.filter((r) => r.status === status) : all;
  },

  async addClarification(id, text) {
    const u = authService.getStoredUser();
    if (!u) throw new Error('Not authenticated');
    const trimmed = (text || '').trim();
    if (!trimmed) return null;
    const db = getDb();
    const r = (db.pendingReviews || []).find((x) => x.id === id);
    if (!r) throw new Error('Review not found');
    const from = u.role === 'guardian' ? 'guardian' : 'ward';
    const msg = {
      id: makeId('msg'),
      from,
      fromName: u.shortName || u.name,
      text: trimmed,
      at: new Date().toISOString(),
    };
    r.clarifications = r.clarifications || [];
    r.clarifications.push(msg);
    setDb(db);
    return msg;
  },

  async decideReview(id, decision, message = '') {
    const db = getDb();
    const r = (db.pendingReviews || []).find((x) => x.id === id);
    if (!r) throw new Error('Review not found');
    if (r.status !== 'pending') return r;

    const decidedAt = new Date().toISOString();
    r.decidedAt = decidedAt;
    r.guardianMessage = message;

    db.transactions[r.fromUserId] = db.transactions[r.fromUserId] || [];
    const txList = db.transactions[r.fromUserId];
    const isPayment = r.kind === 'payment';
    // Find the pending tx that was created when the ward submitted. Older
    // reviews (pre-update) won't have one, so fall back to creating it.
    let tx = txList.find(
      (t) => (r.txId && t.id === r.txId) || (t.reviewId === r.id),
    );

    if (decision === 'approve') {
      const wallet = db.wallets[r.fromUserId] || { balance: 0 };
      if (wallet.balance >= r.amount) {
        wallet.balance -= r.amount;
        wallet.lastUpdated = new Date().toISOString();
        db.wallets[r.fromUserId] = wallet;

        if (tx) {
          tx.status = 'approved';
          tx.type = isPayment ? 'payment' : 'transfer_out';
          tx.decidedAt = decidedAt;
          tx.reviewedBy = r.guardianId;
          tx.guardianMessage = message;
        } else {
          txList.unshift({
            id: makeId('tx'),
            userId: r.fromUserId,
            type: isPayment ? 'payment' : 'transfer_out',
            title: isPayment
              ? r.recipientName || r.merchantId || 'Payment'
              : `Transfer to ${r.recipientPhone}`,
            amount: r.amount,
            recipientPhone: isPayment ? undefined : r.recipientPhone,
            merchantId: isPayment ? r.merchantId : undefined,
            note: r.note,
            status: 'approved',
            reviewId: r.id,
            decidedAt,
            createdAt: decidedAt,
            reviewedBy: r.guardianId,
            guardianMessage: message,
          });
        }
        r.status = 'approved';
      } else {
        r.status = 'blocked';
        r.guardianMessage = 'Insufficient balance at approval time';
        if (tx) {
          tx.status = 'declined';
          tx.type = 'blocked';
          tx.title = `Blocked: ${r.recipientName || r.recipientPhone}`;
          tx.decidedAt = decidedAt;
          tx.reason = 'insufficient_balance';
        }
      }
    } else {
      r.status = 'blocked';
      if (tx) {
        tx.status = 'declined';
        tx.type = 'blocked';
        tx.title = `Blocked: ${r.recipientName || r.recipientPhone}`;
        tx.decidedAt = decidedAt;
        tx.reviewedBy = r.guardianId;
        tx.guardianMessage = message;
        tx.reason = r.aiRiskReport?.matchedScamPattern || 'guardian_blocked';
      } else {
        txList.unshift({
          id: makeId('tx'),
          userId: r.fromUserId,
          type: 'blocked',
          title: `Blocked: ${r.recipientName || r.recipientPhone}`,
          amount: r.amount,
          status: 'declined',
          reviewId: r.id,
          reason: r.aiRiskReport?.matchedScamPattern || 'guardian_blocked',
          decidedAt,
          createdAt: decidedAt,
          reviewedBy: r.guardianId,
          guardianMessage: message,
        });
      }
      if (db.flags) db.flags.scamCallActive = false;
    }

    setDb(db);
    return r;
  },

  async setThreshold(wardId, threshold) {
    const db = getDb();
    const link = (db.guardianLinks || []).find((l) => l.wardId === wardId);
    if (!link) throw new Error('Link not found');
    link.threshold = Math.max(0, Number(threshold) || 0);
    setDb(db);
    return link;
  },

  async setCoolOff(wardId, minutes) {
    const db = getDb();
    const link = (db.guardianLinks || []).find((l) => l.wardId === wardId);
    if (!link) throw new Error('Link not found');
    link.coolOffMinutes = Math.max(1, Math.min(60, Number(minutes) || 5));
    setDb(db);
    return link;
  },

  async listNotifications() {
    const u = authService.getStoredUser();
    if (!u) return [];
    const db = getDb();
    return db.notifications?.[u.id] || [];
  },

  async listScamPatterns() {
    const db = getDb();
    return db.scamPatterns || [];
  },

  async setScamCall(active) {
    const db = getDb();
    db.flags = db.flags || {};
    db.flags.scamCallActive = !!active;
    setDb(db);
    return db.flags;
  },

  getScamCallActive() {
    const db = getDb();
    return !!db.flags?.scamCallActive;
  },
};
