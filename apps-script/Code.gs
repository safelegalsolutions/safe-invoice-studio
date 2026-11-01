/**
 * SAFE Invoice Studio — Google Apps Script backend.
 *
 * Keeps the data (clients, invoices, settings, team) as one JSON file on Google Drive,
 * saves each sent invoice PDF to Drive, and emails invoices to clients from
 * operations@safelegal.org (or whichever "Send mail as" address is set in Settings).
 *
 * Setup: see README.md → "Set up the Google backend".
 */

var VERSION = '1.0.0';
var DEFAULTS = {
  TZ: 'Asia/Kolkata',
  ROOT: 'SAFE Invoice Studio',
  DB: 'invoice-studio-db.json',
  SESSION_SECS: 21600, // 6 hours (the longest CacheService allows)
  FROM_EMAIL: 'operations@safelegal.org',
  FROM_NAME: 'SAFE Legal Solutions',
  MAX_FAILS: 5,
  LOCK_MINS: 15,
  KEEP_BACKUPS_DAYS: 60,
};

// ---------------------------------------------------------------- setup (run once from the editor)
function setup() {
  getRootFolder_();
  getDbFile_();
  var db = readDb_();
  var me = Session.getEffectiveUser().getEmail();
  if (!db.users.length) {
    var pw = randomPassword_();
    db.users.push(makeUser_(me, 'Administrator', 'admin', pw));
    writeDb_(db);
    Logger.log('FIRST SIGN-IN  →  email: ' + me + '   temporary password: ' + pw);
  } else {
    Logger.log('Team already set up (' + db.users.length + ' member(s)). To reset your own password run resetMyPassword.');
  }
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyBackup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyBackup').timeBased().everyDays(1).atHour(2).inTimezone(DEFAULTS.TZ).create();
  var from = fromOptions_();
  Logger.log('This account can send email as: ' + from.join(', '));
  if (from.map(lower_).indexOf(DEFAULTS.FROM_EMAIL) < 0) {
    Logger.log('NOTE: ' + DEFAULTS.FROM_EMAIL + ' is not available as a "Send mail as" address on ' + me + '. See README → "Send from operations@safelegal.org".');
  }
  Logger.log('Data folder: ' + getRootFolder_().getUrl());
}

/** Run from the editor if the administrator is locked out. Prints a new temporary password. */
function resetMyPassword() {
  var me = lower_(Session.getEffectiveUser().getEmail());
  var db = readDb_();
  var u = findUser_(db, me);
  var pw = randomPassword_();
  if (!u) { u = makeUser_(me, 'Administrator', 'admin', pw); db.users.push(u); }
  else { setPassword_(u, pw); u.mustChange = true; u.active = true; u.role = 'admin'; }
  writeDb_(db);
  CacheService.getScriptCache().remove('fail_' + me);
  Logger.log('Email: ' + me + '   temporary password: ' + pw);
}

// ---------------------------------------------------------------- web entry points
function doGet() {
  return json_({ ok: true, app: 'SAFE Invoice Studio backend', version: VERSION });
}

function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    out = handle_(req);
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err), auth: !!(err && err.auth) };
  }
  return json_(out);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(req) {
  var a = req.action;
  if (a === 'ping') return { ok: true, app: 'SAFE Invoice Studio', version: VERSION };
  if (a === 'login') return login_(req.email, req.password);

  var user = auth_(req.token);
  switch (a) {
    case 'logout':
      CacheService.getScriptCache().remove('s_' + req.token);
      return { ok: true };

    case 'load': {
      var db = readDb_();
      return { ok: true, db: { clients: db.clients, invoices: db.invoices, settings: db.settings }, user: user, fromOptions: fromOptions_() };
    }

    case 'saveClient':
      return withDb_(function (db) {
        var c = req.client || {};
        if (!c.id || !c.name) throw new Error('The client needs a name.');
        c.updatedBy = user.email;
        upsert_(db.clients, c);
        // keep unsent drafts in step with the client's billing details
        db.invoices.forEach(function (i) {
          if (i.clientId === c.id && i.status === 'Draft') i.billTo = billTo_(c);
        });
        return { ok: true, client: c };
      });

    case 'deleteClient':
      return withDb_(function (db) {
        if (db.invoices.some(function (i) { return i.clientId === req.id; })) throw new Error('This client has invoices. Mark the client inactive instead.');
        db.clients = db.clients.filter(function (c) { return c.id !== req.id; });
        return { ok: true };
      });

    case 'saveInvoice':
      return withDb_(function (db) {
        var inv = req.invoice || {};
        if (!inv.id || !inv.clientId) throw new Error('The invoice needs a client.');
        var prev = find_(db.invoices, inv.id);
        if (prev && prev.status !== 'Draft' && inv.status === 'Draft') inv.status = prev.status; // never un-send
        if (prev) { inv.sentAt = inv.sentAt || prev.sentAt; inv.emails = prev.emails; inv.pdfFileId = prev.pdfFileId; inv.pdfUrl = prev.pdfUrl; }
        if (!inv.number) inv.number = nextNumber_(db, inv);
        var dup = db.invoices.filter(function (i) { return i.id !== inv.id && i.number === inv.number; })[0];
        if (dup) throw new Error('Invoice number ' + inv.number + ' is already used.');
        inv.updatedAt = new Date().toISOString();
        inv.updatedBy = user.email;
        upsert_(db.invoices, inv);
        return { ok: true, invoice: inv };
      });

    case 'deleteInvoice':
      return withDb_(function (db) {
        var inv = find_(db.invoices, req.id);
        if (inv && inv.status !== 'Draft') throw new Error('Only drafts can be deleted. Cancel the invoice instead.');
        db.invoices = db.invoices.filter(function (i) { return i.id !== req.id; });
        return { ok: true };
      });

    case 'saveSettings':
      requireAdmin_(user);
      return withDb_(function (db) { db.settings = req.settings || {}; return { ok: true }; });

    case 'sendInvoice':
      return sendInvoice_(req, user);

    case 'savePdf':
      return withDb_(function (db) {
        var inv = find_(db.invoices, req.invoiceId);
        if (!inv) throw new Error('Invoice not found.');
        var file = savePdf_(inv, req.pdfBase64, req.fileName);
        return { ok: true, invoice: inv, url: file.getUrl() };
      });

    case 'testEmail': {
      var st = emailSettings_(readDb_().settings);
      var opts = mailOptions_(st);
      opts.htmlBody = '<p>This is a test email from <b>SAFE Invoice Studio</b>. Invoices will be sent from this address.</p>';
      GmailApp.sendEmail(req.to, 'SAFE Invoice Studio – test email', 'This is a test email from SAFE Invoice Studio.', opts);
      return { ok: true };
    }

    case 'users':
      return { ok: true, users: readDb_().users.map(publicUser_) };

    case 'saveUser':
      requireAdmin_(user);
      return withDb_(function (db) {
        var u = req.user || {};
        var email = lower_(u.email);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email.');
        var ex = findUser_(db, email);
        var temp = null;
        if (!ex) {
          temp = randomPassword_();
          ex = makeUser_(email, u.name || email, u.role === 'admin' ? 'admin' : 'staff', temp);
          db.users.push(ex);
        } else {
          if (email === lower_(user.email) && (u.role !== 'admin' || u.active === false)) throw new Error('You cannot remove your own administrator access.');
          ex.name = u.name || ex.name;
          ex.role = u.role === 'admin' ? 'admin' : 'staff';
          ex.active = u.active !== false;
          if (req.resetPassword) { temp = randomPassword_(); setPassword_(ex, temp); ex.mustChange = true; CacheService.getScriptCache().remove('fail_' + email); }
        }
        if (!db.users.some(function (x) { return x.role === 'admin' && x.active !== false; })) throw new Error('At least one active administrator is needed.');
        return { ok: true, user: publicUser_(ex), tempPassword: temp };
      });

    case 'deleteUser':
      requireAdmin_(user);
      return withDb_(function (db) {
        var email = lower_(req.email);
        if (email === lower_(user.email)) throw new Error('You cannot remove yourself.');
        db.users = db.users.filter(function (x) { return lower_(x.email) !== email; });
        return { ok: true };
      });

    case 'changePassword':
      return withDb_(function (db) {
        var u = findUser_(db, user.email);
        if (!u || !checkPassword_(u, req.oldPassword)) throw new Error('The current password is not correct.');
        if (!req.newPassword || String(req.newPassword).length < 8) throw new Error('The new password must have at least 8 characters.');
        setPassword_(u, req.newPassword);
        u.mustChange = false;
        return { ok: true };
      });

    case 'importAll':
      requireAdmin_(user);
      return withDb_(function (db) {
        var d = req.data || {};
        db.clients = d.clients || [];
        db.invoices = d.invoices || [];
        if (d.settings) db.settings = d.settings;
        return { ok: true };
      });

    default:
      throw new Error('Unknown action: ' + a);
  }
}

// ---------------------------------------------------------------- sending invoices
function sendInvoice_(req, user) {
  if (!req.to) throw new Error('Enter the client email.');
  if (!req.pdfBase64) throw new Error('The invoice PDF is missing.');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var db = readDb_();
    var inv = find_(db.invoices, req.invoiceId);
    if (!inv) throw new Error('Save the invoice before sending it.');
    if (inv.status === 'Cancelled') throw new Error('This invoice is cancelled.');
    var st = emailSettings_(db.settings);
    var opts = mailOptions_(st);
    var blob = Utilities.newBlob(Utilities.base64Decode(req.pdfBase64), 'application/pdf', req.fileName || (inv.number + '.pdf'));
    opts.attachments = [blob];
    opts.htmlBody = req.htmlBody || '';
    if (req.cc) opts.cc = req.cc;
    if (req.bcc || st.bcc) opts.bcc = [req.bcc, st.bcc].filter(String).join(', ');
    GmailApp.sendEmail(req.to, req.subject || ('Invoice ' + inv.number), req.textBody || '', opts);

    try { savePdf_(inv, req.pdfBase64, req.fileName); } catch (e) { inv.pdfError = String(e.message || e); }
    var nowIso = new Date().toISOString();
    if (inv.status !== 'Paid') inv.status = 'Sent';
    inv.sentAt = nowIso;
    inv.sentTo = req.to;
    inv.sentBy = user.email;
    inv.emails = (inv.emails || []).concat([{ at: nowIso, to: req.to, cc: req.cc || '', subject: req.subject, by: user.email }]);
    inv.history = (inv.history || []).concat([{ at: nowIso, by: user.name || user.email, what: 'Emailed to ' + req.to + (req.cc ? ' (cc ' + req.cc + ')' : '') }]);
    writeDb_(db);
    return { ok: true, invoice: inv };
  } finally {
    lock.releaseLock();
  }
}

function emailSettings_(s) {
  var e = (s && s.email) || {};
  return {
    fromEmail: lower_(e.fromEmail || DEFAULTS.FROM_EMAIL),
    fromName: e.fromName || DEFAULTS.FROM_NAME,
    replyTo: e.replyTo || '',
    bcc: e.bcc || '',
  };
}

// Sends from operations@safelegal.org only if this Google account may send as it.
function mailOptions_(st) {
  var me = lower_(Session.getEffectiveUser().getEmail());
  var opts = { name: st.fromName };
  if (st.replyTo) opts.replyTo = st.replyTo;
  if (st.fromEmail && st.fromEmail !== me) {
    var aliases = GmailApp.getAliases().map(lower_);
    if (aliases.indexOf(st.fromEmail) < 0) {
      throw new Error('The backend account (' + me + ') is not allowed to send as ' + st.fromEmail +
        '. Add it in Gmail → Settings → Accounts → "Send mail as", or deploy the backend from the ' + st.fromEmail + ' account. Nothing was sent.');
    }
    opts.from = st.fromEmail;
  }
  return opts;
}

function fromOptions_() {
  var me = Session.getEffectiveUser().getEmail();
  var list = [me];
  try { list = list.concat(GmailApp.getAliases()); } catch (e) { /* Gmail not authorised yet */ }
  return list;
}

function savePdf_(inv, base64, fileName) {
  var root = getRootFolder_();
  var inv0 = childFolder_(root, 'Invoices');
  var month = String(inv.periodY) + '-' + ('0' + inv.periodM).slice(-2);
  var folder = childFolder_(inv0, month);
  if (inv.pdfFileId) { try { DriveApp.getFileById(inv.pdfFileId).setTrashed(true); } catch (e) { /* gone */ } }
  var file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(base64), 'application/pdf', fileName || (inv.number + '.pdf')));
  inv.pdfFileId = file.getId();
  inv.pdfUrl = file.getUrl();
  return file;
}

// ---------------------------------------------------------------- invoice numbers
function nextNumber_(db, inv) {
  var prefix = (db.settings && db.settings.invoicePrefix) || 'SLS';
  var d = String(inv.date || Utilities.formatDate(new Date(), DEFAULTS.TZ, 'yyyy-MM-dd'));
  var base = prefix + '-' + d.slice(0, 4) + d.slice(5, 7) + '-';
  var max = 0;
  db.invoices.forEach(function (i) {
    if (i.id !== inv.id && i.number && i.number.indexOf(base) === 0) {
      var n = parseInt(i.number.slice(base.length), 10);
      if (n > max) max = n;
    }
  });
  return base + ('00' + (max + 1)).slice(-3);
}

function billTo_(c) {
  return { name: c.name || '', contact: c.contactPerson || '', address: c.address || '', phone: c.phone || '', email: c.email || '', gstin: c.gstin || '', entity: c.entity || 'business' };
}

// ---------------------------------------------------------------- team sign-in
function login_(email, password) {
  email = lower_(email);
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('fail_' + email) || 0);
  if (fails >= DEFAULTS.MAX_FAILS) throw new Error('Too many wrong passwords. Try again in ' + DEFAULTS.LOCK_MINS + ' minutes, or ask an administrator to reset your password.');
  var db = readDb_();
  var u = findUser_(db, email);
  if (!u || u.active === false || !checkPassword_(u, password)) {
    cache.put('fail_' + email, String(fails + 1), DEFAULTS.LOCK_MINS * 60);
    Utilities.sleep(600);
    throw new Error('Wrong email or password.');
  }
  cache.remove('fail_' + email);
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  cache.put('s_' + token, email, DEFAULTS.SESSION_SECS);
  u.lastLogin = new Date().toISOString();
  writeDb_(db);
  return { ok: true, token: token, user: publicUser_(u) };
}

function auth_(token) {
  var err;
  if (!token) { err = new Error('Please sign in.'); err.auth = true; throw err; }
  var cache = CacheService.getScriptCache();
  var email = cache.get('s_' + token);
  if (!email) { err = new Error('Your session has ended. Please sign in again.'); err.auth = true; throw err; }
  var u = findUser_(readDb_(), email);
  if (!u || u.active === false) { err = new Error('Your access has been removed.'); err.auth = true; throw err; }
  cache.put('s_' + token, email, DEFAULTS.SESSION_SECS); // sliding expiry
  return publicUser_(u);
}

function requireAdmin_(user) {
  if (user.role !== 'admin') throw new Error('Only a SAFE administrator can do this.');
}

function makeUser_(email, name, role, password) {
  var u = { email: lower_(email), name: name, role: role, active: true, mustChange: true, createdAt: new Date().toISOString() };
  setPassword_(u, password);
  return u;
}
function setPassword_(u, pw) {
  u.salt = Utilities.getUuid();
  u.hash = hash_(pw, u.salt);
}
function checkPassword_(u, pw) {
  return !!(u && u.salt && pw) && hash_(pw, u.salt) === u.hash;
}
function hash_(pw, salt) {
  var h = String(pw) + '|' + salt;
  for (var i = 0; i < 300; i++) {
    h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt, Utilities.Charset.UTF_8));
  }
  return h;
}
function publicUser_(u) {
  return { email: u.email, name: u.name, role: u.role, active: u.active !== false, mustChange: !!u.mustChange, lastLogin: u.lastLogin || '' };
}
function findUser_(db, email) {
  email = lower_(email);
  return db.users.filter(function (x) { return lower_(x.email) === email; })[0];
}
function randomPassword_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  var out = '';
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Date.now());
  for (var i = 0; i < 12; i++) out += chars.charAt(((bytes[i] % 256) + 256) % chars.length);
  return out;
}
function lower_(s) { return String(s || '').trim().toLowerCase(); }

// ---------------------------------------------------------------- storage on Drive
function getRootFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('ROOT_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* recreate */ } }
  var f = DriveApp.createFolder(DEFAULTS.ROOT);
  props.setProperty('ROOT_FOLDER_ID', f.getId());
  return f;
}
function childFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
function getDbFile_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('DB_FILE_ID');
  if (id) { try { return DriveApp.getFileById(id); } catch (e) { /* recreate */ } }
  var empty = { version: 1, clients: [], invoices: [], settings: {}, users: [] };
  var file = getRootFolder_().createFile(DEFAULTS.DB, JSON.stringify(empty), 'application/json');
  props.setProperty('DB_FILE_ID', file.getId());
  return file;
}
function readDb_() {
  var db = JSON.parse(getDbFile_().getBlob().getDataAsString('UTF-8') || '{}');
  db.clients = db.clients || [];
  db.invoices = db.invoices || [];
  db.settings = db.settings || {};
  db.users = db.users || [];
  return db;
}
function writeDb_(db) {
  getDbFile_().setContent(JSON.stringify(db));
}
function withDb_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var db = readDb_();
    var out = fn(db);
    writeDb_(db);
    return out;
  } finally {
    lock.releaseLock();
  }
}
function find_(arr, id) { return arr.filter(function (x) { return x.id === id; })[0]; }
function upsert_(arr, obj) {
  for (var i = 0; i < arr.length; i++) { if (arr[i].id === obj.id) { arr[i] = obj; return; } }
  arr.push(obj);
}

// ---------------------------------------------------------------- daily backup
function dailyBackup() {
  var folder = childFolder_(getRootFolder_(), 'Backups');
  var name = 'invoice-studio-db ' + Utilities.formatDate(new Date(), DEFAULTS.TZ, 'yyyy-MM-dd') + '.json';
  var it = folder.getFilesByName(name);
  while (it.hasNext()) it.next().setTrashed(true);
  folder.createFile(name, getDbFile_().getBlob().getDataAsString('UTF-8'), 'application/json');
  var cutoff = Date.now() - DEFAULTS.KEEP_BACKUPS_DAYS * 86400000;
  var all = folder.getFiles();
  while (all.hasNext()) {
    var f = all.next();
    if (f.getDateCreated().getTime() < cutoff) f.setTrashed(true);
  }
}
