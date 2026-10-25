function updateJobContextRibbon(){
  const ribbon = document.getElementById('jobContextRibbon');
  if(!ribbon || !ME) return;
  const proj = currentProjectId === 'ALL' ? null : PROJECTS.find(p => String(p.id) === String(currentProjectId));
  const totalPortfolioBudget = PROJECTS.reduce((s, p) => s + Number(p.budget || 0), 0);
  const canEditTasks = ME.permissions?.edit?.includes('tasks');
  const canEditLogs = ME.permissions?.edit?.includes('dailylogs');
  const canEditRfis = ME.permissions?.edit?.includes('rfis');
  const canEditPunch = ME.permissions?.edit?.includes('punchlist');
  const canEditCO = ME.permissions?.edit?.includes('change_orders');
  const canEditCosts = ME.permissions?.edit?.includes('costs') || ME.permissions?.edit?.includes('budget');

  ribbon.innerHTML = `
    <div class="bt-job-meta">
      <span class="bt-job-code">${proj ? 'JOB #' + escHtml(String(proj.id).slice(0,8).toUpperCase()) : 'PORTFOLIO VIEW'}</span>
      <div>
        <div style="font-weight:700;font-size:14px;color:var(--text);">${proj ? escHtml(proj.name) : 'All Active MEP Projects (' + PROJECTS.length + ')'}</div>
        <div style="font-size:11px;color:var(--muted);">${proj ? 'Client: ' + escHtml(proj.client || 'Main Employer') : 'Enterprise Multi-Project Rollup'}</div>
      </div>
      <div class="bt-job-stat">
        <span>Contract Budget</span>
        <b>${fmtCurrency(proj ? proj.budget : totalPortfolioBudget)}</b>
      </div>
      ${proj && (proj.start_date || proj.end_date) ? `
        <div class="bt-job-stat">
          <span>Programme Window</span>
          <b>${escHtml(proj.start_date || '—')} → ${escHtml(proj.end_date || '—')}</b>
        </div>
      ` : ''}
      ${proj ? `
        <div class="bt-job-stat">
          <span>Job Status</span>
          <span><span class="badge ${badgeClass(proj.status)}">${escHtml(proj.status || 'Active')}</span></span>
        </div>
      ` : ''}
    </div>
    <div class="bt-quick-actions">
      <span class="bt-quick-label">Quick Create:</span>
      ${canEditCosts || ME.permissions?.edit?.includes('projects') ? '<button type="button" class="bt-quick-btn primary-quick" id="btQuickContractBoqBtn" title="Upload a Contract, Tender or BOQ to auto-fill Project, Budget, BOQ, Work Packages & Schedule">📄 Upload Contract / BOQ</button>' : ''}
      ${canEditTasks ? '<button type="button" class="bt-quick-btn" id="btQuickTaskBtn">+ Task</button>' : ''}
      ${canEditLogs ? '<button type="button" class="bt-quick-btn" id="btQuickLogBtn">+ Daily Log</button>' : ''}
      ${canEditRfis ? '<button type="button" class="bt-quick-btn" id="btQuickRfiBtn">+ RFI</button>' : ''}
      ${canEditPunch ? '<button type="button" class="bt-quick-btn" id="btQuickSnagBtn">+ Punch Snag</button>' : ''}
      ${canEditCO ? '<button type="button" class="bt-quick-btn" id="btQuickCoBtn">+ Variation (CO)</button>' : ''}
      ${canEditCosts ? '<button type="button" class="bt-quick-btn" id="btQuickCostBtn">+ Cost Entry</button>' : ''}
    </div>
  `;

  const todayIso = new Date().toISOString().slice(0,10);
  if(document.getElementById('btQuickContractBoqBtn')){
    document.getElementById('btQuickContractBoqBtn').onclick = () => {
      if(typeof window.openContractBoqAutoFillModal === 'function'){
        window.openContractBoqAutoFillModal();
      }
    };
  }
  if(document.getElementById('btQuickTaskBtn')){
    document.getElementById('btQuickTaskBtn').onclick = () => openAddModal('tasks', 'Task', null, { start: todayIso, end: todayIso, progress: 0, status: 'Not Started' });
  }
  if(document.getElementById('btQuickLogBtn')){
    document.getElementById('btQuickLogBtn').onclick = () => openAddModal('dailylogs', 'Daily Site Log', null, { date: todayIso, weather: 'Sunny, 24°C', crew: 12 });
  }
  if(document.getElementById('btQuickRfiBtn')){
    document.getElementById('btQuickRfiBtn').onclick = () => openAddModal('rfis', 'RFI', null, { number: 'RFI-' + String(Math.floor(100 + Math.random()*899)), date_raised: todayIso, status: 'Open' });
  }
  if(document.getElementById('btQuickSnagBtn')){
    document.getElementById('btQuickSnagBtn').onclick = () => openAddModal('punchlist', 'Punch Item', null, { date_raised: todayIso, priority: 'High', status: 'Open' });
  }
  if(document.getElementById('btQuickCoBtn')){
    document.getElementById('btQuickCoBtn').onclick = () => openAddModal('change_orders', 'Change Order', null, { number: 'CO-' + String(Math.floor(100 + Math.random()*899)), date_raised: todayIso, status: 'Pending' });
  }
  if(document.getElementById('btQuickCostBtn')){
    document.getElementById('btQuickCostBtn').onclick = () => openAddModal('costs', 'Cost Entry', null, { date_logged: todayIso });
  }
}

let inlineCalWeekOffset = 0;

function renderInlineScheduleGanttHtml(rows){
  const withDates = rows.filter(r => r.start && r.end);
  if(!withDates.length){
    return '<div class="panel"><div class="empty">No filtered tasks have start and end dates yet. Add start/end dates or click "Programme from BOQ".</div></div>';
  }
  const starts = withDates.map(r => new Date(r.start).getTime());
  const ends = withDates.map(r => new Date(r.end).getTime());
  const minT = Math.min(...starts);
  const maxT = Math.max(...ends);
  const span = Math.max(maxT - minT, 86400000);
  const fmtShort = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const midT = minT + span / 2;

  const sorted = [...withDates].sort((a, b) => {
    if(a.wbs_code && b.wbs_code) return a.wbs_code.localeCompare(b.wbs_code, undefined, { numeric: true });
    return new Date(a.start) - new Date(b.start);
  });

  return `
    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
        <div>
          <h3 style="margin:0;">Buildertrend Programme Gantt Timeline (${sorted.length} scheduled tasks)</h3>
          <div style="font-size:11px;color:var(--muted);">Click any task bar to update schedule dates, assignee, or completion %</div>
        </div>
        <div style="display:flex;gap:12px;font-size:11px;color:var(--muted);align-items:center;">
          <span><span style="display:inline-block;width:10px;height:10px;background:#38bdf8;border-radius:2px;margin-right:4px;"></span>In Progress</span>
          <span><span style="display:inline-block;width:10px;height:10px;background:#10b981;border-radius:2px;margin-right:4px;"></span>Completed</span>
          <span><span style="display:inline-block;width:10px;height:10px;background:#ef4444;border-radius:2px;margin-right:4px;"></span>Delayed</span>
        </div>
      </div>
      <div class="gantt-scale"><div>Task / WBS</div><div class="lbl"><span>${fmtShort(minT)}</span><span>${fmtShort(midT)}</span><span>${fmtShort(maxT)}</span></div></div>
      <div style="max-height:580px;overflow-y:auto;border-top:1px solid var(--border);">
        ${sorted.map(r => {
          const s = new Date(r.start).getTime(), e = new Date(r.end).getTime();
          const left = Math.max(0, Math.min(98, ((s - minT) / span) * 100));
          const width = Math.max(((e - s) / span) * 100, 2.2);
          return `
            <div class="gantt-row" data-edit-task="${r.id}" style="cursor:pointer;">
              <div class="gantt-label" title="${escHtml(r.title)}">
                ${r.wbs_code ? `<span class="wbs">${escHtml(r.wbs_code)}</span>` : ''}
                <div style="overflow:hidden;text-overflow:ellipsis;">
                  <b>${escHtml(r.title)}</b>
                  <span class="sub">${escHtml(r.trade || 'MEP')} · ${escHtml(r.assignee || 'Site Team')}</span>
                </div>
              </div>
              <div class="gantt-track">
                <div class="gantt-bar status-${statusSlug(r.status)}" style="left:${left}%;width:${width}%;" title="${escHtml(r.status)} — ${r.progress||0}% (${r.start} to ${r.end})">
                  ${width > 4 ? `${r.progress||0}%` : ''}
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function renderInlineScheduleCalendarHtml(rows){
  const today = new Date();
  const baseMonday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7) + (inlineCalWeekOffset * 7));
  const days = Array.from({ length: 7 }, (_, idx) => {
    const d = new Date(baseMonday);
    d.setDate(baseMonday.getDate() + idx);
    return d;
  });
  const iso = d => d.toISOString().slice(0, 10);
  const todayIso = iso(today);
  const rangeLabel = `${days[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${days[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;

  return `
    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px;">
        <div>
          <h3 style="margin:0;">Weekly Field Programme Calendar · ${escHtml(rangeLabel)}</h3>
          <div style="font-size:11px;color:var(--muted);">Showing active tasks across 7-day site lookahead window</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <button type="button" class="btn ghost small" id="inlineCalPrevBtn">← Prev Week</button>
          <button type="button" class="btn ghost small" id="inlineCalTodayBtn">This Week</button>
          <button type="button" class="btn ghost small" id="inlineCalNextBtn">Next Week →</button>
        </div>
      </div>
      <div class="week-grid">
        ${days.map(day => {
          const dateStr = iso(day);
          const dayTasks = rows.filter(t => t.start && t.end && t.start <= dateStr && t.end >= dateStr);
          return `
            <section class="week-day ${dateStr === todayIso ? 'is-today' : ''}">
              <header>
                <b>${day.toLocaleDateString(undefined, { weekday: 'short' })}</b>
                <span>${day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              </header>
              ${dayTasks.length ? dayTasks.map(t => `
                <div class="week-task" data-edit-task="${t.id}" style="cursor:pointer;">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
                    <span class="disc-pill ${disciplineClass(t.trade)}" style="font-size:9px;padding:1px 5px;">${escHtml(t.trade||'MEP')}</span>
                    <span style="font-family:monospace;font-size:10px;font-weight:700;">${t.progress||0}%</span>
                  </div>
                  <h4>${escHtml(t.title)}</h4>
                  <span>${escHtml(t.assignee || 'Site Team')}</span>
                </div>
              `).join('') : '<div class="week-empty">No scheduled work</div>'}
            </section>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function wireInlineScheduleCalendarEvents(){
  if(document.getElementById('inlineCalPrevBtn')){
    document.getElementById('inlineCalPrevBtn').onclick = () => { inlineCalWeekOffset -= 1; renderTasksWorkspace(); };
  }
  if(document.getElementById('inlineCalTodayBtn')){
    document.getElementById('inlineCalTodayBtn').onclick = () => { inlineCalWeekOffset = 0; renderTasksWorkspace(); };
  }
  if(document.getElementById('inlineCalNextBtn')){
    document.getElementById('inlineCalNextBtn').onclick = () => { inlineCalWeekOffset += 1; renderTasksWorkspace(); };
  }
}

/* ==========================================================================
   UPGRADE 3: BUILDERTREND 6-COLUMN JOB COSTING & BUDGET VARIANCE WORKSPACE
   ========================================================================== */
