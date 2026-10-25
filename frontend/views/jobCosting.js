let costDisciplineFilter = 'ALL';

async function renderJobCosting(){
  const [costs, boqItems, changeOrders, purchaseOrders] = await Promise.all([
    apiFetch(`/api/costs?project_id=${currentProjectId}`),
    apiFetch(`/api/boq_items?project_id=${currentProjectId}`).catch(() => []),
    apiFetch(`/api/change_orders?project_id=${currentProjectId}`).catch(() => []),
    apiFetch(`/api/purchase_orders?project_id=${currentProjectId}`).catch(() => [])
  ]);

  const canEdit = ME.permissions.edit.includes('costs') || ME.permissions.edit.includes('budget');
  const canDel = ME.permissions.delete && canEdit;

  const normTrade = (raw) => {
    const s = String(raw || '').toLowerCase();
    if(s.includes('hvac') || s.includes('mech') || s.includes('vent') || s.includes('chill')) return 'HVAC';
    if(s.includes('elec') || s.includes('power') || s.includes('light') || s.includes('lv')) return 'Electrical';
    if(s.includes('plumb') || s.includes('hydr') || s.includes('water') || s.includes('drain')) return 'Plumbing';
    if(s.includes('fire') || s.includes('sprink')) return 'Fire Protection';
    if(s.includes('bms') || s.includes('control') || s.includes('elv') || s.includes('ict')) return 'BMS/Controls';
    return 'Other';
  };

  // Build 6-column rollup by MEP Discipline
  const tradeRollup = {};
  TRADES.forEach(tr => {
    tradeRollup[tr] = {
      trade: tr,
      boqEstimate: 0,
      plannedCost: 0,
      approvedCOs: 0,
      pendingCOs: 0,
      committedPOs: 0,
      actualCosts: 0
    };
  });

  boqItems.forEach(b => {
    const tr = normTrade(b.discipline || b.system);
    const amt = Number(b.tender_amount || (Number(b.tender_quantity||0) * Number(b.tender_rate||0)) || 0);
    tradeRollup[tr].boqEstimate += amt;
  });

  costs.forEach(c => {
    const tr = normTrade(c.category);
    tradeRollup[tr].plannedCost += Number(c.planned || 0);
    tradeRollup[tr].actualCosts += Number(c.actual || 0);
  });

  changeOrders.forEach(co => {
    const tr = normTrade(co.trade);
    const impact = Number(co.cost_impact || 0);
    const st = String(co.status || '').toLowerCase();
    if(['approved','po pending','po issued','work in progress','work complete','claimed','certified','paid','closed'].includes(st)){
      tradeRollup[tr].approvedCOs += impact;
    } else if(!st.includes('reject')){
      tradeRollup[tr].pendingCOs += impact;
    }
  });

  purchaseOrders.forEach(po => {
    const tr = normTrade(po.trade);
    const st = String(po.status || '').toLowerCase();
    if(!st.includes('cancel')){
      tradeRollup[tr].committedPOs += Number(po.amount || 0);
    }
  });

  const rowsByTrade = TRADES.map(tr => {
    const r = tradeRollup[tr];
    // Original estimate uses BOQ tender sum if present, otherwise Planned Cost entries
    const originalEst = r.boqEstimate > 0 ? r.boqEstimate : r.plannedCost;
    const revisedBudget = originalEst + r.approvedCOs;
    const totalExposure = Math.max(r.actualCosts, r.committedPOs);
    const variance = revisedBudget - r.actualCosts;
    const pctUsed = revisedBudget > 0 ? Math.round((r.actualCosts / revisedBudget) * 100) : (r.actualCosts > 0 ? 100 : 0);
    return {
      ...r,
      originalEst,
      revisedBudget,
      totalExposure,
      variance,
      pctUsed
    };
  });

  const totOriginal = rowsByTrade.reduce((s, r) => s + r.originalEst, 0);
  const totApprovedCO = rowsByTrade.reduce((s, r) => s + r.approvedCOs, 0);
  const totPendingCO = rowsByTrade.reduce((s, r) => s + r.pendingCOs, 0);
  const totRevised = rowsByTrade.reduce((s, r) => s + r.revisedBudget, 0);
  const totCommittedPO = rowsByTrade.reduce((s, r) => s + r.committedPOs, 0);
  const totActual = rowsByTrade.reduce((s, r) => s + r.actualCosts, 0);
  const totVariance = totRevised - totActual;
  const totPct = totRevised > 0 ? Math.round((totActual / totRevised) * 100) : 0;

  const filteredCosts = costDisciplineFilter === 'ALL'
    ? costs
    : costs.filter(c => normTrade(c.category) === costDisciplineFilter);

  document.getElementById('viewContent').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px;">
      <!-- 6 Buildertrend Financial KPI Cards -->
      <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(175px,1fr));">
        <div class="stat-card">
          <div class="num">${fmtCurrency(totOriginal)}</div>
          <div class="lbl">1. Original Estimate (BOQ/Plan)</div>
        </div>
        <div class="stat-card">
          <div class="num" style="color:#f59e0b;">${totApprovedCO >= 0 ? '+' : ''}${fmtCurrency(totApprovedCO)}</div>
          <div class="lbl">2. Approved Variations (${fmtCurrency(totPendingCO)} Pending)</div>
        </div>
        <div class="stat-card">
          <div class="num" style="color:#0284c7;">${fmtCurrency(totRevised)}</div>
          <div class="lbl">3. Revised Contract Budget</div>
        </div>
        <div class="stat-card">
          <div class="num" style="color:#6366f1;">${fmtCurrency(totCommittedPO)}</div>
          <div class="lbl">4. Committed Purchase Orders</div>
        </div>
        <div class="stat-card">
          <div class="num" style="color:#0f172a;">${fmtCurrency(totActual)}</div>
          <div class="lbl">5. Actual Costs Logged (${totPct}%)</div>
        </div>
        <div class="stat-card ${totVariance < 0 ? 'warn' : ''}">
          <div class="num" style="color:${totVariance >= 0 ? '#10b981' : '#ef4444'};">${totVariance >= 0 ? '+' : ''}${fmtCurrency(totVariance)}</div>
          <div class="lbl">6. Net Budget Variance (${totVariance >= 0 ? 'Under' : 'Overrun'})</div>
        </div>
      </div>

      <!-- Buildertrend 6-Column Job Costing & Budget Control Sheet -->
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:10px;">
          <div>
            <h3 style="margin:0;">Buildertrend 6-Column Job Costing & Variance Control Sheet</h3>
            <div style="font-size:11px;color:var(--muted);">Live commercial rollup combining BOQ Tender Estimates + Approved Change Orders + Committed POs vs. Actual Logged Costs</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            ${canEdit ? '<button class="btn ghost small" id="jcAddCoBtn">+ Raise Variation (CO)</button>' : ''}
            ${canEdit ? '<button class="btn accent small" id="jcAddCostBtn">+ Log Cost Entry</button>' : ''}
            <button class="btn ghost small" id="jcExportBtn">Export Cost CSV</button>
          </div>
        </div>
        <div style="overflow-x:auto;">
          <table class="bt-cost-table">
            <thead>
              <tr>
                <th>Cost Code / MEP Discipline</th>
                <th style="text-align:right;">1. Original Estimate</th>
                <th style="text-align:right;">2. Approved Variations</th>
                <th style="text-align:right;">3. Revised Budget</th>
                <th style="text-align:right;">4. Committed POs</th>
                <th style="text-align:right;">5. Actual Cost</th>
                <th style="text-align:right;">6. Net Variance</th>
                <th style="min-width:130px;">Budget Burn</th>
              </tr>
            </thead>
            <tbody>
              ${rowsByTrade.map((r, idx) => {
                const isOver = r.variance < 0;
                const barColor = isOver ? '#ef4444' : (r.pctUsed > 85 ? '#f59e0b' : '#10b981');
                return `
                  <tr style="cursor:pointer;" data-filter-cost-trade="${r.trade}" title="Click to filter cost ledger by ${r.trade}">
                    <td>
                      <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--muted);margin-right:6px;">0${idx+1}-MEP</span>
                      <span class="disc-pill ${disciplineClass(r.trade)}">${escHtml(r.trade)}</span>
                    </td>
                    <td style="text-align:right;font-family:'IBM Plex Mono',monospace;">${fmtCurrency(r.originalEst)}</td>
                    <td style="text-align:right;font-family:'IBM Plex Mono',monospace;color:${r.approvedCOs>0?'#d97706':'var(--muted)'};">${r.approvedCOs>=0?'+':''}${fmtCurrency(r.approvedCOs)}</td>
                    <td style="text-align:right;font-family:'IBM Plex Mono',monospace;font-weight:700;">${fmtCurrency(r.revisedBudget)}</td>
                    <td style="text-align:right;font-family:'IBM Plex Mono',monospace;color:#4f46e5;">${fmtCurrency(r.committedPOs)}</td>
                    <td style="text-align:right;font-family:'IBM Plex Mono',monospace;font-weight:700;">${fmtCurrency(r.actualCosts)}</td>
                    <td style="text-align:right;font-family:'IBM Plex Mono',monospace;font-weight:700;color:${isOver?'#dc2626':'#059669'};">
                      ${r.variance>=0?'+':''}${fmtCurrency(r.variance)}
                    </td>
                    <td>
                      <div style="display:flex;align-items:center;gap:8px;">
                        <div style="flex:1;height:7px;background:#e2e8f0;border-radius:999px;overflow:hidden;">
                          <div style="height:100%;width:${Math.min(100, Math.max(0, r.pctUsed))}%;background:${barColor};"></div>
                        </div>
                        <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:700;min-width:34px;text-align:right;">${r.pctUsed}%</span>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
            <tfoot>
              <tr>
                <td>TOTAL JOB COSTING CONTROL</td>
                <td style="text-align:right;">${fmtCurrency(totOriginal)}</td>
                <td style="text-align:right;color:#d97706;">+${fmtCurrency(totApprovedCO)}</td>
                <td style="text-align:right;">${fmtCurrency(totRevised)}</td>
                <td style="text-align:right;color:#4f46e5;">${fmtCurrency(totCommittedPO)}</td>
                <td style="text-align:right;">${fmtCurrency(totActual)}</td>
                <td style="text-align:right;color:${totVariance>=0?'#059669':'#dc2626'};">${totVariance>=0?'+':''}${fmtCurrency(totVariance)}</td>
                <td>${totPct}% Burned</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <!-- Detailed Itemized Cost Ledger -->
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:10px;">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <h3 style="margin:0;">Itemized Cost Ledger (${filteredCosts.length} entries)</h3>
            <select id="jcFilterSelect" style="padding:5px 10px;font-size:12px;">
              <option value="ALL" ${costDisciplineFilter==='ALL'?'selected':''}>All MEP Disciplines</option>
              ${TRADES.map(t => `<option value="${t}" ${costDisciplineFilter===t?'selected':''}>${t}</option>`).join('')}
            </select>
            ${costDisciplineFilter !== 'ALL' ? '<button class="btn ghost small" id="jcClearFilterBtn">Clear Filter</button>' : ''}
          </div>
        </div>
        ${filteredCosts.length ? `
          <table>
            <thead>
              <tr>
                <th>Discipline</th>
                <th>Cost Description / Invoice Package</th>
                <th style="text-align:right;">Planned Budget</th>
                <th style="text-align:right;">Actual Cost</th>
                <th style="text-align:right;">Line Variance</th>
                <th>Date Logged</th>
                ${canEdit ? '<th>Actions</th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${filteredCosts.map(c => {
                const pl = Number(c.planned || 0);
                const ac = Number(c.actual || 0);
                const diff = pl - ac;
                return `
                  <tr>
                    <td><span class="disc-pill ${disciplineClass(c.category)}">${escHtml(c.category || 'MEP')}</span></td>
                    <td><b>${escHtml(c.description)}</b></td>
                    <td style="text-align:right;font-family:'IBM Plex Mono',monospace;">${fmtCurrency(pl)}</td>
                    <td style="text-align:right;font-family:'IBM Plex Mono',monospace;font-weight:700;">${fmtCurrency(ac)}</td>
                    <td style="text-align:right;font-family:'IBM Plex Mono',monospace;color:${diff>=0?'#059669':'#dc2626'};">${diff>=0?'+':''}${fmtCurrency(diff)}</td>
                    <td>${escHtml(c.date_logged || '—')}</td>
                    ${canEdit ? `
                      <td class="row-actions">
                        <button class="icon-btn edit" data-edit-cost="${c.id}" title="Edit Cost Entry">✎</button>
                        ${canDel ? `<button class="icon-btn" data-del-cost="${c.id}" title="Delete Cost Entry">✕</button>` : ''}
                      </td>
                    ` : ''}
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        ` : '<div class="empty">No itemized cost entries match the current filter.</div>'}
      </div>
    </div>
  `;

  if(document.getElementById('jcAddCostBtn')){
    document.getElementById('jcAddCostBtn').onclick = () => openAddModal('costs', 'Cost Entry', null, { date_logged: new Date().toISOString().slice(0,10), category: costDisciplineFilter === 'ALL' ? 'HVAC' : costDisciplineFilter });
  }
  if(document.getElementById('jcAddCoBtn')){
    document.getElementById('jcAddCoBtn').onclick = () => openAddModal('change_orders', 'Change Order', null, { number: 'CO-' + String(Math.floor(100 + Math.random()*899)), date_raised: new Date().toISOString().slice(0,10), status: 'Pending' });
  }
  document.getElementById('jcExportBtn').onclick = () => exportCsv('costs');
  document.getElementById('jcFilterSelect').onchange = (e) => { costDisciplineFilter = e.target.value; renderJobCosting(); };
  if(document.getElementById('jcClearFilterBtn')){
    document.getElementById('jcClearFilterBtn').onclick = () => { costDisciplineFilter = 'ALL'; renderJobCosting(); };
  }
  document.querySelectorAll('[data-filter-cost-trade]').forEach(row => {
    row.onclick = () => {
      const tr = row.dataset.filterCostTrade;
      costDisciplineFilter = (costDisciplineFilter === tr) ? 'ALL' : tr;
      renderJobCosting();
    };
  });
  document.querySelectorAll('[data-edit-cost]').forEach(btn => {
    btn.onclick = () => {
      const rec = costs.find(x => x.id === btn.dataset.editCost);
      if(rec) openEditModal('costs', 'Cost Entry', rec);
    };
  });
  document.querySelectorAll('[data-del-cost]').forEach(btn => {
    btn.onclick = async () => {
      const ok = await confirmAction('Delete this cost entry? This cannot be undone.');
      if(!ok) return;
      await apiFetch(`/api/costs/${btn.dataset.delCost}`, { method: 'DELETE' });
      renderJobCosting();
    };
  });
}

/* ==========================================================================
   UPGRADE 4: BUILDERTREND FIELD DAILY LOGS FEED & REGISTER
   ========================================================================== */
