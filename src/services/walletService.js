import { getDb, setDb, makeId } from './mockBackend';
import { authService } from './authService';
import { generateRiskReport } from './riskEngine';

function findGuardianLink(db, wardId) {
  return (db.guardianLinks || []).find((l) => l.wardId === wardId) || null;
}

function failure(message) {
  const err = new Error(message);
  err.response = { data: { message } };
  return err;
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

    if (u.role === 'ward') {
      const link = findGuardianLink(db, u.id);
      if (link) {
        const aiRiskReport = generateRiskReport({
          ward: u,
          link,
          recipientPhone,
          amount,
          note,
          db,
        });

        const aboveThreshold = amount >= link.threshold;
        const aiTriggers = aiRiskReport.score >= 50;

        if (aboveThreshold || aiTriggers) {
          const now = Date.now();
          const coolOffMs = (link.coolOffMinutes || 5) * 60 * 1000;
          const reviewId = makeId('rv');
          const txId = makeId('tx');
          const review = {
            id: reviewId,
            fromUserId: u.id,
            fromName: u.name,
            fromShortName: u.shortName || u.name,
            wardType: link.wardType || u.wardType || 'elderly',
            guardianId: link.guardianId,
            recipientPhone,
            recipientName: aiRiskReport.recipientName || null,
            amount,
            note: note || '',
            thresholdAtRequest: link.threshold,
            coolOffMinutes: link.coolOffMinutes || 5,
            createdAt: new Date(now).toISOString(),
            coolOffEndsAt: new Date(now + coolOffMs).toISOString(),
            aiRiskReport,
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
            title: aiRiskReport.recipientName
              ? `To ${aiRiskReport.recipientName}`
              : `Transfer to ${recipientPhone}`,
            amount,
            recipientPhone,
            note: note || '',
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

    wallet.balance -= amount;
    wallet.lastUpdated = new Date().toISOString();
    db.wallets[u.id] = wallet;
    db.transactions[u.id] = db.transactions[u.id] || [];
    db.transactions[u.id].unshift({
      id: makeId('tx'),
      userId: u.id,
      type: 'transfer_out',
      title: `Transfer to ${recipientPhone}`,
      amount,
      recipientPhone,
      note: note || '',
      status: 'completed',
      createdAt: new Date().toISOString(),
    });
    setDb(db);
    return { status: 'completed' };
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
