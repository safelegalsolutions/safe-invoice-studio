# SAFE Invoice Studio

An internal web app for the **SAFE Legal Solutions** team to raise invoices on SAFE's letterhead, download them as PDF and email them to clients from **operations@safelegal.org**. It is built and styled the same way as SAFE Policy Studio: a static app on GitHub Pages plus a Google Apps Script backend that keeps the data on Google Drive.

## What it does

- **Clients**
  - Add each client with its billing basis:
    - **Monthly retainer**, with the monthly retainer amount;
    - **Case-by-case**, for individuals and one-off matters billed per case.
  - Also recorded: client type (business entity or individual), contact person, phone, invoice email, CC emails, the email greeting ("Dear Tristar Team,"), address, GSTIN and **additional comments** (internal notes, not printed).
- **Month selection:** every invoice has a billing month and year. The dashboard shows any month you pick.
- **Monthly retainers:**
  - Pick the month on the dashboard. **Raise pending invoices** creates a draft for every active retainer client not yet invoiced for that month. Each draft gets the "Legal Retainer Fee - Monthly / Professional legal services and consultation" line with the client's retainer amount.
  - **Send drafts by email** sends them all in one go.
- **Case-by-case invoices:** **+ New invoice** → choose the client → **Case-by-case**, then add as many lines as needed. Each line has a description, an optional detail line, the month billed for and the amount.
- **Lines and amounts:** add, edit or remove lines on any invoice, retainer invoices included (for example, an extra matter billed in the same month). The total and the amount in words update as you type.
- **Live preview:** shows the invoice exactly as the PDF will look.
- **PDF:** in the same layout as SAFE's current invoice:
  - letterhead header and footer, with the SAFE shield as a watermark;
  - invoice number and date;
  - billed to;
  - service table and total;
  - payment details with the HDFC bank account;
  - the GST note, then "THANK YOU FOR YOUR BUSINESS!".
- **GST note:**
  - business entities get the reverse-charge (RCM) note from SAFE's invoice;
  - individuals get the exemption note (Entry 45, Notification 12/2017-CT(Rate));
  - either can be changed or switched off per invoice.
- **Invoice numbers:**
  - Format: `SLS-YYYYMM-NNN`, for example `SLS-202609-004`. YYYYMM is the invoice date and NNN runs within that month.
  - Numbers are given automatically. They can be edited before sending and are never reused.
- **Email:**
  - **Send by email** sends the invoice PDF from **operations@safelegal.org** to the client's email (plus any CC).
  - Subject: *Invoice for Legal Retainer Services - September'2026*.
  - Message: the standard text with Deepika N S's signature.
  - The month and year follow the invoice's billing month automatically. Case-by-case invoices use their own subject and message.
  - Everything can be edited before sending, and the templates can be changed in **Settings → Email**.
- **Tracking:**
  - Statuses: Draft → Sent → Paid. **Overdue** shows automatically after the due date: the 5th of the month for retainers, 7 days after the invoice date for case invoices.
  - Mark an invoice as paid with the date, amount and UTR or reference. **Cancel** an invoice to keep its number reserved.
  - Sent invoices are locked and need **Edit** to change.
  - Every action is kept in the invoice's history.
- **Register:** filter all invoices by month, type, status or client, and **Export CSV** for accounts.
- **SAFE team only:**
  - Each team member signs in with their own email and password. Administrators add or remove people in **Settings → Team**.
  - Passwords are stored only as salted hashes.
  - Five wrong passwords lock sign-in for 15 minutes, and sessions end after 6 hours without use.
- **Drive:**
  - every sent invoice PDF is saved in `SAFE Invoice Studio/Invoices/YYYY-MM/`;
  - the data is backed up daily to `SAFE Invoice Studio/Backups/`.

## Files

```
index.html                  the app (static; runs on GitHub Pages)
assets/app.css              styles (SAFE Policy Studio look)
assets/js/util.js           dates, amounts, invoice numbers, default settings and email templates
assets/js/store.js          storage: Google backend, or demo mode in this browser
assets/js/invoice-pdf.js    the invoice PDF (layout of SAFE's invoice)
assets/js/app.js            user interface
assets/brand/               SAFE logo and shield (from the letterhead)
assets/fonts/               Poppins (SIL Open Font License)
assets/vendor/pdf-lib.min.js PDF library (MIT)
apps-script/Code.gs         Google Apps Script backend (Drive data, sign-in, email)
apps-script/appsscript.json Apps Script manifest
```

## 1. Put the app on GitHub

1. On GitHub, create a repository named `safe-invoice-studio` under the `safelegalsolutions` account.
   - **Private** is recommended if your GitHub plan allows Pages on private repositories (Pro, Team or Enterprise).
   - A public repository is also safe: the code holds no client data or passwords. All data stays on Google Drive behind the team sign-in. The only business detail in the code is the bank account that is printed on every invoice anyway.
2. Upload the contents of this folder to the repository root. Use **Add file → Upload files** and drag in everything, including the `assets` and `apps-script` folders. Or use git:
   ```
   git init && git add . && git commit -m "SAFE Invoice Studio"
   git branch -M main
   git remote add origin https://github.com/safelegalsolutions/safe-invoice-studio.git
   git push -u origin main
   ```
3. **Settings → Pages** → Source: `main` branch, `/ (root)` → Save. After a minute the app is at `https://safelegalsolutions.github.io/safe-invoice-studio/`.

The app opens on a connect screen. **Try demo mode** works at once, but it keeps data in that browser only and cannot send emails. For the team, set up the backend below.

## 2. Set up the Google backend

### Which Google account to use

The backend sends email as the Google account that deploys it.

- **If operations@safelegal.org is a Google Workspace (Gmail) account:** use it for all the steps below. Invoices go out from it directly, with no extra setup. This is the simplest option.
- **Otherwise:** use safelegalsolutions@gmail.com and add operations@safelegal.org to it as a **"Send mail as"** address:
  1. Gmail → ⚙ → **See all settings** → **Accounts and Import** → **Send mail as** → **Add another email address**.
  2. Name: `SAFE Legal Solutions`. Email: `operations@safelegal.org`. **Untick "Treat as an alias".**
  3. Enter the SMTP server, user name and password of the operations@safelegal.org mailbox (from your email provider), then confirm with the code Gmail sends to operations@.

The backend refuses to send from any other address, so a misconfiguration stops the email instead of sending it from the wrong account. **Settings → Email** shows a warning if the address isn't available.

### Steps

1. Go to <https://script.google.com> → **New project**. Name it "SAFE Invoice Studio backend". This is a separate project from Policy Studio.
2. Replace the contents of `Code.gs` with `apps-script/Code.gs`.
3. **Project Settings** (⚙) → tick **Show "appsscript.json" manifest file in editor**. Replace that file's contents with `apps-script/appsscript.json`.
4. In the editor, choose the function **`setup`** and click **Run**. Approve the permissions (Drive, Gmail, triggers). In the **Execution log** you will see:
   - **FIRST SIGN-IN → email … temporary password …**: copy it;
   - the addresses this account can send as: check that operations@safelegal.org is listed;
   - the Drive folder link.
5. **Deploy → New deployment** → type **Web app**. Execute as: **Me**. Who has access: **Anyone**. **Deploy**, then copy the **Web app URL** (it ends in `/exec`).
   "Anyone" only lets the app reach the backend. Every request still needs a signed-in SAFE team member.
6. Open the app, paste the URL under **Connect to SAFE's backend**, and sign in with the email and temporary password from step 4. You will be asked to choose your own password.
7. **Settings → Email → Send test email** to check that sending works.
8. **Settings → Team → + Add team member** for each colleague. Each one gets a temporary password, shown once, and changes it at first sign-in.

After any later change to `Code.gs`: **Deploy → Manage deployments → ✏ → Version: New version → Deploy**. The URL stays the same.

Locked out? In the Apps Script editor, run **`resetMyPassword`**. It prints a new temporary password for the deploying account.

**Sending limits:** Google allows about 100 recipients a day from a free Gmail account and about 1,500 from Google Workspace. That is ample for monthly invoicing.

## 3. Monthly routine

1. **Dashboard** → choose the month and year.
2. **Raise pending invoices** → check the invoice date (SAFE's usual is the 2nd) → **Create drafts**.
3. Open any draft to check it or add lines. The preview on the right is the PDF.
4. **Send drafts by email**, or open an invoice and click **Send by email** to check the message first.
5. When a payment arrives: open the invoice → **More → Mark as paid**, with the date and UTR.
6. **Invoices → Export CSV** for the accounts register.

**Case-by-case:**

1. **+ New invoice** → choose the client → **Case-by-case**.
2. Add the lines and amounts → **Save** → **Send by email**.

**A one-off amount for a retainer client:**

- **On a separate invoice:** open the client → **+ Case invoice**.
- **On that month's retainer invoice:** use **+ Add line**.

## Settings

- **Invoice and letterhead:** firm name, letterhead address, footer lines, invoice prefix, default retainer line, both GST notes, closing line, amount in words.
- **Bank and payment:** account details printed on invoices; the retainer due day (5th) and its text; the days allowed for case-by-case invoices.
- **Email:** sender address and name, reply-to, always-CC/BCC, both subjects and messages, and the signature.
  - Placeholders: `{salutation}`, `{period}` (September'2026), `{periodShort}` (Sept'2026), `{month}`, `{year}`, `{invoiceNo}`, `{invoiceDate}`, `{amount}`, `{dueDate}`, `{dueText}`, `{clientName}`.
- **Connection and backup:** backend URL, download or restore a JSON backup, and switching a browser to demo mode.
- **Team / My account:** sign-in management. Only administrators can change settings and the team; team members can manage clients and invoices.

## Notes

- **PDF font:** the PDF uses the Poppins font, like SAFE's current invoice. It loads a small font helper (fontkit) from jsDelivr or unpkg the first time a PDF is made. If neither can be reached, the PDF falls back to Helvetica with the same layout.
- **GST wording:** the GST notes reflect the reverse-charge and exemption entries for legal services as of October 2026. Review them with your tax adviser if the notifications change; both are editable in Settings.
