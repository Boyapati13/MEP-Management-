// ─────────────────────────────────────────────────────────────────────────────
// Formal Engineering & Commercial Document Print / PDF Generator
// Produces ISO-9001 style A4 documents for POs, Valuation Certificates, RFIs,
// Submittals, Variations, and QA/QC Inspection Reports.
// ─────────────────────────────────────────────────────────────────────────────

export interface PrintableDocumentOptions {
  documentType: string;
  referenceCode: string;
  title: string;
  subtitle?: string;
  projectName?: string;
  projectCode?: string;
  status?: string;
  issueDate?: string;
  metadata?: Array<{ label: string; value: string | number | undefined | null }>;
  columns?: Array<{ key: string; label: string; align?: 'left' | 'right' | 'center' }>;
  rows?: Array<Record<string, any>>;
  summaryTotals?: Array<{ label: string; value: string; highlight?: boolean }>;
  notes?: string;
  signatures?: Array<{ role: string; party: string; name?: string; date?: string }>;
}

function escapeHtml(value: any): string {
  if (value === null || value === undefined) return '—';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function exportFormalDocumentPdf(opts: PrintableDocumentOptions): void {
  const win = window.open('', '_blank', 'width=1024,height=840');
  if (!win) {
    alert('Please allow pop-ups in your browser to export formal PDF documents.');
    return;
  }

  const issueDate = opts.issueDate || new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const metaHtml = (opts.metadata || [])
    .map(
      (m) => `
      <div class="meta-cell">
        <div class="meta-label">${escapeHtml(m.label)}</div>
        <div class="meta-value">${escapeHtml(m.value ?? '—')}</div>
      </div>`
    )
    .join('');

  const tableHtml =
    opts.columns && opts.columns.length > 0
      ? `
      <table class="data-table">
        <thead>
          <tr>
            ${opts.columns
              .map(
                (c) =>
                  `<th class="${c.align === 'right' ? 'num' : c.align === 'center' ? 'center' : ''}">${escapeHtml(
                    c.label
                  )}</th>`
              )
              .join('')}
          </tr>
        </thead>
        <tbody>
          ${
            opts.rows && opts.rows.length > 0
              ? opts.rows
                  .map(
                    (row) => `
                <tr>
                  ${opts.columns!
                    .map(
                      (c) =>
                        `<td class="${c.align === 'right' ? 'num' : c.align === 'center' ? 'center' : ''}">${escapeHtml(
                          row[c.key] ?? '—'
                        )}</td>`
                    )
                    .join('')}
                </tr>`
                  )
                  .join('')
              : `<tr><td colspan="${opts.columns.length}" style="text-align:center;padding:18px;color:#64748b;">No line items recorded</td></tr>`
          }
        </tbody>
      </table>`
      : '';

  const totalsHtml =
    opts.summaryTotals && opts.summaryTotals.length > 0
      ? `
      <div class="totals-wrap">
        <table class="totals-table">
          <tbody>
            ${opts.summaryTotals
              .map(
                (t) => `
              <tr class="${t.highlight ? 'highlight-row' : ''}">
                <td>${escapeHtml(t.label)}</td>
                <td class="num">${escapeHtml(t.value)}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>`
      : '';

  const signatures = opts.signatures || [
    { role: 'Prepared & Submitted By', party: 'Enser Ltd (Main M&E Contractor)' },
    { role: 'Reviewed & Certified By', party: 'Supervising MEP Consultant' },
    { role: 'Approved & Authorized By', party: 'Employer / Client Representative' },
  ];

  const sigHtml = signatures
    .map(
      (s) => `
      <div class="sig-box">
        <div class="sig-role">${escapeHtml(s.role)}</div>
        <div class="sig-party">${escapeHtml(s.party)}</div>
        <div class="sig-line"></div>
        <div class="sig-meta">
          <span>Name: ${escapeHtml(s.name || '______________________')}</span>
          <span>Date: ${escapeHtml(s.date || '____/____/2026')}</span>
        </div>
      </div>`
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(opts.referenceCode)} — ${escapeHtml(opts.title)}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 14mm;
    }
    * {
      box-sizing: border-box;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    body {
      margin: 0;
      padding: 24px;
      color: #0f172a;
      background: #ffffff;
      font-size: 11px;
      line-height: 1.45;
    }
    .toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 16px;
      margin-bottom: 20px;
      background: #0f172a;
      color: #f8fafc;
      border-radius: 6px;
    }
    .toolbar button {
      background: #2563eb;
      color: #ffffff;
      border: none;
      padding: 7px 14px;
      border-radius: 4px;
      font-weight: 600;
      font-size: 12px;
      cursor: pointer;
    }
    @media print {
      body { padding: 0; }
      .toolbar { display: none !important; }
    }
    .header-box {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border: 1.5px solid #0f172a;
      padding: 14px 16px;
      margin-bottom: 14px;
    }
    .company-brand {
      font-size: 16px;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: #0f172a;
    }
    .company-sub {
      font-size: 10px;
      color: #475569;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-top: 2px;
    }
    .doc-control {
      text-align: right;
    }
    .doc-type-badge {
      display: inline-block;
      background: #0f172a;
      color: #ffffff;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 3px 8px;
      margin-bottom: 4px;
    }
    .doc-ref {
      font-family: 'JetBrains Mono', Consolas, monospace;
      font-size: 13px;
      font-weight: 700;
      color: #1e293b;
    }
    .title-banner {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      padding: 10px 14px;
      margin-bottom: 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .title-banner h1 {
      margin: 0;
      font-size: 14px;
      font-weight: 700;
      color: #0f172a;
    }
    .title-banner .status-pill {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 3px 8px;
      border: 1px solid #475569;
      background: #ffffff;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      border-top: 1px solid #cbd5e1;
      border-left: 1px solid #cbd5e1;
      margin-bottom: 16px;
    }
    .meta-cell {
      border-right: 1px solid #cbd5e1;
      border-bottom: 1px solid #cbd5e1;
      padding: 7px 10px;
    }
    .meta-label {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      color: #64748b;
      letter-spacing: 0.04em;
    }
    .meta-value {
      font-size: 11px;
      font-weight: 600;
      color: #0f172a;
      margin-top: 2px;
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 14px;
    }
    .data-table th {
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      padding: 7px 9px;
      text-align: left;
      font-size: 9.5px;
      font-weight: 700;
      text-transform: uppercase;
      color: #334155;
    }
    .data-table td {
      border: 1px solid #cbd5e1;
      padding: 6px 9px;
      font-size: 10.5px;
      color: #0f172a;
      vertical-align: top;
    }
    .data-table .num, .totals-table .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      font-family: 'JetBrains Mono', Consolas, monospace;
    }
    .data-table .center {
      text-align: center;
    }
    .totals-wrap {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 16px;
    }
    .totals-table {
      width: 320px;
      border-collapse: collapse;
    }
    .totals-table td {
      border: 1px solid #cbd5e1;
      padding: 6px 10px;
      font-size: 11px;
    }
    .totals-table .highlight-row td {
      background: #0f172a;
      color: #ffffff;
      font-weight: 700;
      font-size: 12px;
    }
    .notes-box {
      border: 1px solid #cbd5e1;
      background: #f8fafc;
      padding: 10px 12px;
      margin-bottom: 18px;
    }
    .notes-title {
      font-size: 9.5px;
      font-weight: 700;
      text-transform: uppercase;
      color: #475569;
      margin-bottom: 4px;
    }
    .sig-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-top: 22px;
      page-break-inside: avoid;
    }
    .sig-box {
      border: 1px solid #94a3b8;
      padding: 10px;
    }
    .sig-role {
      font-size: 9.5px;
      font-weight: 700;
      text-transform: uppercase;
      color: #475569;
    }
    .sig-party {
      font-size: 10.5px;
      font-weight: 600;
      color: #0f172a;
      margin-top: 2px;
    }
    .sig-line {
      height: 42px;
      border-bottom: 1px dashed #64748b;
      margin-bottom: 6px;
    }
    .sig-meta {
      display: flex;
      justify-content: space-between;
      font-size: 9.5px;
      color: #475569;
    }
    .doc-footer {
      margin-top: 18px;
      padding-top: 8px;
      border-top: 1px solid #cbd5e1;
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div>
      <strong>MEP FieldHub Enterprise Document Engine</strong> — ${escapeHtml(opts.referenceCode)}
    </div>
    <div style="display:flex;gap:8px;">
      <button onclick="window.print()">Print / Save as PDF</button>
      <button style="background:#334155;" onclick="window.close()">Close</button>
    </div>
  </div>

  <div class="header-box">
    <div>
      <div class="company-brand">ENSER LTD — MEP ENGINEERING &amp; CONTRACTING</div>
      <div class="company-sub">Mechanical · Electrical · Plumbing · Fire Life Safety · BMS</div>
      <div style="font-size:10px;color:#475569;margin-top:4px;">
        Project: <strong>${escapeHtml(opts.projectName || 'BOV Head Office Renovation — St Venera')}</strong>
        ${opts.projectCode ? `(${escapeHtml(opts.projectCode)})` : ''}
      </div>
    </div>
    <div class="doc-control">
      <div class="doc-type-badge">${escapeHtml(opts.documentType)}</div>
      <div class="doc-ref">${escapeHtml(opts.referenceCode)}</div>
      <div style="font-size:10px;color:#475569;margin-top:2px;">Issue Date: ${escapeHtml(issueDate)}</div>
    </div>
  </div>

  <div class="title-banner">
    <div>
      <h1>${escapeHtml(opts.title)}</h1>
      ${opts.subtitle ? `<div style="font-size:10.5px;color:#475569;margin-top:2px;">${escapeHtml(opts.subtitle)}</div>` : ''}
    </div>
    ${opts.status ? `<div class="status-pill">${escapeHtml(opts.status)}</div>` : ''}
  </div>

  ${metaHtml ? `<div class="meta-grid">${metaHtml}</div>` : ''}

  ${tableHtml}

  ${totalsHtml}

  ${
    opts.notes
      ? `<div class="notes-box">
          <div class="notes-title">Technical &amp; Commercial Remarks / Terms</div>
          <div>${escapeHtml(opts.notes)}</div>
        </div>`
      : ''
  }

  <div class="sig-grid">
    ${sigHtml}
  </div>

  <div class="doc-footer">
    <span>Generated by MEP FieldHub Enterprise ERP · ISO-9001 Controlled Document</span>
    <span>Printed: ${escapeHtml(new Date().toISOString())}</span>
  </div>

  <script>
    window.addEventListener('load', function() {
      setTimeout(function() { window.print(); }, 250);
    });
  </script>
</body>
</html>`;

  win.document.open();
  win.document.write(html);
  win.document.close();
}
