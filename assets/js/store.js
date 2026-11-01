/* SAFE Invoice Studio — storage.
 *   - "google": the shared mode. Data on Google Drive and emails sent through the
 *     Apps Script backend (apps-script/Code.gs). Every SAFE team member signs in.
 *   - "local": demo mode. Data stays in this browser only; emails open in your mail app. */
(function (root) {
  const S = (root.SAFE = root.SAFE || {});

  const CONN_KEY = 'safe-invoice-studio-connection';
  const TOKEN_KEY = 'safe-invoice-studio-session';
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  S.getConnection = () => { try { return JSON.parse(ls.get(CONN_KEY) || '{}'); } catch (e) { return {}; } };
  S.setConnection = (c) => ls.set(CONN_KEY, JSON.stringify(c || {}));

  function upsert(arr, obj) {
    const i = arr.findIndex((x) => x.id === obj.id);
    if (i >= 0) arr[i] = obj; else arr.push(obj);
  }
  S.upsert = upsert;
  // unsent drafts follow the client's latest billing details (the backend does the same)
  function refreshDrafts(db, c) {
    (db.invoices || []).forEach((i) => { if (i.clientId === c.id && i.status === 'Draft') i.billTo = S.billToFromClient(c); });
  }

  // ---------- IndexedDB (demo mode) ----------
  function idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('safe-invoice-studio', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function kvGet(key) {
    const db = await idb();
    return new Promise((res, rej) => { const r = db.transaction('kv').objectStore('kv').get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  }
  async function kvSet(key, val) {
    const db = await idb();
    return new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(val, key); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  }

  class LocalStore {
    constructor() { this.mode = 'local'; this.db = null; this.user = { email: 'demo', name: 'Demo user', role: 'admin' }; }
    get signedIn() { return true; }
    async load() {
      this.db = (await kvGet('db')) || { clients: [], invoices: [], settings: {} };
      this.db.clients = this.db.clients || []; this.db.invoices = this.db.invoices || []; this.db.settings = this.db.settings || {};
      return this.db;
    }
    async _save() { await kvSet('db', this.db); }
    async saveClient(c) { upsert(this.db.clients, c); refreshDrafts(this.db, c); await this._save(); return c; }
    async deleteClient(id) {
      if (this.db.invoices.some((i) => i.clientId === id)) throw new Error('This client has invoices. Mark the client inactive instead.');
      this.db.clients = this.db.clients.filter((c) => c.id !== id); await this._save();
    }
    async saveInvoice(inv) {
      if (!inv.number) inv.number = S.nextNumber(this.db.invoices, inv, S.mergeSettings(this.db.settings));
      const dup = this.db.invoices.find((i) => i.id !== inv.id && i.number === inv.number);
      if (dup) throw new Error('Invoice number ' + inv.number + ' is already used.');
      inv.updatedAt = new Date().toISOString();
      upsert(this.db.invoices, inv); await this._save(); return inv;
    }
    async deleteInvoice(id) {
      const inv = this.db.invoices.find((i) => i.id === id);
      if (inv && inv.status !== 'Draft') throw new Error('Only drafts can be deleted. Cancel the invoice instead.');
      this.db.invoices = this.db.invoices.filter((i) => i.id !== id); await this._save();
    }
    async saveSettings(s) { this.db.settings = s; await this._save(); }
    async sendInvoice() { throw new Error('Sending email needs the Google backend. In demo mode, use "Download and open email app".'); }
    async savePdf() { return {}; }
    async testEmail() { throw new Error('Emails need the Google backend. Connect it in Settings.'); }
    async exportAll() { return JSON.stringify(this.db, null, 2); }
    async importAll(json) { const d = JSON.parse(json); this.db = { clients: d.clients || [], invoices: d.invoices || [], settings: d.settings || {} }; await this._save(); }
  }

  class GoogleStore {
    constructor(url) { this.mode = 'google'; this.url = url; this.db = null; this.user = null; this.token = ls.get(TOKEN_KEY) || ''; this.fromOptions = []; }
    get signedIn() { return !!this.token; }
    async call(action, payload) {
      let res;
      try {
        res = await fetch(this.url, {
          method: 'POST',
          // text/plain avoids a CORS preflight, which Apps Script does not answer
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(Object.assign({ action, token: this.token }, payload || {})),
          redirect: 'follow',
        });
      } catch (e) {
        throw new Error('Could not reach the Google backend. Check the internet connection and the web app URL in Settings.');
      }
      if (!res.ok) throw new Error('Backend error ' + res.status);
      let out;
      try { out = await res.json(); } catch (e) { throw new Error('The backend did not answer correctly. Check that the web app is deployed with access "Anyone".'); }
      if (!out.ok) {
        const err = new Error(out.error || 'Backend error');
        if (out.auth) { err.auth = true; this.token = ''; ls.del(TOKEN_KEY); }
        throw err;
      }
      return out;
    }
    async ping() { return this.call('ping'); }
    async login(email, password) {
      const r = await this.call('login', { email, password });
      this.token = r.token; ls.set(TOKEN_KEY, r.token); this.user = r.user;
      return r;
    }
    async logout() { try { await this.call('logout'); } catch (e) { /* ignore */ } this.token = ''; ls.del(TOKEN_KEY); }
    async load() {
      const r = await this.call('load');
      this.db = r.db; this.user = r.user; this.fromOptions = r.fromOptions || [];
      this.db.clients = this.db.clients || []; this.db.invoices = this.db.invoices || []; this.db.settings = this.db.settings || {};
      this.db.users = r.users || [];
      return this.db;
    }
    async saveClient(c) { const r = await this.call('saveClient', { client: c }); upsert(this.db.clients, r.client); refreshDrafts(this.db, r.client); return r.client; }
    async deleteClient(id) { await this.call('deleteClient', { id }); this.db.clients = this.db.clients.filter((c) => c.id !== id); }
    async saveInvoice(inv) { const r = await this.call('saveInvoice', { invoice: inv }); upsert(this.db.invoices, r.invoice); return r.invoice; }
    async deleteInvoice(id) { await this.call('deleteInvoice', { id }); this.db.invoices = this.db.invoices.filter((i) => i.id !== id); }
    async saveSettings(s) { await this.call('saveSettings', { settings: s }); this.db.settings = s; }
    async sendInvoice(p) { const r = await this.call('sendInvoice', p); upsert(this.db.invoices, r.invoice); return r.invoice; }
    async savePdf(p) { const r = await this.call('savePdf', p); if (r.invoice) upsert(this.db.invoices, r.invoice); return r; }
    async testEmail(to) { return this.call('testEmail', { to }); }
    async users() { return (await this.call('users')).users; }
    async saveUser(u, resetPassword) { return this.call('saveUser', { user: u, resetPassword: !!resetPassword }); }
    async deleteUser(email) { return this.call('deleteUser', { email }); }
    async changePassword(oldPassword, newPassword) { return this.call('changePassword', { oldPassword, newPassword }); }
    async exportAll() { return JSON.stringify({ clients: this.db.clients, invoices: this.db.invoices, settings: this.db.settings }, null, 2); }
    async importAll(json) { await this.call('importAll', { data: JSON.parse(json) }); await this.load(); }
  }

  S.makeStore = () => {
    const c = S.getConnection();
    if (c.mode === 'google' && c.url) return new GoogleStore(c.url);
    return new LocalStore();
  };
  S.GoogleStore = GoogleStore;
  S.LocalStore = LocalStore;
})(typeof window !== 'undefined' ? window : globalThis);
