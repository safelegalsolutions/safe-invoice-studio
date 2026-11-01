/* SAFE Invoice Studio — builds the invoice PDF in the browser (pdf-lib).
 * Layout follows SAFE Legal's invoice: letterhead header, INVOICE title, number/date,
 * billed to, service table, payment details, GST note, thank-you line, letterhead footer. */
(function (root) {
  const S = (root.SAFE = root.SAFE || {});
  const W = 595.28; // A4
  const H = 841.89;
  const L = 82; // content left
  const R = W - 82; // content right
  const MAROON = [0x80 / 255, 0x14 / 255, 0x25 / 255];

  const cache = {};
  function bytes(url) {
    if (!cache[url]) {
      cache[url] = fetch(url).then((r) => { if (!r.ok) throw new Error('Could not load ' + url); return r.arrayBuffer(); })
        .catch((e) => { delete cache[url]; throw e; });
    }
    return cache[url];
  }

  // fontkit lets pdf-lib embed the Poppins font; loaded on first use, with a fallback CDN
  const FONTKIT_URLS = [
    'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js',
    'https://unpkg.com/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js',
  ];
  let fontkitP = null;
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      const t = setTimeout(() => reject(new Error('timeout')), 8000);
      s.onload = () => { clearTimeout(t); resolve(); };
      s.onerror = () => { clearTimeout(t); reject(new Error('failed')); };
      document.head.appendChild(s);
    });
  }
  function ensureFontkit() {
    if (root.fontkit) return Promise.resolve(root.fontkit);
    if (!fontkitP) {
      fontkitP = (async () => {
        for (const u of FONTKIT_URLS) {
          try { await loadScript(u); if (root.fontkit) return root.fontkit; } catch (e) { /* try next */ }
        }
        fontkitP = null; // allow a retry later
        return null;
      })();
    }
    return fontkitP;
  }
  S.ensureFontkit = ensureFontkit;

  async function embedFonts(doc) {
    await ensureFontkit();
    const { StandardFonts } = PDFLib;
    const f = { serif: await doc.embedFont(StandardFonts.TimesRoman) };
    let custom = false;
    if (root.fontkit) {
      try {
        doc.registerFontkit(root.fontkit);
        const [r, m, b] = await Promise.all(['Regular', 'Medium', 'Bold'].map((n) => bytes('assets/fonts/Poppins-' + n + '.ttf')));
        f.reg = await doc.embedFont(r, { subset: false });
        f.med = await doc.embedFont(m, { subset: false });
        f.bold = await doc.embedFont(b, { subset: false });
        custom = true;
      } catch (e) {
        console.warn('Poppins could not be embedded, using Helvetica instead', e);
      }
    }
    if (!custom) {
      f.reg = await doc.embedFont(StandardFonts.Helvetica);
      f.med = await doc.embedFont(StandardFonts.HelveticaBold);
      f.bold = f.med;
    }
    f.custom = custom;
    // character sets, so unsupported characters never break the PDF
    [f.serif, f.reg, f.med, f.bold].forEach((font) => { if (!font._cs) font._cs = new Set(font.getCharacterSet()); });
    return f;
  }

  const SUBS = { '₹': 'Rs.', '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', ' ': ' ', '\t': ' ' };
  function clean(font, s) {
    let out = '';
    for (const ch of String(s == null ? '' : s)) {
      const cp = ch.codePointAt(0);
      if (font._cs.has(cp)) out += ch;
      else if (SUBS[ch] !== undefined) out += SUBS[ch].split('').every((c) => font._cs.has(c.codePointAt(0))) ? SUBS[ch] : '';
      else if (cp < 32) out += '';
      else out += '';
    }
    return out;
  }

  function wrap(font, text, size, maxW) {
    const out = [];
    String(text == null ? '' : text).split('\n').forEach((para) => {
      const words = clean(font, para).split(/ +/);
      let line = '';
      words.forEach((w) => {
        const tryLine = line ? line + ' ' + w : w;
        if (font.widthOfTextAtSize(tryLine, size) <= maxW) { line = tryLine; return; }
        if (line) out.push(line);
        // very long word: hard-break
        let rest = w;
        while (font.widthOfTextAtSize(rest, size) > maxW && rest.length > 1) {
          let i = rest.length - 1;
          while (i > 1 && font.widthOfTextAtSize(rest.slice(0, i), size) > maxW) i--;
          out.push(rest.slice(0, i));
          rest = rest.slice(i);
        }
        line = rest;
      });
      out.push(line);
    });
    return out;
  }

  // Builds the PDF; if it spills onto a second page, tries a tighter layout first.
  S.buildInvoicePdf = async function (inv, client, st) {
    let doc = await render(inv, client, st, false);
    if (doc.getPageCount() > 1) {
      const tight = await render(inv, client, st, true);
      if (tight.getPageCount() < doc.getPageCount()) doc = tight;
    }
    numberPages(doc, doc._safeFonts);
    return doc.save();
  };

  function numberPages(doc, F) {
    const pages = doc.getPages();
    if (pages.length < 2) return;
    const { rgb } = PDFLib;
    pages.forEach((p, i) => {
      const t = clean(F.reg, `Page ${i + 1} of ${pages.length}`);
      p.drawText(t, { x: W - 30 - F.reg.widthOfTextAtSize(t, 7.5), y: 10, size: 7.5, font: F.reg, color: rgb(0.2, 0.2, 0.2) });
    });
  }

  async function render(inv, client, st, compact) {
    const K = compact
      ? { title: 128, afterTitle: 28, metaGap: 18, billGap: 22, billLh: 14, svcGap: 24, headH: 44, rowMin: 44, rowPad: 16, totH: 32, payLh: 14, payHead: 24 }
      : { title: 142, afterTitle: 32, metaGap: 20, billGap: 27, billLh: 15, svcGap: 30, headH: 52, rowMin: 70, rowPad: 26, totH: 37, payLh: 15.5, payHead: 26 };
    if (!root.PDFLib) throw new Error('The PDF library did not load. Check the internet connection and reload the page.');
    const { PDFDocument, rgb } = PDFLib;
    const maroon = rgb(...MAROON);
    const black = rgb(0.1, 0.1, 0.1);
    const grey = rgb(0.2, 0.2, 0.2);

    const doc = await PDFDocument.create();
    const vars = S.emailVars(inv, client, st);
    doc.setTitle(`Invoice ${inv.number || ''} – ${vars.clientName}`);
    doc.setAuthor(st.firmName || 'SAFE Legal Solutions');
    doc.setCreator('SAFE Invoice Studio');
    doc.setProducer('SAFE Invoice Studio');
    doc.setSubject(`Invoice for ${vars.period}`);

    const F = await embedFonts(doc);
    doc._safeFonts = F;
    const [logoB, shieldB] = await Promise.all([bytes('assets/brand/logo-wide.png'), bytes('assets/brand/shield.png')]);
    const logo = await doc.embedPng(logoB);
    const shield = await doc.embedPng(shieldB);

    let page;
    const text = (s, x, top, font, size, color, align) => {
      const t = clean(font, s);
      const w = font.widthOfTextAtSize(t, size);
      const xx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
      page.drawText(t, { x: xx, y: H - top, size, font, color: color || black });
      return w;
    };
    const hline = (x1, x2, top, th, color) => page.drawLine({ start: { x: x1, y: H - top }, end: { x: x2, y: H - top }, thickness: th, color: color || black });
    const vline = (x, t1, t2, th) => page.drawLine({ start: { x, y: H - t1 }, end: { x, y: H - t2 }, thickness: th, color: black });

    // ----- letterhead (every page) -----
    const FOOT_RULE = H - 80;
    function newPage() {
      page = doc.addPage([W, H]);
      // watermark
      const ws = 250;
      page.drawImage(shield, { x: (W - ws) / 2, y: H - 300 - ws * (shield.height / shield.width), width: ws, height: ws * (shield.height / shield.width), opacity: 0.075 });
      // header
      const lw = 138;
      page.drawImage(logo, { x: 56, y: H - 12 - lw * (logo.height / logo.width), width: lw, height: lw * (logo.height / logo.width) });
      (st.addressLines || []).slice(0, 4).forEach((ln, i) => text(ln, W - 56, 30 + i * 12, F.serif, 9, grey, 'right'));
      hline(26, W - 26, 80, 2.6, maroon);
      // footer
      hline(26, W - 26, FOOT_RULE, 2.6, maroon);
      text(st.footerLine1, W / 2, FOOT_RULE + 16, F.serif, 9.5, grey, 'center');
      text(st.footerLine2, W / 2, FOOT_RULE + 30, F.serif, 9.5, grey, 'center');
      if (st.footerEmail) text('Email: ' + st.footerEmail, 112, FOOT_RULE + 54, F.serif, 11, grey);
      if (st.footerWeb) text('Web: ' + st.footerWeb, 350, FOOT_RULE + 54, F.serif, 11, grey);
    }
    newPage();

    // ----- title, number, date -----
    let y = K.title;
    text('INVOICE', L, y, F.serif, 44, maroon);
    y += K.afterTitle;
    text('INVOICE NUMBER:', L + 3, y, F.med, 10.5, maroon);
    text('INVOICE DATE:', R - 12, y, F.med, 10.5, maroon, 'right');
    y += K.metaGap;
    text(inv.number || 'DRAFT', L + 3, y, F.reg, 10.5);
    text(S.fmtDateLong(inv.date), R - 12, y, F.reg, 10.5, black, 'right');

    // ----- billed to -----
    y += K.billGap;
    text('BILLED TO:', L + 3, y, F.med, 10.5, maroon);
    const b = inv.billTo || {};
    const billLines = [];
    if (b.name) billLines.push(b.entity === 'individual' ? b.name : String(b.name).toUpperCase());
    if (b.contact) billLines.push(b.contact.replace(/,\s*$/, '') + ',');
    if (b.address) String(b.address).split('\n').filter(Boolean).forEach((a) => billLines.push(a));
    if (b.phone) billLines.push('Phone: ' + b.phone);
    if (b.email) billLines.push('Email: ' + b.email);
    if (b.gstin) billLines.push('GSTIN: ' + b.gstin);
    y += 3;
    billLines.forEach((ln) => wrap(F.reg, ln, 10.5, 340).forEach((w) => { y += K.billLh; text(w, L + 3, y, F.reg, 10.5); }));

    // ----- service table -----
    y += K.svcGap;
    text('SERVICE PROVIDED:', L, y, F.med, 10.5, maroon);
    y += 12;
    const tw = R - L;
    const c1 = L + tw * 0.55;
    const c2 = L + tw * 0.775;
    const BT = 1.2;
    const lh = 16;
    const BOTTOM = FOOT_RULE - 30; // lowest point for table rows

    function tableHeader() {
      const top = y;
      const hgt = K.headH;
      [L, c1, c2, R].forEach((x) => vline(x, top, top + hgt, BT));
      hline(L - BT / 2, R + BT / 2, top, BT);
      hline(L - BT / 2, R + BT / 2, top + hgt, BT);
      text('Description', (L + c1) / 2, top + hgt / 2 + 4, F.bold, 10.5, black, 'center');
      text('Month', (c1 + c2) / 2, top + hgt / 2 - 3.5, F.bold, 10.5, black, 'center');
      text('Billed for', (c1 + c2) / 2, top + hgt / 2 + 11.5, F.bold, 10.5, black, 'center');
      text('Amount(Rs)', (c2 + R) / 2, top + hgt / 2 + 4, F.bold, 10.5, black, 'center');
      y = top + hgt;
    }
    tableHeader();

    const lines = (inv.lines || []).filter((l) => (l.desc || l.detail || Number(l.amount)));
    lines.forEach((ln) => {
      const dl = [].concat(ln.desc ? wrap(F.reg, ln.desc, 10.5, c1 - L - 20) : [], ln.detail ? wrap(F.reg, ln.detail, 10.5, c1 - L - 20) : []);
      const pl = wrap(F.reg, ln.period || '', 10.5, c2 - c1 - 12);
      const n = Math.max(dl.length, pl.length, 1);
      const hgt = Math.max(K.rowMin, n * lh + K.rowPad);
      if (y + hgt > BOTTOM) {
        hline(L - BT / 2, R + BT / 2, y, BT);
        newPage();
        y = 110;
        text('INVOICE ' + (inv.number || '') + ' (continued)', L, y - 6, F.med, 9.5, maroon);
        y += 4;
        tableHeader();
      }
      const top = y;
      [L, c1, c2, R].forEach((x) => vline(x, top, top + hgt, BT));
      hline(L - BT / 2, R + BT / 2, top + hgt, BT);
      const mid = top + hgt / 2;
      dl.forEach((t, i) => text(t, (L + c1) / 2, mid - ((dl.length - 1) * lh) / 2 + i * lh + 4, F.reg, 10.5, black, 'center'));
      pl.forEach((t, i) => text(t, (c1 + c2) / 2, mid - ((pl.length - 1) * lh) / 2 + i * lh + 4, F.reg, 10.5, black, 'center'));
      text(S.inr(ln.amount), (c2 + R) / 2, mid + 4, F.reg, 10.5, black, 'center');
      y = top + hgt;
    });

    // total row
    {
      const hgt = K.totH;
      if (y + hgt > BOTTOM) { hline(L - BT / 2, R + BT / 2, y, BT); newPage(); y = 110; hline(L - BT / 2, R + BT / 2, y, BT); }
      const top = y;
      [L, c2, R].forEach((x) => vline(x, top, top + hgt, BT));
      hline(L - BT / 2, R + BT / 2, top + hgt, BT);
      text('TOTAL AMOUNT:', (L + c2) / 2, top + hgt / 2 + 4, F.bold, 11, black, 'center');
      text(S.inr(S.invoiceTotal(inv)), (c2 + R) / 2, top + hgt / 2 + 4, F.bold, 11, black, 'center');
      y = top + hgt;
    }

    // ----- after the table: words, note, payment details, GST note -----
    const gst = S.gstNote(inv, client, st);
    const gstLines = gst ? wrap(F.reg, gst.toUpperCase(), 5.6, R - L + 20) : [];
    const NOTE_BOTTOM = FOOT_RULE - 30; // thank-you line sits here
    const noteTop = () => NOTE_BOTTOM - 16 - gstLines.length * 7.2;

    const after = [];
    if (st.showAmountInWords) after.push({ h: 18, draw: (t) => text('Amount in words: ' + S.amountInWords(S.invoiceTotal(inv)), L + 1, t + 13, F.reg, 9, grey) });
    if (inv.notes) {
      const nl = wrap(F.reg, inv.notes, 9.5, R - L);
      after.push({ h: 10 + nl.length * 13, draw: (t) => nl.forEach((ln, i) => text(ln, L + 1, t + 18 + i * 13, F.reg, 9.5, grey)) });
    }
    const bk = st.bank || {};
    const pay = [S.dueText(inv, st), 'Please make payment via bank transfer to:'];
    if (bk.accountName) pay.push('Account Name – ' + bk.accountName);
    if (bk.accountNo) pay.push('Account No – ' + bk.accountNo);
    if (bk.branch) pay.push('Branch – ' + bk.branch);
    if (bk.ifsc) pay.push('IFSC Code – ' + bk.ifsc);
    if (bk.bankName) pay.push('Bank – ' + bk.bankName);
    if (bk.upi) pay.push('UPI – ' + bk.upi);
    const payH = K.payHead + 2 + pay.length * K.payLh;
    after.push({
      h: payH + 4,
      draw: (t) => {
        text('PAYMENT DETAILS', L, t + K.payHead, F.bold, 11.5, maroon);
        pay.forEach((ln, i) => text(ln, L, t + K.payHead + 20 + i * K.payLh, F.reg, 10.5));
      },
    });

    let need = after.reduce((a, b2) => a + b2.h, 0) + 14;
    if (y + need > noteTop()) { newPage(); y = 100; }
    after.forEach((blk) => { blk.draw(y); y += blk.h; });

    // GST note and thank-you, anchored above the footer on the last page
    let gy = noteTop();
    gstLines.forEach((ln) => { gy += 7.2; text(ln, W / 2, gy, F.reg, 5.6, black, 'center'); });
    if (st.thankYou) text(st.thankYou, W / 2, NOTE_BOTTOM + 2, F.bold, 10.5, maroon, 'center');

    return doc;
  }

  S.pdfToBase64 = (u8) => {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  };

  S.downloadBytes = (u8, name, mime) => {
    const blob = new Blob([u8], { type: mime || 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
})(typeof window !== 'undefined' ? window : globalThis);
