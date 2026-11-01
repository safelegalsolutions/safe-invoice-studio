/* SAFE Invoice Studio — shared helpers, default settings and invoice logic. */
(function (root) {
  const S = (root.SAFE = root.SAFE || {});

  S.APP_VERSION = '1.0.0';

  // ---------- months ----------
  S.MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  // Short forms as used on SAFE invoices ("Sept'2026")
  S.MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
  S.periodLong = (y, m) => `${S.MONTHS[m - 1]}'${y}`;
  S.periodShort = (y, m) => `${S.MONTHS_SHORT[m - 1]}'${y}`;
  S.periodTitle = (y, m) => `${S.MONTHS[m - 1]} ${y}`;
  S.periodKey = (y, m) => `${y}-${String(m).padStart(2, '0')}`;

  // ---------- dates (stored as YYYY-MM-DD, India time) ----------
  S.today = () => {
    const d = new Date(Date.now() + (330 + new Date().getTimezoneOffset()) * 60000);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  S.parseDate = (s) => { const [y, m, d] = String(s || '').split('-').map(Number); return { y, m, d }; };
  S.addDays = (s, n) => {
    const { y, m, d } = S.parseDate(s);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return dt.toISOString().slice(0, 10);
  };
  const ord = (n) => { const v = n % 100; if (v >= 11 && v <= 13) return n + 'th'; return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'); };
  S.fmtDateLong = (s) => { if (!s) return ''; const { y, m, d } = S.parseDate(s); return `${ord(d)} ${S.MONTHS[m - 1]} ${y}`; };
  S.fmtDate = (s) => { if (!s) return ''; const { y, m, d } = S.parseDate(s); return `${String(d).padStart(2, '0')} ${S.MONTHS_SHORT[m - 1].slice(0, 3)} ${y}`; };

  // ---------- money ----------
  S.round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  S.inr = (n) => (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  S.inr0 = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

  const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''));
  const three = (n) => (n >= 100 ? ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + two(n % 100) : '') : two(n));
  function words(n) {
    if (n === 0) return 'Zero';
    const out = [];
    const crore = Math.floor(n / 1e7); n %= 1e7;
    const lakh = Math.floor(n / 1e5); n %= 1e5;
    const th = Math.floor(n / 1000); n %= 1000;
    if (crore) out.push(words(crore) + ' Crore');
    if (lakh) out.push(two(lakh) + ' Lakh');
    if (th) out.push(two(th) + ' Thousand');
    if (n) out.push(three(n));
    return out.join(' ');
  }
  S.amountInWords = (num) => {
    num = S.round2(num);
    const r = Math.floor(num);
    const p = Math.round((num - r) * 100);
    return 'Rupees ' + words(r) + (p ? ' and ' + two(p) + ' Paise' : '') + ' Only';
  };

  // ---------- ids ----------
  S.uid = (p) => (p || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ---------- default settings (editable in Settings) ----------
  S.DEFAULT_SETTINGS = {
    firmName: 'SAFE LEGAL SOLUTIONS',
    addressLines: [
      'No. 39, 1st Floor, 5th Main Road, Ramaiah College',
      'Gate 6, near Little Elly school & MS, ITI Layout,',
      'R.M.V. 2nd Stage, Bengaluru, Karnataka 560054',
    ],
    footerLine1: 'Helpline: +91-6366979121, +91-6366979122, +91-6366979123',
    footerLine2: 'Emergency Contact: +91-9886181839 / +91-9731977228',
    footerEmail: 'info@safelegal.org',
    footerWeb: 'www.safelegal.org',
    invoicePrefix: 'SLS',
    bank: {
      accountName: 'SAFE LEGAL SOLUTIONS',
      accountNo: '50200114924601',
      branch: 'Kasturba Road, Bengaluru',
      ifsc: 'HDFC0000009',
      bankName: 'HDFC',
    },
    retainerDueDay: 5,
    dueRetainerText: 'Payment due within 5th day of every month',
    caseDueDays: 7,
    dueCaseText: 'Payment due within {days} days of the invoice date',
    retainerDesc: 'Legal Retainer Fee - Monthly',
    retainerDetail: 'Professional legal services and consultation',
    gstNoteBusiness: 'GST on this invoice is payable by the recipient under Reverse Charge Mechanism (RCM) in terms of Notification No. 13/2017-Central Tax (Rate) dated 28.06.2017, as amended, read with Section 9(3) of the CGST Act, 2017 and Section 5(3) of the IGST Act, 2017, being legal services provided by an advocate/firm of advocates to a business entity',
    gstNoteIndividual: 'Legal services provided by an advocate/firm of advocates to a person other than a business entity are exempt from GST under Entry 45 of Notification No. 12/2017-Central Tax (Rate) dated 28.06.2017, as amended',
    thankYou: 'THANK YOU FOR YOUR BUSINESS!',
    showAmountInWords: true,
    email: {
      fromEmail: 'operations@safelegal.org',
      fromName: 'SAFE Legal Solutions',
      replyTo: 'operations@safelegal.org',
      cc: '',
      bcc: '',
      subjectRetainer: 'Invoice for Legal Retainer Services - {period}',
      subjectCase: 'Invoice for Legal Services - {period}',
      bodyRetainer: [
        'Dear {salutation},',
        '',
        'I hope this email finds you well.',
        'Please find attached the invoice for our legal retainer services for the month of {period}.',
        'Payment due: within 5th day of every month',
        'Payment can be made via bank transfer to the account details mentioned in the attached invoice.',
        'If you have any questions or need any clarification regarding this invoice, please feel free to reach out to us.',
        'Thank you for your continued trust in our services.',
      ].join('\n'),
      bodyCase: [
        'Dear {salutation},',
        '',
        'I hope this email finds you well.',
        'Please find attached invoice {invoiceNo} for the legal services provided by us for {period}.',
        'Amount payable: Rs. {amount}',
        'Payment due: {dueText}',
        'Payment can be made via bank transfer to the account details mentioned in the attached invoice.',
        'If you have any questions or need any clarification regarding this invoice, please feel free to reach out to us.',
        'Thank you for your continued trust in our services.',
      ].join('\n'),
      signature: [
        'Warm Regards',
        'Deepika N S',
        'Chief Operation Officer',
        'SAFE Legal Solutions',
        '✉️Email: safelegalsolutions@gmail.com; info@safelegal.org; sales@safelegal.org; partnerhelp@safelegal.org',
        '☎️Phone: +91-9731977228',
        '🌐Website: www.safelegal.org | www.safelegal.in',
        '📍Address: #39, 1st Floor, 5th Main, RMV 2nd Stage, ITI Layout, Bangalore - 560054',
      ].join('\n'),
    },
  };

  // deep merge of saved settings over defaults
  S.mergeSettings = (saved) => {
    const d = JSON.parse(JSON.stringify(S.DEFAULT_SETTINGS));
    const s = saved || {};
    Object.keys(s).forEach((k) => {
      if (k === 'bank' || k === 'email') d[k] = Object.assign(d[k], s[k] || {});
      else if (s[k] !== undefined && s[k] !== null) d[k] = s[k];
    });
    if (!Array.isArray(d.addressLines)) d.addressLines = String(d.addressLines || '').split('\n');
    return d;
  };

  // ---------- invoice logic ----------
  S.invoiceTotal = (inv) => S.round2((inv.lines || []).reduce((a, l) => a + (Number(l.amount) || 0), 0));

  S.dueText = (inv, st) => {
    if (inv.dueText) return inv.dueText;
    return inv.kind === 'retainer' ? st.dueRetainerText : String(st.dueCaseText || '').replace('{days}', st.caseDueDays);
  };

  S.dueDate = (inv, st) => {
    if (!inv.date) return '';
    if (inv.kind === 'retainer' && inv.periodY && inv.periodM) {
      const day = Math.min(28, Math.max(1, Number(st.retainerDueDay) || 5));
      const d = S.periodKey(inv.periodY, inv.periodM) + '-' + String(day).padStart(2, '0');
      return d >= inv.date ? d : S.addDays(inv.date, day);
    }
    return S.addDays(inv.date, Number(st.caseDueDays) || 7);
  };

  // which GST note prints: auto = by client type
  S.gstNote = (inv, client, st) => {
    const mode = inv.gstMode || 'auto';
    if (mode === 'none') return '';
    if (mode === 'custom') return inv.gstCustom || '';
    if (mode === 'rcm') return st.gstNoteBusiness;
    if (mode === 'exempt') return st.gstNoteIndividual;
    const entity = (inv.billTo && inv.billTo.entity) || (client && client.entity) || 'business';
    return entity === 'individual' ? st.gstNoteIndividual : st.gstNoteBusiness;
  };

  S.retainerLine = (client, st, y, m) => ({
    id: S.uid('ln'),
    retainer: true,
    desc: (client && client.retainerDesc) || st.retainerDesc,
    detail: client && client.retainerDetail != null && client.retainerDetail !== '' ? client.retainerDetail : st.retainerDetail,
    period: S.periodShort(y, m),
    amount: Number(client && client.retainerAmount) || 0,
  });

  // what prints under "BILLED TO"
  S.billToFromClient = (c) => ({
    name: c.name || '',
    contact: c.contactPerson || '',
    address: c.address || '',
    phone: c.phone || '',
    email: c.email || '',
    gstin: c.gstin || '',
    entity: c.entity || 'business',
  });

  S.newInvoice = (client, st, opts) => {
    const o = opts || {};
    const t = S.parseDate(o.date || S.today());
    const y = o.y || t.y;
    const m = o.m || t.m;
    const kind = o.kind || (client && client.billing === 'case' ? 'case' : 'retainer');
    return {
      id: S.uid('inv'),
      number: '',
      clientId: client ? client.id : '',
      kind,
      periodY: y,
      periodM: m,
      date: o.date || S.today(),
      lines: kind === 'retainer' && client ? [S.retainerLine(client, st, y, m)] : [{ id: S.uid('ln'), desc: '', detail: '', period: S.periodShort(y, m), amount: 0 }],
      notes: '',
      internalNote: '',
      gstMode: 'auto',
      dueText: '',
      billTo: client ? S.billToFromClient(client) : null,
      status: 'Draft',
      history: [],
      createdAt: new Date().toISOString(),
    };
  };

  // Invoice numbers: SLS-YYYYMM-NNN, YYYYMM from the invoice date, NNN running within that month
  S.numberBase = (inv, st) => {
    const { y, m } = S.parseDate(inv.date || S.today());
    return (st.invoicePrefix || 'SLS') + '-' + y + String(m).padStart(2, '0') + '-';
  };
  S.nextNumber = (invoices, inv, st) => {
    const base = S.numberBase(inv, st);
    let max = 0;
    (invoices || []).forEach((i) => {
      if (i.id !== inv.id && i.number && i.number.indexOf(base) === 0) {
        const n = parseInt(i.number.slice(base.length), 10);
        if (n > max) max = n;
      }
    });
    return base + String(max + 1).padStart(3, '0');
  };

  S.isOverdue = (inv, st) => inv.status === 'Sent' && S.dueDate(inv, st) && S.today() > S.dueDate(inv, st);
  S.displayStatus = (inv, st) => (S.isOverdue(inv, st) ? 'Overdue' : inv.status);

  // ---------- email ----------
  S.fillTemplate = (tpl, vars) => String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));

  S.emailVars = (inv, client, st) => ({
    salutation: (client && client.salutation) || (inv.billTo && (inv.billTo.entity === 'individual' ? inv.billTo.contact || inv.billTo.name : inv.billTo.name + ' Team')) || 'Sir/Madam',
    clientName: (inv.billTo && inv.billTo.name) || '',
    period: S.periodLong(inv.periodY, inv.periodM),
    periodShort: S.periodShort(inv.periodY, inv.periodM),
    month: S.MONTHS[inv.periodM - 1],
    year: inv.periodY,
    invoiceNo: inv.number || '',
    invoiceDate: S.fmtDateLong(inv.date),
    amount: S.inr(S.invoiceTotal(inv)),
    dueDate: S.fmtDateLong(S.dueDate(inv, st)),
    dueText: S.dueText(inv, st).replace(/^Payment due\s*/i, ''),
  });

  S.pdfFileName = (inv) => {
    const name = ((inv.billTo && inv.billTo.name) || 'Client').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    const title = name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    return `${title} Invoice ${S.periodShort(inv.periodY, inv.periodM)}${inv.kind === 'case' && inv.number ? ' ' + inv.number : ''}.pdf`;
  };

  const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  S.escHtml = escHtml;
  // plain text → email HTML: keeps line breaks, links emails and web addresses
  S.textToEmailHtml = (text) => {
    let h = escHtml(text);
    h = h.replace(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, '<a href="mailto:$1">$1</a>');
    h = h.replace(/(^|[\s(|;])((?:https?:\/\/)?www\.[A-Za-z0-9.-]+\.[A-Za-z]{2,}[^\s<|;]*)/g, (m, pre, url) => `${pre}<a href="${url.indexOf('http') === 0 ? url : 'https://' + url}">${url}</a>`);
    return h.replace(/\n/g, '<br>');
  };
  S.buildEmail = (body, signature) => {
    const text = body.replace(/\s+$/, '') + '\n' + signature;
    const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">' +
      S.textToEmailHtml(body.replace(/\s+$/, '')) + '<br>' + S.textToEmailHtml(signature) + '</div>';
    return { text, html };
  };
})(typeof window !== 'undefined' ? window : globalThis);
