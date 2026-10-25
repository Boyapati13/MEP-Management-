async function renderCrud(table, label, cols){
  const rows = await apiFetch(`/api/${table}?project_id=${currentProjectId}`);
  const canEdit = ME.permissions.edit.includes(MODULE_PERMS[table] || table);
  const canDel = ME.permissions.delete && canEdit;
  document.getElementById('viewContent').innerHTML = `
  <div class="panel">
    <h3><span>${label}s</span><span>${canEdit?`<button class="btn accent small" id="addBtn">+ Add ${label}</button>`:'<span style="font-size:11px;color:var(--muted);margin-right:10px;">Read-only</span>'}<button class="btn ghost small" id="exportBtn" style="margin-left:8px;">Export CSV</button></span></h3>
    ${rows.length ? `<table><thead><tr>${cols.map(c=>`<th>${c[1]}</th>`).join('')}${canEdit?'<th></th>':''}</tr></thead><tbody>
      ${rows.map(r=>`<tr>${cols.map(c=>{
        let v=r[c[0]];
        if(c[0]==='status'||c[0]==='result') return `<td><span class="badge ${badgeClass(v)}">${v}</span></td>`;
        if(c[0]==='planned'||c[0]==='actual'||c[0]==='cost_impact'||c[0]==='amount') return `<td>${fmtCurrency(v)}</td>`;
        return `<td>${v!==undefined&&v!==null?escHtml(v):''}</td>`;
      }).join('')}${canEdit?`<td class="row-actions">${table==='procurement_items'&&!r.po_number?`<button class="icon-btn" data-create-po="${r.id}" title="Create purchase order">PO</button>`:''}${'visibility' in r?`<button class="icon-btn" data-toggle-publish="${r.id}" data-current-visibility="${r.visibility||'Internal'}" title="${(r.visibility==='Client'||r.visibility==='All')?'Published to Client - click to unpublish':'Publish to Client'}">${(r.visibility==='Client'||r.visibility==='All')?'Published':'Publish'}</button>`:''}${WORKFLOW_NEXT[table]&&WORKFLOW_NEXT[table][r.status]?`<button class="icon-btn" data-transition="${r.id}" title="Advance to ${WORKFLOW_NEXT[table][r.status]}">▶</button>`:''}${canEdit?`<button class="icon-btn edit" data-edit="${r.id}" title="Edit">✎</button>`:''}${canDel?`<button class="icon-btn" data-del="${r.id}" title="Delete">✕</button>`:''}</td>`:''}</tr>`).join('')}
    </tbody></table>` : `<div class="empty-state">
      <p>No ${label.toLowerCase()}s recorded yet for this project.</p>
      ${canEdit?`<button class="btn accent small" id="emptyAddBtn">+ Add the first ${label}</button>`:''}
    </div>`}
  </div>`;
  if(canEdit) document.getElementById('addBtn').onclick = ()=> openAddModal(table, label, cols);
  if(canEdit && document.getElementById('emptyAddBtn')) document.getElementById('emptyAddBtn').onclick = ()=> openAddModal(table, label, cols);
  document.getElementById('exportBtn').onclick = ()=> exportCsv(table);
  document.querySelectorAll('[data-edit]').forEach(btn=>{
    btn.onclick = ()=>{
      const record = rows.find(r=>r.id===btn.dataset.edit);
      openEditModal(table, label, record);
    };
  });
  document.querySelectorAll('[data-transition]').forEach(btn=>{
    btn.onclick = async ()=>{
      const record = rows.find(r=>r.id===btn.dataset.transition);
      const next = WORKFLOW_NEXT[table] && WORKFLOW_NEXT[table][record.status];
      if(!next || !confirm(`Move this record from ${record.status} to ${next}?`)) return;
      await apiFetch(`/api/${table}/${record.id}/transition`, {method:'POST', body:JSON.stringify({status:next})});
      render();
    };
  });
  document.querySelectorAll('[data-create-po]').forEach(btn=>{
    btn.onclick = async ()=>{
      const poNumber = prompt('Purchase order number (optional):') || '';
      await apiFetch(`/api/procurement_items/${btn.dataset.createPo}/create-po`, {method:'POST', body:JSON.stringify({po_number:poNumber})});
      render();
    };
  });
  document.querySelectorAll('[data-toggle-publish]').forEach(btn=>{
    btn.onclick = async ()=>{
      const isPublished = btn.dataset.currentVisibility === 'Client' || btn.dataset.currentVisibility === 'All';
      const newVisibility = isPublished ? 'Internal' : 'Client';
      if(!isPublished && !confirm(`Publish this ${label.toLowerCase()} to the client? They will be able to see it in their Client Portal.`)) return;
      await apiFetch(`/api/${table}/${btn.dataset.togglePublish}`, {method:'PUT', body:JSON.stringify({visibility:newVisibility})});
      render();
    };
  });
  document.querySelectorAll('[data-del]').forEach(btn=>{
    btn.onclick = async ()=>{
      const ok = await confirmAction(`Delete this ${label.toLowerCase()}? This cannot be undone.`);
      if(!ok) return;
      await apiFetch(`/api/${table}/${btn.dataset.del}`, {method:'DELETE'});
      render();
    };
  });
}

async function renderClientDashboard(){
  const projectId = currentProjectId === 'ALL' ? (PROJECTS[0]?.id || '') : currentProjectId;
  if(!projectId){
    document.getElementById('viewContent').innerHTML = `<div class="panel"><h3><span>Client Portal</span></h3><div class="empty-state"><p>No project has been shared with you yet.</p></div></div>`;
    return;
  }
  const summary = await apiFetch(`/api/projects/${projectId}/client-summary`);

  document.getElementById('viewContent').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px;">
      <div class="panel">
        <h3>
          <span>${escHtml(summary.project.name)}</span>
          <span style="font-size:12px;color:var(--muted);font-weight:400;">${escHtml(summary.project.client||'')}</span>
        </h3>
        <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));">
          <div class="stat-card">
            <div class="num" style="color:var(--primary);">${summary.overall_progress}%</div>
            <div class="lbl">Overall Progress</div>
          </div>
          <div class="stat-card ${summary.open_client_items.decisions_required>0?'warn':''}">
            <div class="num" style="color:${summary.open_client_items.decisions_required>0?'#f3b562':'var(--text)'};">${summary.open_client_items.decisions_required}</div>
            <div class="lbl">Decisions Required</div>
          </div>
          <div class="stat-card">
            <div class="num">${summary.open_client_items.documents_published}</div>
            <div class="lbl">Documents Shared</div>
          </div>
        </div>
        ${summary.next_milestone ? `
          <div style="margin-top:14px;padding:14px;background:var(--card-raised);border:1px solid var(--border);border-radius:8px;">
            <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;">Next Milestone</div>
            <div style="font-size:16px;font-weight:700;margin-top:4px;">${escHtml(summary.next_milestone.title)}</div>
            <div style="font-size:12px;color:var(--muted);">${escHtml(summary.next_milestone.date)}</div>
          </div>
        ` : ''}
      </div>

      <div class="panel">
        <h3><span>Documents Shared With You</span></h3>
        ${summary.published_documents.length ? `
          <table><thead><tr><th>Name</th><th>Category</th><th>Rev.</th><th>Shared</th></tr></thead>
          <tbody>${summary.published_documents.map(d => `
            <tr><td>${escHtml(d.name)}</td><td>${escHtml(d.category||'')}</td><td>${escHtml(d.revision||'')}</td><td>${d.published_at ? new Date(d.published_at).toLocaleDateString() : ''}</td></tr>
          `).join('')}</tbody></table>
        ` : `<div class="empty-state"><p>No documents have been shared with you yet.</p></div>`}
      </div>

      <div class="panel">
        <h3><span>Change Orders Shared With You</span></h3>
        ${summary.published_change_orders.length ? `
          <table><thead><tr><th>No.</th><th>Title</th><th>Cost Impact</th><th>Schedule Impact</th><th>Status</th></tr></thead>
          <tbody>${summary.published_change_orders.map(c => `
            <tr><td>${escHtml(c.number)}</td><td>${escHtml(c.title)}</td><td>${fmtCurrency(c.cost_impact)}</td><td>${c.schedule_impact_days ? c.schedule_impact_days+' days' : '-'}</td><td><span class="badge ${badgeClass(c.status)}">${escHtml(c.status)}</span></td></tr>
          `).join('')}</tbody></table>
        ` : `<div class="empty-state"><p>No change orders have been shared with you yet.</p></div>`}
      </div>
    </div>
  `;
}

async function renderPlanner(){
  const plannerProjectId = currentProjectId === 'ALL' ? (PROJECTS[0]?.id || '') : currentProjectId;
  if(!plannerProjectId){
    document.getElementById('viewContent').innerHTML = `<div class="panel"><h3><span>Planner</span></h3><div class="empty-state"><p>Select a project above to view its Planner board.</p></div></div>`;
    return;
  }
  const buckets = await apiFetch(`/api/projects/${plannerProjectId}/planner`);
  const canEditPlanner = ME.permissions.edit.includes('planner');
  const priorityColor = { Urgent: '#ef4444', Important: '#f59e0b', Low: '#6fd3c1' };

  document.getElementById('viewContent').innerHTML = `
  <div class="panel">
    <h3>
      <span>Planner</span>
      <span style="font-size:11px;color:var(--muted);font-weight:400;">Generated from documents you've analyzed — organized into buckets, tasks and checklists.${canEditPlanner && buckets.length ? ' Drag a card to move it between buckets.' : ''}</span>
    </h3>
    ${buckets.length ? `
      <div style="display:flex;gap:14px;overflow-x:auto;padding-bottom:10px;">
        ${buckets.map(b => `
          <div style="min-width:280px;max-width:280px;background:var(--card-raised);border:1px solid var(--border);border-radius:10px;padding:10px;flex-shrink:0;">
            <div style="font-weight:700;font-size:13px;margin-bottom:8px;display:flex;justify-content:space-between;">
              <span>${escHtml(b.name)}</span>
              <span style="color:var(--muted);font-weight:400;">${b.tasks.length}</span>
            </div>
            <div class="planner-dropzone" data-bucket="${b.id}" style="display:flex;flex-direction:column;gap:8px;min-height:40px;border-radius:8px;transition:background 0.15s;">
              ${b.tasks.map(t => {
                const checked = (t.checklist||[]).filter(c=>c.is_checked).length;
                const total = (t.checklist||[]).length;
                return `
                <div class="planner-card" data-task="${t.id}" ${canEditPlanner?'draggable="true"':''} style="background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:8px 10px;cursor:pointer;${canEditPlanner?'cursor:grab;':''}">
                  <div style="font-size:12px;font-weight:600;margin-bottom:4px;">${escHtml(t.title)}</div>
                  <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                    ${t.trade?`<span style="font-size:10px;padding:1px 6px;border-radius:4px;background:var(--card-raised);">${escHtml(t.trade)}</span>`:''}
                    ${t.priority?`<span style="font-size:10px;padding:1px 6px;border-radius:4px;color:${priorityColor[t.priority]||'var(--muted)'};border:1px solid ${priorityColor[t.priority]||'var(--border)'};">${escHtml(t.priority)}</span>`:''}
                    ${t.due_date?`<span style="font-size:10px;color:var(--muted);">${escHtml(t.due_date)}</span>`:''}
                    ${total>0?`<span style="font-size:10px;color:var(--muted);">☑ ${checked}/${total}</span>`:''}
                  </div>
                  <div style="font-size:10px;color:var(--muted);margin-top:4px;">${escHtml(t.status||'Not Started')}</div>
                </div>`;
              }).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    ` : `<div class="empty">No planner items yet. Open <b>Documents</b>, then click <b>Analyze</b> on any uploaded file to build a board from it.</div>`}
  </div>`;

  if(canEditPlanner){
    wirePlannerDragAndDrop(buckets);
  }

  document.querySelectorAll('[data-task]').forEach(card => {
    card.onclick = () => {
      const taskId = card.dataset.task;
      let task = null;
      for (const b of buckets) { const f = b.tasks.find(x=>x.id===taskId); if (f) task = f; }
      if (task) openPlannerTaskModal(task, buckets, canEditPlanner);
    };
  });
}

let notifPollInterval = null;

function startNotificationPolling(){
  refreshNotifications();
  if(notifPollInterval) clearInterval(notifPollInterval);
  notifPollInterval = setInterval(refreshNotifications, 45000);
  document.getElementById('notifBellBtn').onclick = (e) => {
    e.stopPropagation();
    const dd = document.getElementById('notifDropdown');
    if(dd.style.display === 'block'){
      dd.style.display = 'none';
    }else{
      refreshNotifications();
      dd.style.display = 'block';
    }
  };
  document.addEventListener('click', (e) => {
    const dd = document.getElementById('notifDropdown');
    if(dd.style.display === 'block' && !dd.contains(e.target) && e.target.id !== 'notifBellBtn'){
      dd.style.display = 'none';
    }
  });
}

async function refreshNotifications(){
  try{
    const notifs = await apiFetch('/api/notifications');
    const unread = notifs.filter(n=>!n.is_read).length;
    const badge = document.getElementById('notifBadge');
    if(unread > 0){
      badge.textContent = unread > 9 ? '9+' : String(unread);
      badge.style.display = 'inline-block';
    }else{
      badge.style.display = 'none';
    }
    renderNotifDropdown(notifs);
  }catch(err){ /* silent - notifications are a convenience, not critical */ }
}

function renderNotifDropdown(notifs){
  const dd = document.getElementById('notifDropdown');
  if(notifs.length === 0){
    dd.innerHTML = `<div style="padding:16px;font-size:12px;color:var(--muted);text-align:center;">No notifications yet.</div>`;
    return;
  }
  dd.innerHTML = `
    <div style="padding:8px 12px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:12px;font-weight:700;">Notifications</span>
      <span id="notifMarkAllBtn" style="font-size:11px;color:var(--primary);cursor:pointer;">Mark all read</span>
    </div>
    ${notifs.map(n => `
      <div class="notif-item" data-notif="${n.id}" style="padding:10px 12px;border-bottom:1px solid var(--border);cursor:pointer;background:${n.is_read?'transparent':'rgba(111,211,193,0.06)'};">
        <div style="font-size:12px;font-weight:600;">${escHtml(n.title)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">${escHtml(n.message)}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:4px;">${new Date(n.created_at).toLocaleString()}</div>
      </div>
    `).join('')}
  `;
  document.getElementById('notifMarkAllBtn').onclick = async (e) => {
    e.stopPropagation();
    await apiFetch('/api/notifications/read-all', {method:'PUT'});
    refreshNotifications();
  };
  document.querySelectorAll('.notif-item').forEach(el => {
    el.onclick = async () => {
      await apiFetch(`/api/notifications/${el.dataset.notif}/read`, {method:'PUT'});
      refreshNotifications();
    };
  });
}

function wirePlannerDragAndDrop(buckets){
  let draggedTaskId = null;

  document.querySelectorAll('.planner-card[draggable="true"]').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      draggedTaskId = card.dataset.task;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedTaskId);
      card.style.opacity = '0.4';
    });
    card.addEventListener('dragend', () => {
      card.style.opacity = '1';
      draggedTaskId = null;
    });
  });

  document.querySelectorAll('.planner-dropzone').forEach(zone => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      zone.style.background = 'rgba(111,211,193,0.08)';
    });
    zone.addEventListener('dragleave', () => {
      zone.style.background = '';
    });
    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      zone.style.background = '';
      const taskId = e.dataTransfer.getData('text/plain') || draggedTaskId;
      const newBucketId = zone.dataset.bucket;
      if(!taskId || !newBucketId) return;
      let currentBucket = null;
      for(const b of buckets){ if(b.tasks.some(t=>t.id===taskId)) currentBucket = b.id; }
      if(currentBucket === newBucketId) return;
      try{
        await apiFetch(`/api/plan_tasks/${taskId}`, {method:'PUT', body: JSON.stringify({bucket_id: newBucketId})});
        render();
      }catch(err){
        alert('Could not move task: ' + err.message);
      }
    });
  });
}

function openPlannerTaskModal(task, buckets, canEditPlanner){
  const html = `
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div>
        <label style="font-size:11px;color:var(--muted);">Title</label>
        <div style="font-weight:700;">${escHtml(task.title)}</div>
      </div>
      ${task.description?`<div><label style="font-size:11px;color:var(--muted);">Description</label><div style="font-size:13px;">${escHtml(task.description)}</div></div>`:''}
      ${task.source_excerpt?`<div style="font-size:11px;color:var(--muted);font-style:italic;border-left:2px solid var(--border);padding-left:8px;">Source: "${escHtml(task.source_excerpt)}"</div>`:''}
      <div style="display:flex;gap:10px;">
        <div style="flex:1;">
          <label style="font-size:11px;color:var(--muted);">Status</label>
          <select id="f_plan_status" ${canEditPlanner?'':'disabled'}>
            ${['Not Started','In Progress','Completed'].map(s=>`<option value="${s}" ${task.status===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
        <div style="flex:1;">
          <label style="font-size:11px;color:var(--muted);">Move to bucket</label>
          <select id="f_plan_bucket" ${canEditPlanner?'':'disabled'}>
            ${buckets.map(b=>`<option value="${b.id}" ${task.bucket_id===b.id?'selected':''}>${escHtml(b.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      ${(task.checklist||[]).length ? `
        <div>
          <label style="font-size:11px;color:var(--muted);">Checklist</label>
          <div style="display:flex;flex-direction:column;gap:4px;margin-top:4px;">
            ${task.checklist.map(c=>`
              <label style="display:flex;gap:6px;align-items:center;font-size:12px;">
                <input type="checkbox" data-checklist="${c.id}" ${c.is_checked?'checked':''} ${canEditPlanner?'':'disabled'}>
                <span>${escHtml(c.label)}</span>
              </label>
            `).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;
  openModal('Task Details', html, canEditPlanner ? async () => {
    const status = document.getElementById('f_plan_status').value;
    const bucket_id = document.getElementById('f_plan_bucket').value;
    await apiFetch(`/api/plan_tasks/${task.id}`, {method:'PUT', body: JSON.stringify({status, bucket_id})});
    for (const el of document.querySelectorAll('[data-checklist]')) {
      await apiFetch(`/api/plan_task_checklist/${el.dataset.checklist}`, {method:'PUT', body: JSON.stringify({is_checked: el.checked ? 1 : 0})});
    }
  } : async () => {});
}

async function renderDocuments(){
  const rows = await apiFetch(`/api/documents?project_id=${currentProjectId}`);
  const canEdit = ME.permissions.edit.includes('documents');
  const canDel = ME.permissions.delete && canEdit;
  const isSub = ME.role === 'Subcontractor';
  const isClient = ME.role === 'Client';
  const canUpload = canEdit || isClient;

  document.getElementById('viewContent').innerHTML = `
  <div class="panel">
    <h3>
      <span>Documents</span>
      <span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        ${!isClient?'<button class="btn ghost small" id="openDocStudioBtn" title="Open Drawing & PDF Markup Studio">Drawing & PDF Studio</button>':''}
        ${canUpload?`<button class="btn accent small" id="addBtn">${isClient?'+ Submit Document':'+ Add Document'}</button>`:'<span style="font-size:11px;color:var(--muted);margin-right:10px;">Read-only</span>'}
        <button class="btn ghost small" id="exportBtn">Export CSV</button>
      </span>
    </h3>
    ${isSub ? `<div class="api-banner show" style="background:#f0fdf4;border-color:#bbf7d0;color:#166534;margin-bottom:12px;">Document Isolation Active: You only have access to documents assigned to your subcontracting company for this project. Files you upload remain tied to your subcontractor account.</div>` : ''}
    ${isClient ? `<div class="api-banner show" style="margin-bottom:12px;">Client Portal Documents: you can download documents published to you and submit files back to the main contractor. Your submissions cannot change project data or publish contractor records.</div>` : ''}
    ${rows.length ? `<table><thead><tr><th>Name</th><th>Category</th><th>Rev.</th><th>Date Added</th>${!isSub?'<th>Assigned Subcontractor / Uploader</th>':''}<th>File & Tools</th>${canEdit?'<th></th>':''}</tr></thead><tbody>
      ${rows.map(r=>{
        const isDrawingOrVisual = (r.category === 'Drawing') || (r.attachment_name && (r.attachment_name.endsWith('.pdf') || r.attachment_name.match(/\.(png|jpg|jpeg|svg)$/i)));
        return `<tr>
          <td><b>${escHtml(r.name)}</b></td>
          <td>
            <span class="badge ${badgeClass(r.category)}">${escHtml(r.category)}</span>
          </td>
          <td>
            <span class="badge" style="cursor:pointer;background:var(--card-raised);border:1px solid var(--border);" data-doc-revs="${r.id}" title="Click to view full revision history & superseded versions">${escHtml(r.revision||'Rev 0')} ⟲</span>
          </td>
          <td>${escHtml(r.date_added)}</td>
          ${!isSub?`<td>${r.subcontractor_name?`<span class="badge progress" style="font-weight:600;">${escHtml(r.subcontractor_name)}</span>`:r.uploaded_by?`<span style="color:var(--muted);font-size:12px;">${escHtml(r.uploaded_by)}</span>`:'<span style="color:var(--muted);font-size:12px;">Project Team (Internal)</span>'}</td>`:''}
          <td>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              ${r.attachment_data?`<span class="doc-link" data-dl="${r.id}">${escHtml(r.attachment_name||'download')}</span>`:'<span style="color:var(--muted);">—</span>'}
              ${canEdit ? `<button class="btn ghost small" data-doc-newrev="${r.id}" style="padding:2px 6px;font-size:10px;border-color:var(--primary);color:var(--primary);" title="Upload next revision (Rev B, C...)">+ Rev</button>` : ''}
              ${isDrawingOrVisual && r.attachment_data && !isClient ? `
                <button class="btn ghost small" data-doc-markup="${r.id}" style="padding:2px 6px;font-size:10px;" title="Open in Drawing & PDF Markup Studio">✏️ Draw</button>
                <button class="btn ghost small" data-doc-ai="${r.id}" style="padding:2px 6px;font-size:10px;border-color:#0284c7;color:#38bdf8;" title="Ask AI about this drawing">AI</button>
              ` : ''}
              ${r.attachment_data && canEdit ? `
                <button class="btn ghost small" data-doc-analyze="${r.id}" style="padding:2px 6px;font-size:10px;border-color:#6fd3c1;color:#6fd3c1;" title="Read this document and build a Planner board from it">Analyze</button>
              ` : ''}
            </div>
          </td>
          ${canEdit?`<td class="row-actions">${canEdit?`<button class="icon-btn" data-toggle-doc-publish="${r.id}" data-current-visibility="${r.visibility||'Internal'}" title="${(r.visibility==='Client'||r.visibility==='All')?'Published to Client - click to unpublish':'Publish to Client'}">${(r.visibility==='Client'||r.visibility==='All')?'Published':'Publish'}</button>`:''}<button class="icon-btn edit" data-edit="${r.id}" title="Edit">✎</button>${canDel?`<button class="icon-btn" data-del="${r.id}" title="Delete">✕</button>`:''}</td>`:''}
        </tr>`;
      }).join('')}
    </tbody></table>` : '<div class="empty">No documents found for this project.</div>'}
  </div>`;
  if(canUpload && document.getElementById('addBtn')) document.getElementById('addBtn').onclick = ()=> openDocumentModal(null);
  document.getElementById('exportBtn').onclick = ()=> exportCsv('documents');
  document.querySelectorAll('[data-doc-revs]').forEach(btn=>{
    btn.onclick = ()=>{
      const doc = rows.find(x=>x.id===btn.dataset.docRevs);
      if(doc) openDocumentRevisionsModal(doc);
    };
  });
  document.querySelectorAll('[data-doc-newrev]').forEach(btn=>{
    btn.onclick = ()=>{
      const doc = rows.find(x=>x.id===btn.dataset.docNewrev);
      if(doc) openNewRevisionModal(doc);
    };
  });
  if(document.getElementById('openDocStudioBtn')){
    document.getElementById('openDocStudioBtn').onclick = () => {
      openDrawingMarkupStudio({ floorKey: currentFloor || 'L2' });
    };
  }
  document.querySelectorAll('[data-doc-markup]').forEach(btn=>{
    btn.onclick = () => {
      const doc = rows.find(x=>x.id===btn.dataset.docMarkup);
      if(doc){
        openDrawingMarkupStudio({
          docId: doc.id,
          docName: doc.name || doc.attachment_name,
          docAttachmentData: doc.attachment_data,
          floorKey: currentFloor || 'L2'
        });
      }
    };
  });
  document.querySelectorAll('[data-doc-ai]').forEach(btn=>{
    btn.onclick = () => {
      const doc = rows.find(x=>x.id===btn.dataset.docAi);
      if(doc){
        openWorkerAiDrawer({
          drawingTitle: doc.name || doc.attachment_name,
          zoneName: 'Project Drawing Specs',
          zoneSub: doc.category,
          openItems: []
        });
      }
    };
  });
  document.querySelectorAll('[data-toggle-doc-publish]').forEach(btn=>{
    btn.onclick = async () => {
      const isPublished = btn.dataset.currentVisibility === 'Client' || btn.dataset.currentVisibility === 'All';
      const newVisibility = isPublished ? 'Internal' : 'Client';
      if(!isPublished && !confirm('Publish this document to the client? They will be able to see and download it in their Client Portal.')) return;
      try {
        await apiFetch(`/api/documents/${btn.dataset.toggleDocPublish}`, {method:'PUT', body: JSON.stringify({visibility:newVisibility})});
        renderDocuments();
      } catch(err) {
        alert('Could not update publish status: ' + err.message);
      }
    };
  });
  document.querySelectorAll('[data-doc-analyze]').forEach(btn=>{
    btn.onclick = async () => {
      const docId = btn.dataset.docAnalyze;
      const originalText = btn.textContent;
      btn.textContent = 'Reading...';
      btn.disabled = true;
      try {
        const result = await apiFetch(`/api/documents/${docId}/analyze`, {method:'POST'});
        const taskCount = result.buckets.reduce((n,b)=>n+b.tasks.length,0);
        alert(`Done — created ${result.buckets.length} bucket(s) and ${taskCount} task(s) on the Planner board` + (result.source==='reference' ? ' (reference fallback — no AI key configured).' : ' using AI.'));
        document.querySelector('[data-view="planner"]').click();
      } catch(err) {
        alert('Could not analyze this document: ' + err.message);
      } finally {
        btn.textContent = originalText;
        btn.disabled = false;
      }
    };
  });
  document.querySelectorAll('[data-edit]').forEach(btn=>{
    btn.onclick = ()=>{ const record = rows.find(r=>r.id===btn.dataset.edit); openDocumentModal(record); };
  });
  document.querySelectorAll('[data-del]').forEach(btn=>{
    btn.onclick = async ()=>{
      const ok = await confirmAction('Delete this document? This cannot be undone.');
      if(!ok) return;
      await apiFetch(`/api/documents/${btn.dataset.del}`, {method:'DELETE'});
      render();
    };
  });
  document.querySelectorAll('[data-dl]').forEach(el=>{
    el.onclick = ()=>{
      const r = rows.find(x=>x.id===el.dataset.dl);
      if(!r || !r.attachment_data) return;
      const a = document.createElement('a');
      a.href = r.attachment_data;
      a.download = r.attachment_name || 'document';
      document.body.appendChild(a); a.click(); a.remove();
    };
  });
}

async function openDocumentModal(record){
  const isEdit = !!record;
  const isSub = ME.role === 'Subcontractor';
  const isClient = ME.role === 'Client';
  if (isClient && isEdit) throw new Error('Client submissions are immutable after upload; submit a new revision instead.');
  const targetProjId = record ? record.project_id : (currentProjectId === 'ALL' ? (PROJECTS[0]?.id || '') : currentProjectId);

  let subOptions = '';
  if (!isSub && !isClient && targetProjId) {
    try {
      const subs = await apiFetch(`/api/projects/${targetProjId}/subcontractors`);
      subOptions = `<div class="full"><label>Subcontractor Access (Restricts visibility to this subcontractor only)</label>
        <select id="f_subcontractor_id">
          <option value="">— Internal / All Project Managers & Engineers —</option>
          ${subs.map(s=>`<option value="${s.id}" ${record&&record.subcontractor_id===s.id?'selected':''}>${escHtml(s.name)} (${escHtml(s.username)})</option>`).join('')}
        </select>
      </div>`;
    } catch(e) { console.error(e); }
  }

  const projectPicker = !isEdit && currentProjectId==='ALL' ? `<div class="full"><label>Project</label><select id="f_project_id">${PROJECTS.map(p=>`<option value="${p.id}">${escHtml(p.name)}</option>`).join('')}</select></div>` : '';
  const documentCategories = isClient
    ? ['Client Submission','Clarification Attachment','Client Drawing','Other']
    : ['Drawing','Specification','Contract','Tender','BOQ','Programme','Report','Submittal','Safety','Site Photo','Other'];
  const html = `<div class="form-grid">
    ${projectPicker}
    <div class="full" style="background:rgba(217,119,6,0.06);border:1px dashed var(--accent);border-radius:10px;padding:12px;">
      <label style="color:var(--accent);font-weight:700;">1. Attach Document / Contract / BOQ ${isEdit&&record.attachment_name?'(current: '+escHtml(record.attachment_name)+' — choose a new file to replace)':''}</label>
      <input type="file" id="f_file" accept=".pdf,.docx,.csv,.txt,.tsv,.xlsx,.xls,image/*">
      <div style="font-size:11px;color:var(--muted);margin-top:4px;">Selecting a Contract, Tender, or BOQ file will automatically fill the document name, category, and extract project & BOQ data below.</div>
      <div id="f_doc_autofill_banner" style="display:none;margin-top:8px;padding:10px;border-radius:8px;background:rgba(22,163,74,0.08);border:1px solid rgba(22,163,74,0.3);font-size:12px;"></div>
    </div>
    <div class="full"><label>Document Name</label><input id="f_name" value="${record?escHtml(record.name):''}" placeholder="${isClient?'e.g. Client response, marked-up drawing, clarification attachment':'Auto-filled when you select a file above'}"></div>
    <div><label>Category</label><select id="f_category">${documentCategories.map(c=>`<option value="${c}" ${record&&record.category===c?'selected':''}>${c}</option>`).join('')}</select></div>
    <div><label>Revision</label><input id="f_revision" value="${record?escHtml(record.revision):'Rev 0'}"></div>
    <div><label>Date Added</label><input type="date" id="f_date_added" value="${record?escHtml(record.date_added):new Date().toISOString().slice(0,10)}"></div>
    ${subOptions}
    ${!isClient ? `<div class="full" id="f_doc_apply_wrap" style="display:none;padding:8px 10px;border-radius:8px;background:var(--surface-2);border:1px solid var(--border);">
      <label style="display:flex;align-items:center;gap:8px;margin:0;cursor:pointer;font-size:12px;color:var(--ink);">
        <input type="checkbox" id="f_doc_auto_populate" checked style="width:auto;">
        <b>Auto-fill Project Master, BOQ Register, Job Costing Budget, Work Packages & Schedule Tasks from this file</b>
      </label>
    </div>` : ''}
  </div>`;
  openModal(isEdit?'Edit Document':(isClient?'Submit Document to Project':'Add Document (Auto-Fill Enabled)'), html, async ()=>{
    const file = document.getElementById('f_file').files[0];
    if(isClient && !file) throw new Error('Choose a file to submit to the project.');
    const MAX_FILE_MB = 100;
    if(file && file.size > MAX_FILE_MB * 1024 * 1024){
      throw new Error(`This file is ${(file.size/1024/1024).toFixed(1)} MB, which is over the ${MAX_FILE_MB} MB limit for a single document. Try compressing it or splitting it into smaller files.`);
    }
    let attachment_name = record ? record.attachment_name : null;
    let attachment_data = record ? record.attachment_data : null;
    if(file){
      attachment_name = file.name;
      attachment_data = await new Promise((resolve, reject)=>{
        const reader = new FileReader();
        reader.onload = ()=> resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }
    const payload = {
      name: document.getElementById('f_name').value || (file ? file.name.replace(/\.[^.]+$/, '') : 'Document'),
      category: document.getElementById('f_category').value,
      revision: document.getElementById('f_revision').value,
      date_added: document.getElementById('f_date_added').value,
      attachment_name, attachment_data,
    };
    const subSelect = document.getElementById('f_subcontractor_id');
    if(subSelect){
      payload.subcontractor_id = subSelect.value || null;
    }
    let savedDoc = null;
    const projId = isEdit ? record.project_id : (currentProjectId==='ALL' ? document.getElementById('f_project_id').value : currentProjectId);
    if(isEdit){
      savedDoc = await apiFetch(`/api/documents/${record.id}`, {method:'PUT', body: JSON.stringify(payload)});
    }else{
      payload.project_id = projId;
      savedDoc = await apiFetch('/api/documents', {method:'POST', body: JSON.stringify(payload)});
    }
    const shouldAutoPopulate = document.getElementById('f_doc_auto_populate')?.checked;
    if(file && shouldAutoPopulate && savedDoc && savedDoc.id && projId){
      try {
        await apiFetch(`/api/projects/${projId}/extract-setup-data`, {
          method: 'POST',
          body: JSON.stringify({ document_ids: [savedDoc.id] })
        });
        await loadProjectsAndRender();
      } catch(err) {
        console.warn('Auto-populate from document warning:', err);
      }
    }
  });

  const docFileInput = document.getElementById('f_file');
  if (docFileInput) {
    docFileInput.onchange = async () => {
      const f = docFileInput.files && docFileInput.files[0];
      if (!f) return;
      const nameInput = document.getElementById('f_name');
      const catSelect = document.getElementById('f_category');
      const banner = document.getElementById('f_doc_autofill_banner');
      const applyWrap = document.getElementById('f_doc_apply_wrap');

      const inferredCat = inferProjectSetupCategory(f.name);
      if (catSelect && inferredCat && inferredCat !== 'Other') {
        catSelect.value = inferredCat;
      }
      if (nameInput && !nameInput.value.trim()) {
        nameInput.value = f.name.replace(/\.[^.]+$/, '').replace(/[_\-]+/g, ' ');
      }
      if (banner) {
        banner.style.display = 'block';
        banner.innerHTML = '⏳ <b>Scanning document to auto-fill Contract & BOQ metadata...</b>';
      }
      try {
        const fd = new FormData();
        fd.append('file', f);
        const res = await fetch(API + '/api/projects/parse-document', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + TOKEN },
          body: fd
        });
        const parsed = await res.json();
        if (res.ok && parsed && parsed.extracted) {
          const ex = parsed.extracted;
          if (nameInput && ex.projectName) {
            nameInput.value = `${ex.projectName} — ${parsed.document_category || inferredCat}`;
          }
          if (catSelect && parsed.document_category) {
            catSelect.value = parsed.document_category;
          }
          if (applyWrap) applyWrap.style.display = 'block';
          if (banner) {
            banner.innerHTML = `✓ <b>Auto-Filled from ${escHtml(f.name)}:</b><br>`
              + `• <b>Project:</b> ${escHtml(ex.projectName || '—')} | <b>Client:</b> ${escHtml(ex.client || '—')}<br>`
              + `• <b>Contract Value:</b> ${fmtCurrency(ex.budget || 0)} | <b>Dates:</b> ${escHtml(ex.startDate || '—')} → ${escHtml(ex.endDate || '—')}<br>`
              + `• <b>BOQ Lines:</b> ${(parsed.boq_summary && parsed.boq_summary.count) || 0} items | <b>Trades:</b> ${(ex.trades || []).join(', ')}`;
          }
        }
      } catch (e) {
        if (banner) banner.style.display = 'none';
      }
    };
  }
}

async function renderProjects(){
  const canEdit = ME.permissions.edit.includes('projects');
  const canDel = ME.permissions.delete;
  document.getElementById('viewContent').innerHTML = `
  <div class="panel"><h3><span>Projects</span><span style="display:flex;gap:8px;align-items:center;">${canEdit?'<button class="btn accent small" id="uploadContractBoqProjBtn">📄 Upload Contract / BOQ (Auto-Fill)</button><button class="btn ghost small" id="addProjBtn">+ Add Project</button>':''}<button class="btn ghost small" id="exportBtn">Export CSV</button></span></h3>
    ${PROJECTS.length ? `<table><thead><tr><th>Name</th><th>Client</th><th>Main Contractor</th><th>Timeline</th><th>Status</th><th>Contract Budget</th>${canEdit?'<th></th>':''}</tr></thead>
    <tbody>${PROJECTS.map(p=>`<tr><td><b>${escHtml(p.name)}</b></td><td>${escHtml(p.client||'—')}</td><td>${escHtml(p.main_contractor||'—')}</td><td style="font-size:12px;color:var(--muted);">${escHtml(p.start_date||'—')} → ${escHtml(p.end_date||'—')}</td><td><span class="badge ${badgeClass(p.status)}">${p.status}</span></td><td><b>${fmtCurrency(p.budget)}</b></td>
    ${canEdit?`<td class="row-actions"><button class="icon-btn edit" data-editp="${p.id}" title="Edit / Upload Contract & BOQ">✎</button>${canDel?`<button class="icon-btn" data-delp="${p.id}" title="Delete">✕</button>`:''}</td>`:''}</tr>`).join('')}</tbody></table>` : `<div class="empty-state">
      <p>No projects yet.</p>
      ${canEdit?'<button class="btn accent small" id="emptyAddProjBtn">+ Add your first project</button>':''}
    </div>`}
  </div>`;
  if(canEdit && document.getElementById('addProjBtn')) document.getElementById('addProjBtn').onclick = ()=> openProjectModal(null);
  if(canEdit && document.getElementById('uploadContractBoqProjBtn')) document.getElementById('uploadContractBoqProjBtn').onclick = ()=> {
    const activeProj = PROJECTS.find(x=>x.id===currentProjectId) || null;
    openProjectModal(activeProj);
  };
  if(canEdit && document.getElementById('emptyAddProjBtn')) document.getElementById('emptyAddProjBtn').onclick = ()=> openProjectModal(null);
  document.getElementById('exportBtn').onclick = ()=> exportCsv('projects');
  document.querySelectorAll('[data-editp]').forEach(btn=>{
    btn.onclick = ()=>{ const p = PROJECTS.find(x=>x.id===btn.dataset.editp); openProjectModal(p); };
  });
  document.querySelectorAll('[data-delp]').forEach(btn=>{
    btn.onclick = async ()=>{
      const ok = await confirmAction('Delete this project and ALL its tasks, RFIs, submittals, punch items, logs, documents and costs? This cannot be undone.');
      if(!ok) return;
      await apiFetch(`/api/projects/${btn.dataset.delp}`, {method:'DELETE'});
      await loadProjectsAndRender();
    };
  });
}

function inferProjectSetupCategory(filename){
  const n=String(filename||'').toLowerCase();
  if(n.includes('boq') || n.includes('bill of quantities')) return 'BOQ';
  if(n.includes('tender') || n.includes('rfq') || n.includes('quotation')) return 'Tender';
  if(n.includes('programme') || n.includes('program') || n.includes('schedule')) return 'Programme';
  if(n.includes('spec')) return 'Specification';
  if(n.includes('contract') || n.includes('agreement') || n.includes('subcontract')) return 'Contract';
  if(n.includes('drawing') || n.match(/(^|[_\-\s])(dwg|mep|elec|hvac|plumb)([_\-\s]|$)/)) return 'Drawing';
  return 'Other';
}

function readProjectSetupFile(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(new Error('Could not read '+file.name));
    reader.readAsDataURL(file);
  });
}

async function uploadProjectSetupFiles(projectId, files){
  const documentIds=[];
  const MAX_FILE_MB=100;
  for(const file of files){
    if(file.size > MAX_FILE_MB * 1024 * 1024){
      throw new Error(file.name+' is '+(file.size/1024/1024).toFixed(1)+' MB. The maximum is '+MAX_FILE_MB+' MB per document.');
    }
    const attachment_data=await readProjectSetupFile(file);
    const created=await apiFetch('/api/documents',{
      method:'POST',
      body:JSON.stringify({
        project_id:projectId,
        name:file.name.replace(/\.[^.]+$/,''),
        category:inferProjectSetupCategory(file.name),
        revision:'Rev 0',
        date_added:new Date().toISOString().slice(0,10),
        attachment_name:file.name,
        attachment_data
      })
    });
    if(created&&created.id) documentIds.push(created.id);
  }
  return documentIds;
}

function openProjectSetupReview(projectId, analysis){
  const suggestions=Array.isArray(analysis&&analysis.suggestions)?analysis.suggestions:[];
  if(!suggestions.length){
    alert('The project documents were uploaded successfully, but no project fields could be extracted confidently. You can review the files in Documents.');
    return;
  }
  const labels={name:'Project Name',client:'Client / Employer',start_date:'Start / Commencement Date',end_date:'Completion Date',budget:'Contract Value / Budget'};
  const current=PROJECTS.find(p=>p.id===projectId)||{};
  const rows=suggestions.map((s,idx)=>{
    const type=s.field==='budget'?'number':(s.field==='start_date'||s.field==='end_date'?'date':'text');
    const val=s.value===undefined||s.value===null?'':String(s.value);
    const currentVal=current[s.field]===undefined||current[s.field]===null?'':String(current[s.field]);
    return '<div class="full" style="border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:8px;">'
      +'<label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><input type="checkbox" id="setup_accept_'+idx+'" checked> <b>'+escHtml(labels[s.field]||s.field)+'</b> <span class="badge progress">'+escHtml(s.confidence||'Medium')+'</span></label>'
      +'<input type="'+type+'" id="setup_value_'+idx+'" value="'+escHtml(val)+'">'
      +(currentVal&&currentVal!==val?'<div style="font-size:11px;color:var(--muted);margin-top:5px;">Current value: '+escHtml(currentVal)+'</div>':'')
      +'<div style="font-size:11px;color:var(--muted);margin-top:7px;"><b>Source:</b> '+escHtml(s.source_document_name||'Uploaded document')+'</div>'
      +'<div style="font-size:11px;color:var(--muted);margin-top:3px;line-height:1.4;">'+escHtml(s.source_excerpt||'')+'</div>'
      +'</div>';
  }).join('');

  const html='<div class="api-banner show" style="margin-bottom:12px;">Review every extracted value before applying it. Nothing from the documents is written automatically.</div>'
    +'<div class="form-grid">'+rows+'</div>';
  openModal('Review Extracted Project Data',html,async()=>{
    const payload={};
    suggestions.forEach((s,idx)=>{
      const accept=document.getElementById('setup_accept_'+idx);
      if(!accept||!accept.checked) return;
      const input=document.getElementById('setup_value_'+idx);
      if(!input) return;
      let value=input.value;
      if(s.field==='budget') value=Number(value||0);
      payload[s.field]=value;
    });
    if(Object.keys(payload).length){
      await apiFetch('/api/projects/'+projectId,{method:'PUT',body:JSON.stringify(payload)});
    }
    await loadProjectsAndRender();
  });
}

function openProjectModal(record){
  const isEdit=!!record;
  const setupLabel=isEdit?'Upload Contract / Tender / BOQ to Auto-Fill & Update Project':'1. Upload Contract / Tender / BOQ (Instant Auto-Fill)';
  const html='<div class="form-grid">'
    +'<div class="full" style="background:rgba(217,119,6,0.06);border:1.5px dashed var(--accent);border-radius:10px;padding:12px 14px;margin-bottom:4px;">'
      +'<label style="color:var(--accent);font-weight:700;font-size:12px;">📄 '+setupLabel+'</label>'
      +'<input type="file" id="f_project_docs" multiple accept=".pdf,.docx,.csv,.txt,.tsv,.xlsx,.xls,image/*">'
      +'<div style="font-size:11px;color:var(--muted);line-height:1.45;margin-top:5px;">Select a Contract, Subcontract Agreement, Tender RFQ, or BOQ (PDF, DOCX, CSV, XLSX, TXT) — all project fields below will <b>auto-fill immediately</b>, and BOQ items, Work Packages, Budget & Schedule Tasks will be populated on Save.</div>'
      +'<div id="f_project_docs_list" style="font-size:11px;color:var(--muted);margin-top:6px;"></div>'
      +'<div id="f_project_autofill_card" style="display:none;margin-top:8px;padding:10px 12px;border-radius:8px;background:rgba(22,163,74,0.08);border:1px solid rgba(22,163,74,0.35);font-size:12px;color:var(--ink);"></div>'
    +'</div>'
    +'<div class="full"><label>Project Name</label><input id="f_name" value="'+(record?escHtml(record.name):'')+'" placeholder="Auto-filled from uploaded Contract / BOQ"></div>'
    +'<div><label>Client / Employer</label><input id="f_client" value="'+(record?escHtml(record.client):'')+'" placeholder="Auto-filled from Contract / BOQ"></div>'
    +'<div><label>Main Contractor</label><input id="f_main_contractor" value="'+(record&&record.main_contractor?escHtml(record.main_contractor):'')+'" placeholder="Auto-filled from Contract / BOQ"></div>'
    +'<div><label>Supervising Consultant</label><input id="f_consultant" value="'+(record&&record.consultant?escHtml(record.consultant):'')+'" placeholder="Auto-filled from Contract / BOQ"></div>'
    +'<div><label>Site Location</label><input id="f_location" value="'+(record&&record.location?escHtml(record.location):'')+'" placeholder="Auto-filled from Contract / BOQ"></div>'
    +'<div><label>Contract Type</label><input id="f_contract_type" value="'+(record&&record.contract_type?escHtml(record.contract_type):'Lump Sum EPC')+'" placeholder="e.g. Lump Sum EPC"></div>'
    +'<div><label>Status</label><select id="f_status">'+['Active','On Hold','Completed'].map(s=>'<option '+(record&&record.status===s?'selected':'')+'>'+s+'</option>').join('')+'</select></div>'
    +'<div><label>Start / Commencement Date</label><input type="date" id="f_start_date" value="'+(record?escHtml(record.start_date):'')+'"></div>'
    +'<div><label>Completion Date</label><input type="date" id="f_end_date" value="'+(record?escHtml(record.end_date):'')+'"></div>'
    +'<div class="full"><label>Contract Sum / Budget (€)</label><input type="number" id="f_budget" value="'+(record?record.budget:'')+'" placeholder="Auto-filled from Contract / BOQ"></div>'
    +'</div>';

  openModal(isEdit?'Edit Project / Upload Contract & BOQ':'Add Project (Auto-Fill from Contract / BOQ)',html,async()=>{
    const files=Array.from(document.getElementById('f_project_docs')?.files||[]);
    const payload={
      name:document.getElementById('f_name').value,
      client:document.getElementById('f_client').value,
      main_contractor:document.getElementById('f_main_contractor')?.value||'',
      consultant:document.getElementById('f_consultant')?.value||'',
      location:document.getElementById('f_location')?.value||'',
      contract_type:document.getElementById('f_contract_type')?.value||'Lump Sum EPC',
      status:document.getElementById('f_status').value,
      start_date:document.getElementById('f_start_date').value,
      end_date:document.getElementById('f_end_date').value,
      budget:document.getElementById('f_budget').value
    };

    let projectId=record?record.id:null;
    if(isEdit){
      await apiFetch('/api/projects/'+record.id,{method:'PUT',body:JSON.stringify(payload)});
    }else{
      const created=await apiFetch('/api/projects',{method:'POST',body:JSON.stringify(payload)});
      projectId=created&&created.id;
      if(!projectId) throw new Error('Project was created but the server did not return its ID');
    }

    let analysis=null;
    let analysisError=null;
    if(files.length){
      const documentIds=await uploadProjectSetupFiles(projectId,files);
      if(documentIds.length){
        try{
          analysis=await apiFetch('/api/projects/'+projectId+'/extract-setup-data',{
            method:'POST',
            body:JSON.stringify({document_ids:documentIds})
          });
          // Re-apply user-edited form values on top if the user customized any auto-filled field before clicking Save
          const finalOverride = {};
          if(payload.name) finalOverride.name = payload.name;
          if(payload.client) finalOverride.client = payload.client;
          if(payload.main_contractor) finalOverride.main_contractor = payload.main_contractor;
          if(payload.consultant) finalOverride.consultant = payload.consultant;
          if(payload.location) finalOverride.location = payload.location;
          if(payload.contract_type) finalOverride.contract_type = payload.contract_type;
          if(payload.start_date) finalOverride.start_date = payload.start_date;
          if(payload.end_date) finalOverride.end_date = payload.end_date;
          if(payload.budget) { finalOverride.budget = payload.budget; finalOverride.contract_value = payload.budget; }
          if(Object.keys(finalOverride).length){
            await apiFetch('/api/projects/'+projectId,{method:'PUT',body:JSON.stringify(finalOverride)});
          }
        }catch(e){
          analysisError=e;
        }
      }
    }

    currentProjectId = projectId;
    await loadProjectsAndRender();
    if(analysis && (analysis.auto_updated || analysis.report)){
      const rep = analysis.report;
      const wpCount = rep && rep.work_packages ? rep.work_packages.count : (analysis.work_packages ? analysis.work_packages.length : 0);
      const taskCount = rep && rep.programme_tasks ? rep.programme_tasks.count : (analysis.tasks ? analysis.tasks.length : 0);
      const pName = payload.name || (analysis.project && analysis.project.name) || 'Project Master';
      const cName = payload.client || (analysis.project && analysis.project.client) || 'Client Verified';
      const dirName = (rep && rep.contractor_directory && rep.contractor_directory.company_name) || payload.main_contractor || 'Contractor Registered';
      const alertMsg = '✓ Contract / BOQ Auto-Filled & Applied Across All Modules!\n\n'
        + '• Project: ' + pName + '\n'
        + '• Client / Employer: ' + cName + '\n'
        + '• Contract Budget: ' + fmtCurrency(payload.budget || (analysis.project && analysis.project.budget) || 0) + '\n'
        + '• Work Packages: ' + wpCount + ' trade packages generated\n'
        + '• Programme Tasks: ' + taskCount + ' milestones scheduled\n'
        + '• BOQ, Job Costing & Material Requests: Populated\n'
        + '• Contractor Directory: ' + dirName;
      setTimeout(()=>alert(alertMsg), 120);
    }else if(analysis&&Array.isArray(analysis.suggestions)&&analysis.suggestions.length){
      setTimeout(()=>openProjectSetupReview(projectId,analysis),120);
    }else if(files.length && analysisError){
      setTimeout(()=>alert('Project and documents were saved, but automatic extraction could not complete: '+(analysisError.message||'Unknown error')),120);
    }
  });

  const fileInput=document.getElementById('f_project_docs');
  const fileList=document.getElementById('f_project_docs_list');
  const autoCard=document.getElementById('f_project_autofill_card');
  if(fileInput&&fileList){
    fileInput.onchange=async()=>{
      const files=Array.from(fileInput.files||[]);
      fileList.innerHTML=files.length
        ? files.map(f=>'• <b>'+escHtml(f.name)+'</b> — '+(f.size/1024/1024).toFixed(2)+' MB').join('<br>')
        : '';
      if(!files.length){
        if(autoCard) autoCard.style.display='none';
        return;
      }
      if(autoCard){
        autoCard.style.display='block';
        autoCard.innerHTML='⏳ <b>Scanning '+escHtml(files[0].name)+' and auto-filling Contract & BOQ fields...</b>';
      }
      try{
        const fd=new FormData();
        fd.append('file', files[0]);
        const res=await fetch(API+'/api/projects/parse-document',{
          method:'POST',
          headers:{Authorization:'Bearer '+TOKEN},
          body:fd
        });
        const data=await res.json();
        if(res.ok && data && data.extracted){
          const ex=data.extracted;
          const setField=(id,val)=>{
            const el=document.getElementById(id);
            if(el && val!==undefined && val!==null && String(val).trim()!==''){
              el.value=val;
              el.style.borderColor='#16a34a';
              el.style.backgroundColor='rgba(22,163,74,0.05)';
            }
          };
          if(ex.projectName) setField('f_name', ex.projectName);
          if(ex.client) setField('f_client', ex.client);
          if(ex.mainContractor) setField('f_main_contractor', ex.mainContractor);
          if(ex.consultant) setField('f_consultant', ex.consultant);
          if(ex.location) setField('f_location', ex.location);
          if(ex.contractType) setField('f_contract_type', ex.contractType);
          if(ex.startDate) setField('f_start_date', ex.startDate);
          if(ex.endDate) setField('f_end_date', ex.endDate);
          if(ex.budget) setField('f_budget', ex.budget);

          const boqCount=(data.boq_summary && data.boq_summary.count) || 0;
          const boqTotal=(data.boq_summary && data.boq_summary.total_amount) || ex.budget || 0;
          const tradesList=(ex.trades || []).join(', ') || 'MEP';
          const msCount=(ex.milestones || []).length;

          if(autoCard){
            autoCard.innerHTML=`<div style="font-weight:700;color:#15803d;margin-bottom:4px;">✓ Auto-Filled ${escHtml(data.document_category||'Contract / BOQ')} Information from ${escHtml(files[0].name)}</div>`
              +`<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:11.5px;">`
              +`<div><b>Project:</b> ${escHtml(ex.projectName||'—')}</div>`
              +`<div><b>Client:</b> ${escHtml(ex.client||'—')}</div>`
              +`<div><b>Contract Budget:</b> ${fmtCurrency(boqTotal)}</div>`
              +`<div><b>Trades:</b> ${escHtml(tradesList)}</div>`
              +`<div><b>BOQ Items Detected:</b> ${boqCount} lines</div>`
              +`<div><b>Schedule Milestones:</b> ${msCount} tasks</div>`
              +`</div>`
              +`<div style="margin-top:6px;font-size:11px;color:var(--muted);">Click <b>Save</b> below to apply all auto-filled fields and populate BOQ, Job Costing, Work Packages, Schedule & Material Requests.</div>`;
          }
        }
      }catch(err){
        if(autoCard){
          autoCard.innerHTML='⚠️ Could not preview file automatically ('+escHtml(err.message||'error')+'), but it will be processed on Save.';
        }
      }
    };
  }
}

window.openContractBoqAutoFillModal = function(){
  const activeProj = PROJECTS.find(x => x.id === currentProjectId) || null;
  openProjectModal(activeProj);
};

/* =========================================================
   COMPANIES & PARTIES DIRECTORY VIEW
   ========================================================= */
async function renderCompanies(){
  const rows = await apiFetch('/api/companies');
  const canEdit = ME.permissions.edit.includes('companies') || ME.role==='Admin' || ME.role==='ProjectManager' || ME.role==='CommercialManager';
  const canDel = ME.role==='Admin';

  const totalSubs = rows.filter(r=>r.type==='Subcontractor').length;
  const totalConsultants = rows.filter(r=>r.type==='Consultant'||r.type==='Client').length;
  const totalSuppliers = rows.filter(r=>r.type==='Supplier').length;

  document.getElementById('viewContent').innerHTML = `
  <div style="display:flex;flex-direction:column;gap:14px;">
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));">
      <div class="stat-card">
        <div class="num" style="color:var(--primary);">${rows.length}</div>
        <div class="lbl">Total Entities</div>
      </div>
      <div class="stat-card">
        <div class="num" style="color:#6fd3c1;">${totalSubs}</div>
        <div class="lbl">Subcontractors</div>
      </div>
      <div class="stat-card">
        <div class="num" style="color:#0891b2;">${totalConsultants}</div>
        <div class="lbl">Client & Consultants</div>
      </div>
      <div class="stat-card">
        <div class="num" style="color:#f59e0b;">${totalSuppliers}</div>
        <div class="lbl">Suppliers & Vendors</div>
      </div>
    </div>

    <div class="panel">
      <h3>
        <span>Companies & Stakeholders Directory</span>
        <span style="display:flex;gap:8px;align-items:center;">
          ${canEdit ? `<button class="btn accent small" id="addCompanyBtn">+ Add Company / Party</button>` : ''}
          <button class="btn ghost small" id="exportCompaniesBtn">Export CSV</button>
        </span>
      </h3>
      <div style="margin-bottom:12px;display:flex;gap:6px;flex-wrap:wrap;">
        <button class="btn ghost small active" data-filter-type="ALL" style="padding:3px 10px;font-size:11px;">All (${rows.length})</button>
        <button class="btn ghost small" data-filter-type="Subcontractor" style="padding:3px 10px;font-size:11px;">Subcontractors (${totalSubs})</button>
        <button class="btn ghost small" data-filter-type="Client" style="padding:3px 10px;font-size:11px;">Client</button>
        <button class="btn ghost small" data-filter-type="Consultant" style="padding:3px 10px;font-size:11px;">Consultants</button>
        <button class="btn ghost small" data-filter-type="Supplier" style="padding:3px 10px;font-size:11px;">Suppliers</button>
        <button class="btn ghost small" data-filter-type="MainContractor" style="padding:3px 10px;font-size:11px;">Main Contractor</button>
      </div>
      <div id="companyTableWrap">
        ${renderCompanyRowsHtml(rows, canEdit, canDel)}
      </div>
    </div>
  </div>`;

  if(canEdit && document.getElementById('addCompanyBtn')) {
    document.getElementById('addCompanyBtn').onclick = () => openCompanyModal(null);
  }
  document.getElementById('exportCompaniesBtn').onclick = () => exportCsv('companies');

  document.querySelectorAll('[data-filter-type]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('[data-filter-type]').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const type = btn.dataset.filterType;
      const filtered = type === 'ALL' ? rows : rows.filter(r => r.type === type);
      document.getElementById('companyTableWrap').innerHTML = renderCompanyRowsHtml(filtered, canEdit, canDel);
      attachCompanyRowEvents(rows, canEdit, canDel);
    };
  });

  attachCompanyRowEvents(rows, canEdit, canDel);
}

function renderCompanyRowsHtml(rows, canEdit, canDel){
  if(!rows.length) return `<div class="empty-state"><p>No companies found in this category.</p></div>`;
  const typeBadgeColors = {
    'Subcontractor': 'badge-pkg',
    'MainContractor': 'badge-pub',
    'Client': 'badge-pub',
    'Consultant': 'badge-draft',
    'Supplier': 'badge-pkg'
  };
  return `<table>
    <thead>
      <tr>
        <th>Company Name</th>
        <th>Type</th>
        <th>Trade / Specialization</th>
        <th>Key Contact</th>
        <th>Email & Phone</th>
        <th>VAT / Tax ID</th>
        <th>Work Packages</th>
        <th>Status</th>
        ${canEdit?'<th></th>':''}
      </tr>
    </thead>
    <tbody>
      ${rows.map(r=>`
        <tr>
          <td><b>${escHtml(r.name)}</b></td>
          <td><span class="badge ${typeBadgeColors[r.type]||'progress'}">${escHtml(r.type)}</span></td>
          <td>${escHtml(r.trade||'General')}</td>
          <td>${escHtml(r.contact_person||'—')}</td>
          <td>
            <div style="font-size:12px;">
              ${r.email ? `<div><a href="mailto:${escHtml(r.email)}" style="color:var(--primary);">${escHtml(r.email)}</a></div>`:''}
              ${r.phone ? `<div style="color:var(--muted);">${escHtml(r.phone)}</div>`:''}
              ${!r.email && !r.phone ? '<span style="color:var(--muted);">—</span>':''}
            </div>
          </td>
          <td><span style="font-family:monospace;font-size:11px;">${escHtml(r.vat_number||'—')}</span></td>
          <td><span class="badge" style="background:var(--card-raised);">${r.package_count||0} pkgs</span></td>
          <td><span class="badge ${r.status==='Active'?'badge-pub':'badge-draft'}">${escHtml(r.status||'Active')}</span></td>
          ${canEdit?`<td class="row-actions">
            <button class="icon-btn edit" data-edit-company="${r.id}" title="Edit Company">✎</button>
            ${canDel?`<button class="icon-btn" data-del-company="${r.id}" title="Delete Company">✕</button>`:''}
          </td>`:''}
        </tr>
      `).join('')}
    </tbody>
  </table>`;
}

function attachCompanyRowEvents(rows, canEdit, canDel){
  document.querySelectorAll('[data-edit-company]').forEach(btn => {
    btn.onclick = () => {
      const rec = rows.find(r=>r.id===btn.dataset.editCompany);
      if(rec) openCompanyModal(rec);
    };
  });
  document.querySelectorAll('[data-del-company]').forEach(btn => {
    btn.onclick = async () => {
      const ok = await confirmAction('Delete this company? Associated user accounts and packages will lose their company link.');
      if(!ok) return;
      try {
        await apiFetch(`/api/companies/${btn.dataset.delCompany}`, {method:'DELETE'});
        renderCompanies();
      } catch(e) { alert('Delete failed: '+e.message); }
    };
  });
}

function openCompanyModal(record){
  const isEdit = !!record;
  const types = ['Subcontractor', 'MainContractor', 'Client', 'Consultant', 'Supplier'];
  const html = `<div class="form-grid">
    <div class="full"><label>Company Legal Name</label><input id="f_name" value="${record?escHtml(record.name):''}" placeholder="e.g. Apex Mechanical Ltd"></div>
    <div><label>Company Type</label><select id="f_type">${types.map(t=>`<option value="${t}" ${record&&record.type===t?'selected':''}>${t}</option>`).join('')}</select></div>
    <div><label>Primary Trade / Scope</label><input id="f_trade" value="${record?escHtml(record.trade):''}" placeholder="e.g. HVAC Ductwork & VRF"></div>
    <div><label>Contact Person</label><input id="f_contact_person" value="${record?escHtml(record.contact_person):''}" placeholder="e.g. John Borg"></div>
    <div><label>Email</label><input type="email" id="f_email" value="${record?escHtml(record.email):''}" placeholder="contact@company.com"></div>
    <div><label>Phone</label><input id="f_phone" value="${record?escHtml(record.phone):''}" placeholder="+356 2100 0000"></div>
    <div><label>VAT / Registration No.</label><input id="f_vat_number" value="${record?escHtml(record.vat_number):''}" placeholder="MT12345678"></div>
    <div><label>Status</label><select id="f_status"><option value="Active" ${!record||record.status==='Active'?'selected':''}>Active</option><option value="Inactive" ${record&&record.status==='Inactive'?'selected':''}>Inactive</option></select></div>
    <div class="full"><label>Notes / Contract Terms</label><textarea id="f_notes" rows="2">${record?escHtml(record.notes):''}</textarea></div>
  </div>`;

  openModal(isEdit?'Edit Company / Party':'Add Company / Party', html, async ()=>{
    const payload = {
      name: document.getElementById('f_name').value.trim(),
      type: document.getElementById('f_type').value,
      trade: document.getElementById('f_trade').value.trim(),
      contact_person: document.getElementById('f_contact_person').value.trim(),
      email: document.getElementById('f_email').value.trim(),
      phone: document.getElementById('f_phone').value.trim(),
      vat_number: document.getElementById('f_vat_number').value.trim(),
      status: document.getElementById('f_status').value,
      notes: document.getElementById('f_notes').value.trim()
    };
    if(!payload.name) throw new Error('Company name is required');
    if(isEdit){
      await apiFetch(`/api/companies/${record.id}`, {method:'PUT', body: JSON.stringify(payload)});
    } else {
      await apiFetch('/api/companies', {method:'POST', body: JSON.stringify(payload)});
    }
  });
}

/* =========================================================
   WORK PACKAGES & SUBCONTRACTOR SCOPING VIEW
   ========================================================= */
async function renderWorkPackages(){
  const [packages, companies] = await Promise.all([
    apiFetch(`/api/work_packages?project_id=${currentProjectId}`),
    apiFetch('/api/companies')
  ]);
  const canEdit = ME.permissions.edit.includes('work_packages') || ME.role==='Admin' || ME.role==='ProjectManager';
  const canDel = ME.permissions.delete && canEdit;

  const totalBudget = packages.reduce((acc, p) => acc + (Number(p.budget_allocated) || 0), 0);
  const activeCount = packages.filter(p => p.status === 'Active').length;

  document.getElementById('viewContent').innerHTML = `
  <div style="display:flex;flex-direction:column;gap:14px;">
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));">
      <div class="stat-card">
        <div class="num" style="color:var(--primary);">${packages.length}</div>
        <div class="lbl">Work Packages</div>
      </div>
      <div class="stat-card">
        <div class="num" style="color:#6fd3c1;">${fmtCurrency(totalBudget)}</div>
        <div class="lbl">Allocated Budget</div>
      </div>
      <div class="stat-card">
        <div class="num" style="color:#0891b2;">${activeCount}</div>
        <div class="lbl">Active Scopes</div>
      </div>
      <div class="stat-card">
        <div class="num" style="color:#f59e0b;">${companies.filter(c=>c.type==='Subcontractor').length}</div>
        <div class="lbl">Subcontractors in Pool</div>
      </div>
    </div>

    <div class="panel">
      <h3>
        <span>Work Packages & Scopes</span>
        <span style="display:flex;gap:8px;align-items:center;">
          ${canEdit ? `<button class="btn accent small" id="addWorkPkgBtn">+ Add Work Package</button>` : ''}
          <button class="btn ghost small" id="exportWorkPkgBtn">Export CSV</button>
        </span>
      </h3>
      ${packages.length ? `<table>
        <thead>
          <tr>
            <th>Package Code</th>
            <th>Package Name</th>
            <th>Discipline</th>
            <th>Assigned Subcontractor</th>
            <th>Allocated Budget</th>
            <th>Schedule</th>
            <th>Progress & Status</th>
            ${canEdit?'<th></th>':''}
          </tr>
        </thead>
        <tbody>
          ${packages.map(p=>{
            const avgProg = Math.round(Number(p.task_avg_progress) || 0);
            return `<tr>
              <td><span class="badge badge-pkg" style="font-family:monospace;font-weight:700;">${escHtml(p.code)}</span></td>
              <td>
                <div style="font-weight:700;font-size:13px;">${escHtml(p.name)}</div>
                ${p.description ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;">${escHtml(p.description)}</div>` : ''}
              </td>
              <td><span class="badge ${badgeClass(p.discipline)}">${escHtml(p.discipline)}</span></td>
              <td>
                ${p.company_name ? `
                  <div style="font-weight:600;color:var(--text);">${escHtml(p.company_name)}</div>
                  <div style="font-size:11px;color:var(--muted);">${escHtml(p.lead_contact||p.company_trade||'Subcontractor')}</div>
                ` : `<span style="color:var(--muted);font-style:italic;">Unassigned</span>`}
              </td>
              <td><b>${fmtCurrency(p.budget_allocated)}</b></td>
              <td>
                <div style="font-size:11px;color:var(--text);">${p.start_date ? p.start_date : 'TBD'} ➔ ${p.target_date ? p.target_date : 'TBD'}</div>
              </td>
              <td>
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
                  <div class="progress-bar" style="width:70px;height:6px;background:var(--card-raised);border-radius:3px;overflow:hidden;">
                    <div style="height:100%;width:${avgProg}%;background:var(--primary);"></div>
                  </div>
                  <span style="font-size:11px;font-weight:700;">${avgProg}%</span>
                </div>
                <div><span class="badge ${p.status==='Active'?'badge-pub':p.status==='Substantially Complete'?'progress':'badge-draft'}">${escHtml(p.status)}</span></div>
              </td>
              ${canEdit?`<td class="row-actions">
                <button class="icon-btn edit" data-edit-wp="${p.id}" title="Edit Package">✎</button>
                ${canDel?`<button class="icon-btn" data-del-wp="${p.id}" title="Delete Package">✕</button>`:''}
              </td>`:''}
            </tr>`;
          }).join('')}
        </tbody>
      </table>` : `<div class="empty-state">
        <p>No work packages defined yet for this project.</p>
        ${canEdit?`<button class="btn accent small" id="emptyAddWorkPkgBtn">+ Define First Work Package</button>`:''}
      </div>`}
    </div>
  </div>`;

  if(canEdit && document.getElementById('addWorkPkgBtn')) {
    document.getElementById('addWorkPkgBtn').onclick = () => openWorkPackageModal(null, companies);
  }
  if(canEdit && document.getElementById('emptyAddWorkPkgBtn')) {
    document.getElementById('emptyAddWorkPkgBtn').onclick = () => openWorkPackageModal(null, companies);
  }
  document.getElementById('exportWorkPkgBtn').onclick = () => exportCsv('work_packages');

  document.querySelectorAll('[data-edit-wp]').forEach(btn => {
    btn.onclick = () => {
      const rec = packages.find(p=>p.id===btn.dataset.editWp);
      if(rec) openWorkPackageModal(rec, companies);
    };
  });
  document.querySelectorAll('[data-del-wp]').forEach(btn => {
    btn.onclick = async () => {
      const ok = await confirmAction('Delete this work package? Linked tasks and progress claims will remain.');
      if(!ok) return;
      try {
        await apiFetch(`/api/work_packages/${btn.dataset.delWp}`, {method:'DELETE'});
        renderWorkPackages();
      } catch(e) { alert('Delete failed: '+e.message); }
    };
  });
}

function openWorkPackageModal(record, companies){
  const isEdit = !!record;
  const targetProjId = record ? record.project_id : (currentProjectId === 'ALL' ? (PROJECTS[0]?.id || '') : currentProjectId);
  const projectPicker = !isEdit && currentProjectId==='ALL' ? `<div class="full"><label>Project</label><select id="f_project_id">${PROJECTS.map(p=>`<option value="${p.id}">${escHtml(p.name)}</option>`).join('')}</select></div>` : '';

  const html = `<div class="form-grid">
    ${projectPicker}
    <div><label>Package Code</label><input id="f_code" value="${record?escHtml(record.code):'WP-01-HVAC'}" placeholder="WP-01"></div>
    <div><label>Discipline</label><select id="f_discipline">${TRADES.map(t=>`<option ${record&&record.discipline===t?'selected':''}>${t}</option>`).join('')}</select></div>
    <div class="full"><label>Package Name</label><input id="f_name" value="${record?escHtml(record.name):''}" placeholder="e.g. HVAC Ductwork, Grilles & Insulation"></div>
    <div class="full"><label>Assigned Subcontractor Company</label>
      <select id="f_company_id">
        <option value="">— Select Subcontractor / Unassigned —</option>
        ${companies.map(c=>`<option value="${c.id}" ${record&&record.company_id===c.id?'selected':''}>${escHtml(c.name)} (${escHtml(c.type)} - ${escHtml(c.trade||'General')})</option>`).join('')}
      </select>
    </div>
    <div><label>Lead Contact Person</label><input id="f_lead_contact" value="${record?escHtml(record.lead_contact):''}" placeholder="e.g. Lead Project Engineer"></div>
    <div><label>Allocated Budget (€)</label><input type="number" id="f_budget_allocated" value="${record?record.budget_allocated:''}" placeholder="50000"></div>
    <div><label>Commencement / Start Date</label><input type="date" id="f_start_date" value="${record?escHtml(record.start_date):''}"></div>
    <div><label>Target Completion Date</label><input type="date" id="f_target_date" value="${record?escHtml(record.target_date):''}"></div>
    <div><label>Status</label><select id="f_status">${['Planned','Active','Substantially Complete','Closed'].map(s=>`<option ${record&&record.status===s?'selected':''}>${s}</option>`).join('')}</select></div>
    <div class="full"><label>Scope Description / Specification Bounds</label><textarea id="f_description" rows="3">${record?escHtml(record.description):''}</textarea></div>
  </div>`;

  openModal(isEdit?'Edit Work Package':'Add Work Package', html, async ()=>{
    const payload = {
      project_id: isEdit ? record.project_id : (document.getElementById('f_project_id')?.value || targetProjId),
      code: document.getElementById('f_code').value.trim(),
      discipline: document.getElementById('f_discipline').value,
      name: document.getElementById('f_name').value.trim(),
      company_id: document.getElementById('f_company_id').value || null,
      lead_contact: document.getElementById('f_lead_contact').value.trim(),
      budget_allocated: Number(document.getElementById('f_budget_allocated').value || 0),
      start_date: document.getElementById('f_start_date').value,
      target_date: document.getElementById('f_target_date').value,
      status: document.getElementById('f_status').value,
      description: document.getElementById('f_description').value.trim()
    };
    if(!payload.name) throw new Error('Package name is required');
    if(!payload.code) throw new Error('Package code is required');
    if(isEdit){
      await apiFetch(`/api/work_packages/${record.id}`, {method:'PUT', body: JSON.stringify(payload)});
    } else {
      await apiFetch('/api/work_packages', {method:'POST', body: JSON.stringify(payload)});
    }
  });
}

/* =========================================================
   CLARIFICATIONS HUB (CONTROLLED COMMUNICATION WORKFLOW)
   ========================================================= */
async function renderClarifications(){
  const [items, companies, workPackages] = await Promise.all([
    apiFetch(`/api/clarifications?project_id=${currentProjectId}`),
    apiFetch('/api/companies'),
    apiFetch(`/api/work_packages?project_id=${currentProjectId}`)
  ]);
  const canEdit = ME.permissions.edit.includes('clarifications') || ME.role==='Admin' || ME.role==='ProjectManager' || ME.role==='SiteEngineer';
  const canDel = ME.permissions.delete && canEdit;

  const totalOpen = items.filter(i=>i.status==='Submitted'||i.status==='Under Review').length;
  const totalAnswered = items.filter(i=>i.status==='Answered'||i.status==='Closed').length;
  const totalHigh = items.filter(i=>i.priority==='Critical'||i.priority==='High').length;

  document.getElementById('viewContent').innerHTML = `
  <div style="display:flex;flex-direction:column;gap:14px;">
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));">
      <div class="stat-card">
        <div class="num" style="color:var(--primary);">${items.length}</div>
        <div class="lbl">Clarifications Total</div>
      </div>
      <div class="stat-card ${totalOpen>0?'warn':''}">
        <div class="num" style="color:${totalOpen>0?'#f59e0b':'var(--text)'};">${totalOpen}</div>
        <div class="lbl">Open / Under Review</div>
      </div>
      <div class="stat-card">
        <div class="num" style="color:#6fd3c1;">${totalAnswered}</div>
        <div class="lbl">Answered & Closed</div>
      </div>
      <div class="stat-card">
        <div class="num" style="color:#ef4444;">${totalHigh}</div>
        <div class="lbl">Critical / High Priority</div>
      </div>
    </div>

    <div class="panel">
      <h3>
        <span>Clarifications Hub</span>
        <span style="display:flex;gap:8px;align-items:center;">
          ${canEdit ? `<button class="btn accent small" id="addClarificationBtn">+ Raise Clarification</button>` : ''}
          <button class="btn ghost small" id="exportClarificationsBtn">Export CSV</button>
        </span>
      </h3>
      <div style="margin-bottom:12px;display:flex;gap:6px;flex-wrap:wrap;">
        <button class="btn ghost small active" data-cl-filter="ALL" style="padding:3px 10px;font-size:11px;">All (${items.length})</button>
        <button class="btn ghost small" data-cl-filter="OPEN" style="padding:3px 10px;font-size:11px;">Open / Pending (${totalOpen})</button>
        <button class="btn ghost small" data-cl-filter="ANSWERED" style="padding:3px 10px;font-size:11px;">Answered (${totalAnswered})</button>
        <button class="btn ghost small" data-cl-filter="CRITICAL" style="padding:3px 10px;font-size:11px;">Critical / High</button>
      </div>
      <div id="clarificationsTableWrap">
        ${renderClarificationRowsHtml(items, canEdit, canDel)}
      </div>
    </div>
  </div>`;

  if(canEdit && document.getElementById('addClarificationBtn')) {
    document.getElementById('addClarificationBtn').onclick = () => openClarificationModal(null, companies, workPackages);
  }
  document.getElementById('exportClarificationsBtn').onclick = () => exportCsv('clarifications');

  document.querySelectorAll('[data-cl-filter]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('[data-cl-filter]').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const f = btn.dataset.clFilter;
      let filtered = items;
      if(f==='OPEN') filtered = items.filter(i=>i.status==='Submitted'||i.status==='Under Review');
      if(f==='ANSWERED') filtered = items.filter(i=>i.status==='Answered'||i.status==='Closed');
      if(f==='CRITICAL') filtered = items.filter(i=>i.priority==='Critical'||i.priority==='High');
      document.getElementById('clarificationsTableWrap').innerHTML = renderClarificationRowsHtml(filtered, canEdit, canDel);
      attachClarificationEvents(items, companies, workPackages, canEdit, canDel);
    };
  });

  attachClarificationEvents(items, companies, workPackages, canEdit, canDel);
}

function renderClarificationRowsHtml(items, canEdit, canDel){
  if(!items.length) return `<div class="empty-state"><p>No clarifications recorded in this category.</p></div>`;
  const priorityBadges = {
    'Critical': 'style="background:#fee2e2;color:#991b1b;border:1px solid #f87171;"',
    'High': 'style="background:#ffedd5;color:#9a3412;border:1px solid #fb923c;"',
    'Medium': 'style="background:#fef3c7;color:#92400e;border:1px solid #fcd34d;"',
    'Low': 'style="background:#f1f5f9;color:#475569;"'
  };
  return `<table>
    <thead>
      <tr>
        <th>No.</th>
        <th>Subject</th>
        <th>Route (From ➔ To)</th>
        <th>Discipline / Scope</th>
        <th>Priority</th>
        <th>Impact</th>
        <th>Status</th>
        <th>Visibility</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      ${items.map(r=>`
        <tr>
          <td><span class="badge badge-pkg" style="font-family:monospace;font-weight:700;">${escHtml(r.clarification_number)}</span></td>
          <td>
            <div style="font-weight:700;font-size:13px;color:var(--text);cursor:pointer;" data-thread-cl="${r.id}" title="Click to view full thread, responses & comments">${escHtml(r.subject)}</div>
            <div style="font-size:11px;color:var(--muted);">${escHtml(r.type||'Technical Query')} · ${r.comments_count||0} comments</div>
          </td>
          <td>
            <div style="font-size:12px;">
              <span style="color:var(--text);font-weight:600;">${escHtml(r.from_company_name||'Main Contractor')}</span>
              <span style="color:var(--primary);margin:0 4px;">➔</span>
              <span style="color:var(--text);">${escHtml(r.to_company_name||'Consultant / Client')}</span>
            </div>
          </td>
          <td>
            <span class="badge ${badgeClass(r.discipline)}">${escHtml(r.discipline)}</span>
            ${r.work_package_code ? `<span class="badge badge-draft" style="margin-left:4px;font-size:10px;">${escHtml(r.work_package_code)}</span>`:''}
          </td>
          <td><span class="badge" ${priorityBadges[r.priority]||''}>${escHtml(r.priority)}</span></td>
          <td>
            <div style="font-size:11px;">
              ${r.cost_impact_flag ? '<span style="color:#ef4444;font-weight:700;">€ Cost</span> ':''}
              ${r.schedule_impact_flag ? '<span style="color:#f59e0b;font-weight:700;">⏱ Schedule</span>':''}
              ${!r.cost_impact_flag && !r.schedule_impact_flag ? '<span style="color:var(--muted);">None</span>':''}
            </div>
          </td>
          <td><span class="badge ${r.status==='Answered'||r.status==='Closed'?'badge-pub':r.status==='Under Review'?'badge-draft':'progress'}">${escHtml(r.status)}</span></td>
          <td>
            <span class="badge ${r.client_visible?'badge-pub':'badge-draft'}" style="font-size:10px;">${r.client_visible?'Client Published':'Internal'}</span>
          </td>
          <td class="row-actions">
            <button class="btn ghost small" data-thread-cl="${r.id}" style="padding:2px 7px;font-size:11px;" title="Open Thread & Comments">Thread</button>
            ${canEdit?`<button class="icon-btn edit" data-edit-cl="${r.id}" title="Edit Clarification">✎</button>`:''}
            ${canDel?`<button class="icon-btn" data-del-cl="${r.id}" title="Delete Clarification">✕</button>`:''}
          </td>
        </tr>
      `).join('')}
    </tbody>
  </table>`;
}

function attachClarificationEvents(items, companies, workPackages, canEdit, canDel){
  document.querySelectorAll('[data-thread-cl]').forEach(btn => {
    btn.onclick = () => {
      const rec = items.find(i=>i.id===btn.dataset.threadCl);
      if(rec) openClarificationThread(rec, companies, workPackages);
    };
  });
  document.querySelectorAll('[data-edit-cl]').forEach(btn => {
    btn.onclick = () => {
      const rec = items.find(i=>i.id===btn.dataset.editCl);
      if(rec) openClarificationModal(rec, companies, workPackages);
    };
  });
  document.querySelectorAll('[data-del-cl]').forEach(btn => {
    btn.onclick = async () => {
      const ok = await confirmAction('Delete this clarification? All comments and attachment records will be removed.');
      if(!ok) return;
      try {
        await apiFetch(`/api/clarifications/${btn.dataset.delCl}`, {method:'DELETE'});
        renderClarifications();
      } catch(e) { alert('Delete failed: '+e.message); }
    };
  });
}

function openClarificationModal(record, companies, workPackages){
  const isEdit = !!record;
  const targetProjId = record ? record.project_id : (currentProjectId === 'ALL' ? (PROJECTS[0]?.id || '') : currentProjectId);
  const projectPicker = !isEdit && currentProjectId==='ALL' ? `<div class="full"><label>Project</label><select id="f_project_id">${PROJECTS.map(p=>`<option value="${p.id}">${escHtml(p.name)}</option>`).join('')}</select></div>` : '';

  const types = ['Technical Query', 'RFI', 'Commercial', 'Site Coordination', 'Specification'];
  const priorities = ['Low', 'Medium', 'High', 'Critical'];

  const html = `<div class="form-grid">
    ${projectPicker}
    <div><label>Clarification No.</label><input id="f_clarification_number" value="${record?escHtml(record.clarification_number):'CLR-001'}" placeholder="CLR-001"></div>
    <div><label>Type</label><select id="f_type">${types.map(t=>`<option ${record&&record.type===t?'selected':''}>${t}</option>`).join('')}</select></div>
    <div class="full"><label>Subject</label><input id="f_subject" value="${record?escHtml(record.subject):''}" placeholder="e.g. AHU Duct Riser Routing Clash at Level 2"></div>
    <div><label>From Party / Company</label>
      <select id="f_from_company_id">
        <option value="">— Main Contractor (Internal) —</option>
        ${companies.map(c=>`<option value="${c.id}" ${record&&record.from_company_id===c.id?'selected':''}>${escHtml(c.name)} (${escHtml(c.type)})</option>`).join('')}
      </select>
    </div>
    <div><label>To Party / Company</label>
      <select id="f_to_company_id">
        <option value="">— Consultant / Client Rep —</option>
        ${companies.map(c=>`<option value="${c.id}" ${record&&record.to_company_id===c.id?'selected':''}>${escHtml(c.name)} (${escHtml(c.type)})</option>`).join('')}
      </select>
    </div>
    <div><label>Linked Work Package</label>
      <select id="f_work_package_id">
        <option value="">— None / General —</option>
        ${workPackages.map(wp=>`<option value="${wp.id}" ${record&&record.work_package_id===wp.id?'selected':''}>${escHtml(wp.code)} - ${escHtml(wp.name)}</option>`).join('')}
      </select>
    </div>
    <div><label>Discipline</label><select id="f_discipline">${TRADES.map(t=>`<option ${record&&record.discipline===t?'selected':''}>${t}</option>`).join('')}</select></div>
    <div><label>Priority</label><select id="f_priority">${priorities.map(p=>`<option ${record&&record.priority===p?'selected':''}>${p}</option>`).join('')}</select></div>
    <div><label>Status</label><select id="f_status">${['Submitted','Under Review','Answered','Closed'].map(s=>`<option ${record&&record.status===s?'selected':''}>${s}</option>`).join('')}</select></div>
    <div class="full"><label>Question / Query Details</label><textarea id="f_question" rows="3" placeholder="Describe the query, discrepancy, or site situation requiring clarification...">${record?escHtml(record.question):''}</textarea></div>
    <div class="full"><label>Proposed Solution / Recommendation</label><textarea id="f_proposed_solution" rows="2" placeholder="Proposed contractor resolution or design adjustment...">${record?escHtml(record.proposed_solution):''}</textarea></div>
    <div style="display:flex;gap:14px;align-items:center;padding:8px 0;">
      <label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" id="f_cost_impact" ${record&&record.cost_impact_flag?'checked':''}> Potential Cost Impact</label>
      <label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" id="f_schedule_impact" ${record&&record.schedule_impact_flag?'checked':''}> Potential Schedule Impact</label>
      <label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" id="f_client_visible" ${record&&record.client_visible?'checked':''}> Publish to Client</label>
    </div>
    <div class="full"><label>Attach Reference Drawing / Document ${record&&record.attachment_name?'(current: '+escHtml(record.attachment_name)+')':''}</label><input type="file" id="f_cl_file"></div>
  </div>`;

  openModal(isEdit?'Edit Clarification':'Raise Clarification', html, async ()=>{
    const file = document.getElementById('f_cl_file').files[0];
    let attachment_name = record ? record.attachment_name : null;
    let attachment_data = record ? record.attachment_data : null;
    if(file){
      attachment_name = file.name;
      attachment_data = await new Promise((resolve, reject)=>{
        const reader = new FileReader();
        reader.onload = ()=> resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    const payload = {
      project_id: isEdit ? record.project_id : (document.getElementById('f_project_id')?.value || targetProjId),
      clarification_number: document.getElementById('f_clarification_number').value.trim(),
      type: document.getElementById('f_type').value,
      subject: document.getElementById('f_subject').value.trim(),
      from_company_id: document.getElementById('f_from_company_id').value || null,
      to_company_id: document.getElementById('f_to_company_id').value || null,
      work_package_id: document.getElementById('f_work_package_id').value || null,
      discipline: document.getElementById('f_discipline').value,
      priority: document.getElementById('f_priority').value,
      status: document.getElementById('f_status').value,
      question: document.getElementById('f_question').value.trim(),
      proposed_solution: document.getElementById('f_proposed_solution').value.trim(),
      cost_impact_flag: document.getElementById('f_cost_impact').checked ? 1 : 0,
      schedule_impact_flag: document.getElementById('f_schedule_impact').checked ? 1 : 0,
      client_visible: document.getElementById('f_client_visible').checked ? 1 : 0,
      attachment_name, attachment_data
    };
    if(!payload.subject) throw new Error('Subject is required');
    if(!payload.question) throw new Error('Question details are required');
    if(isEdit){
      await apiFetch(`/api/clarifications/${record.id}`, {method:'PUT', body: JSON.stringify(payload)});
    } else {
      await apiFetch('/api/clarifications', {method:'POST', body: JSON.stringify(payload)});
    }
  });
}

async function openClarificationThread(cl, companies, workPackages){
  const [threadData, comments] = await Promise.all([
    apiFetch(`/api/clarifications/${cl.id}`),
    apiFetch(`/api/clarifications/${cl.id}/comments`)
  ]);

  const canAnswer = ME.role==='Admin' || ME.role==='ProjectManager' || ME.role==='Consultant';
  const overlay = document.getElementById('modalOverlay');

  const html = `
    <div style="display:flex;flex-direction:column;gap:14px;max-height:80vh;overflow-y:auto;padding-right:4px;">
      <!-- Clarification Header -->
      <div style="background:var(--card-raised);border:1px solid var(--border);border-radius:10px;padding:14px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
          <div>
            <span class="badge badge-pkg" style="font-family:monospace;font-weight:700;">${escHtml(threadData.clarification_number)}</span>
            <span class="badge ${badgeClass(threadData.discipline)}" style="margin-left:6px;">${escHtml(threadData.discipline)}</span>
            <span class="badge ${threadData.status==='Answered'||threadData.status==='Closed'?'badge-pub':'progress'}" style="margin-left:6px;">${escHtml(threadData.status)}</span>
          </div>
          <div style="font-size:11px;color:var(--muted);">Raised on ${new Date(threadData.created_at).toLocaleDateString()}</div>
        </div>
        <h4 style="margin:0 0 8px 0;font-size:16px;">${escHtml(threadData.subject)}</h4>
        <div style="display:flex;gap:16px;font-size:12px;color:var(--muted);margin-bottom:12px;flex-wrap:wrap;">
          <div>From: <b style="color:var(--text);">${escHtml(threadData.from_company_name||'Main Contractor')}</b></div>
          <div>To: <b style="color:var(--text);">${escHtml(threadData.to_company_name||'Consultant / Client')}</b></div>
          ${threadData.work_package_code ? `<div>Scope: <b style="color:var(--text);">${escHtml(threadData.work_package_code)}</b></div>`:''}
          <div>Priority: <b style="color:var(--text);">${escHtml(threadData.priority)}</b></div>
        </div>

        <div style="padding:10px;background:var(--card-raised);border-radius:8px;margin-bottom:10px;">
          <div style="font-size:11px;font-weight:700;color:var(--primary);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;">Query / Question:</div>
          <div style="font-size:13px;line-height:1.5;white-space:pre-wrap;">${escHtml(threadData.question)}</div>
        </div>

        ${threadData.proposed_solution ? `
          <div style="padding:10px;background:rgba(111,211,193,0.06);border:1px solid rgba(111,211,193,0.2);border-radius:8px;margin-bottom:10px;">
            <div style="font-size:11px;font-weight:700;color:#6fd3c1;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;">Proposed Contractor Solution:</div>
            <div style="font-size:13px;line-height:1.5;white-space:pre-wrap;">${escHtml(threadData.proposed_solution)}</div>
          </div>
        ` : ''}

        ${threadData.attachment_data ? `
          <div style="font-size:12px;display:flex;align-items:center;gap:8px;padding-top:4px;">
            <span style="color:var(--muted);">Attached Document:</span>
            <a href="${threadData.attachment_data}" download="${escHtml(threadData.attachment_name||'attachment')}" class="btn ghost small" style="padding:2px 8px;font-size:11px;">⬇️ ${escHtml(threadData.attachment_name||'Download File')}</a>
          </div>
        ` : ''}
      </div>

      <!-- Official Answer Section -->
      <div style="background:var(--card-raised);border:1px solid var(--border);border-radius:10px;padding:14px;">
        <div style="font-size:12px;font-weight:700;color:var(--primary);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px;">Official Response & Directive</div>
        ${threadData.official_response ? `
          <div style="padding:12px;background:rgba(8,145,178,0.08);border:1px solid rgba(8,145,178,0.3);border-radius:8px;">
            <div style="font-size:13px;line-height:1.5;white-space:pre-wrap;margin-bottom:8px;">${escHtml(threadData.official_response)}</div>
            <div style="font-size:11px;color:var(--muted);display:flex;justify-content:space-between;">
              <span>Answered by <b>${escHtml(threadData.answered_by||'Project Consultant')}</b></span>
              <span>${threadData.answered_date ? new Date(threadData.answered_date).toLocaleDateString() : ''}</span>
            </div>
          </div>
        ` : `
          <div style="color:var(--muted);font-size:12px;font-style:italic;margin-bottom:10px;">Pending official directive from Consultant / PM.</div>
        `}

        ${canAnswer ? `
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">${threadData.official_response ? 'Update Official Directive' : 'Submit Official Directive'}</label>
            <textarea id="f_official_response_text" rows="3" placeholder="Enter official engineering instruction or technical approval...">${escHtml(threadData.official_response||'')}</textarea>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
              <select id="f_official_status" style="max-width:160px;font-size:11px;">
                <option value="Answered" ${threadData.status==='Answered'?'selected':''}>Status: Answered</option>
                <option value="Closed" ${threadData.status==='Closed'?'selected':''}>Status: Closed</option>
                <option value="Under Review" ${threadData.status==='Under Review'?'selected':''}>Status: Under Review</option>
              </select>
              <button class="btn accent small" id="submitOfficialAnswerBtn">Save Official Directive</button>
            </div>
          </div>
        ` : ''}
      </div>

      <!-- Discussion Comment Stream -->
      <div style="background:var(--card-raised);border:1px solid var(--border);border-radius:10px;padding:14px;">
        <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:10px;">Multi-Party Discussion (${comments.length})</div>
        <div id="threadCommentsList" style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
          ${comments.map(c=>`
            <div class="thread-box">
              <div class="thread-header">
                <b>${escHtml(c.user_name||'Team Member')} <span style="font-weight:400;color:var(--muted);">(${escHtml(c.user_role||'')})</span></b>
                <span>${new Date(c.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} · ${new Date(c.created_at).toLocaleDateString()}</span>
              </div>
              <div style="font-size:12px;line-height:1.45;white-space:pre-wrap;">${escHtml(c.message)}</div>
            </div>
          `).join('')}
          ${!comments.length ? '<div style="color:var(--muted);font-size:11px;font-style:italic;">No comments yet on this thread.</div>':''}
        </div>

        <div style="display:flex;gap:8px;align-items:flex-start;">
          <textarea id="threadNewComment" rows="2" placeholder="Write a comment or query update..." style="flex:1;font-size:12px;"></textarea>
          <button class="btn accent small" id="postCommentBtn" style="white-space:nowrap;margin-top:2px;">Post Reply</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('modalBody').innerHTML = `
    <h3>
      <span>Clarification Thread: ${escHtml(threadData.clarification_number)}</span>
    </h3>
    ${html}
    <div class="modal-actions" style="margin-top:14px;">
      <button class="btn ghost small" id="threadCloseBtn">Close</button>
    </div>
  `;
  overlay.classList.add('show');
  document.getElementById('threadCloseBtn').onclick = () => { overlay.classList.remove('show'); renderClarifications(); };

  if(canAnswer && document.getElementById('submitOfficialAnswerBtn')){
    document.getElementById('submitOfficialAnswerBtn').onclick = async () => {
      const resp = document.getElementById('f_official_response_text').value.trim();
      const status = document.getElementById('f_official_status').value;
      if(!resp) { alert('Please enter an official directive response'); return; }
      try {
        await apiFetch(`/api/clarifications/${cl.id}`, {
          method: 'PUT',
          body: JSON.stringify({ official_response: resp, status })
        });
        openClarificationThread(cl, companies, workPackages);
      } catch(e) { alert('Failed to update response: '+e.message); }
    };
  }

  document.getElementById('postCommentBtn').onclick = async () => {
    const msg = document.getElementById('threadNewComment').value.trim();
    if(!msg) return;
    try {
      await apiFetch(`/api/clarifications/${cl.id}/comment`, {
        method: 'POST',
        body: JSON.stringify({ message: msg })
      });
      openClarificationThread(cl, companies, workPackages);
    } catch(e) { alert('Failed to post comment: '+e.message); }
  };
}

/* =========================================================
   PUBLISHED PROGRESS REPORTS (CLIENT REPORTING ENGINE)
   ========================================================= */
async function renderProgressReports(){
  const reports = await apiFetch(`/api/progress_reports?project_id=${currentProjectId}`);
  const canEdit = ME.permissions.edit.includes('progress_reports') || ME.role==='Admin' || ME.role==='ProjectManager';
  const canDel = ME.permissions.delete && canEdit;
  const isClient = ME.role==='Client';

  const publishedCount = reports.filter(r=>r.status==='Published').length;

  document.getElementById('viewContent').innerHTML = `
  <div style="display:flex;flex-direction:column;gap:14px;">
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));">
      <div class="stat-card">
        <div class="num" style="color:var(--primary);">${reports.length}</div>
        <div class="lbl">Progress Reports</div>
      </div>
      <div class="stat-card">
        <div class="num" style="color:#6fd3c1;">${publishedCount}</div>
        <div class="lbl">Published to Client</div>
      </div>
      <div class="stat-card">
        <div class="num" style="color:#0891b2;">${reports[0]?.period_end || 'Current Month'}</div>
        <div class="lbl">Latest Period</div>
      </div>
    </div>

    <div class="panel">
      <h3>
        <span>Formal Published Progress Reports</span>
        <span style="display:flex;gap:8px;align-items:center;">
          ${canEdit ? `
            <button class="btn accent small" id="autoCompileReportBtn" title="Auto-compile progress, manpower & safety data from live project records into a new draft report">⚡ Auto-Compile Draft</button>
            <button class="btn ghost small" id="addReportBtn">+ Custom Report</button>
          ` : ''}
          <button class="btn ghost small" id="exportReportsBtn">Export CSV</button>
        </span>
      </h3>
      ${isClient ? `<div class="api-banner show" style="margin-bottom:12px;">Client Progress Reports: Review formal monthly & weekly milestone packs published by the Main Contractor.</div>` : ''}

      ${reports.length ? `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-top:10px;">
          ${reports.map(r=>{
            const actual = Math.round(Number(r.overall_progress_actual) || 0);
            const planned = Math.round(Number(r.overall_progress_planned) || 0);
            const isPub = r.status === 'Published';
            return `
              <div class="report-view-grid" style="display:flex;flex-direction:column;gap:10px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                  <div>
                    <span class="badge badge-pkg" style="font-family:monospace;font-weight:700;">${escHtml(r.report_number)}</span>
                    <span class="badge ${isPub?'badge-pub':'badge-draft'}" style="margin-left:6px;">${isPub?'Published to Client':'Draft'}</span>
                  </div>
                  <div style="font-size:11px;color:var(--muted);">${escHtml(r.period_start||'')} ➔ ${escHtml(r.period_end||'')}</div>
                </div>

                <h4 style="margin:0;font-size:15px;color:var(--text);">${escHtml(r.title)}</h4>

                <!-- Overall Progress comparison -->
                <div style="background:var(--card-raised);padding:8px 10px;border-radius:8px;border:1px solid var(--border);">
                  <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
                    <span>Overall Progress (Actual / Planned):</span>
                    <b><span style="color:var(--primary);">${actual}%</span> / <span style="color:var(--muted);">${planned}%</span></b>
                  </div>
                  <div class="progress-bar" style="height:6px;background:var(--card-raised);border-radius:3px;overflow:hidden;">
                    <div style="height:100%;width:${actual}%;background:var(--primary);"></div>
                  </div>
                </div>

                <!-- Trade breakdown bars -->
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px;">
                  <div>HVAC: <b>${Math.round(r.hvac_progress||0)}%</b></div>
                  <div>Electrical: <b>${Math.round(r.electrical_progress||0)}%</b></div>
                  <div>Plumbing: <b>${Math.round(r.plumbing_progress||0)}%</b></div>
                  <div>Fire Fighting: <b>${Math.round(r.fire_progress||0)}%</b></div>
                </div>

                <div style="display:flex;justify-content:space-between;align-items:center;padding-top:6px;border-top:1px solid var(--border);margin-top:auto;">
                  <button class="btn ghost small" data-view-report="${r.id}" style="font-size:11px;padding:3px 9px;">📖 Open Full Report</button>
                  <div style="display:flex;gap:4px;">
                    ${canEdit ? `
                      <button class="icon-btn" data-toggle-pub-report="${r.id}" data-pub="${isPub?1:0}" title="${isPub?'Unpublish from client':'Publish to client'}">${isPub?'Unpublish':'Publish'}</button>
                      <button class="icon-btn" data-add-photo="${r.id}" title="Upload Site Progress Photo">📷</button>
                      <button class="icon-btn edit" data-edit-report="${r.id}" title="Edit Report">✎</button>
                      ${canDel?`<button class="icon-btn" data-del-report="${r.id}" title="Delete Report">✕</button>`:''}
                    ` : ''}
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      ` : `<div class="empty-state">
        <p>No progress reports compiled yet for this project.</p>
        ${canEdit?`<button class="btn accent small" id="emptyAutoCompileBtn">⚡ Auto-Compile First Report from Site Data</button>`:''}
      </div>`}
    </div>
  </div>`;

  if(canEdit && document.getElementById('autoCompileReportBtn')) {
    document.getElementById('autoCompileReportBtn').onclick = () => autoCompileDraftReport();
  }
  if(canEdit && document.getElementById('emptyAutoCompileBtn')) {
    document.getElementById('emptyAutoCompileBtn').onclick = () => autoCompileDraftReport();
  }
  if(canEdit && document.getElementById('addReportBtn')) {
    document.getElementById('addReportBtn').onclick = () => openProgressReportModal(null);
  }
  document.getElementById('exportReportsBtn').onclick = () => exportCsv('progress_reports');

  document.querySelectorAll('[data-view-report]').forEach(btn => {
    btn.onclick = () => {
      const rep = reports.find(r=>r.id===btn.dataset.viewReport);
      if(rep) openProgressReportViewer(rep);
    };
  });
  document.querySelectorAll('[data-edit-report]').forEach(btn => {
    btn.onclick = () => {
      const rep = reports.find(r=>r.id===btn.dataset.editReport);
      if(rep) openProgressReportModal(rep);
    };
  });
  document.querySelectorAll('[data-add-photo]').forEach(btn => {
    btn.onclick = () => openAddReportPhotoModal(btn.dataset.addPhoto);
  });
  document.querySelectorAll('[data-toggle-pub-report]').forEach(btn => {
    btn.onclick = async () => {
      const isPub = btn.dataset.pub === '1';
      const newStatus = isPub ? 'Draft' : 'Published';
      if(!isPub && !confirm('Publish this report to the Client Portal? The client will immediately see these progress figures, photos and narrative.')) return;
      try {
        await apiFetch(`/api/progress_reports/${btn.dataset.togglePubReport}/publish`, {
          method:'POST',
          body: JSON.stringify({ status: newStatus })
        });
        renderProgressReports();
      } catch(e) { alert('Publish failed: '+e.message); }
    };
  });
  document.querySelectorAll('[data-del-report]').forEach(btn => {
    btn.onclick = async () => {
      const ok = await confirmAction('Delete this progress report?');
      if(!ok) return;
      try {
        await apiFetch(`/api/progress_reports/${btn.dataset.delReport}`, {method:'DELETE'});
        renderProgressReports();
      } catch(e) { alert('Delete failed: '+e.message); }
    };
  });
}

async function autoCompileDraftReport(){
  const targetProjId = currentProjectId === 'ALL' ? (PROJECTS[0]?.id || '') : currentProjectId;
  if(!targetProjId) { alert('Please select a project first'); return; }
  try {
    const draft = await apiFetch(`/api/progress_reports/auto-compile?project_id=${targetProjId}`);
    openProgressReportModal(draft, true);
  } catch(e) {
    alert('Auto-compile failed: ' + e.message);
  }
}

function openProgressReportModal(record, isAutoCompiled = false){
  const isEdit = !!record && !isAutoCompiled;
  const targetProjId = record ? record.project_id : (currentProjectId === 'ALL' ? (PROJECTS[0]?.id || '') : currentProjectId);
  const projectPicker = !isEdit && currentProjectId==='ALL' ? `<div class="full"><label>Project</label><select id="f_project_id">${PROJECTS.map(p=>`<option value="${p.id}">${escHtml(p.name)}</option>`).join('')}</select></div>` : '';

  const html = `<div class="form-grid">
    ${projectPicker}
    <div><label>Report Number</label><input id="f_report_number" value="${record?escHtml(record.report_number):'MPR-01'}"></div>
    <div><label>Status</label><select id="f_status"><option value="Draft" ${!record||record.status==='Draft'?'selected':''}>Draft (Internal Review)</option><option value="Published" ${record&&record.status==='Published'?'selected':''}>Published (Client Visible)</option></select></div>
    <div class="full"><label>Report Title</label><input id="f_title" value="${record?escHtml(record.title):'Monthly Progress Report'}"></div>
    <div><label>Period Start Date</label><input type="date" id="f_period_start" value="${record?escHtml(record.period_start):''}"></div>
    <div><label>Period End Date</label><input type="date" id="f_period_end" value="${record?escHtml(record.period_end):''}"></div>
    <div><label>Overall Actual Progress %</label><input type="number" id="f_overall_progress_actual" value="${record?record.overall_progress_actual:0}"></div>
    <div><label>Overall Planned Progress %</label><input type="number" id="f_overall_progress_planned" value="${record?record.overall_progress_planned:0}"></div>
    <div><label>HVAC Progress %</label><input type="number" id="f_hvac_progress" value="${record?record.hvac_progress:0}"></div>
    <div><label>Electrical Progress %</label><input type="number" id="f_electrical_progress" value="${record?record.electrical_progress:0}"></div>
    <div><label>Plumbing Progress %</label><input type="number" id="f_plumbing_progress" value="${record?record.plumbing_progress:0}"></div>
    <div><label>Fire Fighting Progress %</label><input type="number" id="f_fire_progress" value="${record?record.fire_progress:0}"></div>
    <div><label>BMS & Low Voltage %</label><input type="number" id="f_bms_progress" value="${record?record.bms_progress:0}"></div>
    <div><label>Manpower Peak (Workers)</label><input type="number" id="f_manpower_peak" value="${record?record.manpower_peak:0}"></div>
    <div class="full"><label>Executive Summary / Key Highlights</label><textarea id="f_executive_summary" rows="3">${record?escHtml(record.executive_summary):''}</textarea></div>
    <div class="full"><label>Lookahead Schedule (Next Period Focus)</label><textarea id="f_lookahead_narrative" rows="2">${record?escHtml(record.lookahead_narrative):''}</textarea></div>
    <div class="full"><label>Key Risks & Blockers / Mitigation</label><textarea id="f_key_risks" rows="2">${record?escHtml(record.key_risks):''}</textarea></div>
  </div>`;

  openModal(isEdit?'Edit Progress Report':'Compile Progress Report', html, async ()=>{
    const payload = {
      project_id: isEdit ? record.project_id : (document.getElementById('f_project_id')?.value || targetProjId),
      report_number: document.getElementById('f_report_number').value.trim(),
      title: document.getElementById('f_title').value.trim(),
      period_start: document.getElementById('f_period_start').value,
      period_end: document.getElementById('f_period_end').value,
      status: document.getElementById('f_status').value,
      overall_progress_actual: Number(document.getElementById('f_overall_progress_actual').value || 0),
      overall_progress_planned: Number(document.getElementById('f_overall_progress_planned').value || 0),
      hvac_progress: Number(document.getElementById('f_hvac_progress').value || 0),
      electrical_progress: Number(document.getElementById('f_electrical_progress').value || 0),
      plumbing_progress: Number(document.getElementById('f_plumbing_progress').value || 0),
      fire_progress: Number(document.getElementById('f_fire_progress').value || 0),
      bms_progress: Number(document.getElementById('f_bms_progress').value || 0),
      manpower_peak: Number(document.getElementById('f_manpower_peak').value || 0),
      executive_summary: document.getElementById('f_executive_summary').value.trim(),
      lookahead_narrative: document.getElementById('f_lookahead_narrative').value.trim(),
      key_risks: document.getElementById('f_key_risks').value.trim(),
      prepared_by: ME.name
    };
    if(isEdit){
      await apiFetch(`/api/progress_reports/${record.id}`, {method:'PUT', body: JSON.stringify(payload)});
    } else {
      await apiFetch('/api/progress_reports', {method:'POST', body: JSON.stringify(payload)});
    }
  });
}

async function openProgressReportViewer(report){
  const full = await apiFetch(`/api/progress_reports/${report.id}`);
  const photos = full.photos || [];
  const overlay = document.getElementById('modalOverlay');

  const html = `
    <div style="max-height:82vh;overflow-y:auto;padding-right:4px;display:flex;flex-direction:column;gap:14px;">
      <!-- Formal Document Header -->
      <div style="background:linear-gradient(135deg,rgba(111,211,193,0.1),rgba(8,145,178,0.1));border:1px solid var(--border);border-radius:10px;padding:16px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
          <div>
            <div style="font-size:11px;font-weight:700;color:var(--primary);text-transform:uppercase;letter-spacing:0.05em;">MEP Monthly Progress Report</div>
            <h2 style="margin:4px 0 6px 0;font-size:20px;">${escHtml(full.title)}</h2>
            <div style="font-size:12px;color:var(--muted);">Reporting Period: <b style="color:var(--text);">${escHtml(full.period_start)} ➔ ${escHtml(full.period_end)}</b></div>
          </div>
          <div style="text-align:right;">
            <span class="badge badge-pkg" style="font-family:monospace;font-size:13px;font-weight:700;">${escHtml(full.report_number)}</span>
            <div style="margin-top:6px;"><span class="badge ${full.status==='Published'?'badge-pub':'badge-draft'}">${full.status==='Published'?'Published to Client':'Draft (Under Review)'}</span></div>
          </div>
        </div>
        <div style="margin-top:12px;display:flex;gap:20px;font-size:11px;color:var(--muted);border-top:1px solid var(--border);padding-top:8px;flex-wrap:wrap;">
          <div>Prepared By: <b style="color:var(--text);">${escHtml(full.prepared_by||'Main Contractor Project Manager')}</b></div>
          ${full.published_at ? `<div>Published On: <b style="color:var(--text);">${new Date(full.published_at).toLocaleDateString()}</b></div>`:''}
        </div>
      </div>

      <!-- Executive Summary -->
      <div class="panel" style="padding:14px;">
        <h4 style="margin:0 0 8px 0;font-size:14px;color:var(--primary);text-transform:uppercase;letter-spacing:0.04em;">1. Executive Summary & Milestones</h4>
        <div style="font-size:13px;line-height:1.6;white-space:pre-wrap;">${escHtml(full.executive_summary||'Project progress on schedule according to approved baseline.')}</div>
      </div>

      <!-- Trade Breakdown Progress -->
      <div class="panel" style="padding:14px;">
        <h4 style="margin:0 0 12px 0;font-size:14px;color:var(--primary);text-transform:uppercase;letter-spacing:0.04em;">2. Discipline Completion Status</h4>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;">
          ${[
            ['Overall MEP Progress', full.overall_progress_actual, '#6fd3c1'],
            ['HVAC & Ventilation', full.hvac_progress, '#0284c7'],
            ['Electrical & Power', full.electrical_progress, '#f59e0b'],
            ['Plumbing & Drainage', full.plumbing_progress, '#3b82f6'],
            ['Fire Protection', full.fire_progress, '#ef4444'],
            ['BMS & ELV Systems', full.bms_progress, '#8b5cf6']
          ].map(([title, val, col])=>`
            <div style="background:var(--card-raised);border:1px solid var(--border);border-radius:8px;padding:10px;">
              <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:6px;">
                <span>${title}</span>
                <b style="color:${col};">${Math.round(val||0)}%</b>
              </div>
              <div class="progress-bar" style="height:6px;background:var(--card-raised);border-radius:3px;overflow:hidden;">
                <div style="height:100%;width:${Math.round(val||0)}%;background:${col};"></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Site Progress Photos Gallery -->
      <div class="panel" style="padding:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <h4 style="margin:0;font-size:14px;color:var(--primary);text-transform:uppercase;letter-spacing:0.04em;">3. Site Progress Photographic Record (${photos.length})</h4>
          <button class="btn ghost small" id="addViewerPhotoBtn" style="font-size:11px;padding:2px 8px;">+ Add Photo</button>
        </div>
        ${photos.length ? `
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;">
            ${photos.map(p=>`
              <div style="background:var(--card-raised);border:1px solid var(--border);border-radius:8px;overflow:hidden;">
                <img src="${p.photo_data}" alt="${escHtml(p.caption||'Site Photo')}" style="width:100%;height:140px;object-fit:cover;display:block;" referrerPolicy="no-referrer">
                <div style="padding:8px;">
                  <div style="font-weight:600;font-size:12px;color:var(--text);">${escHtml(p.caption||'Site Progress')}</div>
                  <div style="font-size:10px;color:var(--muted);margin-top:2px;">${escHtml(p.trade||'')} · ${escHtml(p.location||'Site Level')}</div>
                </div>
              </div>
            `).join('')}
          </div>
        ` : '<div style="color:var(--muted);font-size:12px;font-style:italic;">No progress photos attached yet. Click "+ Add Photo" to attach verified installation shots.</div>'}
      </div>

      <!-- Lookahead & Risk Narrative -->
      <div class="panel" style="padding:14px;">
        <h4 style="margin:0 0 8px 0;font-size:14px;color:var(--primary);text-transform:uppercase;letter-spacing:0.04em;">4. Lookahead Programme & Risk Management</h4>
        <div style="font-size:12px;line-height:1.5;margin-bottom:8px;"><b>Next Period Objectives:</b><br>${escHtml(full.lookahead_narrative||'Proceed with 2nd fix installations, cabling termination, and pressure testing.')}</div>
        ${full.key_risks ? `<div style="font-size:12px;line-height:1.5;color:#f59e0b;"><b>Identified Risks & Mitigations:</b><br>${escHtml(full.key_risks)}</div>`:''}
      </div>
    </div>
  `;

  document.getElementById('modalBody').innerHTML = `
    <h3><span>Progress Report Viewer</span></h3>
    ${html}
    <div class="modal-actions" style="margin-top:14px;">
      <button class="btn ghost small" onclick="window.print()">🖨️ Print / Export PDF</button>
      <button class="btn small" id="viewerCloseBtn">Close</button>
    </div>
  `;
  overlay.classList.add('show');
  document.getElementById('viewerCloseBtn').onclick = () => overlay.classList.remove('show');
  if(document.getElementById('addViewerPhotoBtn')){
    document.getElementById('addViewerPhotoBtn').onclick = () => {
      overlay.classList.remove('show');
      openAddReportPhotoModal(report.id);
    };
  }
}

function openAddReportPhotoModal(reportId){
  const html = `<div class="form-grid">
    <div class="full"><label>Select / Capture Photo</label><input type="file" id="f_report_photo" accept="image/*"></div>
    <div class="full"><label>Photo Caption / Work Description</label><input id="f_photo_caption" placeholder="e.g. Level 2 FCU piping and insulation installed"></div>
    <div><label>Trade / Discipline</label><select id="f_photo_trade">${TRADES.map(t=>`<option>${t}</option>`).join('')}</select></div>
    <div><label>Location on Site</label><input id="f_photo_location" placeholder="e.g. Level 2 East Wing Plant Room"></div>
  </div>`;

  openModal('Upload Site Progress Photo', html, async ()=>{
    const file = document.getElementById('f_report_photo').files[0];
    if(!file) throw new Error('Please select a photo to upload');
    const photo_data = await new Promise((resolve, reject)=>{
      const reader = new FileReader();
      reader.onload = ()=> resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    await apiFetch(`/api/progress_reports/${reportId}/photos`, {
      method: 'POST',
      body: JSON.stringify({
        caption: document.getElementById('f_photo_caption').value.trim(),
        trade: document.getElementById('f_photo_trade').value,
        location: document.getElementById('f_photo_location').value.trim(),
        photo_data
      })
    });
  });
}

/* =========================================================
   SUBCONTRACTOR PROGRESS CLAIMS & VERIFICATION WORKFLOW
   ========================================================= */
async function renderProgressSubmissions(){
  const [submissions, workPackages, companies] = await Promise.all([
    apiFetch(`/api/progress_submissions?project_id=${currentProjectId}`),
    apiFetch(`/api/work_packages?project_id=${currentProjectId}`),
    apiFetch('/api/companies')
  ]);
  const canEdit = ME.permissions.edit.includes('progress_submissions') || ME.role==='Admin' || ME.role==='ProjectManager' || ME.role==='SiteEngineer' || ME.role==='Subcontractor';
  const canReview = ME.role==='Admin' || ME.role==='ProjectManager' || ME.role==='SiteEngineer';
  const canDel = ME.permissions.delete && canReview;

  const totalPending = submissions.filter(s=>s.status==='Submitted').length;
  const totalApproved = submissions.filter(s=>s.status==='Approved'||s.status==='Approved with Adjustments').length;

  document.getElementById('viewContent').innerHTML = `
  <div style="display:flex;flex-direction:column;gap:14px;">
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));">
      <div class="stat-card">
        <div class="num" style="color:var(--primary);">${submissions.length}</div>
        <div class="lbl">Total Claims</div>
      </div>
      <div class="stat-card ${totalPending>0?'warn':''}">
        <div class="num" style="color:${totalPending>0?'#f59e0b':'var(--text)'};">${totalPending}</div>
        <div class="lbl">Pending Verification</div>
      </div>
      <div class="stat-card">
        <div class="num" style="color:#6fd3c1;">${totalApproved}</div>
        <div class="lbl">Approved Claims</div>
      </div>
    </div>

    <div class="panel">
      <h3>
        <span>Subcontractor Progress Claims & Verification</span>
        <span style="display:flex;gap:8px;align-items:center;">
          ${canEdit ? `<button class="btn accent small" id="addClaimBtn">+ Submit Progress Claim</button>` : ''}
          <button class="btn ghost small" id="exportClaimsBtn">Export CSV</button>
        </span>
      </h3>
      <div class="api-banner show" style="margin-bottom:12px;">
        <b>Construction-Grade Verification Workflow:</b> Subcontractors submit proposed completion % and installed quantities against their Work Package. Main Contractor Project Managers and Site Engineers verify on site, approve, or adjust before official progress changes.
      </div>

      ${submissions.length ? `<table>
        <thead>
          <tr>
            <th>Date / Period</th>
            <th>Work Package</th>
            <th>Subcontractor</th>
            <th>Discipline</th>
            <th>Claimed % & Qty</th>
            <th>Status</th>
            <th>Verified %</th>
            <th>Reviewer Comments</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${submissions.map(s=>`
            <tr>
              <td>${escHtml(s.period_date||s.created_at.slice(0,10))}</td>
              <td><b>${escHtml(s.work_package_code||'WP')}</b><div style="font-size:11px;color:var(--muted);">${escHtml(s.work_package_name||'')}</div></td>
              <td>${escHtml(s.company_name||'Subcontractor')}</td>
              <td><span class="badge ${badgeClass(s.discipline)}">${escHtml(s.discipline)}</span></td>
              <td>
                <div style="font-weight:700;color:var(--text);">${s.claimed_percentage}%</div>
                <div style="font-size:11px;color:var(--muted);">${s.quantity_installed ? `${s.quantity_installed} ${s.unit||''}` : ''}</div>
              </td>
              <td><span class="badge ${s.status==='Approved'?'badge-pub':s.status==='Approved with Adjustments'?'badge-pkg':s.status==='Rejected'?'warn':'progress'}">${escHtml(s.status)}</span></td>
              <td>${s.verified_percentage !== null && s.verified_percentage !== undefined ? `<b>${s.verified_percentage}%</b>` : '<span style="color:var(--muted);">—</span>'}</td>
              <td>
                <div style="font-size:11px;max-width:200px;line-height:1.3;">${escHtml(s.review_comments||s.notes||'—')}</div>
                ${s.reviewed_by ? `<div style="font-size:10px;color:var(--muted);margin-top:2px;">by ${escHtml(s.reviewed_by)}</div>`:''}
              </td>
              <td class="row-actions">
                ${canReview && s.status==='Submitted' ? `<button class="btn accent small" data-review-claim="${s.id}" style="padding:2px 7px;font-size:11px;">Verify</button>`:''}
                ${canDel ? `<button class="icon-btn" data-del-claim="${s.id}" title="Delete Claim">✕</button>`:''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>` : `<div class="empty-state">
        <p>No subcontractor claims submitted yet for this project.</p>
        ${canEdit?`<button class="btn accent small" id="emptyAddClaimBtn">+ Submit First Progress Claim</button>`:''}
      </div>`}
    </div>
  </div>`;

  if(canEdit && document.getElementById('addClaimBtn')) {
    document.getElementById('addClaimBtn').onclick = () => openProgressSubmissionModal(null, workPackages, companies);
  }
  if(canEdit && document.getElementById('emptyAddClaimBtn')) {
    document.getElementById('emptyAddClaimBtn').onclick = () => openProgressSubmissionModal(null, workPackages, companies);
  }
  document.getElementById('exportClaimsBtn').onclick = () => exportCsv('progress_submissions');

  document.querySelectorAll('[data-review-claim]').forEach(btn => {
    btn.onclick = () => {
      const rec = submissions.find(s=>s.id===btn.dataset.reviewClaim);
      if(rec) openReviewSubmissionModal(rec);
    };
  });
  document.querySelectorAll('[data-del-claim]').forEach(btn => {
    btn.onclick = async () => {
      const ok = await confirmAction('Delete this progress claim record?');
      if(!ok) return;
      try {
        await apiFetch(`/api/progress_submissions/${btn.dataset.delClaim}`, {method:'DELETE'});
        renderProgressSubmissions();
      } catch(e) { alert('Delete failed: '+e.message); }
    };
  });
}

function openProgressSubmissionModal(record, workPackages, companies){
  const targetProjId = record ? record.project_id : (currentProjectId === 'ALL' ? (PROJECTS[0]?.id || '') : currentProjectId);
  const projectPicker = currentProjectId==='ALL' ? `<div class="full"><label>Project</label><select id="f_project_id">${PROJECTS.map(p=>`<option value="${p.id}">${escHtml(p.name)}</option>`).join('')}</select></div>` : '';

  const html = `<div class="form-grid">
    ${projectPicker}
    <div class="full"><label>Select Work Package</label>
      <select id="f_work_package_id">
        ${workPackages.map(wp=>`<option value="${wp.id}" data-disc="${wp.discipline}" data-comp="${wp.company_id||''}">${escHtml(wp.code)} - ${escHtml(wp.name)} (${escHtml(wp.discipline)})</option>`).join('')}
      </select>
    </div>
    <div><label>Subcontractor Company</label>
      <select id="f_company_id">
        <option value="">— Current Subcontractor —</option>
        ${companies.filter(c=>c.type==='Subcontractor').map(c=>`<option value="${c.id}">${escHtml(c.name)}</option>`).join('')}
      </select>
    </div>
    <div><label>Claim Date / Period</label><input type="date" id="f_period_date" value="${new Date().toISOString().slice(0,10)}"></div>
    <div><label>Claimed Progress %</label><input type="number" id="f_claimed_percentage" placeholder="e.g. 65" min="0" max="100"></div>
    <div><label>Quantity Installed (Units / Meters)</label><input type="number" id="f_quantity_installed" placeholder="e.g. 450"></div>
    <div><label>Unit of Measurement</label><input id="f_unit" placeholder="e.g. m, m2, units, %"></div>
    <div><label>Discipline</label><select id="f_discipline">${TRADES.map(t=>`<option>${t}</option>`).join('')}</select></div>
    <div class="full"><label>Progress Notes / Site Justification</label><textarea id="f_notes" rows="2" placeholder="Describe zones completed, duct lines tested, or equipment positioned..."></textarea></div>
  </div>`;

  openModal('Submit Subcontractor Progress Claim', html, async ()=>{
    const wpSelect = document.getElementById('f_work_package_id');
    const selectedOpt = wpSelect.options[wpSelect.selectedIndex];
    const payload = {
      project_id: document.getElementById('f_project_id')?.value || targetProjId,
      work_package_id: wpSelect.value,
      company_id: document.getElementById('f_company_id').value || (selectedOpt?.dataset.comp || null),
      period_date: document.getElementById('f_period_date').value,
      discipline: document.getElementById('f_discipline').value,
      claimed_percentage: Number(document.getElementById('f_claimed_percentage').value || 0),
      quantity_installed: Number(document.getElementById('f_quantity_installed').value || 0),
      unit: document.getElementById('f_unit').value.trim(),
      notes: document.getElementById('f_notes').value.trim()
    };
    if(!payload.work_package_id) throw new Error('Work Package is required');
    await apiFetch('/api/progress_submissions', {method:'POST', body: JSON.stringify(payload)});
  });
}

function openReviewSubmissionModal(sub){
  const html = `<div class="form-grid">
    <div class="full" style="background:var(--card-raised);border:1px solid var(--border);border-radius:8px;padding:12px;">
      <div style="font-size:12px;color:var(--muted);">Subcontractor Claim Details:</div>
      <div style="font-size:14px;font-weight:700;margin-top:4px;">${escHtml(sub.work_package_code)} - ${escHtml(sub.work_package_name)}</div>
      <div style="font-size:12px;margin-top:4px;">Claimed: <b style="color:var(--primary);">${sub.claimed_percentage}%</b> ${sub.quantity_installed ? `(${sub.quantity_installed} ${sub.unit||''})` : ''}</div>
      ${sub.notes ? `<div style="font-size:12px;color:var(--muted);margin-top:4px;">Notes: ${escHtml(sub.notes)}</div>`:''}
    </div>
    <div><label>Verification Decision</label>
      <select id="f_review_status">
        <option value="Approved">Approved (Claim Accepted)</option>
        <option value="Approved with Adjustments">Approved with Adjustments (Verified On Site)</option>
        <option value="Rejected">Rejected (Incomplete / Non-compliant)</option>
      </select>
    </div>
    <div><label>Verified / Adjusted Progress %</label><input type="number" id="f_verified_percentage" value="${sub.claimed_percentage}"></div>
    <div class="full"><label>Reviewer Comments / Site Verification Notes</label><textarea id="f_review_comments" rows="3" placeholder="State inspection findings, measured installed quantities, or adjustment reasons..."></textarea></div>
  </div>`;

  openModal('Verify & Review Subcontractor Claim', html, async ()=>{
    const payload = {
      status: document.getElementById('f_review_status').value,
      verified_percentage: Number(document.getElementById('f_verified_percentage').value || 0),
      review_comments: document.getElementById('f_review_comments').value.trim()
    };
    await apiFetch(`/api/progress_submissions/${sub.id}/review`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  });
}

/* =========================================================
   TRANSMITTALS & REVISION CONTROL REGISTER
   ========================================================= */
async function renderTransmittals(){
  const [transmittals, companies] = await Promise.all([
    apiFetch(`/api/document_transmittals?project_id=${currentProjectId}`),
    apiFetch('/api/companies')
  ]);
  const canEdit = ME.permissions.edit.includes('transmittals') || ME.role==='Admin' || ME.role==='ProjectManager' || ME.role==='SiteEngineer';
  const canDel = ME.permissions.delete && canEdit;

  document.getElementById('viewContent').innerHTML = `
  <div style="display:flex;flex-direction:column;gap:14px;">
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));">
      <div class="stat-card">
        <div class="num" style="color:var(--primary);">${transmittals.length}</div>
        <div class="lbl">Document Transmittals</div>
      </div>
      <div class="stat-card">
        <div class="num" style="color:#6fd3c1;">${transmittals.filter(t=>t.purpose==='For Approval').length}</div>
        <div class="lbl">For Approval</div>
      </div>
      <div class="stat-card">
        <div class="num" style="color:#0891b2;">${transmittals.filter(t=>t.purpose==='For Construction').length}</div>
        <div class="lbl">For Construction</div>
      </div>
    </div>

    <div class="panel">
      <h3>
        <span>Formal Transmittals & Drawing Revisions Register</span>
        <span style="display:flex;gap:8px;align-items:center;">
          ${canEdit ? `<button class="btn accent small" id="addTransmittalBtn">+ Create Transmittal</button>` : ''}
          <button class="btn ghost small" id="exportTransmittalsBtn">Export CSV</button>
        </span>
      </h3>
      ${transmittals.length ? `<table>
        <thead>
          <tr>
            <th>Transmittal No.</th>
            <th>Subject</th>
            <th>Purpose</th>
            <th>Sender (From)</th>
            <th>Recipient (To)</th>
            <th>Date Sent</th>
            <th>Items</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${transmittals.map(t=>`
            <tr>
              <td><span class="badge badge-pkg" style="font-family:monospace;font-weight:700;">${escHtml(t.transmittal_number)}</span></td>
              <td><b>${escHtml(t.subject)}</b></td>
              <td><span class="badge ${t.purpose==='For Construction'?'badge-pub':t.purpose==='For Approval'?'progress':'badge-draft'}">${escHtml(t.purpose)}</span></td>
              <td>${escHtml(t.sender_company_name||'Main Contractor')}</td>
              <td>${escHtml(t.recipient_company_name||'Consultant / Client')}</td>
              <td>${escHtml(t.date_sent)}</td>
              <td><span class="badge" style="background:var(--card-raised);">${t.items_count||0} docs</span></td>
              <td><span class="badge ${t.status==='Transmitted'?'badge-pub':'progress'}">${escHtml(t.status)}</span></td>
              <td class="row-actions">
                <button class="btn ghost small" data-view-transmittal="${t.id}" style="padding:2px 7px;font-size:11px;">View Slip</button>
                ${canDel ? `<button class="icon-btn" data-del-transmittal="${t.id}" title="Delete Transmittal">✕</button>`:''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>` : `<div class="empty-state">
        <p>No document transmittals created yet for this project.</p>
        ${canEdit?`<button class="btn accent small" id="emptyAddTransmittalBtn">+ Create First Transmittal</button>`:''}
      </div>`}
    </div>
  </div>`;

  if(canEdit && document.getElementById('addTransmittalBtn')) {
    document.getElementById('addTransmittalBtn').onclick = () => openTransmittalModal(null, companies);
  }
  if(canEdit && document.getElementById('emptyAddTransmittalBtn')) {
    document.getElementById('emptyAddTransmittalBtn').onclick = () => openTransmittalModal(null, companies);
  }
  document.getElementById('exportTransmittalsBtn').onclick = () => exportCsv('document_transmittals');

  document.querySelectorAll('[data-view-transmittal]').forEach(btn => {
    btn.onclick = () => {
      const tr = transmittals.find(t=>t.id===btn.dataset.viewTransmittal);
      if(tr) openTransmittalSlipModal(tr);
    };
  });
  document.querySelectorAll('[data-del-transmittal]').forEach(btn => {
    btn.onclick = async () => {
      const ok = await confirmAction('Delete this document transmittal?');
      if(!ok) return;
      try {
        await apiFetch(`/api/document_transmittals/${btn.dataset.delTransmittal}`, {method:'DELETE'});
        renderTransmittals();
      } catch(e) { alert('Delete failed: '+e.message); }
    };
  });
}

function openTransmittalModal(record, companies){
  const targetProjId = record ? record.project_id : (currentProjectId === 'ALL' ? (PROJECTS[0]?.id || '') : currentProjectId);
  const projectPicker = currentProjectId==='ALL' ? `<div class="full"><label>Project</label><select id="f_project_id">${PROJECTS.map(p=>`<option value="${p.id}">${escHtml(p.name)}</option>`).join('')}</select></div>` : '';

  const html = `<div class="form-grid">
    ${projectPicker}
    <div><label>Transmittal No.</label><input id="f_transmittal_number" value="TRN-001"></div>
    <div><label>Purpose</label><select id="f_purpose"><option>For Approval</option><option>For Construction</option><option>For Information</option><option>As-Built</option></select></div>
    <div class="full"><label>Subject / Description</label><input id="f_subject" placeholder="e.g. Submittal of L2 HVAC Shop Drawings Rev B"></div>
    <div><label>Sender Company</label>
      <select id="f_sender_company_id">
        <option value="">— Main Contractor —</option>
        ${companies.map(c=>`<option value="${c.id}">${escHtml(c.name)} (${escHtml(c.type)})</option>`).join('')}
      </select>
    </div>
    <div><label>Recipient Company</label>
      <select id="f_recipient_company_id">
        <option value="">— Consultant / Client —</option>
        ${companies.map(c=>`<option value="${c.id}">${escHtml(c.name)} (${escHtml(c.type)})</option>`).join('')}
      </select>
    </div>
    <div><label>Date Sent</label><input type="date" id="f_date_sent" value="${new Date().toISOString().slice(0,10)}"></div>
    <div><label>Due Date for Approval</label><input type="date" id="f_due_date"></div>
    <div class="full"><label>Transmittal Notes</label><textarea id="f_notes" rows="2" placeholder="Please review and return 1 signed copy..."></textarea></div>
  </div>`;

  openModal('Create Document Transmittal', html, async ()=>{
    const payload = {
      project_id: document.getElementById('f_project_id')?.value || targetProjId,
      transmittal_number: document.getElementById('f_transmittal_number').value.trim(),
      purpose: document.getElementById('f_purpose').value,
      subject: document.getElementById('f_subject').value.trim(),
      sender_company_id: document.getElementById('f_sender_company_id').value || null,
      recipient_company_id: document.getElementById('f_recipient_company_id').value || null,
      date_sent: document.getElementById('f_date_sent').value,
      due_date: document.getElementById('f_due_date').value,
      notes: document.getElementById('f_notes').value.trim(),
      status: 'Transmitted'
    };
    if(!payload.subject) throw new Error('Subject is required');
    await apiFetch('/api/document_transmittals', {method:'POST', body: JSON.stringify(payload)});
  });
}

async function openTransmittalSlipModal(tr){
  const full = await apiFetch(`/api/document_transmittals/${tr.id}`);
  const items = full.items || [];
  const overlay = document.getElementById('modalOverlay');

  const html = `
    <div style="max-height:80vh;overflow-y:auto;padding-right:4px;display:flex;flex-direction:column;gap:14px;">
      <div style="background:var(--card-raised);border:1px solid var(--border);border-radius:10px;padding:16px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <div style="font-size:11px;font-weight:700;color:var(--primary);text-transform:uppercase;">Document Transmittal Form</div>
            <h3 style="margin:4px 0;">${escHtml(full.subject)}</h3>
            <div style="font-size:12px;color:var(--muted);">Date: <b style="color:var(--text);">${escHtml(full.date_sent)}</b> · Purpose: <span class="badge badge-pub">${escHtml(full.purpose)}</span></div>
          </div>
          <span class="badge badge-pkg" style="font-family:monospace;font-size:13px;font-weight:700;">${escHtml(full.transmittal_number)}</span>
        </div>
        <div style="display:flex;gap:20px;font-size:12px;margin-top:12px;padding-top:10px;border-top:1px solid var(--border);">
          <div>From: <b style="color:var(--text);">${escHtml(full.sender_company_name||'Main Contractor')}</b></div>
          <div>To: <b style="color:var(--text);">${escHtml(full.recipient_company_name||'Consultant / Client')}</b></div>
        </div>
        ${full.notes ? `<div style="font-size:12px;color:var(--muted);margin-top:8px;">Notes: ${escHtml(full.notes)}</div>`:''}
      </div>

      <div class="panel" style="padding:12px;">
        <h4 style="margin:0 0 8px 0;font-size:13px;color:var(--primary);text-transform:uppercase;">Transmitted Documents & Drawings (${items.length})</h4>
        ${items.length ? `
          <table>
            <thead>
              <tr>
                <th>Doc Title</th>
                <th>Doc Number</th>
                <th>Revision</th>
                <th>Format</th>
                <th>Action Required</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(it=>`
                <tr>
                  <td><b>${escHtml(it.document_title)}</b></td>
                  <td><span style="font-family:monospace;">${escHtml(it.document_number||'—')}</span></td>
                  <td><span class="badge badge-pkg">${escHtml(it.revision||'Rev A')}</span></td>
                  <td>${escHtml(it.format||'PDF')}</td>
                  <td>${escHtml(it.action_required||'Review & Approve')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : `<div style="color:var(--muted);font-size:12px;font-style:italic;">All active project documents attached under this transmittal purpose.</div>`}
      </div>
    </div>
  `;

  document.getElementById('modalBody').innerHTML = `
    <h3><span>Document Transmittal Slip</span></h3>
    ${html}
    <div class="modal-actions" style="margin-top:14px;">
      <button class="btn ghost small" onclick="window.print()">🖨️ Print Slip</button>
      <button class="btn small" id="transmittalSlipCloseBtn">Close</button>
    </div>
  `;
  overlay.classList.add('show');
  document.getElementById('transmittalSlipCloseBtn').onclick = () => overlay.classList.remove('show');
}

/* =========================================================
   DOCUMENT REVISION CONTROL AUDIT MODALS
   ========================================================= */
async function openDocumentRevisionsModal(doc){
  const revisions = await apiFetch(`/api/documents/${doc.id}/revisions`);
  const overlay = document.getElementById('modalOverlay');

  const html = `
    <div style="max-height:75vh;overflow-y:auto;display:flex;flex-direction:column;gap:12px;">
      <div style="background:var(--card-raised);border:1px solid var(--border);border-radius:8px;padding:12px;">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Current Active Version:</div>
        <div style="font-size:15px;font-weight:700;color:var(--text);margin-top:2px;">${escHtml(doc.name)}</div>
        <div style="font-size:12px;margin-top:4px;">
          Active Revision: <span class="badge badge-pub">${escHtml(doc.revision||'Rev 0')}</span> · Date Added: <b>${escHtml(doc.date_added)}</b>
        </div>
      </div>

      <div class="panel" style="padding:12px;">
        <h4 style="margin:0 0 8px 0;font-size:13px;color:var(--primary);text-transform:uppercase;">Superseded Revisions History (${revisions.length})</h4>
        ${revisions.length ? `
          <table>
            <thead>
              <tr>
                <th>Rev.</th>
                <th>Superseded Date</th>
                <th>Archived By</th>
                <th>Change Notes</th>
                <th>Archived File</th>
              </tr>
            </thead>
            <tbody>
              ${revisions.map(rev=>`
                <tr>
                  <td><span class="badge badge-draft" style="font-weight:700;">${escHtml(rev.revision)}</span></td>
                  <td>${new Date(rev.superseded_at).toLocaleDateString()}</td>
                  <td>${escHtml(rev.changed_by||'Engineer')}</td>
                  <td><div style="font-size:11px;max-width:220px;line-height:1.4;">${escHtml(rev.change_notes||'Superseded by new revision')}</div></td>
                  <td>
                    ${rev.attachment_data ? `<a href="${rev.attachment_data}" download="${escHtml(rev.attachment_name||'archived_rev')}" class="btn ghost small" style="padding:2px 6px;font-size:10px;">⬇️ ${escHtml(rev.attachment_name||'Download')}</a>` : '<span style="color:var(--muted);">—</span>'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : `<div style="color:var(--muted);font-size:12px;font-style:italic;">No superseded revisions yet. This is original initial release (${escHtml(doc.revision||'Rev 0')}).</div>`}
      </div>
    </div>
  `;

  document.getElementById('modalBody').innerHTML = `
    <h3><span>Document Revision Audit Trail</span></h3>
    ${html}
    <div class="modal-actions" style="margin-top:14px;">
      <button class="btn small" id="revHistoryCloseBtn">Close</button>
    </div>
  `;
  overlay.classList.add('show');
  document.getElementById('revHistoryCloseBtn').onclick = () => overlay.classList.remove('show');
}

function openNewRevisionModal(doc){
  const currRev = doc.revision || 'Rev 0';
  let nextRev = 'Rev 1';
  if(currRev.startsWith('Rev ')){
    const num = parseInt(currRev.replace('Rev ',''), 10);
    if(!isNaN(num)) nextRev = 'Rev ' + (num + 1);
    else if(currRev.match(/Rev ([A-Z])/i)){
      const charCode = currRev.charCodeAt(4);
      nextRev = 'Rev ' + String.fromCharCode(charCode + 1);
    }
  }

  const html = `<div class="form-grid">
    <div class="full" style="background:var(--card-raised);border:1px solid var(--border);border-radius:8px;padding:12px;">
      <div style="font-size:11px;color:var(--muted);">Incrementing Revision for:</div>
      <div style="font-size:14px;font-weight:700;margin-top:2px;">${escHtml(doc.name)}</div>
      <div style="font-size:12px;margin-top:4px;">Current Version: <span class="badge badge-draft">${escHtml(currRev)}</span> will be archived to revision history.</div>
    </div>
    <div><label>New Revision Identifier</label><input id="f_new_revision" value="${nextRev}"></div>
    <div><label>Revision Release Date</label><input type="date" id="f_rev_date" value="${new Date().toISOString().slice(0,10)}"></div>
    <div class="full"><label>Reason for Revision / Change Description</label><textarea id="f_change_notes" rows="2" placeholder="e.g. Revised to incorporate Consultant RFI-004 response regarding duct sizing..."></textarea></div>
    <div class="full"><label>Upload New Revision File (PDF / Drawing / Spec)</label><input type="file" id="f_new_rev_file"></div>
  </div>`;

  openModal('Upload New Document Revision', html, async ()=>{
    const file = document.getElementById('f_new_rev_file').files[0];
    let attachment_name = null;
    let attachment_data = null;
    if(file){
      attachment_name = file.name;
      attachment_data = await new Promise((resolve, reject)=>{
        const reader = new FileReader();
        reader.onload = ()=> resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    const payload = {
      new_revision: document.getElementById('f_new_revision').value.trim(),
      change_notes: document.getElementById('f_change_notes').value.trim(),
      date_added: document.getElementById('f_rev_date').value,
      attachment_name, attachment_data
    };
    if(!payload.new_revision) throw new Error('New revision identifier is required');
    await apiFetch(`/api/documents/${doc.id}/new-revision`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    renderDocuments();
  });
}

function openModal(title, html, onSave){
  stopActiveCameraStream();
  const overlay = document.getElementById('modalOverlay');
  document.getElementById('modalBody').innerHTML = `<h3>${title}</h3>${html}
    <div class="modal-actions"><button class="btn ghost small" id="mCancel">Cancel</button><button class="btn small" id="mSave">Save</button></div>`;
  overlay.classList.add('show');
  document.getElementById('mCancel').onclick = ()=> { stopActiveCameraStream(); overlay.classList.remove('show'); };
  document.getElementById('mSave').onclick = async ()=>{
    document.getElementById('mSave').disabled = true;
    try{ await onSave(); stopActiveCameraStream(); overlay.classList.remove('show'); render(); }
    catch(e){ alert(e.message||'Save failed'); }
    finally{ document.getElementById('mSave').disabled = false; }
  };
}

const FIELD_TEMPLATES = {
  tasks: (r) => `<div class="form-grid"><div class="full"><label>Title</label><input id="f_title" value="${r?escHtml(r.title):''}"></div>
    <div><label>Trade</label><select id="f_trade">${TRADES.map(t=>`<option ${r&&r.trade===t?'selected':''}>${t}</option>`).join('')}</select></div>
    <div><label>Assignee</label><input id="f_assignee" value="${r?escHtml(r.assignee):''}"></div>
    <div><label>Start</label><input type="date" id="f_start" value="${r?escHtml(r.start):''}"></div>
    <div><label>End</label><input type="date" id="f_end" value="${r?escHtml(r.end):''}"></div>
    <div><label>Progress %</label><input type="number" id="f_progress" value="${r?r.progress:0}"></div>
    <div><label>Status</label><select id="f_status">${['Not Started','In Progress','Completed','Delayed'].map(s=>`<option ${r&&r.status===s?'selected':''}>${s}</option>`).join('')}</select></div></div>`,
  rfis: (r) => `<div class="form-grid"><div><label>Number</label><input id="f_number" value="${r?escHtml(r.number):'RFI-00X'}"></div>
    <div><label>Trade</label><select id="f_trade">${TRADES.map(t=>`<option ${r&&r.trade===t?'selected':''}>${t}</option>`).join('')}</select></div>
    <div class="full"><label>Subject</label><input id="f_subject" value="${r?escHtml(r.subject):''}"></div>
    <div><label>Raised By</label><input id="f_raised_by" value="${r?escHtml(r.raised_by):(ME?ME.name:'')}"></div>
    <div><label>Date Raised</label><input type="date" id="f_date_raised" value="${r?escHtml(r.date_raised):''}"></div>
    <div><label>Due Date</label><input type="date" id="f_due_date" value="${r?escHtml(r.due_date):''}"></div>
    <div><label>Status</label><select id="f_status">${['Open','Under Review','Closed'].map(s=>`<option ${r&&r.status===s?'selected':''}>${s}</option>`).join('')}</select></div></div>`,
  submittals: (r) => `<div class="form-grid"><div><label>Number</label><input id="f_number" value="${r?escHtml(r.number):'SUB-00X'}"></div>
    <div><label>Trade</label><select id="f_trade">${TRADES.map(t=>`<option ${r&&r.trade===t?'selected':''}>${t}</option>`).join('')}</select></div>
    <div class="full"><label>Item</label><input id="f_item" value="${r?escHtml(r.item):''}"></div>
    <div><label>Date Submitted</label><input type="date" id="f_date_submitted" value="${r?escHtml(r.date_submitted):''}"></div>
    <div><label>Due Date</label><input type="date" id="f_due_date" value="${r?escHtml(r.due_date):''}"></div>
    <div><label>Status</label><select id="f_status">${['Under Review','Approved','Rejected','Resubmit'].map(s=>`<option ${r&&r.status===s?'selected':''}>${s}</option>`).join('')}</select></div></div>`,
  punchlist: (r) => `<div class="form-grid"><div class="full">
      <label>Item</label>
      <div style="display:flex;gap:6px;">
        <input id="f_item" value="${r?escHtml(r.item):''}" style="flex:1;">
        <button type="button" class="btn ghost small" id="suggestFixBtn" title="Get an AI-assisted likely cause and fix for this defect">Suggest Fix</button>
      </div>
      <div id="suggestFixResult" style="display:none;font-size:12px;background:rgba(111,211,193,0.08);border:1px solid rgba(111,211,193,0.3);border-radius:6px;padding:8px;margin-top:6px;white-space:pre-wrap;"></div>
    </div>
    <div><label>Trade</label><select id="f_trade">${TRADES.map(t=>`<option ${r&&r.trade===t?'selected':''}>${t}</option>`).join('')}</select></div>
    <div><label>Location</label><input id="f_location" value="${r?escHtml(r.location):''}"></div>
    <div><label>Priority</label><select id="f_priority">${['Critical','High','Medium','Low'].map(p=>`<option ${r&&r.priority===p?'selected':''}>${p}</option>`).join('')}</select></div>
    <div><label>Date Raised</label><input type="date" id="f_date_raised" value="${r?escHtml(r.date_raised):new Date().toISOString().slice(0,10)}"></div>
    <div><label>Status</label><select id="f_status">${['Open','In Progress','Closed'].map(s=>`<option ${r&&r.status===s?'selected':''}>${s}</option>`).join('')}</select></div>
    <div class="full">
      <label>Site Defect Photo</label>
      <div style="display:flex;gap:8px;align-items:center;margin-top:4px;flex-wrap:wrap;">
        <button type="button" class="btn ghost small" id="formSnapPhotoBtn">Take Photo with Camera</button>
        <button type="button" class="btn ghost small" id="formUploadPhotoBtn">Choose File</button>
        <input type="file" id="formNativePhotoInput" accept="image/*" capture="environment" style="display:none;">
      </div>
      <input type="hidden" id="f_attachment_data" value="${r&&r.attachment_data?escHtml(r.attachment_data):''}">
      <div id="formPhotoPreviewBox" style="margin-top:8px;${r&&r.attachment_data?'':'display:none;'}">
        <img id="formPhotoPreviewImg" src="${r&&r.attachment_data?r.attachment_data:''}" style="max-height:140px;border-radius:6px;border:1px solid var(--hairline);object-fit:contain;cursor:pointer;" onclick="if(this.src) openPhotoLightbox('Punch Defect Photo', this.src)">
      </div>
    </div>
  </div>`,
  dailylogs: (r) => `<div class="form-grid"><div><label>Date</label><input type="date" id="f_date" value="${r?escHtml(r.date):''}"></div>
    <div><label>Trade</label><select id="f_trade">${TRADES.map(t=>`<option ${r&&r.trade===t?'selected':''}>${t}</option>`).join('')}</select></div>
    <div><label>Weather</label><input id="f_weather" value="${r?escHtml(r.weather):''}"></div>
    <div><label>Crew</label><input type="number" id="f_crew" value="${r?r.crew:''}"></div>
    <div class="full"><label>Notes</label><textarea id="f_notes" rows="3">${r?escHtml(r.notes):''}</textarea></div></div>`,
  costs: (r) => `<div class="form-grid"><div><label>Category</label><select id="f_category">${TRADES.map(t=>`<option ${r&&r.category===t?'selected':''}>${t}</option>`).join('')}</select></div>
    <div class="full"><label>Description</label><input id="f_description" value="${r?escHtml(r.description):''}"></div>
    <div><label>Planned (€)</label><input type="number" id="f_planned" value="${r?r.planned:''}"></div>
    <div><label>Actual (€)</label><input type="number" id="f_actual" value="${r?r.actual:''}"></div>
    <div><label>Date Logged</label><input type="date" id="f_date_logged" value="${r?escHtml(r.date_logged):''}"></div></div>`,
  change_orders: (r) => `<div class="form-grid"><div><label>Number</label><input id="f_number" value="${r?escHtml(r.number):'CO-00X'}"></div>
    <div><label>Trade</label><select id="f_trade">${TRADES.map(t=>`<option ${r&&r.trade===t?'selected':''}>${t}</option>`).join('')}</select></div>
    <div class="full"><label>Title</label><input id="f_title" value="${r?escHtml(r.title):''}"></div>
    <div class="full"><label>Reason</label><input id="f_reason" value="${r?escHtml(r.reason):''}"></div>
    <div><label>Cost Impact (€)</label><input type="number" id="f_cost_impact" value="${r?r.cost_impact:''}"></div>
    <div><label>Schedule Impact (days)</label><input type="number" id="f_schedule_impact_days" value="${r?r.schedule_impact_days:''}"></div>
    <div><label>Date Raised</label><input type="date" id="f_date_raised" value="${r?escHtml(r.date_raised):''}"></div>
    <div><label>Status</label><select id="f_status">${['Pending','Approved','Rejected'].map(s=>`<option ${r&&r.status===s?'selected':''}>${s}</option>`).join('')}</select></div></div>`,
  purchase_orders: (r) => `<div class="form-grid"><div><label>PO Number</label><input id="f_po_number" value="${r?escHtml(r.po_number):'PO-100X'}"></div>
    <div><label>Vendor</label><input id="f_vendor" value="${r?escHtml(r.vendor):''}"></div>
    <div><label>Trade</label><select id="f_trade">${TRADES.map(t=>`<option ${r&&r.trade===t?'selected':''}>${t}</option>`).join('')}</select></div>
    <div class="full"><label>Description</label><input id="f_description" value="${r?escHtml(r.description):''}"></div>
    <div><label>Amount (€)</label><input type="number" id="f_amount" value="${r?r.amount:''}"></div>
    <div><label>Order Date</label><input type="date" id="f_order_date" value="${r?escHtml(r.order_date):''}"></div>
    <div><label>Expected Delivery</label><input type="date" id="f_expected_delivery" value="${r?escHtml(r.expected_delivery):''}"></div>
    <div><label>Status</label><select id="f_status">${['Draft','Ordered','Delivered','Cancelled'].map(s=>`<option ${r&&r.status===s?'selected':''}>${s}</option>`).join('')}</select></div></div>`,
  safety_incidents: (r) => `<div class="form-grid"><div><label>Date</label><input type="date" id="f_date" value="${r?escHtml(r.date):''}"></div>
    <div><label>Trade</label><select id="f_trade">${TRADES.map(t=>`<option ${r&&r.trade===t?'selected':''}>${t}</option>`).join('')}</select></div>
    <div><label>Incident Type</label><select id="f_incident_type">${['Near Miss','First Aid','Injury','Property Damage','Environmental'].map(s=>`<option ${r&&r.incident_type===s?'selected':''}>${s}</option>`).join('')}</select></div>
    <div><label>Severity</label><select id="f_severity">${['Low','Medium','High','Critical'].map(s=>`<option ${r&&r.severity===s?'selected':''}>${s}</option>`).join('')}</select></div>
    <div class="full"><label>Description</label><input id="f_description" value="${r?escHtml(r.description):''}"></div>
    <div class="full"><label>Corrective Action</label><input id="f_corrective_action" value="${r?escHtml(r.corrective_action):''}"></div>
    <div><label>Status</label><select id="f_status">${['Open','Closed'].map(s=>`<option ${r&&r.status===s?'selected':''}>${s}</option>`).join('')}</select></div></div>`,
  inspections: (r) => `<div class="form-grid"><div><label>Date</label><input type="date" id="f_date" value="${r?escHtml(r.date):''}"></div>
    <div><label>Trade</label><select id="f_trade">${TRADES.map(t=>`<option ${r&&r.trade===t?'selected':''}>${t}</option>`).join('')}</select></div>
    <div class="full"><label>Inspection Type</label><input id="f_inspection_type" value="${r?escHtml(r.inspection_type):''}"></div>
    <div><label>Inspector</label><input id="f_inspector" value="${r?escHtml(r.inspector):''}"></div>
    <div><label>Result</label><select id="f_result">${['Pass','Fail','Conditional'].map(s=>`<option ${r&&r.result===s?'selected':''}>${s}</option>`).join('')}</select></div>
    <div class="full"><label>Notes</label><textarea id="f_notes" rows="3">${r?escHtml(r.notes):''}</textarea></div></div>`,
  meeting_minutes: (r) => `<div class="form-grid"><div><label>Date</label><input type="date" id="f_date" value="${r?escHtml(r.date):''}"></div>
    <div><label>Meeting Type</label><input id="f_meeting_type" value="${r?escHtml(r.meeting_type):''}"></div>
    <div class="full"><label>Attendees</label><input id="f_attendees" value="${r?escHtml(r.attendees):''}"></div>
    <div class="full"><label>Subject</label><input id="f_subject" value="${r?escHtml(r.subject):''}"></div>
    <div class="full"><label>Notes</label><textarea id="f_notes" rows="3">${r?escHtml(r.notes):''}</textarea></div></div>`,
  timesheets: (r) => `<div class="form-grid"><div><label>Date</label><input type="date" id="f_date" value="${r?escHtml(r.date):''}"></div>
    <div><label>Worker</label><input id="f_worker" value="${r?escHtml(r.worker):''}"></div>
    <div><label>Trade</label><select id="f_trade">${TRADES.map(t=>`<option ${r&&r.trade===t?'selected':''}>${t}</option>`).join('')}</select></div>
    <div class="full"><label>Task</label><input id="f_task" value="${r?escHtml(r.task):''}"></div>
    <div><label>Hours</label><input type="number" step="0.5" id="f_hours" value="${r?r.hours:''}"></div></div>`,
  equipment: (r) => `<div class="form-grid"><div class="full"><label>Name</label><input id="f_name" value="${r?escHtml(r.name):''}"></div>
    <div><label>Type</label><input id="f_type" value="${r?escHtml(r.type):''}"></div>
    <div><label>Assigned To</label><input id="f_assigned_to" value="${r?escHtml(r.assigned_to):''}"></div>
    <div><label>Status</label><select id="f_status">${['Available','In Use','Maintenance'].map(s=>`<option ${r&&r.status===s?'selected':''}>${s}</option>`).join('')}</select></div>
    <div class="full"><label>Notes</label><textarea id="f_notes" rows="2">${r?escHtml(r.notes):''}</textarea></div></div>`
};
const GENERIC_FIELD_IDS = {
  wbs_items:['parent_id','code','name','level','discipline','system','active'],
  dependencies:['task_id','task_owner','dependent_party','description','dependency_owner','required_date','completed_date','status','impact_if_late','programme_impact','commercial_impact','next_action'],
  procurement_items:['pr_number','material','specification','boq_reference','drawing_reference','quantity','unit','required_on_site','responsible_buyer','selected_supplier','po_number','po_date','expected_delivery','actual_delivery','delivered_quantity','outstanding_quantity','inspection_status','storage_location','status'],
  material_requests:['location','discipline','system','material','description','quantity','unit','required_date','reason','drawing','boq_reference','requested_by','status'],
  risks:['title','category','probability','impact','risk_score','owner','mitigation','target_date','status'],
  ncrs:['number','location','description','raised_against','raised_date','responsible_party','root_cause','corrective_action','target_date','verification','closure_date','status'],
  commissioning_tests:['system','subsystem','equipment','test_type','power_available','installation_complete','controls_complete','interface_complete','drawings_approved','test_date','test_engineer','witness','result','failure_reason','retest_date','certificate','status','comments'],
  handover_items:['contractor','system','item_type','description','required','submitted','approved','due_date','status','notes'],
  companies:['name','type','trade','contact_person','email','phone','vat_number','status','notes'],
  work_packages:['code','name','discipline','description','company_id','lead_contact','budget_allocated','status','start_date','target_date'],
  clarifications:['clarification_number','subject','type','from_company_id','to_company_id','work_package_id','discipline','priority','question','proposed_solution','status'],
  progress_reports:['report_number','title','period_start','period_end','prepared_by','approved_by','overall_progress_actual','overall_progress_planned','status'],
  transmittals:['transmittal_number','subject','purpose','sender_company_id','recipient_company_id','date_sent','due_date','status','notes'],
  progress_submissions:['work_package_id','company_id','period_date','discipline','claimed_percentage','quantity_installed','unit','notes','status']
};
Object.entries(GENERIC_FIELD_IDS).forEach(([table, fields])=>{
  FIELD_TEMPLATES[table] = r => `<div class="form-grid">${fields.map(field=>`<div class="${['description','specification','mitigation','notes','comments','next_action','reason'].includes(field)?'full':''}"><label>${field.replaceAll('_',' ')}</label><input id="f_${field}" value="${r?escHtml(r[field]):''}"></div>`).join('')}</div>`;
});
const FIELD_IDS = {
  tasks: ['title','trade','assignee','start','end','progress','status'],
  rfis: ['number','trade','subject','raised_by','date_raised','due_date','status'],
  submittals: ['number','trade','item','date_submitted','due_date','status'],
  punchlist: ['item','trade','location','priority','date_raised','status','attachment_data'],
  dailylogs: ['date','trade','weather','crew','notes'],
  costs: ['category','description','planned','actual','date_logged'],
  change_orders: ['number','title','trade','reason','cost_impact','schedule_impact_days','date_raised','status'],
  purchase_orders: ['po_number','vendor','trade','description','amount','order_date','expected_delivery','status'],
  safety_incidents: ['date','trade','incident_type','severity','description','corrective_action','status'],
  inspections: ['date','trade','inspection_type','inspector','result','notes'],
  meeting_minutes: ['date','meeting_type','attendees','subject','notes'],
  timesheets: ['date','worker','trade','task','hours'],
  equipment: ['name','type','assigned_to','status','notes'],
  ...GENERIC_FIELD_IDS
};

function wireSuggestFixButton(){
  const btn = document.getElementById('suggestFixBtn');
  if(!btn) return;
  btn.onclick = async () => {
    const description = document.getElementById('f_item').value.trim();
    const trade = document.getElementById('f_trade') ? document.getElementById('f_trade').value : '';
    if(!description){ alert('Enter a description of the defect first.'); return; }
    const resultBox = document.getElementById('suggestFixResult');
    const originalText = btn.textContent;
    btn.textContent = 'Analyzing...';
    btn.disabled = true;
    try {
      const res = await apiFetch('/api/ai/suggest-fix', {method:'POST', body: JSON.stringify({description, trade})});
      resultBox.style.display = 'block';
      resultBox.textContent = res.suggestion + (res.source==='reference' ? '\n\n(from the built-in MEP reference — configure GEMINI_API_KEY for AI-assisted analysis of issues outside this reference set)' : '');
    } catch(err) {
      alert('Could not get a suggestion: ' + err.message);
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  };
}

function wireFormPhotoControls(){
  const snapBtn = document.getElementById('formSnapPhotoBtn');
  const uploadBtn = document.getElementById('formUploadPhotoBtn');
  const nativeInput = document.getElementById('formNativePhotoInput');
  const previewBox = document.getElementById('formPhotoPreviewBox');
  const previewImg = document.getElementById('formPhotoPreviewImg');
  const hiddenData = document.getElementById('f_attachment_data');

  if(nativeInput){
    nativeInput.onchange = async (e)=>{
      const file = e.target.files && e.target.files[0];
      if(!file) return;
      try{
        const dataUrl = await compressImageFile(file);
        if(hiddenData) hiddenData.value = dataUrl;
        if(previewImg) previewImg.src = dataUrl;
        if(previewBox) previewBox.style.display = 'block';
      }catch(err){
        alert('Failed to process image: ' + err.message);
      }
    };
  }

  if(uploadBtn && nativeInput){
    uploadBtn.onclick = ()=>{
      nativeInput.removeAttribute('capture');
      nativeInput.click();
    };
  }

  if(snapBtn){
    snapBtn.onclick = ()=>{
      openCameraCaptureModal({
        context: 'punchlist',
        defaultZone: document.getElementById('f_location')?.value || '',
        onCaptured: (dataUrl)=>{
          if(hiddenData) hiddenData.value = dataUrl;
          if(previewImg) previewImg.src = dataUrl;
          if(previewBox) previewBox.style.display = 'block';
        }
      });
    };
  }
}

function collectFieldPayload(table){
  const payload = {};
  FIELD_IDS[table].forEach(f=>{
    const el = document.getElementById('f_'+f);
    payload[f] = el ? el.value : '';
  });
  return payload;
}

function openAddModal(table, label, cols, initialData = null){
  const projectPicker = currentProjectId==='ALL' ? `<div class="form-grid"><div class="full"><label>Project</label><select id="f_project_id">${PROJECTS.map(p=>`<option value="${p.id}">${escHtml(p.name)}</option>`).join('')}</select></div></div>` : '';
  openModal(`Add ${label}`, projectPicker + FIELD_TEMPLATES[table](initialData), async ()=>{
    const payload = collectFieldPayload(table);
    payload.project_id = currentProjectId==='ALL' ? document.getElementById('f_project_id').value : currentProjectId;
    await apiFetch(`/api/${table}`, {method:'POST', body: JSON.stringify(payload)});
  });
  if(table==='punchlist') wireFormPhotoControls();
  if(table==='punchlist') wireSuggestFixButton();
}

function openEditModal(table, label, record){
  openModal(`Edit ${label}`, FIELD_TEMPLATES[table](record), async ()=>{
    const payload = collectFieldPayload(table);
    await apiFetch(`/api/${table}/${record.id}`, {method:'PUT', body: JSON.stringify(payload)});
  });
  if(table==='punchlist') wireFormPhotoControls();
  if(table==='punchlist') wireSuggestFixButton();
}

/* ==========================================================================
   FIREBASE INTEGRATION & AUTHENTICATION
   ========================================================================== */
