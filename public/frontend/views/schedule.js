const BOQ_NON_MATERIAL_RE = /\b(labou?r|installation only|testing|commissioning|service fee|service contract|preliminary|preliminaries|provisional sum|daywork|attendance|dismantling|re-installation|retermination|training|as[- ]fitted drawings|operating manuals)\b/i;

function disciplineClass(d){
  const s = (d||'').toLowerCase();
  if(s.includes('elec')) return 'disc-Electrical';
  if(s.includes('plumb') || s.includes('hydr')) return 'disc-Plumbing';
  if(s.includes('fire')) return 'disc-Fire';
  if(s.includes('bms') || s.includes('elv') || s.includes('control')) return 'disc-BMS';
  return 'disc-HVAC';
}

async function generateProgrammeFromBOQ(rows){
  const projId = currentProjectId === 'ALL' ? (PROJECTS[0]?.id || '') : currentProjectId;
  if(!projId){ alert('Select a project first.'); return; }
  const boqRows = rows || await apiFetch(`/api/boq_items?project_id=${projId}`);
  if(!boqRows.length){ alert('Import or add BOQ lines first before generating the programme.'); return; }
  const existingTasks = await apiFetch(`/api/tasks?project_id=${projId}`);
  const existingTitles = new Set(existingTasks.map(t => (t.title||'').toLowerCase()));
  const groups = new Map();
  for(const r of boqRows){
    const disc = String(r.discipline || 'HVAC').trim();
    const sys = String(r.system || 'General').trim();
    const key = `${disc}|${sys}`.toLowerCase();
    const g = groups.get(key) || { label: sys ? `${disc} · ${sys}` : disc, disc, rows: [], value: 0 };
    g.rows.push(r);
    g.value += Number(r.tender_amount || (Number(r.tender_quantity||0)*Number(r.tender_rate||0)) || 0);
    groups.set(key, g);
  }
  const phases = [
    { name: 'Procurement & Delivery', share: 0.3, offsetDays: 0 },
    { name: 'Site Installation', share: 0.5, offsetDays: 7 },
    { name: 'Testing & Commissioning', share: 0.2, offsetDays: 21 }
  ];
  const baseDate = new Date();
  const iso = d => d.toISOString().slice(0,10);
  const addDays = (d, n) => new Date(d.getTime() + n*86400000);
  let created = 0;
  let idx = 0;
  for(const [, g] of groups.entries()){
    const startOffset = idx * 3;
    for(const p of phases){
      const title = `${g.label} — ${p.name}`;
      if(existingTitles.has(title.toLowerCase())) continue;
      const sDate = addDays(baseDate, startOffset + p.offsetDays);
      const eDate = addDays(sDate, Math.max(4, Math.round(14 * p.share)));
      await apiFetch('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          project_id: projId,
          title,
          trade: g.disc,
          assignee: 'Site Team',
          start: iso(sDate),
          end: iso(eDate),
          progress: 0,
          status: 'Not Started',
          wbs_code: `BOQ-${idx+1}`
        })
      });
      created++;
    }
    idx++;
  }
  return created;
}

async function generateMaterialListFromBOQ(rows){
  const projId = currentProjectId === 'ALL' ? (PROJECTS[0]?.id || '') : currentProjectId;
  if(!projId){ alert('Select a project first.'); return; }
  const boqRows = rows || await apiFetch(`/api/boq_items?project_id=${projId}`);
  if(!boqRows.length){ alert('Import or add BOQ lines first.'); return; }
  const existingReqs = await apiFetch(`/api/material_requests?project_id=${projId}`);
  const existingMats = new Set(existingReqs.map(m => (m.material||'').toLowerCase()));
  const reqDate = new Date(Date.now() + 14*86400000).toISOString().slice(0,10);
  let created = 0;
  for(const r of boqRows){
    const desc = String(r.description || '').trim();
    if(!desc || BOQ_NON_MATERIAL_RE.test(desc)) continue;
    const matLabel = r.item_number ? `[${r.item_number}] ${desc}` : desc;
    if(existingMats.has(matLabel.toLowerCase()) || existingMats.has(desc.toLowerCase())) continue;
    await apiFetch('/api/material_requests', {
      method: 'POST',
      body: JSON.stringify({
        project_id: projId,
        material: matLabel,
        location: r.system || 'Site Wide',
        discipline: r.discipline || 'HVAC',
        quantity: Number(r.revised_quantity || r.tender_quantity || 1),
        unit: r.unit || 'pcs',
        required_date: reqDate,
        status: 'Requested'
      })
    });
    created++;
  }
  return created;
}

let tasksViewMode = 'board';
let tasksFilterTrade = 'ALL';
let tasksFilterStatus = 'ALL';
let tasksSearchQuery = '';

async function renderTasksWorkspace(){
  const [rows, docs] = await Promise.all([
    apiFetch(`/api/tasks?project_id=${currentProjectId}`),
    apiFetch(`/api/documents?project_id=${currentProjectId}`).catch(()=>[])
  ]);
  const canEdit = ME.permissions.edit.includes('tasks');
  const canDel = ME.permissions.delete && canEdit;

  // Map task evidence photos from documents (Category = 'Site Photo' or 'Task Evidence' matching task ID or title)
  const photoByTask = {};
  for(const d of docs){
    if(!d.attachment_data) continue;
    for(const t of rows){
      if(t.evidence_url) photoByTask[t.id] = t.evidence_url;
      else if(d.name && (d.name.includes(`[TASK:${t.id}]`) || d.name.includes(`Task Evidence - ${t.title}`))){
        photoByTask[t.id] = d.attachment_data;
      }
    }
  }

  const filtered = rows.filter(t => {
    if(tasksFilterTrade !== 'ALL' && (t.trade||'') !== tasksFilterTrade) return false;
    if(tasksFilterStatus !== 'ALL' && (t.status||'Not Started') !== tasksFilterStatus) return false;
    if(tasksSearchQuery){
      const q = tasksSearchQuery.toLowerCase();
      const hay = `${t.title||''} ${t.trade||''} ${t.assignee||''} ${t.wbs_code||''}`.toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });

  const total = rows.length;
  const doneCount = rows.filter(t => (t.status||'').toLowerCase() === 'completed').length;
  const wipCount = rows.filter(t => (t.status||'').toLowerCase() === 'in progress').length;
  const delayedCount = rows.filter(t => (t.status||'').toLowerCase() === 'delayed').length;
  const photoCount = rows.filter(t => Boolean(photoByTask[t.id])).length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;

  const columns = [
    { key: 'Not Started', label: 'Not Started', color: '#94a3b8' },
    { key: 'In Progress', label: 'In Progress', color: '#38bdf8' },
    { key: 'Delayed', label: 'Delayed / Blocked', color: '#ef4444' },
    { key: 'Completed', label: 'Completed / Done', color: '#10b981' }
  ];

  document.getElementById('viewContent').innerHTML = `
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:14px;">
      <div class="stat-card"><div class="num">${total}</div><div class="lbl">Total Tasks</div></div>
      <div class="stat-card"><div class="num" style="color:#38bdf8;">${wipCount}</div><div class="lbl">In Progress</div></div>
      <div class="stat-card"><div class="num" style="color:#10b981;">${doneCount}</div><div class="lbl">Completed (${pct}%)</div></div>
      <div class="stat-card ${delayedCount>0?'warn':''}"><div class="num" style="color:${delayedCount>0?'#ef4444':'var(--text)'};">${delayedCount}</div><div class="lbl">Delayed / Blocked</div></div>
      <div class="stat-card"><div class="num" style="color:#f59e0b;">${photoCount}</div><div class="lbl">With Evidence Photo</div></div>
    </div>

    <div class="panel" style="padding:14px 18px;margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <div class="view-mode-toggle">
            <button class="view-mode-btn ${tasksViewMode==='board'?'active':''}" id="tViewBoard">Kanban Board</button>
            <button class="view-mode-btn ${tasksViewMode==='table'?'active':''}" id="tViewTable">Table Register</button>
            <button class="view-mode-btn ${tasksViewMode==='gantt'?'active':''}" id="tViewGantt">Gantt Timeline</button>
            <button class="view-mode-btn ${tasksViewMode==='calendar'?'active':''}" id="tViewCalendar">Week Calendar</button>
          </div>
          <input id="tSearchInput" value="${escHtml(tasksSearchQuery)}" placeholder="Filter tasks, WBS, assignee..." style="min-width:200px;padding:6px 10px;font-size:12px;">
          <select id="tFilterTrade" style="padding:6px 10px;font-size:12px;">
            <option value="ALL">All Disciplines</option>
            ${TRADES.map(tr => `<option value="${tr}" ${tasksFilterTrade===tr?'selected':''}>${tr}</option>`).join('')}
          </select>
          <select id="tFilterStatus" style="padding:6px 10px;font-size:12px;">
            <option value="ALL">All Statuses</option>
            ${columns.map(c => `<option value="${c.key}" ${tasksFilterStatus===c.key?'selected':''}>${c.label}</option>`).join('')}
          </select>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          ${canEdit && currentProjectId !== 'ALL' ? `<button class="btn ghost small" id="tPlanFromBoqBtn" title="Auto-generate programme tasks from BOQ sections">⚡ Programme from BOQ</button>` : ''}
          ${canEdit ? `<button class="btn accent small" id="tAddTaskBtn">+ Add Task</button>` : ''}
          <button class="btn ghost small" id="tExportCsvBtn">Export CSV</button>
        </div>
      </div>
      <div class="api-banner" id="tasksResultBanner" style="margin-top:10px;margin-bottom:0;"></div>
    </div>

    ${tasksViewMode === 'board' ? `
      <div class="kanban-board">
        ${columns.map(col => {
          const colTasks = filtered.filter(t => (t.status || 'Not Started') === col.key);
          return `
            <div class="kanban-col" data-kanban-col="${col.key}">
              <div class="kanban-col-header" style="border-top:3px solid ${col.color};">
                <span>${col.label}</span>
                <span class="badge" style="background:rgba(255,255,255,.08);color:var(--text);">${colTasks.length}</span>
              </div>
              <div class="kanban-col-body" data-drop-status="${col.key}">
                ${colTasks.length ? colTasks.map(t => {
                  const photo = photoByTask[t.id];
                  const isDone = (t.status || '') === 'Completed';
                  return `
                    <div class="kanban-card" draggable="${canEdit?'true':'false'}" data-task-card="${t.id}">
                      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
                        <span class="disc-pill ${disciplineClass(t.trade)}">${escHtml(t.trade||'General')}</span>
                        ${t.wbs_code ? `<span style="font-family:monospace;font-size:10px;color:var(--muted);">${escHtml(t.wbs_code)}</span>` : ''}
                      </div>
                      <div class="kanban-card-title">${escHtml(t.title)}</div>
                      <div style="font-size:11px;color:var(--muted);display:flex;justify-content:space-between;">
                        <span>${escHtml(t.assignee||'Unassigned')}</span>
                        <span>${escHtml(t.end||'')}</span>
                      </div>
                      <div class="prog-bar-container">
                        <div class="prog-bar-fill ${isDone?'success':''}" style="width:${Math.max(0,Math.min(100,t.progress||0))}%;"></div>
                      </div>
                      ${photo ? `
                        <div data-view-evidence="${t.id}" style="margin-top:4px;position:relative;border-radius:5px;overflow:hidden;border:1px solid rgba(16,185,129,.4);cursor:pointer;">
                          <img src="${photo}" alt="Completion Evidence" style="width:100%;height:78px;object-fit:cover;display:block;">
                          <span style="position:absolute;bottom:4px;left:4px;background:rgba(6,78,59,.9);color:#6ee7b7;font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;">✓ EVIDENCE PHOTO</span>
                        </div>
                      ` : ''}
                      ${canEdit ? `
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:4px;margin-top:4px;padding-top:6px;border-top:1px solid var(--hairline);">
                          ${!isDone ? `
                            <button class="btn accent small" data-complete-task="${t.id}" style="padding:4px 8px;font-size:11px;flex:1;">✓ Done + Photo</button>
                          ` : `
                            <button class="btn ghost small" data-complete-task="${t.id}" style="padding:4px 8px;font-size:10px;flex:1;">+ Update Photo</button>
                          `}
                          ${t.status === 'Not Started' ? `<button class="btn ghost small" data-quick-status="${t.id}" data-target-status="In Progress" style="padding:4px 7px;font-size:10px;" title="Start Work">Start</button>` : ''}
                          <button class="icon-btn edit" data-edit-task="${t.id}" title="Edit Task">✎</button>
                          ${canDel ? `<button class="icon-btn" data-del-task="${t.id}" title="Delete Task">✕</button>` : ''}
                        </div>
                      ` : ''}
                    </div>
                  `;
                }).join('') : `<div class="empty" style="font-size:11px;padding:28px 8px;">No tasks in ${col.label}</div>`}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    ` : tasksViewMode === 'table' ? `
      <div class="panel">
        ${filtered.length ? `
          <table>
            <thead>
              <tr>
                <th>WBS</th>
                <th>Task Description</th>
                <th>Discipline</th>
                <th>Assignee</th>
                <th>Start</th>
                <th>End</th>
                <th>Progress</th>
                <th>Status</th>
                <th>Evidence</th>
                ${canEdit ? '<th>Actions</th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${filtered.map(t => {
                const photo = photoByTask[t.id];
                const isDone = (t.status || '') === 'Completed';
                return `
                  <tr>
                    <td style="font-family:monospace;font-size:11px;color:var(--muted);">${escHtml(t.wbs_code||'—')}</td>
                    <td><b>${escHtml(t.title)}</b></td>
                    <td><span class="disc-pill ${disciplineClass(t.trade)}">${escHtml(t.trade||'General')}</span></td>
                    <td>${escHtml(t.assignee||'—')}</td>
                    <td>${escHtml(t.start||'—')}</td>
                    <td>${escHtml(t.end||'—')}</td>
                    <td>${t.progress||0}%</td>
                    <td><span class="badge ${badgeClass(t.status)}">${escHtml(t.status||'Not Started')}</span></td>
                    <td>
                      ${photo ? `<button class="btn ghost small" data-view-evidence="${t.id}" style="padding:2px 7px;font-size:10px;border-color:#10b981;color:#6ee7b7;">View Photo</button>` : '<span style="color:var(--muted);font-size:11px;">—</span>'}
                    </td>
                    ${canEdit ? `
                      <td class="row-actions">
                        ${!isDone ? `<button class="btn accent small" data-complete-task="${t.id}" style="padding:3px 8px;font-size:10px;margin-right:4px;">✓ Done + Photo</button>` : `<button class="btn ghost small" data-complete-task="${t.id}" style="padding:3px 7px;font-size:10px;margin-right:4px;">Photo</button>`}
                        <button class="icon-btn edit" data-edit-task="${t.id}" title="Edit">✎</button>
                        ${canDel ? `<button class="icon-btn" data-del-task="${t.id}" title="Delete">✕</button>` : ''}
                      </td>
                    ` : ''}
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        ` : `<div class="empty">No matching tasks found. Use "+ Add Task" or "Programme from BOQ" to schedule work.</div>`}
      </div>
    ` : tasksViewMode === 'gantt' ? renderInlineScheduleGanttHtml(filtered) : renderInlineScheduleCalendarHtml(filtered)}
  `;

  document.getElementById('tViewBoard').onclick = () => { tasksViewMode = 'board'; renderTasksWorkspace(); };
  document.getElementById('tViewTable').onclick = () => { tasksViewMode = 'table'; renderTasksWorkspace(); };
  if(document.getElementById('tViewGantt')) document.getElementById('tViewGantt').onclick = () => { tasksViewMode = 'gantt'; renderTasksWorkspace(); };
  if(document.getElementById('tViewCalendar')) document.getElementById('tViewCalendar').onclick = () => { tasksViewMode = 'calendar'; renderTasksWorkspace(); };
  wireInlineScheduleCalendarEvents();
  const searchEl = document.getElementById('tSearchInput');
  searchEl.oninput = (e) => { tasksSearchQuery = e.target.value; renderTasksWorkspace(); };
  document.getElementById('tFilterTrade').onchange = (e) => { tasksFilterTrade = e.target.value; renderTasksWorkspace(); };
  document.getElementById('tFilterStatus').onchange = (e) => { tasksFilterStatus = e.target.value; renderTasksWorkspace(); };
  document.getElementById('tExportCsvBtn').onclick = () => exportCsv('tasks');

  if(document.getElementById('tAddTaskBtn')){
    document.getElementById('tAddTaskBtn').onclick = () => openAddModal('tasks', 'Task', [['title','Task'],['trade','Trade'],['assignee','Assignee'],['start','Start'],['end','End'],['progress','Progress'],['status','Status']]);
  }
  if(document.getElementById('tPlanFromBoqBtn')){
    document.getElementById('tPlanFromBoqBtn').onclick = async () => {
      const banner = document.getElementById('tasksResultBanner');
      banner.textContent = 'Generating construction programme from BOQ systems...';
      banner.classList.add('show');
      const count = await generateProgrammeFromBOQ();
      if(count !== undefined){
        banner.textContent = count > 0 ? `✓ Generated ${count} scheduled programme tasks from BOQ.` : 'All BOQ discipline groups are already scheduled in Tasks.';
        setTimeout(() => renderTasksWorkspace(), 700);
      }
    };
  }

  document.querySelectorAll('[data-edit-task]').forEach(btn => {
    btn.onclick = () => {
      const t = rows.find(x => x.id === btn.dataset.editTask);
      if(t) openEditModal('tasks', 'Task', t);
    };
  });
  document.querySelectorAll('[data-del-task]').forEach(btn => {
    btn.onclick = async () => {
      const ok = await confirmAction('Delete this task? This cannot be undone.');
      if(!ok) return;
      await apiFetch(`/api/tasks/${btn.dataset.delTask}`, { method: 'DELETE' });
      renderTasksWorkspace();
    };
  });
  document.querySelectorAll('[data-quick-status]').forEach(btn => {
    btn.onclick = async () => {
      const t = rows.find(x => x.id === btn.dataset.quickStatus);
      if(!t) return;
      const nextSt = btn.dataset.targetStatus;
      await apiFetch(`/api/tasks/${t.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...t, status: nextSt, progress: nextSt === 'In Progress' ? Math.max(25, t.progress||0) : t.progress })
      });
      renderTasksWorkspace();
    };
  });
  document.querySelectorAll('[data-complete-task]').forEach(btn => {
    btn.onclick = () => {
      const t = rows.find(x => x.id === btn.dataset.completeTask);
      if(t) openCompleteTaskWithEvidenceModal(t, photoByTask[t.id]);
    };
  });
  document.querySelectorAll('[data-view-evidence]').forEach(el => {
    el.onclick = () => {
      const t = rows.find(x => x.id === el.dataset.viewEvidence);
      const photo = photoByTask[el.dataset.viewEvidence];
      if(t && photo) openPhotoLightbox(`Evidence Photo — ${t.title}`, photo);
    };
  });

  // Drag and drop between Kanban columns
  if(canEdit && tasksViewMode === 'board'){
    let draggedId = null;
    document.querySelectorAll('[data-task-card]').forEach(card => {
      card.addEventListener('dragstart', e => {
        draggedId = card.dataset.taskCard;
        e.dataTransfer.setData('text/plain', draggedId);
        card.style.opacity = '0.45';
      });
      card.addEventListener('dragend', () => {
        card.style.opacity = '1';
      });
    });
    document.querySelectorAll('[data-drop-status]').forEach(zone => {
      zone.addEventListener('dragover', e => {
        e.preventDefault();
        zone.style.background = 'rgba(245,158,11,.06)';
      });
      zone.addEventListener('dragleave', () => {
        zone.style.background = '';
      });
      zone.addEventListener('drop', async e => {
        e.preventDefault();
        zone.style.background = '';
        const taskId = e.dataTransfer.getData('text/plain') || draggedId;
        const targetStatus = zone.dataset.dropStatus;
        const task = rows.find(x => x.id === taskId);
        if(!task || task.status === targetStatus) return;
        if(targetStatus === 'Completed'){
          openCompleteTaskWithEvidenceModal(task, photoByTask[task.id]);
        } else {
          const newProg = targetStatus === 'Not Started' ? 0 : (targetStatus === 'In Progress' ? Math.max(25, task.progress||0) : task.progress);
          await apiFetch(`/api/tasks/${task.id}`, {
            method: 'PUT',
            body: JSON.stringify({ ...task, status: targetStatus, progress: newProg })
          });
          renderTasksWorkspace();
        }
      });
    });
  }
}

function openCompleteTaskWithEvidenceModal(task, existingPhoto){
  let selectedPhotoData = existingPhoto || '';
  const html = `
    <div class="form-grid">
      <div class="full">
        <label>Task Moving to Done / Completed</label>
        <input value="${escHtml(task.title)}" disabled style="font-weight:700;opacity:0.9;">
      </div>
      <div>
        <label>Discipline</label>
        <input value="${escHtml(task.trade||'General')}" disabled>
      </div>
      <div>
        <label>Completion Progress (%)</label>
        <input type="number" id="f_comp_progress" value="100" min="0" max="100">
      </div>
      <div class="full">
        <label>Site Completion & QA Notes</label>
        <textarea id="f_comp_notes" rows="2" placeholder="Record installation details, test readings, or QA sign-off notes...">${escHtml(task.evidence_notes||'')}</textarea>
      </div>
      <div class="full">
        <label>Completion Evidence Photo (Required for QA / Handover)</label>
        <div style="display:flex;gap:8px;align-items:center;margin-top:4px;flex-wrap:wrap;">
          <button type="button" class="btn accent small" id="btnTaskCaptureCam">📷 Capture with Camera</button>
          <button type="button" class="btn ghost small" id="btnTaskUploadFile">Upload Photo File</button>
          <input type="file" id="inpTaskEvidenceFile" accept="image/*" style="display:none;">
        </div>
        <div id="taskEvidencePreviewWrap" style="margin-top:10px;${selectedPhotoData?'':'display:none;'}">
          <img id="taskEvidencePreviewImg" src="${selectedPhotoData}" style="max-height:200px;width:100%;object-fit:contain;border-radius:6px;border:1px solid var(--border);background:#09121e;">
        </div>
      </div>
    </div>
  `;
  openModal('Complete Task & Attach Evidence Photo', html, async () => {
    const prog = Number(document.getElementById('f_comp_progress').value || 100);
    const notes = document.getElementById('f_comp_notes').value.trim();
    const projId = task.project_id || (currentProjectId === 'ALL' ? (PROJECTS[0]?.id || '') : currentProjectId);

    await apiFetch(`/api/tasks/${task.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        ...task,
        status: 'Completed',
        progress: prog,
        evidence_url: selectedPhotoData || task.evidence_url || undefined,
        evidence_notes: notes || undefined
      })
    });

    if(selectedPhotoData && selectedPhotoData !== existingPhoto){
      await apiFetch('/api/documents', {
        method: 'POST',
        body: JSON.stringify({
          project_id: projId,
          name: `[TASK:${task.id}] Task Evidence - ${task.title}${notes ? ' ('+notes.slice(0,40)+')' : ''}`,
          category: 'Site Photo',
          revision: 'Final',
          date_added: new Date().toISOString().slice(0,10),
          attachment_name: `task_evidence_${task.id}_${Date.now()}.jpg`,
          attachment_data: selectedPhotoData
        })
      });
    }
  });

  setTimeout(() => {
    const fileInp = document.getElementById('inpTaskEvidenceFile');
    const uploadBtn = document.getElementById('btnTaskUploadFile');
    const camBtn = document.getElementById('btnTaskCaptureCam');
    const previewWrap = document.getElementById('taskEvidencePreviewWrap');
    const previewImg = document.getElementById('taskEvidencePreviewImg');

    if(uploadBtn && fileInp){
      uploadBtn.onclick = () => fileInp.click();
      fileInp.onchange = async (e) => {
        const file = e.target.files && e.target.files[0];
        if(!file) return;
        selectedPhotoData = await compressImageFile(file);
        previewImg.src = selectedPhotoData;
        previewWrap.style.display = 'block';
      };
    }
    if(camBtn){
      camBtn.onclick = () => {
        openCameraCaptureModal({
          context: 'task_evidence',
          selectedDate: new Date().toISOString().slice(0,10),
          onCaptured: (dataUrl) => {
            selectedPhotoData = dataUrl;
            openCompleteTaskWithEvidenceModal(task, selectedPhotoData);
          }
        });
      };
    }
  }, 50);
}
