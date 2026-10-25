let dailyLogsViewMode = 'feed';
let dailyLogsTradeFilter = 'ALL';
let dailyLogsSearch = '';

function weatherIconFor(w){
  const s = String(w || '').toLowerCase();
  if(s.includes('rain') || s.includes('storm') || s.includes('wet')) return '🌧️';
  if(s.includes('wind')) return '💨';
  if(s.includes('cloud') || s.includes('overcast')) return '⛅';
  if(s.includes('hot') || s.includes('heat')) return '🌡️';
  return '☀️';
}

async function renderDailyLogsWorkspace(){
  const [logs, docs] = await Promise.all([
    apiFetch(`/api/dailylogs?project_id=${currentProjectId}`),
    apiFetch(`/api/documents?project_id=${currentProjectId}`).catch(() => [])
  ]);

  const canEdit = ME.permissions.edit.includes('dailylogs');
  const canDel = ME.permissions.delete && canEdit;
  const todayIso = new Date().toISOString().slice(0, 10);

  const sitePhotosByDate = {};
  docs.filter(d => d.category === 'Site Photo' && d.attachment_data).forEach(d => {
    const dt = d.date_added || '';
    if(!sitePhotosByDate[dt]) sitePhotosByDate[dt] = [];
    sitePhotosByDate[dt].push(d);
  });

  const sortedLogs = [...logs].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const filtered = sortedLogs.filter(l => {
    if(dailyLogsTradeFilter !== 'ALL' && l.trade !== dailyLogsTradeFilter) return false;
    if(dailyLogsSearch){
      const q = dailyLogsSearch.toLowerCase();
      const hay = `${l.date||''} ${l.trade||''} ${l.weather||''} ${l.notes||''}`.toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });

  const totalCrewDays = logs.reduce((s, l) => s + Number(l.crew || 0), 0);
  const delayLogs = logs.filter(l => /delay|rain|hold|stop|wait|issue|obstruction|shortage/i.test(`${l.weather||''} ${l.notes||''}`)).length;
  const todayLogged = logs.some(l => l.date === todayIso);

  document.getElementById('viewContent').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px;">
      <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(175px,1fr));">
        <div class="stat-card">
          <div class="num">${logs.length}</div>
          <div class="lbl">Total Field Daily Logs</div>
        </div>
        <div class="stat-card">
          <div class="num" style="color:#0284c7;">${totalCrewDays}</div>
          <div class="lbl">Cumulative Crew Man-Days</div>
        </div>
        <div class="stat-card ${delayLogs > 0 ? 'warn' : ''}">
          <div class="num" style="color:${delayLogs > 0 ? '#ef4444' : 'var(--text)'};">${delayLogs}</div>
          <div class="lbl">Weather / Site Delay Notices</div>
        </div>
        <div class="stat-card">
          <div class="num" style="color:${todayLogged ? '#10b981' : '#f59e0b'};font-size:18px;">${todayLogged ? '✓ LOGGED TODAY' : 'PENDING TODAY'}</div>
          <div class="lbl">Today's Site Log (${todayIso})</div>
        </div>
      </div>

      <div class="panel" style="padding:14px 18px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <div class="view-mode-toggle">
              <button class="view-mode-btn ${dailyLogsViewMode==='feed'?'active':''}" id="dlViewFeed">Timeline Feed</button>
              <button class="view-mode-btn ${dailyLogsViewMode==='table'?'active':''}" id="dlViewTable">Table Register</button>
            </div>
            <input id="dlSearchInput" value="${escHtml(dailyLogsSearch)}" placeholder="Search weather, notes, date..." style="min-width:200px;padding:6px 10px;font-size:12px;">
            <select id="dlTradeSelect" style="padding:6px 10px;font-size:12px;">
              <option value="ALL" ${dailyLogsTradeFilter==='ALL'?'selected':''}>All MEP Disciplines</option>
              ${TRADES.map(t => `<option value="${t}" ${dailyLogsTradeFilter===t?'selected':''}>${t}</option>`).join('')}
            </select>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            ${canEdit ? '<button class="btn ghost small" id="dlSnapPhotoBtn">📷 Capture Site Photo</button>' : ''}
            ${canEdit ? '<button class="btn accent small" id="dlAddLogBtn">+ Log Daily Site Report</button>' : ''}
            <button class="btn ghost small" id="dlExportBtn">Export CSV</button>
          </div>
        </div>
      </div>

      ${dailyLogsViewMode === 'feed' ? `
        ${filtered.length ? `
          <div class="bt-log-feed">
            ${filtered.map(l => {
              const hasDelay = /delay|rain|hold|stop|wait|issue|shortage/i.test(`${l.weather||''} ${l.notes||''}`);
              const dayPhotos = sitePhotosByDate[l.date] || [];
              return `
                <div class="bt-log-card ${hasDelay ? 'has-delay' : ''}">
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                    <div>
                      <div style="font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:700;color:var(--text);">${escHtml(l.date || '—')}</div>
                      <div style="font-size:11px;color:var(--muted);">Project: ${escHtml(PROJECTS.find(p => p.id === l.project_id)?.name || l.project_id)}</div>
                    </div>
                    <span class="disc-pill ${disciplineClass(l.trade)}">${escHtml(l.trade || 'MEP')}</span>
                  </div>
                  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                    <span class="bt-weather-pill">${weatherIconFor(l.weather)} ${escHtml(l.weather || 'Clear Site')}</span>
                    <span class="bt-crew-pill">👷 ${Number(l.crew || 0)} Operatives</span>
                    ${hasDelay ? '<span class="badge open">⚠️ Impact Noted</span>' : '<span class="badge closed">Normal Progress</span>'}
                  </div>
                  <div style="font-size:12.5px;color:var(--text);line-height:1.5;background:#f8fafc;padding:10px 12px;border-radius:6px;border:1px solid #e2e8f0;flex:1;">
                    ${escHtml(l.notes || 'Routine MEP installation and site coordination.')}
                  </div>
                  ${dayPhotos.length ? `
                    <div style="display:flex;gap:6px;overflow-x:auto;padding-top:4px;">
                      ${dayPhotos.slice(0, 4).map(ph => `
                        <img src="${ph.attachment_data}" alt="${escHtml(ph.name)}" style="width:56px;height:44px;object-fit:cover;border-radius:4px;border:1px solid var(--border);cursor:pointer;" data-dl-photo-id="${ph.id}">
                      `).join('')}
                    </div>
                  ` : ''}
                  ${canEdit ? `
                    <div style="display:flex;justify-content:flex-end;gap:6px;padding-top:6px;border-top:1px solid var(--hairline);">
                      <button class="btn ghost small" data-edit-log="${l.id}" style="padding:3px 8px;font-size:11px;">✎ Edit Log</button>
                      ${canDel ? `<button class="icon-btn" data-del-log="${l.id}" title="Delete Log">✕</button>` : ''}
                    </div>
                  ` : ''}
                </div>
              `;
            }).join('')}
          </div>
        ` : '<div class="panel"><div class="empty">No daily logs match your filter. Click "+ Log Daily Site Report" to record today\'s weather, crew count, and progress.</div></div>'}
      ` : `
        <div class="panel">
          ${filtered.length ? `
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Discipline</th>
                  <th>Weather Conditions</th>
                  <th>Crew Headcount</th>
                  <th>Work Performed & Site Notes</th>
                  ${canEdit ? '<th>Actions</th>' : ''}
                </tr>
              </thead>
              <tbody>
                ${filtered.map(l => `
                  <tr>
                    <td style="font-family:'IBM Plex Mono',monospace;font-weight:700;">${escHtml(l.date)}</td>
                    <td><span class="disc-pill ${disciplineClass(l.trade)}">${escHtml(l.trade)}</span></td>
                    <td><span class="bt-weather-pill">${weatherIconFor(l.weather)} ${escHtml(l.weather || '—')}</span></td>
                    <td><span class="bt-crew-pill">👷 ${Number(l.crew || 0)}</span></td>
                    <td>${escHtml(l.notes || '')}</td>
                    ${canEdit ? `
                      <td class="row-actions">
                        <button class="icon-btn edit" data-edit-log="${l.id}" title="Edit">✎</button>
                        ${canDel ? `<button class="icon-btn" data-del-log="${l.id}" title="Delete">✕</button>` : ''}
                      </td>
                    ` : ''}
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<div class="empty">No daily logs match your filter.</div>'}
        </div>
      `}
    </div>
  `;

  document.getElementById('dlViewFeed').onclick = () => { dailyLogsViewMode = 'feed'; renderDailyLogsWorkspace(); };
  document.getElementById('dlViewTable').onclick = () => { dailyLogsViewMode = 'table'; renderDailyLogsWorkspace(); };
  document.getElementById('dlSearchInput').oninput = (e) => { dailyLogsSearch = e.target.value; renderDailyLogsWorkspace(); };
  document.getElementById('dlTradeSelect').onchange = (e) => { dailyLogsTradeFilter = e.target.value; renderDailyLogsWorkspace(); };
  document.getElementById('dlExportBtn').onclick = () => exportCsv('dailylogs');

  if(document.getElementById('dlAddLogBtn')){
    document.getElementById('dlAddLogBtn').onclick = () => openAddModal('dailylogs', 'Daily Site Log', null, { date: todayIso, weather: 'Sunny, 24°C', crew: 12, trade: dailyLogsTradeFilter === 'ALL' ? 'HVAC' : dailyLogsTradeFilter });
  }
  if(document.getElementById('dlSnapPhotoBtn')){
    document.getElementById('dlSnapPhotoBtn').onclick = () => openCameraCaptureModal({ context: 'site_today', selectedDate: todayIso });
  }
  document.querySelectorAll('[data-edit-log]').forEach(btn => {
    btn.onclick = () => {
      const rec = logs.find(x => x.id === btn.dataset.editLog);
      if(rec) openEditModal('dailylogs', 'Daily Site Log', rec);
    };
  });
  document.querySelectorAll('[data-del-log]').forEach(btn => {
    btn.onclick = async () => {
      const ok = await confirmAction('Delete this daily log entry? This cannot be undone.');
      if(!ok) return;
      await apiFetch(`/api/dailylogs/${btn.dataset.delLog}`, { method: 'DELETE' });
      renderDailyLogsWorkspace();
    };
  });
}
