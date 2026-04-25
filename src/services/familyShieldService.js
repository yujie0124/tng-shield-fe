import { getDb, setDb, makeId } from './mockBackend';
import { authService } from './authService';

function findLinksForGuardian(db, guardianId) {
  return (db.guardianLinks || []).filter((l) => l.guardianId === guardianId);
}

function findLinkForWard(db, wardId) {
  return (db.guardianLinks || []).find((l) => l.wardId === wardId) || null;
}

function expireIfNeeded(db, review) {
  if (review.status !== 'pending') return review;
  const ends = new Date(review.coolOffEndsAt).getTime();
  if (Date.now() > ends + 24 * 3600 * 1000) {
    review.status = 'expired';
    review.decidedAt = new Date().toISOString();
    review.guardianMessage = 'Auto-blocked — cool-off elapsed without guardian decision.';
  }
  return review;
}

export const familyShieldService = {
  async getStatus() {
    const u = authService.getStoredUser();
    if (!u) return null;
    const db = getDb();

    if (u.role === 'guardian') {
      const links = findLinksForGuardian(db, u.id);
      const wards = links.map((link) => {
        const w = db.users.find((x) => x.id === link.wardId);
        const txs = db.transactions[link.wardId] || [];
        const reviews = (db.pendingReviews || []).filter((r) => r.fromUserId === link.wardId);
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

      const pending = (db.pendingReviews || [])
        .filter((r) => r.guardianId === u.id && r.status === 'pending')
        .map((r) => expireIfNeeded(db, r));
      const blockedReviews = (db.pendingReviews || []).filter(
        (r) => r.guardianId === u.id && (r.status === 'blocked' || r.status === 'expired'),
      );
      const blockedSavings = blockedReviews.reduce((s, r) => s + r.amount, 0);

      setDb(db);
      return {
        role: 'guardian',
        guardian: { id: u.id, name: u.shortName || u.name },
        wards,
        pending,
        blockedSavings,
        blockedCount: blockedReviews.length,
      };
    }

    const link = findLinkForWard(db, u.id);
    const guardian = link ? db.users.find((x) => x.id === link.guardianId) || null : null;
    const myReviews = (db.pendingReviews || [])
      .filter((r) => r.fromUserId === u.id)
      .map((r) => expireIfNeeded(db, r));
    const latestPending = myReviews.find((r) => r.status === 'pending') || null;
    const latestBlocked = myReviews.find((r) => r.status === 'blocked' || r.status === 'expired') || null;
    setDb(db);
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

  async getReview(id) {
    const db = getDb();
    const r = (db.pendingReviews || []).find((x) => x.id === id);
    if (!r) return null;
    expireIfNeeded(db, r);
    setDb(db);
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
