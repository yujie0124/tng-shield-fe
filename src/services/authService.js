import { getDb } from './mockBackend';

const TOKEN_KEY = 'tng_token';
const USER_KEY = 'tng_user';

function strip(user) {
  const { pin, ...safe } = user;
  return safe;
}

export const authService = {
  async login(phone, pin) {
    await new Promise((r) => setTimeout(r, 200));
    const db = getDb();
    const match = db.users.find((u) => u.phone === phone && u.pin === pin);
    if (!match) {
      const err = new Error('Invalid phone or PIN');
      err.response = { data: { message: 'Invalid phone or PIN' } };
      throw err;
    }
    const user = strip(match);
    const token = `tng-${user.id}`;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    return { token, user };
  },

  async register() {
    throw new Error('Registration is disabled in prototype');
  },

  async me() {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) {
      const err = new Error('Not authenticated');
      err.response = { status: 401 };
      throw err;
    }
    const cached = JSON.parse(raw);
    const db = getDb();
    const fresh = db.users.find((u) => u.id === cached.id);
    return fresh ? strip(fresh) : cached;
  },

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },

  getStoredUser() {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  },

  getToken() {
    return localStorage.getItem(TOKEN_KEY);
  },
};
