import { getDb } from './mockBackend';
import { authService } from './authService';

export const transactionService = {
  async list({ limit = 20 } = {}) {
    await new Promise((r) => setTimeout(r, 60));
    const u = authService.getStoredUser();
    if (!u) return { items: [] };
    const db = getDb();
    const items = (db.transactions[u.id] || []).slice(0, limit);
    return { items };
  },

  async getById(id) {
    const u = authService.getStoredUser();
    if (!u) return null;
    const db = getDb();
    return (db.transactions[u.id] || []).find((t) => t.id === id) || null;
  },
};
