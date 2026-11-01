/* SAFE Invoice Studio — user interface. */
(function () {
  'use strict';
  const S = window.SAFE;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = S.escHtml;
  const main = $('#main');

  const now = S.parseDate(S.today());
  const state = {
    store: null, db: null, st: null, user: null,
    dash: { y: now.y, m: now.m },
    filters: { y: 'all', m: 'all', status: 'all', kind: 'all', q: '' },
    editing: null, dirty: false, unlocked: false,
    lastHash: location.hash,
    settingsTab: 'invoice',
  };

  // ---------------- small UI helpers ----------------
  function toast(msg, kind) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast ' + (kind || '');
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, kind === 'bad' ? 8000 : 3500);
  }
  function openModal(title, html, onMount, wide) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = html;
    $('.modal-card').classList.toggle('wide', !!wide);
    $('#modal').hidden = false;
    if (onMount) onMount($('#modalBody'));
    const f = $('#modalBody').querySelector('input:not([type=hidden]):not([disabled]),select,textarea');
    if (f) f.focus();
  }
  function closeModal() { $('#modal').hidden = true; $('#modalBody').innerHTML = ''; }
  async function busy(btn, label, fn) {
    const old = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = esc(label || 'Working…'); }
    try { return await fn(); } catch (e) {
      console.error(e);
      toast(e.message || String(e), 'bad');
      if (e.auth) setTimeout(() => viewLogin(e.message), 600);
      return undefined;
    } finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = old; } }
  }
  const isAdmin = () => !state.user || state.user.role === 'admin';
  const clientById = (id) => state.db.clients.find((c) => c.id === id);
  const invById = (id) => state.db.invoices.find((i) => i.id === id);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const yearsList = () => { const ys = []; for (let y = 2024; y <= now.y + 1; y++) ys.push(y); return ys; };
  function monthSelect(name, m, all) {
    return `<select class="input" name="${name}" aria-label="Month">${all ? `<option value="all"${m === 'all' ? ' selected' : ''}>All months</option>` : ''}${S.MONTHS.map((mm, i) => `<option value="${i + 1}"${Number(m) === i + 1 ? ' selected' : ''}>${mm}</option>`).join('')}</select>`;
  }
  function yearSelect(name, y, all) {
    return `<select class="input" name="${name}" aria-label="Year">${all ? `<option value="all"${y === 'all' ? ' selected' : ''}>All years</option>` : ''}${yearsList().map((yy) => `<option${Number(y) === yy ? ' selected' : ''}>${yy}</option>`).join('')}</select>`;
  }
  function statusPill(inv) {
    const s = S.displayStatus(inv, state.st);
    return `<span class="status st-${s}">${s}</span>`;
  }
  const kindLabel = (k) => (k === 'case' ? 'Case-by-case' : 'Monthly retainer');
  const validEmails = (s) => String(s || '').split(/[,;\s]+/).filter(Boolean).every((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  const normEmails = (s) => String(s || '').split(/[,;\s]+/).filter(Boolean).join(', ');

  function setChrome(show) {
    document.body.classList.toggle('bare', !show);
    $('#topbarRight').hidden = !show;
  }

  // ---------------- boot / auth ----------------
  async function boot() {
    const conn = S.getConnection();
    if (!conn.mode) return viewWelcome();
    state.store = S.makeStore();
    if (state.store.mode === 'google' && !state.store.signedIn) return viewLogin();
    setChrome(false);
    main.innerHTML = '<div class="empty">Loading…</div>';
    try {
      await reload();
    } catch (e) {
      if (e.auth) return viewLogin(e.message);
      main.innerHTML = `<div class="card login-card"><h2>Could not load</h2><p class="notice bad">${esc(e.message)}</p>
        <div class="modal-actions"><button class="btn" data-action="change-connection">Change connection</button><button class="btn primary" data-action="retry">Try again</button></div></div>`;
      return;
    }
    setChrome(true);
    if (state.user && state.user.mustChange) return viewChangePassword(true);
    route();
  }
  async function reload() {
    state.db = await state.store.load();
    state.st = S.mergeSettings(state.db.settings);
    state.user = state.store.user;
    renderTop();
    renderSidebar();
  }
  function renderTop() {
    const b = $('#modeBadge');
    if (state.store.mode === 'google') { b.textContent = 'Google Drive'; b.className = 'mode-badge google'; b.title = 'Shared data on Google Drive'; }
    else { b.textContent = 'Demo mode'; b.className = 'mode-badge'; b.title = 'Data is kept in this browser only'; }
    $('#userChip').textContent = state.user && state.store.mode === 'google' ? state.user.name || state.user.email : '';
    $('#signOutBtn').hidden = state.store.mode !== 'google';
  }

  function viewWelcome() {
    setChrome(false);
    main.innerHTML = `
      <div class="card login-card wide">
        <div class="eyebrow">SAFE Legal Solutions · internal</div>
        <h1>SAFE Invoice Studio</h1>
        <p class="muted">Raise monthly retainer and case-by-case invoices on SAFE Legal's letterhead, download them as PDF and email them to clients from operations@safelegal.org.</p>
        <h3 class="mt">Connect to SAFE's backend</h3>
        <p class="small muted">Paste the Apps Script web app URL (it ends with <code>/exec</code>). The setup is in the README.</p>
        <form id="connectForm" class="stack">
          <input class="input" name="url" type="url" required placeholder="https://script.google.com/macros/s/…/exec" value="${esc(S.getConnection().url || '')}">
          <button class="btn primary" type="submit">Connect</button>
        </form>
        <div class="divider"><span>or</span></div>
        <button class="btn block" data-action="demo-mode">Try demo mode (this browser only, no emails)</button>
      </div>`;
    $('#connectForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = new FormData(e.target).get('url').trim();
      const btn = e.target.querySelector('button');
      await busy(btn, 'Connecting…', async () => {
        const st = new S.GoogleStore(url);
        await st.ping();
        S.setConnection({ mode: 'google', url });
        toast('Connected. Please sign in.', 'ok');
        boot();
      });
    });
  }

  function viewLogin(msg) {
    setChrome(false);
    main.innerHTML = `
      <div class="card login-card">
        <div class="eyebrow">SAFE team sign-in</div>
        <h1>SAFE Invoice Studio</h1>
        ${msg ? `<p class="notice warn">${esc(msg)}</p>` : ''}
        <form id="loginForm" class="stack">
          <label class="field">Email<input class="input" name="email" type="email" autocomplete="username" required></label>
          <label class="field">Password<input class="input" name="password" type="password" autocomplete="current-password" required></label>
          <button class="btn primary" type="submit">Sign in</button>
        </form>
        <p class="small muted mt">Forgotten your password? Ask a SAFE administrator to reset it.</p>
        <button class="link-btn small" data-action="change-connection">Change backend connection</button>
      </div>`;
    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await busy(e.target.querySelector('button'), 'Signing in…', async () => {
        if (!state.store || state.store.mode !== 'google') state.store = S.makeStore();
        await state.store.login(fd.get('email').trim(), fd.get('password'));
        boot();
      });
    });
  }

  function viewChangePassword(forced) {
    setChrome(!forced);
    main.innerHTML = `
      <div class="card login-card">
        <h2>${forced ? 'Choose your own password' : 'Change password'}</h2>
        ${forced ? '<p class="muted">You signed in with a temporary password. Choose a new one to continue.</p>' : ''}
        <form id="pwForm" class="stack">
          <label class="field">Current password<input class="input" name="old" type="password" autocomplete="current-password" required></label>
          <label class="field">New password <span class="help">At least 8 characters</span><input class="input" name="new1" type="password" minlength="8" autocomplete="new-password" required></label>
          <label class="field">New password again<input class="input" name="new2" type="password" minlength="8" autocomplete="new-password" required></label>
          <button class="btn primary" type="submit">Save password</button>
        </form>
      </div>`;
    $('#pwForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      if (fd.get('new1') !== fd.get('new2')) return toast('The new passwords do not match.', 'bad');
      await busy(e.target.querySelector('button'), 'Saving…', async () => {
        await state.store.changePassword(fd.get('old'), fd.get('new1'));
        toast('Password changed.', 'ok');
        if (state.user) state.user.mustChange = false;
        setChrome(true);
        location.hash = '#/';
        route();
      });
    });
  }

  // ---------------- sidebar ----------------
  function renderSidebar() {
    const q = ($('#clientSearch').value || '').toLowerCase();
    const list = state.db.clients
      .filter((c) => !q || (c.name + ' ' + (c.contactPerson || '') + ' ' + (c.email || '')).toLowerCase().includes(q))
      .sort((a, b) => (b.active !== false) - (a.active !== false) || a.name.localeCompare(b.name));
    const cur = (location.hash.match(/^#\/client\/(.+)$/) || [])[1];
    $('#clientList').innerHTML = list.length ? list.map((c) => `
      <a class="client-item${c.id === cur ? ' active' : ''}${c.active === false ? ' inactive' : ''}" href="#/client/${c.id}">
        ${esc(c.name)}<small>${c.billing === 'case' ? 'Case-by-case' : 'Retainer · ' + S.inr0(c.retainerAmount)}${c.active === false ? ' · inactive' : ''}</small>
      </a>`).join('') : `<div class="small muted pad">${q ? 'No match' : 'No clients yet'}</div>`;
    const sec = (location.hash.split('/')[1] || '').split('?')[0] || 'dashboard';
    $$('.side-nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === sec));
  }

  // ---------------- routing ----------------
  function route() {
    if (!state.db) return;
    const h = location.hash || '#/';
    if (state.dirty && h !== state.lastHash) {
      if (!confirm('You have unsaved changes on this invoice. Leave without saving?')) {
        history.replaceState(null, '', state.lastHash);
        return;
      }
      state.dirty = false;
    }
    state.lastHash = h;
    state.unlocked = false;
    const [path, qs] = h.slice(1).split('?');
    const parts = path.split('/').filter(Boolean);
    const params = new URLSearchParams(qs || '');
    renderSidebar();
    window.scrollTo(0, 0);
    if (!parts.length) return viewDashboard();
    switch (parts[0]) {
      case 'invoices': return viewInvoices();
      case 'clients': return viewClients();
      case 'client': return viewClient(parts[1]);
      case 'invoice': return viewInvoiceById(parts[1]);
      case 'new-invoice': return viewNewInvoice(params);
      case 'settings': if (parts[1]) state.settingsTab = parts[1]; return viewSettings();
      case 'password': return viewChangePassword(false);
      default: return viewDashboard();
    }
  }

  // ---------------- dashboard ----------------
  function viewDashboard() {
    const { y, m } = state.dash;
    const st = state.st;
    const live = state.db.invoices.filter((i) => i.status !== 'Cancelled');
    const month = live.filter((i) => i.periodY === y && i.periodM === m);
    const retClients = state.db.clients.filter((c) => c.billing !== 'case' && c.active !== false).sort((a, b) => a.name.localeCompare(b.name));
    const rows = retClients.map((c) => ({ c, inv: month.find((i) => i.clientId === c.id && i.kind === 'retainer') }));
    const pending = rows.filter((r) => !r.inv);
    const drafts = rows.filter((r) => r.inv && r.inv.status === 'Draft');
    const sum = (arr) => arr.reduce((a, i) => a + S.invoiceTotal(i), 0);
    const outstanding = live.filter((i) => i.status === 'Sent');
    const overdue = outstanding.filter((i) => S.isOverdue(i, st));
    const caseInv = month.filter((i) => i.kind === 'case');

    main.innerHTML = `
      <div class="page-head">
        <div><div class="eyebrow">Dashboard</div><h1>Invoices for ${S.periodTitle(y, m)}</h1></div>
        <div class="row" id="dashPeriod">${monthSelect('m', m)}${yearSelect('y', y)}</div>
      </div>
      ${state.store.mode === 'local' ? '<p class="notice warn">Demo mode: data stays in this browser and emails cannot be sent from here. Connect the Google backend in Settings for the SAFE team.</p>' : ''}
      <div class="stats">
        <div class="stat"><div class="n">${month.length}</div><div class="l">Invoices raised for ${S.periodShort(y, m)}</div></div>
        <div class="stat"><div class="n">${S.inr0(sum(month))}</div><div class="l">Billed for ${S.periodShort(y, m)}</div></div>
        <div class="stat"><div class="n">${month.filter((i) => i.status === 'Paid').length} / ${month.filter((i) => i.status !== 'Draft').length}</div><div class="l">Paid / sent this month</div></div>
        <div class="stat ${outstanding.length ? 'warn' : ''}"><div class="n">${S.inr0(sum(outstanding))}</div><div class="l">Outstanding, all months (${outstanding.length})</div></div>
        <div class="stat ${overdue.length ? 'bad' : ''}"><div class="n">${overdue.length}</div><div class="l">Overdue</div></div>
      </div>

      <div class="card">
        <div class="spread"><h3>Monthly retainers · ${S.periodShort(y, m)}</h3>
          <div class="row">
            ${pending.length ? `<button class="btn primary" data-action="raise-retainers">Raise ${pending.length} pending invoice${pending.length > 1 ? 's' : ''}</button>` : ''}
            ${drafts.length ? `<button class="btn" data-action="bulk-send">Send ${drafts.length} draft${drafts.length > 1 ? 's' : ''} by email</button>` : ''}
          </div>
        </div>
        ${retClients.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Client</th><th class="num">Retainer</th><th>Invoice</th><th>Status</th><th></th></tr></thead>
          <tbody>${rows.map(({ c, inv }) => `<tr>
            <td><a href="#/client/${c.id}">${esc(c.name)}</a><div class="small muted">${esc(c.email || '')}</div></td>
            <td class="num">${S.inr(c.retainerAmount)}</td>
            <td>${inv ? `<a href="#/invoice/${inv.id}">${esc(inv.number)}</a><div class="small muted">${S.fmtDate(inv.date)}</div>` : '<span class="muted">Not raised</span>'}</td>
            <td>${inv ? statusPill(inv) : '<span class="status st-None">Pending</span>'}</td>
            <td class="actions">${inv ? `<a class="btn small" href="#/invoice/${inv.id}">Open</a>` : `<button class="btn small" data-action="raise-one" data-client="${c.id}">Raise</button>`}</td>
          </tr>`).join('')}</tbody></table></div>` : `<div class="empty">No retainer clients yet. <button class="link-btn" data-action="new-client">Add a client</button></div>`}
      </div>

      <div class="card">
        <div class="spread"><h3>Case-by-case invoices · ${S.periodShort(y, m)}</h3><a class="btn" href="#/new-invoice?kind=case&y=${y}&m=${m}">+ Case invoice</a></div>
        ${caseInv.length ? invoiceTable(caseInv) : '<div class="empty small">None this month.</div>'}
      </div>

      <div class="card">
        <h3>Outstanding</h3>
        ${outstanding.length ? invoiceTable(outstanding.sort((a, b) => (S.dueDate(a, st) > S.dueDate(b, st) ? 1 : -1)), true) : '<div class="empty small">Nothing outstanding.</div>'}
      </div>`;
    $('#dashPeriod').addEventListener('change', (e) => {
      const f = e.currentTarget;
      state.dash = { y: Number($('[name=y]', f).value), m: Number($('[name=m]', f).value) };
      viewDashboard();
    });
  }

  function invoiceTable(list, showDue) {
    const st = state.st;
    return `<div class="table-wrap"><table class="table">
      <thead><tr><th>Invoice</th><th>Date</th><th>Client</th><th>Type</th><th>Month</th><th class="num">Amount (₹)</th>${showDue ? '<th>Due</th>' : ''}<th>Status</th><th></th></tr></thead>
      <tbody>${list.map((i) => `<tr class="clickable" data-href="#/invoice/${i.id}">
        <td><a href="#/invoice/${i.id}">${esc(i.number || 'Draft')}</a></td>
        <td>${S.fmtDate(i.date)}</td>
        <td>${esc((i.billTo && i.billTo.name) || '')}</td>
        <td>${i.kind === 'case' ? 'Case' : 'Retainer'}</td>
        <td>${S.periodShort(i.periodY, i.periodM)}</td>
        <td class="num">${S.inr(S.invoiceTotal(i))}</td>
        ${showDue ? `<td class="${S.isOverdue(i, st) ? 'exp-bad' : ''}">${S.fmtDate(S.dueDate(i, st))}</td>` : ''}
        <td>${statusPill(i)}${i.status === 'Paid' && i.payment ? `<div class="small muted">Received ${S.fmtDate(i.payment.date)}</div>` : ''}</td>
        <td class="actions">${i.status === 'Sent' ? `<button class="btn small" data-action="mark-paid-row" data-id="${i.id}">Mark paid</button>` : ''}</td>
      </tr>`).join('')}</tbody></table></div>`;
  }

  // raise retainer invoices for the dashboard month
  function raiseRetainers(clientIds) {
    const { y, m } = state.dash;
    const month = state.db.invoices.filter((i) => i.status !== 'Cancelled' && i.periodY === y && i.periodM === m && i.kind === 'retainer');
    const list = state.db.clients.filter((c) => c.billing !== 'case' && c.active !== false && !month.some((i) => i.clientId === c.id) && (!clientIds || clientIds.includes(c.id)));
    if (!list.length) return toast('All retainer invoices for this month are already raised.');
    const t = S.today();
    const sameMonth = S.parseDate(t).y === y && S.parseDate(t).m === m;
    const defDate = sameMonth ? t : S.periodKey(y, m) + '-02';
    openModal(`Raise retainer invoices · ${S.periodLong(y, m)}`, `
      <form id="raiseForm">
        <div class="grid2">
          <label class="field">Invoice date<input class="input" type="date" name="date" value="${defDate}" required></label>
          <div class="field"><span>Billing month</span><div class="pill-static">${S.periodShort(y, m)}</div></div>
        </div>
        <p class="small muted">Each client gets a draft with its monthly retainer line. Check the drafts, then send them.</p>
        <div class="check-list">${list.map((c) => `<label class="check"><input type="checkbox" name="c" value="${c.id}" checked> <span>${esc(c.name)}</span><span class="muted">${S.inr(c.retainerAmount)}</span></label>`).join('')}</div>
        <div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Cancel</button><button class="btn primary" type="submit">Create drafts</button></div>
      </form>`, (body) => {
      $('#raiseForm', body).addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const ids = fd.getAll('c');
        const date = fd.get('date');
        await busy(e.target.querySelector('button[type=submit]'), 'Creating…', async () => {
          let n = 0;
          for (const id of ids) {
            const c = clientById(id);
            const inv = S.newInvoice(c, state.st, { y, m, date, kind: 'retainer' });
            inv.history.push(hist('Created'));
            await state.store.saveInvoice(inv);
            n++;
          }
          closeModal();
          toast(`${n} draft invoice${n === 1 ? '' : 's'} created.`, 'ok');
          if (ids.length === 1) { const inv = state.db.invoices.find((i) => i.clientId === ids[0] && i.periodY === y && i.periodM === m && i.kind === 'retainer' && i.status === 'Draft'); if (inv) { location.hash = '#/invoice/' + inv.id; return; } }
          viewDashboard();
        });
      });
    });
  }

  function hist(what) { return { at: new Date().toISOString(), by: state.user ? state.user.name || state.user.email : '', what }; }

  // send all drafts for the month
  function bulkSend() {
    const { y, m } = state.dash;
    const drafts = state.db.invoices.filter((i) => i.status === 'Draft' && i.kind === 'retainer' && i.periodY === y && i.periodM === m);
    if (state.store.mode !== 'google') return toast('Sending email needs the Google backend. Open each invoice to download it instead.', 'bad');
    const e = state.st.email;
    openModal(`Send retainer invoices · ${S.periodLong(y, m)}`, `
      <p class="small muted">Each invoice is emailed from <b>${esc(e.fromName)} &lt;${esc(e.fromEmail)}&gt;</b> with the standard retainer email and the PDF attached. Untick any you want to check first.</p>
      <form id="bulkForm">
        <div class="check-list">${drafts.map((i) => { const c = clientById(i.clientId) || {}; const ok = validEmails(i.billTo && i.billTo.email) && (i.billTo && i.billTo.email); return `<label class="check"><input type="checkbox" name="i" value="${i.id}" ${ok ? 'checked' : 'disabled'}> <span>${esc(i.number)} · ${esc(i.billTo.name)}</span><span class="muted small">${ok ? esc(i.billTo.email) + (c.cc ? ' + cc' : '') : 'no client email'}</span></label>`; }).join('')}</div>
        <div id="bulkProgress" class="small"></div>
        <div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Cancel</button><button class="btn primary" type="submit">Send emails</button></div>
      </form>`, (body) => {
      $('#bulkForm', body).addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const ids = new FormData(ev.target).getAll('i');
        const prog = $('#bulkProgress', body);
        await busy(ev.target.querySelector('button[type=submit]'), 'Sending…', async () => {
          let ok = 0; const errs = [];
          for (const id of ids) {
            const inv = invById(id);
            prog.textContent = `Sending ${inv.number} to ${inv.billTo.name}…`;
            try {
              const c = clientById(inv.clientId);
              const p = composeEmail(inv, c);
              await doSend(inv, c, p);
              ok++;
            } catch (err) { errs.push(`${inv.number}: ${err.message}`); if (err.auth) throw err; }
          }
          closeModal();
          toast(`${ok} invoice${ok === 1 ? '' : 's'} sent.${errs.length ? ' Not sent: ' + errs.join('; ') : ''}`, errs.length ? 'bad' : 'ok');
          viewDashboard();
        });
      });
    });
  }

  // ---------------- invoices list ----------------
  function viewInvoices() {
    const f = state.filters;
    const st = state.st;
    const q = f.q.toLowerCase();
    const list = state.db.invoices.filter((i) =>
      (f.y === 'all' || i.periodY === Number(f.y)) &&
      (f.m === 'all' || i.periodM === Number(f.m)) &&
      (f.kind === 'all' || i.kind === f.kind) &&
      (f.status === 'all' || S.displayStatus(i, st) === f.status || (f.status === 'Sent' && i.status === 'Sent')) &&
      (!q || ((i.number || '') + ' ' + ((i.billTo && i.billTo.name) || '')).toLowerCase().includes(q)),
    ).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.number || '').localeCompare(a.number || ''));
    const total = list.filter((i) => i.status !== 'Cancelled').reduce((a, i) => a + S.invoiceTotal(i), 0);
    main.innerHTML = `
      <div class="page-head">
        <div><div class="eyebrow">Register</div><h1>Invoices</h1></div>
        <div class="row"><button class="btn" data-action="export-csv">Export CSV</button><button class="btn primary" data-action="new-invoice">+ New invoice</button></div>
      </div>
      <div class="filters" id="invFilters">
        ${monthSelect('m', f.m, true)}${yearSelect('y', f.y, true)}
        <select class="input" name="kind" aria-label="Type"><option value="all">All types</option><option value="retainer"${f.kind === 'retainer' ? ' selected' : ''}>Monthly retainer</option><option value="case"${f.kind === 'case' ? ' selected' : ''}>Case-by-case</option></select>
        <select class="input" name="status" aria-label="Status">${['all', 'Draft', 'Sent', 'Overdue', 'Paid', 'Cancelled'].map((s) => `<option value="${s}"${f.status === s ? ' selected' : ''}>${s === 'all' ? 'All statuses' : s}</option>`).join('')}</select>
        <input class="input" type="search" name="q" placeholder="Search number or client" value="${esc(f.q)}">
      </div>
      <div class="card">
        <div class="spread small muted"><span>${list.length} invoice${list.length === 1 ? '' : 's'}</span><span>Total (excluding cancelled): <b>₹${S.inr(total)}</b></span></div>
        ${list.length ? invoiceTable(list, true) : '<div class="empty">No invoices match.</div>'}
      </div>`;
    const ff = $('#invFilters');
    const apply = () => {
      ['y', 'm', 'kind', 'status', 'q'].forEach((k) => { f[k] = $(`[name=${k}]`, ff).value; });
      const pos = $('[name=q]', ff).selectionStart;
      viewInvoices();
      if (document.activeElement && pos != null) { const qi = $('#invFilters [name=q]'); if (qi && f.q) { qi.focus(); qi.setSelectionRange(pos, pos); } }
    };
    ff.addEventListener('change', apply);
    $('[name=q]', ff).addEventListener('input', debounce(apply, 250));
  }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  function exportCsv() {
    const st = state.st;
    const rows = [['Invoice No', 'Invoice Date', 'Client', 'Type', 'Billing Month', 'Amount', 'Status', 'Due Date', 'Sent On', 'Sent To', 'Paid On', 'Amount Received', 'Payment Reference']];
    state.db.invoices.slice().sort((a, b) => (a.number || '').localeCompare(b.number || '')).forEach((i) => rows.push([
      i.number, i.date, i.billTo && i.billTo.name, kindLabel(i.kind), S.periodShort(i.periodY, i.periodM), S.invoiceTotal(i).toFixed(2),
      S.displayStatus(i, st), S.dueDate(i, st), i.sentAt ? i.sentAt.slice(0, 10) : '', i.sentTo || '', i.payment ? i.payment.date : '', i.payment ? Number(i.payment.amount).toFixed(2) : '', i.payment ? i.payment.ref || '' : '',
    ]));
    const csv = rows.map((r) => r.map((v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n');
    S.downloadBytes(new TextEncoder().encode('﻿' + csv), `SAFE invoices register ${S.today()}.csv`, 'text/csv');
  }

  // ---------------- clients ----------------
  function viewClients() {
    const list = state.db.clients.slice().sort((a, b) => a.name.localeCompare(b.name));
    main.innerHTML = `
      <div class="page-head">
        <div><div class="eyebrow">Clients</div><h1>Clients</h1></div>
        <button class="btn primary" data-action="new-client">+ Add client</button>
      </div>
      <div class="card">${list.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Client</th><th>Billing</th><th>Type</th><th class="num">Monthly retainer (₹)</th><th>Email</th><th>Last invoice</th></tr></thead>
        <tbody>${list.map((c) => { const last = state.db.invoices.filter((i) => i.clientId === c.id).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0]; return `<tr class="clickable${c.active === false ? ' dim' : ''}" data-href="#/client/${c.id}">
          <td><a href="#/client/${c.id}">${esc(c.name)}</a>${c.active === false ? ' <span class="badge">inactive</span>' : ''}<div class="small muted">${esc(c.contactPerson || '')}</div></td>
          <td>${kindLabel(c.billing)}</td><td>${c.entity === 'individual' ? 'Individual' : 'Business entity'}</td>
          <td class="num">${c.billing === 'case' ? '—' : S.inr(c.retainerAmount)}</td>
          <td>${esc(c.email || '')}</td>
          <td>${last ? `${esc(last.number)} · ${S.periodShort(last.periodY, last.periodM)}` : '<span class="muted">—</span>'}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">No clients yet. <button class="link-btn" data-action="new-client">Add the first client</button></div>'}</div>`;
  }

  function viewClient(id) {
    const c = clientById(id);
    if (!c) { main.innerHTML = '<div class="empty">Client not found.</div>'; return; }
    const invs = state.db.invoices.filter((i) => i.clientId === id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const billed = invs.filter((i) => i.status !== 'Cancelled').reduce((a, i) => a + S.invoiceTotal(i), 0);
    const out = invs.filter((i) => i.status === 'Sent').reduce((a, i) => a + S.invoiceTotal(i), 0);
    main.innerHTML = `
      <div class="page-head">
        <div><div class="eyebrow">${kindLabel(c.billing)} · ${c.entity === 'individual' ? 'Individual' : 'Business entity'}${c.active === false ? ' · inactive' : ''}</div><h1>${esc(c.name)}</h1></div>
        <div class="row">
          <button class="btn" data-action="edit-client" data-id="${c.id}">Edit client</button>
          ${c.billing !== 'case' ? `<a class="btn" href="#/new-invoice?client=${c.id}&kind=case">+ Case invoice</a><a class="btn primary" href="#/new-invoice?client=${c.id}&kind=retainer">+ Retainer invoice</a>` : `<a class="btn primary" href="#/new-invoice?client=${c.id}&kind=case">+ New invoice</a>`}
        </div>
      </div>
      <div class="stats">
        ${c.billing !== 'case' ? `<div class="stat"><div class="n">${S.inr0(c.retainerAmount)}</div><div class="l">Monthly retainer</div></div>` : ''}
        <div class="stat"><div class="n">${invs.length}</div><div class="l">Invoices</div></div>
        <div class="stat"><div class="n">${S.inr0(billed)}</div><div class="l">Total billed</div></div>
        <div class="stat ${out ? 'warn' : ''}"><div class="n">${S.inr0(out)}</div><div class="l">Outstanding</div></div>
      </div>
      <div class="grid2 cards">
        <div class="card">
          <h3>Billing details</h3>
          <dl class="dl">
            <dt>Contact person</dt><dd>${esc(c.contactPerson || '—')}</dd>
            <dt>Phone</dt><dd>${esc(c.phone || '—')}</dd>
            <dt>Invoice email</dt><dd>${esc(c.email || '—')}</dd>
            <dt>CC</dt><dd>${esc(c.cc || '—')}</dd>
            <dt>Email greeting</dt><dd>Dear ${esc(c.salutation || S.emailVars({ billTo: S.billToFromClient(c), periodY: now.y, periodM: now.m, lines: [] }, c, state.st).salutation)},</dd>
            <dt>Address</dt><dd class="pre">${esc(c.address || '—')}</dd>
            <dt>GSTIN</dt><dd>${esc(c.gstin || '—')}</dd>
            ${c.billing !== 'case' ? `<dt>Retainer line</dt><dd>${esc(c.retainerDesc || state.st.retainerDesc)}<br><span class="muted">${esc(c.retainerDetail || state.st.retainerDetail)}</span></dd>` : ''}
          </dl>
        </div>
        <div class="card">
          <h3>Additional comments</h3>
          ${c.comments ? `<div class="pre">${esc(c.comments)}</div>` : '<p class="muted">No comments. Use Edit client to add notes such as scope, agreed terms or billing instructions.</p>'}
        </div>
      </div>
      <div class="card"><h3>Invoices</h3>${invs.length ? invoiceTable(invs, true) : '<div class="empty small">No invoices yet.</div>'}</div>`;
  }

  function clientForm(c) {
    const st = state.st;
    const isCase = c.billing === 'case';
    return `
      <form id="clientForm" class="client-form">
        <div class="seg-row">
          <div class="field"><span>Billing basis</span>
            <div class="seg" role="radiogroup">
              <label><input type="radio" name="billing" value="retainer" ${!isCase ? 'checked' : ''}><span>Monthly retainer</span></label>
              <label><input type="radio" name="billing" value="case" ${isCase ? 'checked' : ''}><span>Case-by-case</span></label>
            </div></div>
          <div class="field"><span>Client type <span class="help">decides the GST note</span></span>
            <div class="seg" role="radiogroup">
              <label><input type="radio" name="entity" value="business" ${c.entity !== 'individual' ? 'checked' : ''}><span>Business entity</span></label>
              <label><input type="radio" name="entity" value="individual" ${c.entity === 'individual' ? 'checked' : ''}><span>Individual</span></label>
            </div></div>
        </div>
        <div class="grid2">
          <label class="field span2">Client / company name <span class="req">*</span><input class="input" name="name" required value="${esc(c.name || '')}" placeholder="e.g. TRISTAR IMMIGRATION"></label>
          <label class="field">Contact person<input class="input" name="contactPerson" value="${esc(c.contactPerson || '')}" placeholder="e.g. Mr. Omkar Singh"></label>
          <label class="field">Phone<input class="input" name="phone" value="${esc(c.phone || '')}" placeholder="+91 99453 93191"></label>
          <label class="field">Invoice email (To) <span class="req">*</span><input class="input" name="email" required value="${esc(c.email || '')}" placeholder="accounts@client.com"></label>
          <label class="field">CC emails <span class="help">optional, separate with commas</span><input class="input" name="cc" value="${esc(c.cc || '')}"></label>
          <label class="field">Email greeting <span class="help">"Dear …," in the email</span><input class="input" name="salutation" value="${esc(c.salutation || '')}" placeholder="e.g. Tristar Team"></label>
          <label class="field">GSTIN <span class="help">optional, printed if given</span><input class="input" name="gstin" value="${esc(c.gstin || '')}"></label>
          <label class="field span2">Address <span class="help">optional, printed under "Billed to"</span><textarea class="input" name="address" rows="2">${esc(c.address || '')}</textarea></label>
        </div>
        <fieldset class="retainer-box" ${isCase ? 'hidden' : ''}>
          <legend>Monthly retainer</legend>
          <div class="grid2">
            <label class="field">Monthly retainer amount (₹) <span class="req">*</span><input class="input" name="retainerAmount" type="number" min="0" step="0.01" value="${c.retainerAmount != null ? esc(c.retainerAmount) : ''}" placeholder="10000"></label>
            <label class="field">Retainer since <span class="help">optional</span><input class="input" name="since" type="month" value="${esc(c.since || '')}"></label>
            <label class="field">Invoice line<input class="input" name="retainerDesc" value="${esc(c.retainerDesc || '')}" placeholder="${esc(st.retainerDesc)}"></label>
            <label class="field">Line detail<input class="input" name="retainerDetail" value="${esc(c.retainerDetail || '')}" placeholder="${esc(st.retainerDetail)}"></label>
          </div>
        </fieldset>
        <label class="field">Additional comments <span class="help">internal, not printed (scope, agreed terms, billing instructions)</span><textarea class="input" name="comments" rows="3">${esc(c.comments || '')}</textarea></label>
        <label class="check-inline"><input type="checkbox" name="active" ${c.active !== false ? 'checked' : ''}> Active client</label>
        <div class="modal-actions">
          ${c.id && clientById(c.id) ? '<button type="button" class="btn danger" data-action="delete-client" data-id="' + c.id + '">Delete</button><span class="grow"></span>' : ''}
          <button type="button" class="btn" data-action="close-modal">Cancel</button><button class="btn primary" type="submit">Save client</button>
        </div>
      </form>`;
  }

  function openClientForm(existing) {
    const c = existing ? clone(existing) : { billing: 'retainer', entity: 'business', active: true };
    openModal(existing ? 'Edit client' : 'Add client', clientForm(c), (body) => {
      const form = $('#clientForm', body);
      form.addEventListener('change', (e) => {
        if (e.target.name === 'billing') $('.retainer-box', form).hidden = e.target.value === 'case';
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const out = Object.assign(c, {
          id: c.id || S.uid('cl'),
          billing: fd.get('billing'), entity: fd.get('entity'),
          name: fd.get('name').trim(), contactPerson: fd.get('contactPerson').trim(), phone: fd.get('phone').trim(),
          email: normEmails(fd.get('email')), cc: normEmails(fd.get('cc')), salutation: fd.get('salutation').trim(),
          gstin: fd.get('gstin').trim().toUpperCase(), address: fd.get('address').trim(),
          retainerAmount: fd.get('retainerAmount') === '' ? null : S.round2(fd.get('retainerAmount')),
          since: fd.get('since'), retainerDesc: fd.get('retainerDesc').trim(), retainerDetail: fd.get('retainerDetail').trim(),
          comments: fd.get('comments').trim(), active: !!fd.get('active'),
          updatedAt: new Date().toISOString(),
        });
        if (!out.createdAt) out.createdAt = out.updatedAt;
        if (!validEmails(out.email) || !out.email) return toast('Enter a valid invoice email.', 'bad');
        if (out.cc && !validEmails(out.cc)) return toast('Check the CC emails.', 'bad');
        if (out.billing === 'retainer' && !(out.retainerAmount > 0)) return toast('Enter the monthly retainer amount.', 'bad');
        await busy(form.querySelector('button[type=submit]'), 'Saving…', async () => {
          await state.store.saveClient(out);
          closeModal();
          toast('Client saved.', 'ok');
          renderSidebar();
          if (location.hash === '#/client/' + out.id) viewClient(out.id); else location.hash = '#/client/' + out.id;
        });
      });
    }, true);
  }

  // ---------------- invoice editor ----------------
  function viewNewInvoice(params) {
    const c = params.get('client') ? clientById(params.get('client')) : null;
    const y = Number(params.get('y')) || state.dash.y;
    const m = Number(params.get('m')) || state.dash.m;
    const kind = params.get('kind') || (c && c.billing === 'case' ? 'case' : 'retainer');
    if (kind === 'retainer' && c) {
      const exists = state.db.invoices.find((i) => i.clientId === c.id && i.kind === 'retainer' && i.periodY === y && i.periodM === m && i.status !== 'Cancelled');
      if (exists) toast(`Note: ${exists.number} is already raised for ${c.name} for ${S.periodShort(y, m)}.`);
    }
    const inv = S.newInvoice(c, state.st, { y, m, kind });
    renderEditor(inv, true);
  }
  function viewInvoiceById(id) {
    const inv = invById(id);
    if (!inv) { main.innerHTML = '<div class="empty">Invoice not found.</div>'; return; }
    renderEditor(clone(inv), false);
  }

  function lockedInv() { const e = state.editing; return e.status !== 'Draft' && !state.unlocked; }

  function renderEditor(inv, isNew) {
    state.editing = inv;
    state.isNew = isNew;
    state.dirty = isNew && !!inv.clientId;
    const st = state.st;
    const locked = lockedInv();
    const clients = state.db.clients.filter((c) => c.active !== false || c.id === inv.clientId).sort((a, b) => a.name.localeCompare(b.name));
    const dis = locked ? 'disabled' : '';
    const s = S.displayStatus(inv, st);
    main.innerHTML = `
      <div class="page-head">
        <div><div class="eyebrow">${isNew ? 'New invoice' : kindLabel(inv.kind)}</div>
          <h1>${inv.number ? esc(inv.number) : 'New invoice'} ${!isNew ? `<span class="status st-${s}">${s}</span>` : ''}</h1>
          ${inv.sentAt ? `<div class="small muted">Sent ${S.fmtDate(inv.sentAt.slice(0, 10))} to ${esc(inv.sentTo)}${inv.payment ? ` · Paid ${S.fmtDate(inv.payment.date)} (₹${S.inr(inv.payment.amount)}${inv.payment.ref ? ', ' + esc(inv.payment.ref) : ''})` : ''}</div>` : ''}
        </div>
        <div class="row">
          ${locked && inv.status !== 'Cancelled' ? '<button class="btn" data-action="unlock">Edit</button>' : ''}
          ${!locked ? '<button class="btn" data-action="save-invoice">Save</button>' : ''}
          <button class="btn" data-action="download-pdf">Download PDF</button>
          ${inv.status === 'Sent' ? '<button class="btn gold" data-action="mark-paid">✓ Mark as paid</button>' : ''}
          ${inv.status !== 'Cancelled' ? `<button class="btn primary" data-action="send-invoice">${inv.status === 'Draft' ? 'Send by email' : 'Resend'}</button>` : ''}
          <div class="menu-wrap"><button class="btn" data-action="toggle-menu" aria-haspopup="true">More ▾</button>
            <div class="menu" hidden>
              ${inv.status === 'Paid' ? '<button data-action="mark-unpaid">Mark as unpaid</button>' : ''}
              ${!isNew ? '<button data-action="duplicate">Duplicate</button>' : ''}
              ${!isNew && inv.status !== 'Draft' && inv.status !== 'Cancelled' ? '<button data-action="cancel-invoice" class="danger">Cancel invoice</button>' : ''}
              ${!isNew && inv.status === 'Draft' ? '<button data-action="delete-invoice" class="danger">Delete draft</button>' : ''}
              ${isNew ? '<button data-action="go" data-to="#/">Discard</button>' : ''}
            </div></div>
        </div>
      </div>
      ${locked && inv.status !== 'Cancelled' ? `<p class="notice info">This invoice has been ${inv.status === 'Paid' ? 'paid' : 'sent'}, so it is locked. Click <b>Edit</b> only to correct it, then resend it to the client.</p>` : ''}
      ${inv.status === 'Cancelled' ? `<p class="notice bad">Cancelled${inv.cancelReason ? ': ' + esc(inv.cancelReason) : ''}. The number stays reserved.</p>` : ''}
      <div class="editor">
        <form class="card editor-form" id="invForm" autocomplete="off">
          <div class="group-title">Client and month</div>
          <label class="field">Client <span class="req">*</span>
            <select class="input" name="clientId" ${dis}><option value="">Choose a client…</option>${clients.map((c) => `<option value="${c.id}"${c.id === inv.clientId ? ' selected' : ''}>${esc(c.name)}${c.billing === 'case' ? ' (case-by-case)' : ''}</option>`).join('')}</select>
          </label>
          <div class="field"><span>Invoice type</span>
            <div class="seg"><label><input type="radio" name="kind" value="retainer" ${inv.kind === 'retainer' ? 'checked' : ''} ${dis}><span>Monthly retainer</span></label><label><input type="radio" name="kind" value="case" ${inv.kind === 'case' ? 'checked' : ''} ${dis}><span>Case-by-case</span></label></div>
          </div>
          <div class="grid2">
            <div class="field"><span>Billing month</span><div class="row nowrap">${monthSelect('periodM', inv.periodM).replace('<select', `<select ${dis}`)}${yearSelect('periodY', inv.periodY).replace('<select', `<select ${dis}`)}</div></div>
            <label class="field">Invoice date<input class="input" type="date" name="date" value="${esc(inv.date)}" required ${dis}></label>
          </div>
          <label class="field">Invoice number <span class="help">${inv.number ? 'change only if needed' : 'given automatically when saved'}</span><input class="input" name="number" value="${esc(inv.number || '')}" placeholder="${esc(S.nextNumber(state.db.invoices, inv, st))}" ${dis}></label>

          <details class="billto" ${!inv.clientId ? '' : ''}>
            <summary>Billed to <span class="muted small">(from the client record; edit for this invoice only)</span></summary>
            <div id="billToFields">${billToFields(inv, dis)}</div>
          </details>

          <div class="group-title spread"><span>Lines and amounts</span><span class="muted small" id="lineTotal">Total ₹${S.inr(S.invoiceTotal(inv))}</span></div>
          <div id="lines">${linesHtml(inv, dis)}</div>
          ${!locked ? `<div class="row"><button type="button" class="btn small" data-action="add-line">+ Add line</button>${inv.kind === 'retainer' ? '<button type="button" class="btn small ghost" data-action="add-retainer-line">+ Retainer line</button>' : ''}</div>` : ''}

          <div class="group-title">Printed on the invoice</div>
          <label class="field">Payment due text<input class="input" name="dueText" value="${esc(inv.dueText || '')}" placeholder="${esc(S.dueText(Object.assign({}, inv, { dueText: '' }), st))}" ${dis}></label>
          <label class="field">Note on invoice <span class="help">optional, printed below the table</span><textarea class="input" name="notes" rows="2" ${dis}>${esc(inv.notes || '')}</textarea></label>
          <label class="field">GST note
            <select class="input" name="gstMode" ${dis}>
              ${[['auto', 'Automatic (by client type)'], ['rcm', 'Reverse charge (business entity)'], ['exempt', 'Exempt (individual / non-business)'], ['custom', 'Custom text'], ['none', 'No GST note']].map(([v, l]) => `<option value="${v}"${(inv.gstMode || 'auto') === v ? ' selected' : ''}>${l}</option>`).join('')}
            </select></label>
          <label class="field" ${inv.gstMode === 'custom' ? '' : 'hidden'} id="gstCustomWrap">Custom GST note<textarea class="input" name="gstCustom" rows="3" ${dis}>${esc(inv.gstCustom || '')}</textarea></label>

          <div class="group-title">Internal</div>
          <label class="field">Internal note <span class="help">not printed</span><textarea class="input" name="internalNote" rows="2">${esc(inv.internalNote || '')}</textarea></label>
          ${(inv.history || []).length ? `<div class="group-title">History</div><ul class="history">${inv.history.slice().reverse().map((h) => `<li><span>${esc(h.what)}</span><span class="muted small">${new Date(h.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}${h.by ? ' · ' + esc(h.by) : ''}</span></li>`).join('')}</ul>` : ''}
        </form>
        <div class="preview-col"><div class="preview-scale" id="previewScale"><div id="preview"></div></div></div>
      </div>`;
    updatePreview();
    fitPreview();
    const form = $('#invForm');
    form.addEventListener('input', onEditorInput);
    form.addEventListener('change', onEditorChange);
  }

  function billToFields(inv, dis) {
    const b = inv.billTo || {};
    return `<div class="grid2">
      <label class="field span2">Name<input class="input" data-bt="name" value="${esc(b.name || '')}" ${dis}></label>
      <label class="field">Contact person<input class="input" data-bt="contact" value="${esc(b.contact || '')}" ${dis}></label>
      <label class="field">Phone<input class="input" data-bt="phone" value="${esc(b.phone || '')}" ${dis}></label>
      <label class="field">Email<input class="input" data-bt="email" value="${esc(b.email || '')}" ${dis}></label>
      <label class="field">GSTIN<input class="input" data-bt="gstin" value="${esc(b.gstin || '')}" ${dis}></label>
      <label class="field span2">Address<textarea class="input" data-bt="address" rows="2" ${dis}>${esc(b.address || '')}</textarea></label>
    </div>
    ${!dis && inv.clientId ? '<button type="button" class="link-btn small" data-action="refresh-billto">Reload from client record</button>' : ''}`;
  }

  function linesHtml(inv, dis) {
    return (inv.lines || []).map((l, i) => `
      <div class="line" data-i="${i}">
        <div class="line-head"><span class="line-no">${i + 1}</span>${!dis && inv.lines.length > 1 ? `<button type="button" class="icon-btn small" data-action="remove-line" data-i="${i}" aria-label="Remove line ${i + 1}">×</button>` : ''}</div>
        <label class="field">Description<input class="input" data-l="desc" value="${esc(l.desc || '')}" placeholder="${inv.kind === 'case' ? 'e.g. Professional fee – drafting of sale deed' : 'Legal Retainer Fee - Monthly'}" ${dis}></label>
        <label class="field">Detail <span class="help">optional second line</span><input class="input" data-l="detail" value="${esc(l.detail || '')}" ${dis}></label>
        <div class="grid2">
          <label class="field">Month billed for<input class="input" data-l="period" value="${esc(l.period || '')}" ${dis}></label>
          <label class="field">Amount (₹)<input class="input num" data-l="amount" type="number" step="0.01" value="${l.amount === '' || l.amount == null ? '' : esc(l.amount)}" ${dis}></label>
        </div>
      </div>`).join('');
  }

  function readForm() {
    const inv = state.editing;
    const form = $('#invForm');
    if (!form) return inv;
    const v = (n) => { const el = form.elements[n]; return el ? el.value : undefined; };
    inv.date = v('date');
    inv.number = (v('number') || '').trim();
    inv.dueText = (v('dueText') || '').trim();
    inv.notes = v('notes') || '';
    inv.gstMode = v('gstMode');
    inv.gstCustom = v('gstCustom') || '';
    inv.internalNote = v('internalNote') || '';
    inv.billTo = inv.billTo || {};
    $$('[data-bt]', form).forEach((el) => { inv.billTo[el.dataset.bt] = el.value; });
    $$('#lines .line', form).forEach((row) => {
      const l = inv.lines[Number(row.dataset.i)];
      if (!l) return;
      $$('[data-l]', row).forEach((el) => { l[el.dataset.l] = el.dataset.l === 'amount' ? (el.value === '' ? '' : Number(el.value)) : el.value; });
    });
    return inv;
  }

  const onEditorInput = () => {
    readForm();
    state.dirty = true;
    $('#lineTotal').textContent = 'Total ₹' + S.inr(S.invoiceTotal(state.editing));
    updatePreviewSoon();
  };
  function onEditorChange(e) {
    const inv = state.editing;
    const t = e.target;
    readForm();
    state.dirty = true;
    if (t.name === 'clientId') {
      const c = clientById(t.value);
      inv.clientId = t.value;
      if (c) {
        inv.billTo = S.billToFromClient(c);
        inv.kind = c.billing === 'case' ? 'case' : inv.kind;
        if (inv.kind === 'retainer') replaceRetainerLine(inv, c);
      }
      return renderEditorKeep();
    }
    if (t.name === 'kind') {
      inv.kind = t.value;
      const c = clientById(inv.clientId);
      if (inv.kind === 'retainer' && c) replaceRetainerLine(inv, c);
      if (inv.kind === 'case') inv.lines = inv.lines.filter((l) => !l.retainer);
      if (!inv.lines.length) inv.lines.push({ id: S.uid('ln'), desc: '', detail: '', period: S.periodShort(inv.periodY, inv.periodM), amount: '' });
      return renderEditorKeep();
    }
    if (t.name === 'periodM' || t.name === 'periodY') {
      const old = S.periodShort(inv.periodY, inv.periodM);
      inv.periodM = Number($('#invForm').elements.periodM.value);
      inv.periodY = Number($('#invForm').elements.periodY.value);
      const nw = S.periodShort(inv.periodY, inv.periodM);
      inv.lines.forEach((l) => { if (!l.period || l.period === old) l.period = nw; });
      $('#lines').innerHTML = linesHtml(inv, '');
    }
    if (t.name === 'gstMode') $('#gstCustomWrap').hidden = t.value !== 'custom';
    if (t.name === 'date' && !invById(inv.id)) $('#invForm').elements.number.placeholder = S.nextNumber(state.db.invoices, inv, state.st);
    $('#lineTotal').textContent = 'Total ₹' + S.inr(S.invoiceTotal(inv));
    updatePreview();
  }
  function replaceRetainerLine(inv, c) {
    const rl = Object.assign(S.retainerLine(c, state.st, inv.periodY, inv.periodM), { retainer: true });
    const i = inv.lines.findIndex((l) => l.retainer);
    if (i >= 0) inv.lines[i] = rl;
    else {
      const blank = inv.lines.findIndex((l) => !l.desc && !Number(l.amount));
      if (blank >= 0) inv.lines[blank] = rl; else inv.lines.unshift(rl);
    }
  }
  function renderEditorKeep() {
    const dirty = state.dirty;
    const open = $('details.billto') && $('details.billto').open;
    renderEditor(state.editing, state.isNew);
    state.dirty = dirty;
    if (open) $('details.billto').open = true;
  }

  // ---------------- preview ----------------
  let pvTimer;
  function updatePreviewSoon() { clearTimeout(pvTimer); pvTimer = setTimeout(updatePreview, 120); }
  function updatePreview() {
    const el = $('#preview');
    if (!el) return;
    const inv = state.editing;
    el.innerHTML = previewHtml(inv, clientById(inv.clientId), state.st);
  }
  function fitPreview() {
    const wrap = $('#previewScale');
    if (!wrap) return;
    const w = wrap.clientWidth;
    const sc = Math.min(1, w / 595);
    wrap.style.setProperty('--sc', sc);
    wrap.style.height = Math.ceil(842 * sc) + 'px';
  }
  window.addEventListener('resize', debounce(fitPreview, 100));

  function previewHtml(inv, client, st) {
    const b = inv.billTo || {};
    const billLines = [];
    if (b.name) billLines.push(b.entity === 'individual' ? b.name : String(b.name).toUpperCase());
    if (b.contact) billLines.push(b.contact.replace(/,\s*$/, '') + ',');
    if (b.address) String(b.address).split('\n').filter(Boolean).forEach((a) => billLines.push(a));
    if (b.phone) billLines.push('Phone: ' + b.phone);
    if (b.email) billLines.push('Email: ' + b.email);
    if (b.gstin) billLines.push('GSTIN: ' + b.gstin);
    const lines = (inv.lines || []).filter((l) => l.desc || l.detail || Number(l.amount));
    const bk = st.bank || {};
    const pay = [S.dueText(inv, st), 'Please make payment via bank transfer to:'];
    if (bk.accountName) pay.push('Account Name – ' + bk.accountName);
    if (bk.accountNo) pay.push('Account No – ' + bk.accountNo);
    if (bk.branch) pay.push('Branch – ' + bk.branch);
    if (bk.ifsc) pay.push('IFSC Code – ' + bk.ifsc);
    if (bk.bankName) pay.push('Bank – ' + bk.bankName);
    if (bk.upi) pay.push('UPI – ' + bk.upi);
    const gst = S.gstNote(inv, client, st);
    return `<div class="inv-paper">
      <img class="inv-wm" src="assets/brand/shield.png" alt="">
      <div class="inv-head"><img src="assets/brand/logo-wide.png" alt="SAFE Legal Solutions"><div class="inv-addr">${(st.addressLines || []).map(esc).join('<br>')}</div></div>
      <div class="inv-rule"></div>
      <div class="inv-body">
        <div class="inv-title">INVOICE</div>
        <div class="inv-meta"><div><div class="lbl">INVOICE NUMBER:</div><div>${esc(inv.number || 'DRAFT')}</div></div><div class="r"><div class="lbl">INVOICE DATE:</div><div>${esc(S.fmtDateLong(inv.date))}</div></div></div>
        <div class="lbl mt8">BILLED TO:</div>
        <div class="inv-bill">${billLines.map(esc).join('<br>') || '<span class="ph">Choose a client</span>'}</div>
        <div class="lbl mt18">SERVICE PROVIDED:</div>
        <table class="inv-table"><thead><tr><th>Description</th><th>Month<br>Billed for</th><th>Amount(Rs)</th></tr></thead>
          <tbody>${lines.length ? lines.map((l) => `<tr><td>${esc(l.desc)}${l.detail ? '<br>' + esc(l.detail) : ''}</td><td>${esc(l.period || '')}</td><td>${S.inr(l.amount)}</td></tr>`).join('') : '<tr><td colspan="3" class="ph">Add a line</td></tr>'}
          <tr class="tot"><td colspan="2">TOTAL AMOUNT:</td><td>${S.inr(S.invoiceTotal(inv))}</td></tr></tbody></table>
        ${st.showAmountInWords ? `<div class="inv-words">Amount in words: ${esc(S.amountInWords(S.invoiceTotal(inv)))}</div>` : ''}
        ${inv.notes ? `<div class="inv-notes">${esc(inv.notes)}</div>` : ''}
        <div class="lbl big mt14">PAYMENT DETAILS</div>
        <div class="inv-pay">${pay.map(esc).join('<br>')}</div>
      </div>
      <div class="inv-foot">
        ${gst ? `<div class="inv-gst">${esc(gst)}</div>` : ''}
        ${st.thankYou ? `<div class="inv-thanks">${esc(st.thankYou)}</div>` : ''}
        <div class="inv-rule"></div>
        <div class="inv-fl">${esc(st.footerLine1)}<br>${esc(st.footerLine2)}</div>
        <div class="inv-fl2"><span>${st.footerEmail ? 'Email: ' + esc(st.footerEmail) : ''}</span><span>${st.footerWeb ? 'Web: ' + esc(st.footerWeb) : ''}</span></div>
      </div>
    </div>`;
  }

  // ---------------- invoice actions ----------------
  function validateInvoice(inv) {
    if (!inv.clientId) throw new Error('Choose a client.');
    if (!inv.date) throw new Error('Enter the invoice date.');
    const real = inv.lines.filter((l) => l.desc || l.detail || Number(l.amount));
    if (!real.length) throw new Error('Add at least one line.');
    if (real.some((l) => !l.desc && !l.detail)) throw new Error('Each line needs a description.');
    if (real.some((l) => l.amount === '' || isNaN(Number(l.amount)))) throw new Error('Each line needs an amount.');
    if (!(S.invoiceTotal(inv) > 0)) throw new Error('The total must be more than zero.');
    if (inv.number && !/^[A-Za-z0-9/_.-]+$/.test(inv.number)) throw new Error('The invoice number can contain only letters, numbers, - / _ and .');
  }

  async function saveEditing(quiet) {
    const inv = readForm();
    validateInvoice(inv);
    inv.lines = inv.lines.filter((l) => l.desc || l.detail || Number(l.amount)).map((l) => Object.assign(l, { amount: S.round2(l.amount) }));
    const wasNew = !invById(inv.id);
    if (wasNew) inv.history = (inv.history || []).concat(hist('Created'));
    else if (state.unlocked && inv.status !== 'Draft') inv.history = (inv.history || []).concat(hist('Edited after ' + inv.status.toLowerCase()));
    inv.total = S.invoiceTotal(inv);
    const saved = await state.store.saveInvoice(clone(inv));
    state.editing = clone(saved);
    state.dirty = false;
    if (!quiet) toast('Invoice ' + saved.number + ' saved.', 'ok');
    const h = '#/invoice/' + saved.id;
    if (location.hash !== h) { state.lastHash = h; history.replaceState(null, '', h); }
    state.isNew = false;
    renderSidebar();
    return saved;
  }

  async function ensureSaved() {
    if (state.dirty || state.isNew || !invById(state.editing.id)) {
      if (lockedInv() && !state.dirty) return state.editing;
      return saveEditing(true);
    }
    return state.editing;
  }

  async function makePdf(inv) {
    const bytes = await S.buildInvoicePdf(inv, clientById(inv.clientId), state.st);
    return bytes;
  }

  function composeEmail(inv, c) {
    const st = state.st;
    const e = st.email;
    const vars = S.emailVars(inv, c, st);
    const subject = S.fillTemplate(inv.kind === 'case' ? e.subjectCase : e.subjectRetainer, vars);
    const body = S.fillTemplate(inv.kind === 'case' ? e.bodyCase : e.bodyRetainer, vars);
    const to = (inv.billTo && inv.billTo.email) || (c && c.email) || '';
    const cc = [c && c.cc, e.cc].filter(Boolean).join(', ');
    return { to, cc, bcc: e.bcc || '', subject, body };
  }

  async function doSend(inv, c, p) {
    const bytes = await makePdf(inv);
    const mail = S.buildEmail(p.body, state.st.email.signature);
    const updated = await state.store.sendInvoice({
      invoiceId: inv.id, to: p.to, cc: p.cc, bcc: p.bcc, subject: p.subject,
      textBody: mail.text, htmlBody: mail.html,
      pdfBase64: S.pdfToBase64(bytes), fileName: S.pdfFileName(inv),
      by: state.user ? state.user.name || state.user.email : '',
    });
    return updated;
  }

  function openSendModal(inv) {
    const c = clientById(inv.clientId);
    const p = composeEmail(inv, c);
    const e = state.st.email;
    const google = state.store.mode === 'google';
    openModal(inv.status === 'Draft' ? 'Send invoice by email' : 'Resend invoice', `
      <form id="sendForm" class="send-form">
        <div class="kv"><span>From</span><b>${esc(e.fromName)} &lt;${esc(e.fromEmail)}&gt;</b></div>
        <label class="field">To <span class="req">*</span><input class="input" name="to" value="${esc(p.to)}" required></label>
        <div class="grid2">
          <label class="field">CC<input class="input" name="cc" value="${esc(p.cc)}"></label>
          <label class="field">BCC<input class="input" name="bcc" value="${esc(p.bcc)}"></label>
        </div>
        <label class="field">Subject<input class="input" name="subject" value="${esc(p.subject)}" required></label>
        <label class="field">Message<textarea class="input mono" name="body" rows="10">${esc(p.body)}</textarea></label>
        <div class="field"><span>Signature <span class="help">change it in Settings → Email</span></span><div class="sig-preview">${S.textToEmailHtml(e.signature)}</div></div>
        <div class="kv"><span>Attachment</span><span class="attach">📎 ${esc(S.pdfFileName(inv))}</span></div>
        ${!google ? '<p class="notice warn">Demo mode cannot send email. The button below downloads the PDF and opens your email app with this message; attach the PDF there.</p>' : ''}
        ${inv.status !== 'Draft' ? `<p class="notice info small">Already sent ${inv.sentAt ? S.fmtDate(inv.sentAt.slice(0, 10)) : ''} to ${esc(inv.sentTo || '')}. This sends it again.</p>` : ''}
        <div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Cancel</button>
          <button class="btn primary" type="submit">${google ? 'Send email' : 'Download PDF and open email app'}</button></div>
      </form>`, (body) => {
      $('#sendForm', body).addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.target);
        const pp = { to: normEmails(fd.get('to')), cc: normEmails(fd.get('cc')), bcc: normEmails(fd.get('bcc')), subject: fd.get('subject').trim(), body: fd.get('body') };
        if (!pp.to || !validEmails(pp.to)) return toast('Check the To address.', 'bad');
        if ((pp.cc && !validEmails(pp.cc)) || (pp.bcc && !validEmails(pp.bcc))) return toast('Check the CC/BCC addresses.', 'bad');
        await busy(ev.target.querySelector('button[type=submit]'), google ? 'Sending…' : 'Preparing…', async () => {
          if (google) {
            const updated = await doSend(state.editing, c, pp);
            closeModal();
            toast(`Invoice ${updated.number} sent to ${pp.to}.`, 'ok');
            renderEditor(clone(updated), false);
          } else {
            const bytes = await makePdf(state.editing);
            S.downloadBytes(bytes, S.pdfFileName(state.editing));
            const mail = S.buildEmail(pp.body, e.signature);
            const href = `mailto:${encodeURIComponent(pp.to)}?subject=${encodeURIComponent(pp.subject)}${pp.cc ? '&cc=' + encodeURIComponent(pp.cc) : ''}&body=${encodeURIComponent(mail.text)}`;
            window.location.href = href;
            closeModal();
            setTimeout(() => {
              if (confirm('Did you send the email? Click OK to mark the invoice as sent.')) markSentLocally(pp);
            }, 1200);
          }
        });
      });
    }, true);
  }

  async function markSentLocally(pp) {
    const inv = state.editing;
    inv.status = inv.status === 'Paid' ? 'Paid' : 'Sent';
    inv.sentAt = new Date().toISOString();
    inv.sentTo = pp.to;
    inv.history = (inv.history || []).concat(hist('Marked as sent to ' + pp.to));
    const saved = await state.store.saveInvoice(clone(inv));
    renderEditor(clone(saved), false);
  }

  function openPaidModal(inv, onDone) {
    openModal('Mark as paid', `
      <p><b>${esc(inv.number || '')}</b> · ${esc((inv.billTo && inv.billTo.name) || '')} · ₹${S.inr(S.invoiceTotal(inv))}</p>
      <form id="paidForm">
        <div class="grid2">
          <label class="field">Date received<input class="input" type="date" name="date" value="${S.today()}" required></label>
          <label class="field">Amount received (₹)<input class="input" type="number" step="0.01" name="amount" value="${S.invoiceTotal(inv)}" required></label>
          <label class="field span2">Reference <span class="help">UTR / cheque no. / mode</span><input class="input" name="ref"></label>
        </div>
        <div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Cancel</button><button class="btn primary" type="submit">Mark as paid</button></div>
      </form>`, (body) => {
      $('#paidForm', body).addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        await busy(e.target.querySelector('button[type=submit]'), 'Saving…', async () => {
          const x = clone(invById(inv.id));
          x.status = 'Paid';
          x.payment = { date: fd.get('date'), amount: S.round2(fd.get('amount')), ref: fd.get('ref').trim() };
          x.history = (x.history || []).concat(hist(`Marked paid (₹${S.inr(x.payment.amount)}${x.payment.ref ? ', ' + x.payment.ref : ''})`));
          const saved = await state.store.saveInvoice(x);
          closeModal();
          toast('Marked as paid.', 'ok');
          if (onDone) onDone(saved); else renderEditor(clone(saved), false);
        });
      });
    });
  }

  // ---------------- settings ----------------
  function viewSettings() {
    const st = state.st;
    const google = state.store.mode === 'google';
    const admin = isAdmin();
    const tabs = [['invoice', 'Invoice and letterhead'], ['bank', 'Bank and payment'], ['email', 'Email'], ['connection', 'Connection and backup']];
    if (google) tabs.push(['team', 'Team'], ['account', 'My account']);
    if (!tabs.some((t) => t[0] === state.settingsTab)) state.settingsTab = 'invoice';
    const tab = state.settingsTab;
    const ro = !admin && ['invoice', 'bank', 'email'].includes(tab) ? 'disabled' : '';
    let body = '';
    if (tab === 'invoice') {
      body = `<form id="setForm" class="card stack">
        <div class="grid2">
          <label class="field">Firm name<input class="input" name="firmName" value="${esc(st.firmName)}" ${ro}></label>
          <label class="field">Invoice number prefix <span class="help">numbers look like ${esc(st.invoicePrefix)}-202609-004</span><input class="input" name="invoicePrefix" value="${esc(st.invoicePrefix)}" ${ro}></label>
          <label class="field span2">Letterhead address (top right) <span class="help">one line per row</span><textarea class="input" name="addressLines" rows="3" ${ro}>${esc(st.addressLines.join('\n'))}</textarea></label>
          <label class="field">Footer line 1<input class="input" name="footerLine1" value="${esc(st.footerLine1)}" ${ro}></label>
          <label class="field">Footer line 2<input class="input" name="footerLine2" value="${esc(st.footerLine2)}" ${ro}></label>
          <label class="field">Footer email<input class="input" name="footerEmail" value="${esc(st.footerEmail)}" ${ro}></label>
          <label class="field">Footer website<input class="input" name="footerWeb" value="${esc(st.footerWeb)}" ${ro}></label>
          <label class="field">Default retainer line<input class="input" name="retainerDesc" value="${esc(st.retainerDesc)}" ${ro}></label>
          <label class="field">Default retainer line detail<input class="input" name="retainerDetail" value="${esc(st.retainerDetail)}" ${ro}></label>
          <label class="field span2">GST note – business entity (reverse charge)<textarea class="input" name="gstNoteBusiness" rows="3" ${ro}>${esc(st.gstNoteBusiness)}</textarea></label>
          <label class="field span2">GST note – individual (exempt)<textarea class="input" name="gstNoteIndividual" rows="2" ${ro}>${esc(st.gstNoteIndividual)}</textarea></label>
          <label class="field">Closing line<input class="input" name="thankYou" value="${esc(st.thankYou)}" ${ro}></label>
          <label class="check-inline"><input type="checkbox" name="showAmountInWords" ${st.showAmountInWords ? 'checked' : ''} ${ro}> Print amount in words</label>
        </div>
        ${saveBar(ro)}
      </form>`;
    } else if (tab === 'bank') {
      const bk = st.bank;
      body = `<form id="setForm" class="card stack">
        <div class="grid2">
          <label class="field">Account name<input class="input" name="bank.accountName" value="${esc(bk.accountName)}" ${ro}></label>
          <label class="field">Account number<input class="input" name="bank.accountNo" value="${esc(bk.accountNo)}" ${ro}></label>
          <label class="field">Branch<input class="input" name="bank.branch" value="${esc(bk.branch)}" ${ro}></label>
          <label class="field">IFSC code<input class="input" name="bank.ifsc" value="${esc(bk.ifsc)}" ${ro}></label>
          <label class="field">Bank<input class="input" name="bank.bankName" value="${esc(bk.bankName)}" ${ro}></label>
          <label class="field">UPI ID <span class="help">optional</span><input class="input" name="bank.upi" value="${esc(bk.upi || '')}" ${ro}></label>
          <label class="field">Retainer payment due by (day of month)<input class="input" type="number" min="1" max="28" name="retainerDueDay" value="${esc(st.retainerDueDay)}" ${ro}></label>
          <label class="field">Retainer due text (printed)<input class="input" name="dueRetainerText" value="${esc(st.dueRetainerText)}" ${ro}></label>
          <label class="field">Case-by-case: days to pay<input class="input" type="number" min="0" max="120" name="caseDueDays" value="${esc(st.caseDueDays)}" ${ro}></label>
          <label class="field">Case-by-case due text (printed) <span class="help">{days} = days to pay</span><input class="input" name="dueCaseText" value="${esc(st.dueCaseText)}" ${ro}></label>
        </div>
        ${saveBar(ro)}
      </form>`;
    } else if (tab === 'email') {
      const e = st.email;
      const fromOpts = (state.store.fromOptions || []);
      body = `<form id="setForm" class="card stack">
        ${google && fromOpts.length && !fromOpts.map((x) => x.toLowerCase()).includes(String(e.fromEmail).toLowerCase()) ? `<p class="notice bad">The backend's Google account cannot send as <b>${esc(e.fromEmail)}</b> yet. It can send as: ${fromOpts.map(esc).join(', ')}. See README → "Send from operations@safelegal.org".</p>` : ''}
        <div class="grid2">
          <label class="field">Send from<input class="input" name="email.fromEmail" value="${esc(e.fromEmail)}" ${ro}></label>
          <label class="field">Sender name<input class="input" name="email.fromName" value="${esc(e.fromName)}" ${ro}></label>
          <label class="field">Reply-to<input class="input" name="email.replyTo" value="${esc(e.replyTo)}" ${ro}></label>
          <label class="field">Always CC <span class="help">optional</span><input class="input" name="email.cc" value="${esc(e.cc)}" ${ro}></label>
          <label class="field">Always BCC <span class="help">optional, e.g. for SAFE's records</span><input class="input" name="email.bcc" value="${esc(e.bcc)}" ${ro}></label>
        </div>
        <p class="small muted">Placeholders: <code>{salutation}</code> <code>{period}</code> (September'2026) <code>{periodShort}</code> (Sept'2026) <code>{month}</code> <code>{year}</code> <code>{invoiceNo}</code> <code>{invoiceDate}</code> <code>{amount}</code> <code>{dueDate}</code> <code>{dueText}</code> <code>{clientName}</code>. The month and year follow the invoice's billing month.</p>
        <h3>Monthly retainer email</h3>
        <label class="field">Subject<input class="input" name="email.subjectRetainer" value="${esc(e.subjectRetainer)}" ${ro}></label>
        <label class="field">Message<textarea class="input mono" name="email.bodyRetainer" rows="9" ${ro}>${esc(e.bodyRetainer)}</textarea></label>
        <h3>Case-by-case email</h3>
        <label class="field">Subject<input class="input" name="email.subjectCase" value="${esc(e.subjectCase)}" ${ro}></label>
        <label class="field">Message<textarea class="input mono" name="email.bodyCase" rows="9" ${ro}>${esc(e.bodyCase)}</textarea></label>
        <h3>Signature</h3>
        <label class="field">Signature <span class="help">emails and websites become links</span><textarea class="input mono" name="email.signature" rows="8" ${ro}>${esc(e.signature)}</textarea></label>
        ${saveBar(ro)}
        ${google ? `<div class="row"><input class="input" id="testTo" type="email" placeholder="Send a test email to…" style="max-width:300px"><button type="button" class="btn" data-action="test-email">Send test email</button></div>` : ''}
      </form>`;
    } else if (tab === 'connection') {
      const conn = S.getConnection();
      body = `<div class="card stack">
        <h3>Where the data is kept</h3>
        <p>${google ? `Connected to the Google backend. Data is on SAFE's Google Drive, and emails go out from ${esc(st.email.fromEmail)}.` : 'Demo mode: data is kept in this browser only and emails cannot be sent.'}</p>
        <form id="connForm" class="row">
          <input class="input" name="url" type="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(conn.url || '')}" style="flex:1;min-width:260px">
          <button class="btn primary" type="submit">${google ? 'Update' : 'Connect'}</button>
          ${google ? '' : ''}
        </form>
        ${google ? '<button class="btn small" data-action="demo-mode">Switch this browser to demo mode</button>' : ''}
        <h3 class="mt">Backup</h3>
        <p class="small muted">Download all clients, invoices and settings as one file. ${google ? 'The backend also keeps a daily backup on Drive.' : ''}</p>
        <div class="row"><button class="btn" data-action="export-json">Download backup (JSON)</button>
          ${admin ? '<label class="btn">Restore from backup<input type="file" accept=".json,application/json" id="importJson" hidden></label>' : ''}</div>
        <p class="small muted">Version ${S.APP_VERSION}</p>
      </div>`;
    } else if (tab === 'team') {
      body = `<div class="card stack" id="teamCard"><div class="empty small">Loading team…</div></div>`;
    } else if (tab === 'account') {
      body = `<div class="card stack"><p>Signed in as <b>${esc(state.user.name || '')}</b> (${esc(state.user.email)}) · ${esc(state.user.role)}</p><div class="row"><a class="btn" href="#/password">Change password</a><button class="btn" data-action="sign-out">Sign out</button></div></div>`;
    }
    main.innerHTML = `
      <div class="page-head"><div><div class="eyebrow">Settings</div><h1>Settings</h1></div></div>
      ${!admin && ro ? '<p class="notice info">Only a SAFE administrator can change these settings.</p>' : ''}
      <div class="tabs">${tabs.map(([k, l]) => `<button class="tab${k === tab ? ' active' : ''}" data-action="set-tab" data-tab="${k}">${l}</button>`).join('')}</div>
      ${body}`;
    const form = $('#setForm');
    if (form) form.addEventListener('submit', saveSettingsForm);
    const cf = $('#connForm');
    if (cf) cf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = new FormData(cf).get('url').trim();
      await busy(cf.querySelector('button'), 'Connecting…', async () => {
        await new S.GoogleStore(url).ping();
        const wasLocal = state.store.mode === 'local';
        let localData = null;
        if (wasLocal && (state.db.clients.length || state.db.invoices.length)) localData = await state.store.exportAll();
        S.setConnection({ mode: 'google', url });
        if (localData) { try { sessionStorage.setItem('safe-invoice-pending-import', localData); } catch (er) { /* ignore */ } }
        toast('Connected. Please sign in.', 'ok');
        location.hash = '#/';
        boot();
      });
    });
    const ij = $('#importJson');
    if (ij) ij.addEventListener('change', async () => {
      const f = ij.files[0];
      if (!f) return;
      if (!confirm('Restore from this backup? It replaces all clients, invoices and settings.')) return;
      await busy(null, '', async () => { await state.store.importAll(await f.text()); await reload(); toast('Backup restored.', 'ok'); viewSettings(); });
    });
    if (tab === 'team') loadTeam();
  }
  function saveBar(ro) { return ro ? '' : '<div class="row end"><button class="btn primary" type="submit">Save settings</button></div>'; }

  async function saveSettingsForm(e) {
    e.preventDefault();
    const form = e.target;
    const s = clone(S.mergeSettings(state.db.settings));
    $$('input[name],textarea[name],select[name]', form).forEach((el) => {
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (el.type === 'number') v = Number(v);
      const [a, b] = el.name.split('.');
      if (b) s[a][b] = v;
      else if (a === 'addressLines') s[a] = String(v).split('\n').map((x) => x.trim()).filter(Boolean);
      else s[a] = v;
    });
    if (!validEmails(s.email.fromEmail)) return toast('Check the "Send from" address.', 'bad');
    await busy(form.querySelector('button[type=submit]'), 'Saving…', async () => {
      await state.store.saveSettings(s);
      state.db.settings = s;
      state.st = S.mergeSettings(s);
      toast('Settings saved.', 'ok');
      viewSettings();
    });
  }

  async function loadTeam() {
    const card = $('#teamCard');
    try {
      const users = await state.store.users();
      const admin = isAdmin();
      card.innerHTML = `
        <div class="spread"><h3>SAFE team members</h3>${admin ? '<button class="btn primary" data-action="add-user">+ Add team member</button>' : ''}</div>
        <p class="small muted">Only these people can sign in. Each person has their own password; a new member gets a temporary password to change at first sign-in.</p>
        <div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>
        ${users.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${u.role === 'admin' ? 'Administrator' : 'Team member'}</td><td>${u.active === false ? '<span class="badge">disabled</span>' : 'Active'}${u.lastLogin ? `<div class="small muted">Last sign-in ${S.fmtDate(u.lastLogin.slice(0, 10))}</div>` : ''}</td>
          <td class="actions">${admin ? `<button class="btn small" data-action="edit-user" data-email="${esc(u.email)}">Edit</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>`;
      state.teamUsers = users;
    } catch (e) { card.innerHTML = `<p class="notice bad">${esc(e.message)}</p>`; }
  }

  function openUserForm(u) {
    const isNew = !u;
    u = u || { role: 'staff', active: true };
    openModal(isNew ? 'Add team member' : 'Edit team member', `
      <form id="userForm">
        <div class="grid2">
          <label class="field">Name<input class="input" name="name" required value="${esc(u.name || '')}"></label>
          <label class="field">Email<input class="input" name="email" type="email" required value="${esc(u.email || '')}" ${isNew ? '' : 'disabled'}></label>
          <label class="field">Role<select class="input" name="role"><option value="staff"${u.role !== 'admin' ? ' selected' : ''}>Team member (clients and invoices)</option><option value="admin"${u.role === 'admin' ? ' selected' : ''}>Administrator (also settings and team)</option></select></label>
          <label class="check-inline"><input type="checkbox" name="active" ${u.active !== false ? 'checked' : ''}> Can sign in</label>
        </div>
        ${!isNew ? '<label class="check-inline"><input type="checkbox" name="reset"> Reset password (a new temporary password is shown once)</label>' : ''}
        <div class="modal-actions">${!isNew ? `<button type="button" class="btn danger" data-action="delete-user" data-email="${esc(u.email)}">Remove</button><span class="grow"></span>` : ''}<button type="button" class="btn" data-action="close-modal">Cancel</button><button class="btn primary" type="submit">Save</button></div>
      </form>`, (body) => {
      $('#userForm', body).addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const out = { name: fd.get('name').trim(), email: isNew ? fd.get('email').trim().toLowerCase() : u.email, role: fd.get('role'), active: !!fd.get('active') };
        await busy(e.target.querySelector('button[type=submit]'), 'Saving…', async () => {
          const r = await state.store.saveUser(out, isNew || !!fd.get('reset'));
          if (r.tempPassword) {
            openModal('Temporary password', `<p>Give these sign-in details to <b>${esc(out.name)}</b>. The password is shown only once; they will choose their own at first sign-in.</p>
              <div class="cred"><div>App: <b>${esc(location.origin + location.pathname)}</b></div><div>Email: <b>${esc(out.email)}</b></div><div>Temporary password: <b class="mono">${esc(r.tempPassword)}</b></div></div>
              <div class="modal-actions"><button class="btn" data-action="copy-cred">Copy</button><button class="btn primary" data-action="close-modal">Done</button></div>`);
          } else closeModal();
          toast('Saved.', 'ok');
          loadTeam();
        });
      });
    });
  }

  // ---------------- global click handler ----------------
  document.addEventListener('click', async (e) => {
    const row = e.target.closest('tr.clickable');
    if (row && !e.target.closest('a,button,input')) { location.hash = row.dataset.href; return; }
    const menuOpen = $('.menu:not([hidden])');
    if (menuOpen && !e.target.closest('.menu-wrap')) menuOpen.hidden = true;
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    if (el.tagName === 'A' && a !== 'go') return;
    if (el.closest('.menu')) el.closest('.menu').hidden = true;
    switch (a) {
      case 'close-modal': return closeModal();
      case 'go': return void (location.hash = el.dataset.to);
      case 'retry': return boot();
      case 'change-connection': S.setConnection({}); return viewWelcome();
      case 'demo-mode':
        if (state.store && state.store.mode === 'google' && !confirm('Switch this browser to demo mode? The shared Google data is not affected.')) return;
        S.setConnection({ mode: 'local' }); location.hash = '#/'; return boot();
      case 'sign-out': if (state.store) await state.store.logout(); state.db = null; return viewLogin();
      case 'new-client': return openClientForm(null);
      case 'edit-client': return openClientForm(clientById(el.dataset.id));
      case 'delete-client':
        if (!confirm('Delete this client? This cannot be undone.')) return;
        return busy(el, 'Deleting…', async () => { await state.store.deleteClient(el.dataset.id); closeModal(); toast('Client deleted.'); location.hash = '#/clients'; renderSidebar(); });
      case 'new-invoice': return void (location.hash = '#/new-invoice?y=' + state.dash.y + '&m=' + state.dash.m + '&t=' + Date.now());
      case 'raise-retainers': return raiseRetainers(null);
      case 'raise-one': return raiseRetainers([el.dataset.client]);
      case 'bulk-send': return bulkSend();
      case 'export-csv': return exportCsv();
      case 'export-json': return S.downloadBytes(new TextEncoder().encode(await state.store.exportAll()), `SAFE invoice studio backup ${S.today()}.json`, 'application/json');
      case 'set-tab': state.settingsTab = el.dataset.tab; return viewSettings();
      case 'toggle-menu': { const m = el.parentElement.querySelector('.menu'); m.hidden = !m.hidden; return; }
      case 'add-line': {
        readForm();
        const inv = state.editing;
        inv.lines.push({ id: S.uid('ln'), desc: '', detail: '', period: S.periodShort(inv.periodY, inv.periodM), amount: '' });
        $('#lines').innerHTML = linesHtml(inv, '');
        state.dirty = true;
        const last = $$('#lines .line').pop();
        if (last) $('[data-l=desc]', last).focus();
        return updatePreview();
      }
      case 'add-retainer-line': {
        readForm();
        const inv = state.editing;
        const c = clientById(inv.clientId);
        if (!c) return toast('Choose a client first.', 'bad');
        inv.lines.push(S.retainerLine(c, state.st, inv.periodY, inv.periodM));
        $('#lines').innerHTML = linesHtml(inv, '');
        state.dirty = true;
        return updatePreview();
      }
      case 'remove-line': {
        readForm();
        state.editing.lines.splice(Number(el.dataset.i), 1);
        $('#lines').innerHTML = linesHtml(state.editing, '');
        state.dirty = true;
        $('#lineTotal').textContent = 'Total ₹' + S.inr(S.invoiceTotal(state.editing));
        return updatePreview();
      }
      case 'refresh-billto': {
        const c = clientById(state.editing.clientId);
        if (!c) return;
        state.editing.billTo = S.billToFromClient(c);
        $('#billToFields').innerHTML = billToFields(state.editing, '');
        state.dirty = true;
        return updatePreview();
      }
      case 'save-invoice': return busy(el, 'Saving…', async () => { await saveEditing(); renderEditor(clone(state.editing), false); });
      case 'unlock': state.unlocked = true; return renderEditorKeep();
      case 'download-pdf': return busy(el, 'Preparing…', async () => {
        const inv = await ensureSaved();
        const bytes = await makePdf(inv);
        S.downloadBytes(bytes, S.pdfFileName(inv));
        if (state.isNew === false && !$('.page-head h1').textContent.includes(inv.number)) renderEditor(clone(inv), false);
      });
      case 'send-invoice': return busy(el, 'Preparing…', async () => {
        const inv = await ensureSaved();
        renderEditor(clone(inv), false);
        openSendModal(state.editing);
      });
      case 'mark-paid': return openPaidModal(state.editing);
      case 'mark-paid-row': { const x = invById(el.dataset.id); if (x) openPaidModal(x, () => route()); return; }
      case 'mark-unpaid': return busy(el, 'Saving…', async () => {
        const x = clone(invById(state.editing.id));
        x.status = 'Sent'; delete x.payment;
        x.history = (x.history || []).concat(hist('Marked as unpaid'));
        renderEditor(clone(await state.store.saveInvoice(x)), false);
      });
      case 'duplicate': {
        const src = state.editing;
        const c = clientById(src.clientId);
        const inv = S.newInvoice(c, state.st, { y: src.periodY, m: src.periodM, kind: src.kind });
        inv.lines = src.lines.map((l) => Object.assign({}, l, { id: S.uid('ln') }));
        inv.billTo = clone(src.billTo || {});
        inv.notes = src.notes; inv.gstMode = src.gstMode; inv.gstCustom = src.gstCustom; inv.dueText = src.dueText;
        history.replaceState(null, '', '#/new-invoice');
        state.lastHash = '#/new-invoice';
        renderEditor(inv, true);
        state.dirty = true;
        return toast('Copy created. Change the month or lines, then save.');
      }
      case 'cancel-invoice': {
        const reason = prompt('Cancel this invoice? The number stays reserved and it will show as cancelled.\n\nReason (optional):');
        if (reason === null) return;
        return busy(el, 'Saving…', async () => {
          const x = clone(invById(state.editing.id));
          x.status = 'Cancelled'; x.cancelReason = reason.trim();
          x.history = (x.history || []).concat(hist('Cancelled' + (reason.trim() ? ': ' + reason.trim() : '')));
          renderEditor(clone(await state.store.saveInvoice(x)), false);
        });
      }
      case 'delete-invoice':
        if (!confirm('Delete this draft invoice?')) return;
        return busy(el, 'Deleting…', async () => { await state.store.deleteInvoice(state.editing.id); state.dirty = false; toast('Draft deleted.'); location.hash = '#/'; });
      case 'test-email': {
        const to = $('#testTo').value.trim();
        if (!validEmails(to) || !to) return toast('Enter an email address for the test.', 'bad');
        return busy(el, 'Sending…', async () => { await state.store.testEmail(to); toast('Test email sent to ' + to + '.', 'ok'); });
      }
      case 'add-user': return openUserForm(null);
      case 'edit-user': return openUserForm((state.teamUsers || []).find((u) => u.email === el.dataset.email));
      case 'delete-user':
        if (!confirm('Remove ' + el.dataset.email + ' from the team?')) return;
        return busy(el, 'Removing…', async () => { await state.store.deleteUser(el.dataset.email); closeModal(); toast('Removed.'); loadTeam(); });
      case 'copy-cred': {
        const t = $('.cred').innerText;
        try { await navigator.clipboard.writeText(t); toast('Copied.', 'ok'); } catch (er) { toast('Select the text and copy it.'); }
        return;
      }
      default: return undefined;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#modal').hidden) closeModal();
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && $('#invForm') && !lockedInv()) {
      e.preventDefault();
      const b = $('[data-action=save-invoice]');
      if (b) b.click();
    }
  });
  $('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(); });
  $('#clientSearch').addEventListener('input', debounce(renderSidebar, 150));
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });

  // after connecting a demo browser to Google, offer to copy the demo data across
  async function maybeImportPending() {
    let pending = null;
    try { pending = sessionStorage.getItem('safe-invoice-pending-import'); } catch (e) { /* ignore */ }
    if (!pending || !state.store || state.store.mode !== 'google' || !isAdmin()) return;
    try { sessionStorage.removeItem('safe-invoice-pending-import'); } catch (e) { /* ignore */ }
    if (state.db.clients.length || state.db.invoices.length) return;
    if (confirm('Copy the clients and invoices from demo mode in this browser to the shared Google data?')) {
      await busy(null, '', async () => { await state.store.importAll(pending); await reload(); toast('Demo data copied.', 'ok'); route(); });
    }
  }
  const _boot = boot;
  boot = async function () { await _boot(); await maybeImportPending(); }; // eslint-disable-line no-func-assign
  boot();
})();
