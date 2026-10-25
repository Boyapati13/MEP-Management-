async function renderDashboard(){
  if(currentProjectId==='ALL'){
    const [cards, operations] = await Promise.all([apiFetch('/api/portfolio'), apiFetch('/api/operations/today')]);
    document.getElementById('viewContent').innerHTML = `<div class="panel"><h3><span>Portfolio Overview</span><span style="font-size:11px;color:var(--muted);">${cards.length} accessible project${cards.length===1?'':'s'}</span></h3><div class="portfolio-grid">${cards.map(card=>`<article class="project-card" data-project-card="${card.id}"><div style="display:flex;justify-content:space-between;gap:10px;"><div><h3>${escHtml(card.name)}</h3><div class="meta">${escHtml(card.client||'No client recorded')} · ${escHtml(card.status||'')}</div></div><span class="health ${card.health}">${card.health}</span></div><div class="project-metrics"><div><span>Completion</span><b>${card.project_completion}%</b></div><div><span>Contract value</span><b>${fmtCurrency(card.revised_contract_value)}</b></div><div><span>Open snags</span><b>${card.open_snags}</b></div><div><span>Overdue actions</span><b>${card.overdue_actions}</b></div><div><span>Blockers</span><b>${card.major_blockers}</b></div><div><span>Late materials</span><b>${card.late_materials}</b></div></div></article>`).join('')||'<div class="empty-state"><p>No projects yet. Create your first project to get started.</p><button class="btn accent small" data-goto-projects>+ Create Project</button></div>'}</div></div><div class="panel"><h3><span>Today across all projects</span><span style="font-size:11px;color:var(--muted);">${escHtml(operations.date)}</span></h3>${operations.projects.length?`<table><thead><tr><th>Project</th><th>Work today</th><th>Progress</th><th>Crew</th><th>Logs</th><th>Photos</th><th>BOQ installed</th></tr></thead><tbody>${operations.projects.map(item=>`<tr class="operations-row" data-operation-project="${item.project.id}"><td><b>${escHtml(item.project.name)}</b><span style="display:block;color:var(--muted);font-size:11px;">${escHtml(item.project.client||'')}</span></td><td>${item.tasks.length?item.tasks.map(task=>`<div>${escHtml(task.title)}</div>`).join(''):'<span style="color:var(--muted);">No scheduled work</span>'}</td><td>${item.progress}%</td><td>${item.crew}</td><td>${item.logs.length}</td><td>${item.photo_count}</td><td>${item.boq.tender?`${item.boq.installed} / ${item.boq.tender}`:'-'}</td></tr>`).join('')}</tbody></table>`:'<div class="empty-state"><p>Nothing scheduled for today across your projects yet.</p></div>'}</div>`;
    if(document.querySelector('[data-goto-projects]')) document.querySelector('[data-goto-projects]').onclick = () => document.querySelector('[data-view="projects"]').click();
    document.querySelectorAll('[data-project-card]').forEach(card=>card.onclick=()=>{ currentProjectId=card.dataset.projectCard; document.getElementById('projectSelect').value=currentProjectId; render(); });
    document.querySelectorAll('[data-operation-project]').forEach(row=>row.onclick=()=>{ currentProjectId=row.dataset.operationProject; document.getElementById('projectSelect').value=currentProjectId; currentView='site_today'; document.querySelectorAll('.nav-item').forEach(item=>item.classList.toggle('active',item.dataset.view==='site_today')); document.getElementById('viewTitle').textContent='Today on Site'; render(); });
    return;
  }
  const stats = await apiFetch('/api/dashboard?project_id='+currentProjectId);
  document.getElementById('viewContent').innerHTML = `
  <div class="stat-grid">
    <div class="stat-card"><div class="num">${stats.total_tasks}</div><div class="lbl">Total Tasks</div></div>
    <div class="stat-card"><div class="num">${stats.avg_progress}%</div><div class="lbl">Avg. Progress</div></div>
    <div class="stat-card"><div class="num">${stats.open_rfi}</div><div class="lbl">Open RFIs</div></div>
    <div class="stat-card"><div class="num">${stats.open_punch}</div><div class="lbl">Open Punch Items</div></div>
    <div class="stat-card ${stats.overdue_count?'warn':''}"><div class="num">${stats.overdue_count}</div><div class="lbl">Overdue Items</div></div>
    <div class="stat-card ${stats.cost_variance>0?'warn':''}"><div class="num">${fmtCurrency(stats.cost_variance)}</div><div class="lbl">Cost Variance</div></div>
    <div class="stat-card ${stats.pending_change_orders?'warn':''}"><div class="num">${stats.pending_change_orders}</div><div class="lbl">Pending Change Orders</div></div>
    <div class="stat-card ${stats.open_safety_incidents?'warn':''}"><div class="num">${stats.open_safety_incidents}</div><div class="lbl">Open Safety Incidents</div></div>
    <div class="stat-card"><div class="num">${stats.boq_line_count||0}</div><div class="lbl">BOQ Lines</div></div>
    <div class="stat-card"><div class="num">${fmtCurrency(stats.boq_tender_value||0)}</div><div class="lbl">Tender Value</div></div>
  </div>
  <div class="panel"><h3>Tasks by Trade</h3>
    ${Object.entries(stats.tasks_by_trade).map(([t,c])=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);"><span>${t}</span><span>${c}</span></div>`).join('') || '<div class="empty">No tasks yet.</div>'}
  </div>`;
}

const USER_ROLES_META = {
  Admin: { name: 'Executive Administrator', icon: '', badge: 'badge-role-admin', cat: 'Executive Leadership', scope: 'Global Enterprise (All Projects)', desc: 'Unrestricted system governance, user/role provisioning, project setup, and financial approvals.' },
  ProjectManager: { name: 'MEP Project Manager', icon: '', badge: 'badge-role-pm', cat: 'Operations Management', scope: 'Assigned Projects (or All)', desc: 'Full project execution oversight, schedule/Gantt management, variation claim approvals, submittals, and budget tracking.' },
  SiteEngineer: { name: 'MEP Site Engineer', icon: '', badge: 'badge-role-engineer', cat: 'Field Engineering', scope: 'Assigned Projects', desc: 'Site installation, drawing hand markups, punch snagging, daily site logs, RFIs, and material requisitions.' },
  CommercialManager: { name: 'Quantity Surveyor / Commercial Lead', icon: '', badge: 'badge-role-commercial', cat: 'Commercial & Contracts', scope: 'Assigned Projects', desc: 'BOQ measurement, cost valuations, budget commitments, change orders & claims, procurement, and supplier purchase orders.' },
  QAQC: { name: 'QA/QC & Commissioning Lead', icon: '', badge: 'badge-role-qaqc', cat: 'Quality & Compliance', scope: 'Assigned Projects', desc: 'Site inspections, Non-Conformance Reports (NCRs), testing & balancing witness sheets, and system handover closeout.' },
  SafetyOfficer: { name: 'Site HSE & Safety Manager', icon: '', badge: 'badge-role-safety', cat: 'Health, Safety & Environment', scope: 'Assigned Projects', desc: 'HSE compliance, safety incident reporting, hazard mitigation, safety audits, and worker safety briefing tracking.' },
  Subcontractor: { name: 'Specialist Trade Subcontractor', icon: '', badge: 'badge-role-sub', cat: 'Trade Contractor', scope: 'Project & Trade Restricted', desc: 'Execute assigned trade tasks, report progress, submit floor plan snags, create material requests, and upload trade documents.' },
  Consultant: { name: 'Supervising MEP Consultant', icon: '', badge: 'badge-role-consultant', cat: 'Client & Design Oversight', scope: 'Assigned Projects (Witness/Review)', desc: 'Design compliance review, RFI responses, submittal approvals, inspection witness sign-off, and handover acceptance.' },
  Client: { name: 'Client / Project Owner', icon: '', badge: 'badge-role-client', cat: 'Client & Design Oversight', scope: 'Assigned Projects (Published Data Only)', desc: 'Curated project health, milestones, and only the documents and change orders explicitly published to the client.' }
};

let userAdminState = {
  tab: 'directory', // 'directory' | 'matrix'
  search: '',
  roleFilter: 'ALL',
  statusFilter: 'ALL',
  tradeFilter: 'ALL'
};

async function renderUsers(){
  if (ME.role !== 'Admin') {
    document.getElementById('viewContent').innerHTML = `
      <div class="panel">
        <h3><span>High-Level Administration</span></h3>
        <div class="api-banner show" style="border-left-color:#ef4444;background:rgba(239,68,68,0.08);color:var(--text);">
          <b>Access Restricted:</b> High-level user & role administration requires Executive Administrator authority. Your current role is <b>${escHtml(ME.role)}</b>.
        </div>
      </div>`;
    return;
  }

  let users = [];
  try {
    users = await apiFetch('/api/users');
  } catch (err) {
    console.error('Failed to fetch users', err);
  }

  // Filter users
  const q = (userAdminState.search || '').trim().toLowerCase();
  const filteredUsers = users.filter(u => {
    if (userAdminState.roleFilter !== 'ALL' && u.role !== userAdminState.roleFilter) return false;
    if (userAdminState.statusFilter !== 'ALL' && (u.status || 'Active') !== userAdminState.statusFilter) return false;
    if (userAdminState.tradeFilter !== 'ALL' && (u.trade || '') !== userAdminState.tradeFilter) return false;
    if (q) {
      const match = (u.name || '').toLowerCase().includes(q) ||
                    (u.username || '').toLowerCase().includes(q) ||
                    (u.email || '').toLowerCase().includes(q) ||
                    (u.company || '').toLowerCase().includes(q) ||
                    (u.trade || '').toLowerCase().includes(q) ||
                    (u.role || '').toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  // Calculate metrics
  const totalCount = users.length;
  const activeCount = users.filter(u => (u.status || 'Active') === 'Active').length;
  const rolesCount = new Set(users.map(u => u.role)).size;
  const totalMemberships = users.reduce((acc, u) => acc + (u.role === 'Admin' ? PROJECTS.length : (u.project_count || 0)), 0);

  // Available trades for filter
  const distinctTrades = [...new Set(users.map(u => u.trade).filter(Boolean))].sort();

  let html = `
    <!-- Top KPI Strip -->
    <div class="admin-kpi-grid">
      <div class="admin-kpi-card" style="--kpi-accent:#3b82f6;">
        <div class="admin-kpi-lbl">Total Registered Users</div>
        <div class="admin-kpi-val">${totalCount}</div>
        <div class="admin-kpi-sub">${activeCount} active • ${totalCount - activeCount} inactive accounts</div>
      </div>
      <div class="admin-kpi-card" style="--kpi-accent:#10b981;">
        <div class="admin-kpi-lbl">Account Status</div>
        <div class="admin-kpi-val">${Math.round((activeCount / (totalCount || 1)) * 100)}%</div>
        <div class="admin-kpi-sub">Active operational personnel</div>
      </div>
      <div class="admin-kpi-card" style="--kpi-accent:#a855f7;">
        <div class="admin-kpi-lbl">Enterprise Roles Active</div>
        <div class="admin-kpi-val">${rolesCount} / 8</div>
        <div class="admin-kpi-sub">Granular MEP security matrix</div>
      </div>
      <div class="admin-kpi-card" style="--kpi-accent:#f59e0b;">
        <div class="admin-kpi-lbl">Project Memberships</div>
        <div class="admin-kpi-val">${totalMemberships}</div>
        <div class="admin-kpi-sub">Across ${PROJECTS.length} active MEP projects</div>
      </div>
    </div>

    <div class="panel">
      <!-- Toolbar & Tabs -->
      <div class="admin-toolbar">
        <div class="admin-tabs">
          <button class="admin-tab-btn ${userAdminState.tab === 'directory' ? 'active' : ''}" id="tabUsersDir">👥 Personnel Directory (${filteredUsers.length})</button>
          <button class="admin-tab-btn ${userAdminState.tab === 'matrix' ? 'active' : ''}" id="tabRolesMatrix">Role & Permission Matrix</button>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <button class="btn accent small" id="addUserBtn">+ Add Enterprise User</button>
          <button class="btn ghost small" id="exportUsersBtn">Export CSV</button>
        </div>
      </div>
  `;

  if (userAdminState.tab === 'directory') {
    html += `
      <!-- Filters Bar -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:10px;margin-bottom:16px;background:var(--card-raised);padding:12px;border-radius:8px;border:1px solid var(--hairline);">
        <div>
          <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">Search Directory</label>
          <input id="userSearchInput" placeholder="Filter by name, username, email, company..." value="${escHtml(userAdminState.search)}" style="width:100%;font-size:12px;padding:6px 10px;">
        </div>
        <div>
          <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">Filter by Role</label>
          <select id="userRoleFilter" style="width:100%;font-size:12px;padding:6px 10px;">
            <option value="ALL" ${userAdminState.roleFilter==='ALL'?'selected':''}>All Roles (${users.length})</option>
            ${Object.entries(USER_ROLES_META).map(([key, meta]) => `
              <option value="${key}" ${userAdminState.roleFilter===key?'selected':''}>${meta.icon} ${meta.name}</option>
            `).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">Account Status</label>
          <select id="userStatusFilter" style="width:100%;font-size:12px;padding:6px 10px;">
            <option value="ALL" ${userAdminState.statusFilter==='ALL'?'selected':''}>All Statuses</option>
            <option value="Active" ${userAdminState.statusFilter==='Active'?'selected':''}>Active Accounts</option>
            <option value="Inactive" ${userAdminState.statusFilter==='Inactive'?'selected':''}>Inactive / Suspended</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">Trade / Discipline</label>
          <select id="userTradeFilter" style="width:100%;font-size:12px;padding:6px 10px;">
            <option value="ALL" ${userAdminState.tradeFilter==='ALL'?'selected':''}>All Trades</option>
            ${distinctTrades.map(t => `<option value="${escHtml(t)}" ${userAdminState.tradeFilter===t?'selected':''}>${escHtml(t)}</option>`).join('')}
          </select>
        </div>
      </div>

      <!-- Personnel Directory Table -->
      ${filteredUsers.length ? `
        <div style="overflow-x:auto;">
          <table>
            <thead>
              <tr>
                <th>Personnel</th>
                <th>Role & Scope</th>
                <th>Organization & Trade</th>
                <th>Contact</th>
                <th>Assigned Projects</th>
                <th>Status</th>
                <th style="text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${filteredUsers.map(user => {
                const meta = USER_ROLES_META[user.role] || { name: user.role, icon: '👤', badge: 'badge-role-sub' };
                const initials = (user.name || user.username || 'U').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
                const isActive = (user.status || 'Active') === 'Active';
                const isMe = user.id === ME.user_id;

                let projectBadgesHtml = '';
                if (user.role === 'Admin') {
                  projectBadgesHtml = `<span class="tag-project-all">Global (All Projects)</span>`;
                } else if (user.project_names) {
                  const names = user.project_names.split(', ');
                  projectBadgesHtml = names.map(n => `<span class="tag-project-pill">${escHtml(n)}</span>`).join('');
                } else {
                  projectBadgesHtml = `<span style="color:var(--muted);font-size:11px;">No projects assigned</span>`;
                }

                return `
                  <tr style="${!isActive ? 'opacity:0.6;' : ''}">
                    <td>
                      <div class="user-cell">
                        <div class="user-avatar">${escHtml(initials)}</div>
                        <div class="user-cell-meta">
                          <span class="user-cell-name">${escHtml(user.name)} ${isMe ? '<span style="color:var(--primary);font-size:10px;">(You)</span>' : ''}</span>
                          <span class="user-cell-user">@${escHtml(user.username)}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span class="badge-role ${meta.badge}">${meta.icon} ${escHtml(meta.name)}</span>
                    </td>
                    <td>
                      <div><b>${escHtml(user.company || '—')}</b></div>
                      <div style="font-size:11px;color:var(--muted);">${escHtml(user.trade || 'General MEP')}</div>
                    </td>
                    <td>
                      <div style="font-size:12px;">${user.email ? `<a href="mailto:${escHtml(user.email)}" style="color:var(--primary);text-decoration:none;">${escHtml(user.email)}</a>` : '<span style="color:var(--muted);">—</span>'}</div>
                      <div style="font-size:11px;color:var(--muted);">${user.phone ? escHtml(user.phone) : ''}</div>
                    </td>
                    <td>
                      <div style="max-width:240px;line-height:1.6;">${projectBadgesHtml}</div>
                    </td>
                    <td>
                      <span class="badge-status ${isActive ? 'active' : 'inactive'}">${isActive ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td class="row-actions" style="text-align:right;">
                      <button class="icon-btn edit" data-edit-user="${user.id}" title="Edit User & Roles">✎</button>
                      <button class="icon-btn" data-reset-pw="${user.id}" title="Reset Password" style="color:#f59e0b;">🔑</button>
                      ${!isMe ? `
                        <button class="icon-btn" data-toggle-status="${user.id}" title="${isActive ? 'Deactivate user' : 'Activate user'}" style="color:${isActive ? '#94a3b8' : '#10b981'};">
                          ${isActive ? '⏸' : '▶'}
                        </button>
                        <button class="icon-btn" data-delete-user="${user.id}" title="Delete user" style="color:#ef4444;">✕</button>
                      ` : ''}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      ` : `
        <div class="empty">No personnel match your search criteria. <a href="#" id="clearFiltersBtn" style="color:var(--primary);">Clear filters</a></div>
      `}
    `;
  } else {
    // Role & Permission Matrix View
    html += renderRoleMatrixContent(users);
  }

  html += `</div>`;
  document.getElementById('viewContent').innerHTML = html;

  // Event handlers
  document.getElementById('tabUsersDir').onclick = () => { userAdminState.tab = 'directory'; renderUsers(); };
  document.getElementById('tabRolesMatrix').onclick = () => { userAdminState.tab = 'matrix'; renderUsers(); };
  document.getElementById('addUserBtn').onclick = () => openUserModal(null);
  document.getElementById('exportUsersBtn').onclick = () => exportUsersCsv(users);

  if (userAdminState.tab === 'directory') {
    const searchInput = document.getElementById('userSearchInput');
    if (searchInput) {
      searchInput.oninput = (e) => {
        userAdminState.search = e.target.value;
        // debounce slightly
        clearTimeout(window._userSearchTimeout);
        window._userSearchTimeout = setTimeout(renderUsers, 250);
      };
    }
    const roleFilter = document.getElementById('userRoleFilter');
    if (roleFilter) roleFilter.onchange = (e) => { userAdminState.roleFilter = e.target.value; renderUsers(); };
    const statusFilter = document.getElementById('userStatusFilter');
    if (statusFilter) statusFilter.onchange = (e) => { userAdminState.statusFilter = e.target.value; renderUsers(); };
    const tradeFilter = document.getElementById('userTradeFilter');
    if (tradeFilter) tradeFilter.onchange = (e) => { userAdminState.tradeFilter = e.target.value; renderUsers(); };
    const clearFiltersBtn = document.getElementById('clearFiltersBtn');
    if (clearFiltersBtn) {
      clearFiltersBtn.onclick = (e) => {
        e.preventDefault();
        userAdminState.search = '';
        userAdminState.roleFilter = 'ALL';
        userAdminState.statusFilter = 'ALL';
        userAdminState.tradeFilter = 'ALL';
        renderUsers();
      };
    }

    // Row Actions
    document.querySelectorAll('[data-edit-user]').forEach(btn => {
      btn.onclick = () => {
        const u = users.find(x => x.id === btn.dataset.editUser);
        if (u) openUserModal(u);
      };
    });

    document.querySelectorAll('[data-reset-pw]').forEach(btn => {
      btn.onclick = () => {
        const u = users.find(x => x.id === btn.dataset.resetPw);
        if (u) openResetPasswordModal(u);
      };
    });

    document.querySelectorAll('[data-toggle-status]').forEach(btn => {
      btn.onclick = async () => {
        const u = users.find(x => x.id === btn.dataset.toggleStatus);
        if (!u) return;
        const willDeactivate = (u.status || 'Active') === 'Active';
        if (!confirm(`${willDeactivate ? 'Deactivate' : 'Activate'} account for "${u.name}" (@${u.username})?`)) return;
        try {
          await apiFetch(`/api/users/${u.id}/toggle-status`, { method: 'POST' });
          renderUsers();
        } catch (err) {
          alert('Error toggling status: ' + err.message);
        }
      };
    });

    document.querySelectorAll('[data-delete-user]').forEach(btn => {
      btn.onclick = async () => {
        const u = users.find(x => x.id === btn.dataset.deleteUser);
        if (!u) return;
        if (!confirm(`Are you sure you want to permanently delete user "${u.name}" (@${u.username})?\n\nThis will remove their project access, audit records, and login sessions.`)) return;
        try {
          await apiFetch(`/api/users/${u.id}`, { method: 'DELETE' });
          renderUsers();
        } catch (err) {
          alert('Error deleting user: ' + err.message);
        }
      };
    });
  }
}

function renderRoleMatrixContent(users) {
  const roleCounts = {};
  for (const u of users) {
    roleCounts[u.role] = (roleCounts[u.role] || 0) + 1;
  }

  const MATRIX_MODULES = [
    { cat: 'Governance', name: 'Projects Setup & Metadata', key: 'projects', levels: { Admin: 'full', ProjectManager: 'edit', SiteEngineer: 'view', CommercialManager: 'view', QAQC: 'view', SafetyOfficer: 'view', Subcontractor: 'none', Consultant: 'view' } },
    { cat: 'Governance', name: 'High-Level Users & Roles Administration', key: 'users', levels: { Admin: 'full', ProjectManager: 'none', SiteEngineer: 'none', CommercialManager: 'none', QAQC: 'none', SafetyOfficer: 'none', Subcontractor: 'none', Consultant: 'none' } },
    { cat: 'Governance', name: 'Audit Trail Logs', key: 'audit', levels: { Admin: 'full', ProjectManager: 'view', SiteEngineer: 'none', CommercialManager: 'view', QAQC: 'view', SafetyOfficer: 'view', Subcontractor: 'none', Consultant: 'view' } },
    { cat: 'Planning', name: 'Tasks & WBS Management', key: 'tasks', levels: { Admin: 'full', ProjectManager: 'edit', SiteEngineer: 'edit', CommercialManager: 'view', QAQC: 'view', SafetyOfficer: 'view', Subcontractor: 'edit', Consultant: 'view' } },
    { cat: 'Planning', name: 'Gantt Programme & Schedule', key: 'gantt', levels: { Admin: 'full', ProjectManager: 'edit', SiteEngineer: 'view', CommercialManager: 'view', QAQC: 'view', SafetyOfficer: 'view', Subcontractor: 'view', Consultant: 'view' } },
    { cat: 'Design & Field', name: 'Drawings & PDF Hand Markup Studio', key: 'drawings', levels: { Admin: 'full', ProjectManager: 'edit', SiteEngineer: 'edit', CommercialManager: 'view', QAQC: 'edit', SafetyOfficer: 'view', Subcontractor: 'view', Consultant: 'view' } },
    { cat: 'Design & Field', name: 'RFIs (Technical Inquiries)', key: 'rfis', levels: { Admin: 'full', ProjectManager: 'edit', SiteEngineer: 'edit', CommercialManager: 'view', QAQC: 'edit', SafetyOfficer: 'view', Subcontractor: 'edit', Consultant: 'edit' } },
    { cat: 'Design & Field', name: 'Submittals & Approvals', key: 'submittals', levels: { Admin: 'full', ProjectManager: 'edit', SiteEngineer: 'edit', CommercialManager: 'view', QAQC: 'edit', SafetyOfficer: 'view', Subcontractor: 'edit', Consultant: 'edit' } },
    { cat: 'Design & Field', name: 'Floor Plan Snags & Punch List', key: 'punchlist', levels: { Admin: 'full', ProjectManager: 'edit', SiteEngineer: 'edit', CommercialManager: 'view', QAQC: 'edit', SafetyOfficer: 'edit', Subcontractor: 'edit', Consultant: 'view' } },
    { cat: 'Commercial', name: 'BOQ & Budget Management', key: 'boq', levels: { Admin: 'full', ProjectManager: 'edit', SiteEngineer: 'none', CommercialManager: 'edit', QAQC: 'none', SafetyOfficer: 'none', Subcontractor: 'none', Consultant: 'view' } },
    { cat: 'Commercial', name: 'Cost Valuations & Earned Value', key: 'valuations', levels: { Admin: 'full', ProjectManager: 'edit', SiteEngineer: 'none', CommercialManager: 'edit', QAQC: 'none', SafetyOfficer: 'none', Subcontractor: 'none', Consultant: 'view' } },
    { cat: 'Commercial', name: 'Change Orders & Variations', key: 'change_orders', levels: { Admin: 'full', ProjectManager: 'edit', SiteEngineer: 'view', CommercialManager: 'edit', QAQC: 'view', SafetyOfficer: 'none', Subcontractor: 'none', Consultant: 'view' } },
    { cat: 'Commercial', name: 'Purchase Orders & Requisitions', key: 'purchase_orders', levels: { Admin: 'full', ProjectManager: 'edit', SiteEngineer: 'view', CommercialManager: 'edit', QAQC: 'none', SafetyOfficer: 'none', Subcontractor: 'none', Consultant: 'none' } },
    { cat: 'Site Operations', name: 'Site Daily Logs & Weather', key: 'daily_logs', levels: { Admin: 'full', ProjectManager: 'edit', SiteEngineer: 'edit', CommercialManager: 'view', QAQC: 'view', SafetyOfficer: 'edit', Subcontractor: 'edit', Consultant: 'view' } },
    { cat: 'Quality & Safety', name: 'Site Inspections', key: 'inspections', levels: { Admin: 'full', ProjectManager: 'edit', SiteEngineer: 'edit', CommercialManager: 'view', QAQC: 'edit', SafetyOfficer: 'edit', Subcontractor: 'view', Consultant: 'edit' } },
    { cat: 'Quality & Safety', name: 'NCRs (Non-Conformance Reports)', key: 'ncrs', levels: { Admin: 'full', ProjectManager: 'edit', SiteEngineer: 'edit', CommercialManager: 'view', QAQC: 'edit', SafetyOfficer: 'edit', Subcontractor: 'view', Consultant: 'edit' } },
    { cat: 'Quality & Safety', name: 'Safety & HSE Incident Tracking', key: 'safety_incidents', levels: { Admin: 'full', ProjectManager: 'edit', SiteEngineer: 'edit', CommercialManager: 'none', QAQC: 'view', SafetyOfficer: 'edit', Subcontractor: 'edit', Consultant: 'view' } },
    { cat: 'Closeout', name: 'Commissioning & Witness Tests', key: 'commissioning', levels: { Admin: 'full', ProjectManager: 'edit', SiteEngineer: 'edit', CommercialManager: 'none', QAQC: 'edit', SafetyOfficer: 'none', Subcontractor: 'view', Consultant: 'edit' } },
    { cat: 'Closeout', name: 'Handover & O&M Manuals', key: 'handover', levels: { Admin: 'full', ProjectManager: 'edit', SiteEngineer: 'edit', CommercialManager: 'view', QAQC: 'edit', SafetyOfficer: 'none', Subcontractor: 'view', Consultant: 'edit' } },
    { cat: 'Site Operations', name: 'Worker Attendance & Timesheets', key: 'timesheets', levels: { Admin: 'full', ProjectManager: 'edit', SiteEngineer: 'edit', CommercialManager: 'view', QAQC: 'none', SafetyOfficer: 'view', Subcontractor: 'edit', Consultant: 'none' } },
    { cat: 'Site Operations', name: 'Equipment & Tool Tracking', key: 'equipment', levels: { Admin: 'full', ProjectManager: 'edit', SiteEngineer: 'edit', CommercialManager: 'view', QAQC: 'view', SafetyOfficer: 'view', Subcontractor: 'view', Consultant: 'none' } }
  ];

  return `
    <div style="margin-bottom:16px;">
      <h4 style="margin:0 0 6px;color:var(--text);font-size:14px;">Enterprise Roles & Authority Hierarchy</h4>
      <p style="margin:0;font-size:12px;color:var(--muted);">All 8 roles enforce strict Role-Based Access Control (RBAC) across data querying, modification, and project scoping.</p>
    </div>

    <!-- Role Cards Grid -->
    <div class="role-cards-grid">
      ${Object.entries(USER_ROLES_META).map(([key, meta]) => `
        <div class="role-card">
          <div>
            <div class="role-card-header">
              <div>
                <span class="role-card-cat">${escHtml(meta.cat)}</span>
                <h5 class="role-card-title">${meta.icon} ${escHtml(meta.name)}</h5>
              </div>
              <span class="badge-role ${meta.badge}">${roleCounts[key] || 0} users</span>
            </div>
            <p class="role-card-desc">${escHtml(meta.desc)}</p>
          </div>
          <div class="role-card-scope">
            Scope: <b>${escHtml(meta.scope)}</b>
          </div>
        </div>
      `).join('')}
    </div>

    <!-- Comprehensive Permission Matrix Table -->
    <div style="margin-top:24px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <h4 style="margin:0;color:var(--text);font-size:14px;">Detailed Capability & Permission Matrix</h4>
        <div style="display:flex;gap:12px;font-size:11px;">
          <span style="display:inline-flex;align-items:center;gap:4px;"><span class="perm-chip full">Admin</span> Full CRUD + System</span>
          <span style="display:inline-flex;align-items:center;gap:4px;"><span class="perm-chip edit">Edit</span> Create & Edit</span>
          <span style="display:inline-flex;align-items:center;gap:4px;"><span class="perm-chip view">View</span> Read-only</span>
          <span style="display:inline-flex;align-items:center;gap:4px;"><span class="perm-chip none">—</span> Restricted</span>
        </div>
      </div>

      <div style="overflow-x:auto;">
        <table class="role-matrix-table">
          <thead>
            <tr>
              <th style="min-width:180px;">MEP Module</th>
              <th style="min-width:110px;">Category</th>
              <th style="text-align:center;">Admin</th>
              <th style="text-align:center;">Project Manager</th>
              <th style="text-align:center;">Site Engineer</th>
              <th style="text-align:center;">Commercial Lead</th>
              <th style="text-align:center;">QA/QC Lead</th>
              <th style="text-align:center;">Safety Officer</th>
              <th style="text-align:center;">Subcontractor</th>
              <th style="text-align:center;">Consultant</th>
            </tr>
          </thead>
          <tbody>
            ${MATRIX_MODULES.map(m => `
              <tr>
                <td><b>${escHtml(m.name)}</b></td>
                <td><span style="font-size:11px;color:var(--muted);">${escHtml(m.cat)}</span></td>
                <td class="center"><span class="perm-chip ${m.levels.Admin}">${permLabel(m.levels.Admin)}</span></td>
                <td class="center"><span class="perm-chip ${m.levels.ProjectManager}">${permLabel(m.levels.ProjectManager)}</span></td>
                <td class="center"><span class="perm-chip ${m.levels.SiteEngineer}">${permLabel(m.levels.SiteEngineer)}</span></td>
                <td class="center"><span class="perm-chip ${m.levels.CommercialManager}">${permLabel(m.levels.CommercialManager)}</span></td>
                <td class="center"><span class="perm-chip ${m.levels.QAQC}">${permLabel(m.levels.QAQC)}</span></td>
                <td class="center"><span class="perm-chip ${m.levels.SafetyOfficer}">${permLabel(m.levels.SafetyOfficer)}</span></td>
                <td class="center"><span class="perm-chip ${m.levels.Subcontractor}">${permLabel(m.levels.Subcontractor)}</span></td>
                <td class="center"><span class="perm-chip ${m.levels.Consultant}">${permLabel(m.levels.Consultant)}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function permLabel(level) {
  if (level === 'full') return 'FULL';
  if (level === 'edit') return 'EDIT';
  if (level === 'view') return 'VIEW';
  return '—';
}

async function openUserModal(user){
  const isEdit = !!user;
  let assigned = [];
  if (isEdit) {
    try {
      const userProjects = await apiFetch(`/api/users/${user.id}/projects`);
      assigned = userProjects.filter(p => p.active === 1 || p.active === true).map(p => p.id);
    } catch(e) { console.error(e); }
  } else if (currentProjectId !== 'ALL') {
    assigned = [currentProjectId];
  } else {
    assigned = PROJECTS.map(p => p.id);
  }

  const currentRole = user ? user.role : 'SiteEngineer';
  const currentStatus = user ? (user.status || 'Active') : 'Active';

  const projectChoices = PROJECTS.map(project => `
    <label style="display:flex;gap:10px;align-items:center;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.05);font-size:12px;cursor:pointer;">
      <input type="checkbox" class="user-project-cb" value="${project.id}" ${assigned.includes(project.id) ? 'checked' : ''}>
      <span style="flex:1;"><b>${escHtml(project.name)}</b> <span style="font-size:11px;color:var(--muted);">(${escHtml(project.client || 'Client')})</span></span>
      <span class="badge ${badgeClass(project.status)}">${escHtml(project.status)}</span>
    </label>
  `).join('');

  const html = `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <!-- Section 1: Identity & Credentials -->
      <div style="background:var(--card-raised);border:1px solid var(--hairline);border-radius:10px;padding:14px;">
        <h4 style="margin:0 0 10px;color:var(--primary);font-size:13px;display:flex;align-items:center;gap:6px;">
          👤 Personal Identity & Credentials
        </h4>
        <div class="form-grid" style="margin-bottom:0;">
          <div>
            <label>Full Name *</label>
            <input id="f_user_name" value="${isEdit ? escHtml(user.name) : ''}" placeholder="e.g. Mark Farrugia" required>
          </div>
          <div>
            <label>Username *</label>
            <input id="f_user_username" value="${isEdit ? escHtml(user.username) : ''}" placeholder="e.g. mark_mep" ${isEdit ? 'disabled style="opacity:0.6;"' : 'required'}>
          </div>
          <div>
            <label>Email Address</label>
            <input id="f_user_email" type="email" value="${isEdit && user.email ? escHtml(user.email) : ''}" placeholder="e.g. name@company.com">
          </div>
          <div>
            <label>Contact Phone</label>
            <input id="f_user_phone" value="${isEdit && user.phone ? escHtml(user.phone) : ''}" placeholder="e.g. +356 7912 3456">
          </div>
        </div>
      </div>

      <!-- Section 2: Organization & Trade -->
      <div style="background:var(--card-raised);border:1px solid var(--hairline);border-radius:10px;padding:14px;">
        <h4 style="margin:0 0 10px;color:var(--primary);font-size:13px;display:flex;align-items:center;gap:6px;">
          Organization & Discipline Specialization
        </h4>
        <div class="form-grid" style="margin-bottom:0;">
          <div>
            <label>Company / Contractor Name</label>
            <input id="f_user_company" value="${isEdit && user.company ? escHtml(user.company) : ''}" placeholder="e.g. Acme MEP Contractors">
          </div>
          <div>
            <label>Trade Specialization</label>
            <select id="f_user_trade">
              ${['General MEP', 'HVAC', 'Electrical', 'Plumbing', 'Fire Protection', 'BMS / Controls', 'Commercial', 'Quality & Commissioning', 'Health & Safety'].map(t => `
                <option value="${t}" ${isEdit && user.trade === t ? 'selected' : ''}>${t}</option>
              `).join('')}
            </select>
          </div>
          <div>
            <label>Account Status</label>
            <select id="f_user_status">
              <option value="Active" ${currentStatus === 'Active' ? 'selected' : ''}>Active (Can Sign In)</option>
              <option value="Inactive" ${currentStatus === 'Inactive' ? 'selected' : ''}>Inactive / Suspended</option>
            </select>
          </div>
          <div>
            <label>${isEdit ? 'Reset Password (optional)' : 'Initial Password *'}</label>
            <div style="display:flex;gap:6px;">
              <input id="f_user_password" type="text" placeholder="${isEdit ? 'Leave blank to keep current' : 'Min 6 characters'}" style="flex:1;">
              <button type="button" class="btn ghost small" id="btnGenPassword" title="Generate secure random password" style="white-space:nowrap;">Gen</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Section 3: High-Level Role Assignment -->
      <div style="background:var(--card-raised);border:1px solid var(--hairline);border-radius:10px;padding:14px;">
        <h4 style="margin:0 0 8px;color:var(--primary);font-size:13px;display:flex;align-items:center;gap:6px;">
          Enterprise Role & Authority Scope
        </h4>
        <div>
          <label>Assigned System Role</label>
          <select id="f_user_role" style="width:100%;padding:8px 12px;font-size:13px;background:var(--card-raised);border:1px solid var(--border);color:var(--text);border-radius:6px;">
            ${Object.entries(USER_ROLES_META).map(([key, meta]) => `
              <option value="${key}" ${currentRole === key ? 'selected' : ''}>${meta.icon} ${meta.name} (${meta.cat})</option>
            `).join('')}
          </select>
        </div>
        <div id="roleDescBox" style="margin-top:10px;padding:10px 12px;background:rgba(111,211,193,0.06);border:1px solid rgba(111,211,193,0.2);border-radius:8px;font-size:12px;color:var(--text);">
          <!-- dynamically updated -->
        </div>
      </div>

      <!-- Section 4: Project Access -->
      <div style="background:var(--card-raised);border:1px solid var(--hairline);border-radius:10px;padding:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <h4 style="margin:0;color:var(--primary);font-size:13px;display:flex;align-items:center;gap:6px;">
            Project Scope Access
          </h4>
          <div style="display:flex;gap:6px;" id="projectQuickButtons">
            <button type="button" class="btn ghost small" id="btnSelectAllProjects" style="font-size:11px;padding:3px 8px;">Select All</button>
            <button type="button" class="btn ghost small" id="btnClearAllProjects" style="font-size:11px;padding:3px 8px;">Clear All</button>
          </div>
        </div>
        <div id="adminProjectNotice" style="display:none;padding:8px 12px;background:rgba(168,85,247,0.12);border:1px solid rgba(168,85,247,0.3);border-radius:6px;font-size:12px;color:#c084fc;margin-bottom:8px;">
          <b>Executive Administrator:</b> Automatically granted unrestricted access to all current and future projects.
        </div>
        <div id="projectChoicesContainer" style="max-height:160px;overflow-y:auto;background:var(--card-raised);border:1px solid var(--border);border-radius:6px;padding:4px;">
          ${projectChoices || '<div class="empty">No projects found.</div>'}
        </div>
      </div>
    </div>
  `;

  openModal(isEdit ? `Edit User: ${user.name}` : '+ Add Enterprise User', html, async () => {
    const name = document.getElementById('f_user_name').value.trim();
    const username = document.getElementById('f_user_username').value.trim();
    const email = document.getElementById('f_user_email').value.trim();
    const phone = document.getElementById('f_user_phone').value.trim();
    const company = document.getElementById('f_user_company').value.trim();
    const trade = document.getElementById('f_user_trade').value;
    const status = document.getElementById('f_user_status').value;
    const role = document.getElementById('f_user_role').value;
    const password = document.getElementById('f_user_password').value.trim();

    if (!name) throw new Error('Full Name is required');
    if (!isEdit && !username) throw new Error('Username is required');
    if (!isEdit && !password) throw new Error('Password is required for new users');

    const project_ids = role === 'Admin' ? ['ALL'] : [...document.querySelectorAll('.user-project-cb:checked')].map(cb => cb.value);

    const payload = {
      name,
      email,
      phone,
      company,
      trade,
      status,
      role,
      project_ids
    };
    if (password) payload.password = password;

    if (isEdit) {
      await apiFetch(`/api/users/${user.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      payload.username = username;
      await apiFetch('/api/users', { method: 'POST', body: JSON.stringify(payload) });
    }

    renderUsers();
  });

  // Modal Interactive Helpers
  const roleSelect = document.getElementById('f_user_role');
  const roleDescBox = document.getElementById('roleDescBox');
  const adminNotice = document.getElementById('adminProjectNotice');
  const projContainer = document.getElementById('projectChoicesContainer');
  const projQuickBtns = document.getElementById('projectQuickButtons');

  function updateRoleHelp() {
    const r = roleSelect.value;
    const meta = USER_ROLES_META[r] || {};
    roleDescBox.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <span class="badge-role ${meta.badge}">${meta.icon} ${meta.name}</span>
        <span style="color:var(--muted);font-size:11px;">${meta.scope}</span>
      </div>
      <div style="color:var(--text);">${meta.desc}</div>
    `;
    if (r === 'Admin') {
      adminNotice.style.display = 'block';
      projContainer.style.opacity = '0.5';
      projContainer.style.pointerEvents = 'none';
      projQuickBtns.style.display = 'none';
    } else {
      adminNotice.style.display = 'none';
      projContainer.style.opacity = '1';
      projContainer.style.pointerEvents = 'auto';
      projQuickBtns.style.display = 'flex';
    }
  }

  roleSelect.onchange = updateRoleHelp;
  updateRoleHelp();

  document.getElementById('btnGenPassword').onclick = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!#$*';
    let pw = 'Mep';
    for (let i = 0; i < 7; i++) pw += chars.charAt(Math.floor(Math.random() * chars.length));
    document.getElementById('f_user_password').value = pw;
  };

  document.getElementById('btnSelectAllProjects').onclick = () => {
    document.querySelectorAll('.user-project-cb').forEach(cb => cb.checked = true);
  };
  document.getElementById('btnClearAllProjects').onclick = () => {
    document.querySelectorAll('.user-project-cb').forEach(cb => cb.checked = false);
  };
}

function openResetPasswordModal(user) {
  const html = `
    <div style="padding:10px 0;">
      <p style="font-size:13px;color:var(--text);margin-top:0;">
        Reset password for <b>${escHtml(user.name)}</b> (@${escHtml(user.username)}):
      </p>
      <div style="display:flex;gap:8px;align-items:center;">
        <input id="f_reset_pw_val" type="text" placeholder="Enter new password" style="flex:1;" value="MepPass#2026">
        <button type="button" class="btn ghost small" id="btnGenResetPw">Gen</button>
      </div>
    </div>
  `;
  openModal(`Reset Password: @${user.username}`, html, async () => {
    const pw = document.getElementById('f_reset_pw_val').value.trim();
    if (!pw) throw new Error('Password cannot be empty');
    await apiFetch(`/api/users/${user.id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ new_password: pw })
    });
    alert(`Password reset successfully for @${user.username}.`);
  });

  document.getElementById('btnGenResetPw').onclick = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!#$*';
    let pw = '';
    for (let i = 0; i < 12; i++) pw += chars.charAt(Math.floor(Math.random() * chars.length));
    document.getElementById('f_reset_pw_val').value = pw;
  };
}

function exportUsersCsv(users) {
  const headers = ['Name', 'Username', 'Role', 'Email', 'Phone', 'Company', 'Trade', 'Status', 'Assigned Projects'];
  const rows = users.map(u => [
    `"${(u.name || '').replace(/"/g, '""')}"`,
    `"${(u.username || '').replace(/"/g, '""')}"`,
    `"${(u.role || '').replace(/"/g, '""')}"`,
    `"${(u.email || '').replace(/"/g, '""')}"`,
    `"${(u.phone || '').replace(/"/g, '""')}"`,
    `"${(u.company || '').replace(/"/g, '""')}"`,
    `"${(u.trade || '').replace(/"/g, '""')}"`,
    `"${(u.status || 'Active').replace(/"/g, '""')}"`,
    `"${(u.role === 'Admin' ? 'All Projects' : (u.project_names || '')).replace(/"/g, '""')}"`
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `MEP_Users_Directory_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

async function renderAudit(){
  const rows = await apiFetch(`/api/audit?project_id=${currentProjectId}`);
  document.getElementById('viewContent').innerHTML = `<div class="panel"><h3><span>Audit Trail</span><span style="font-size:11px;color:var(--muted);">${rows.length} recent events</span></h3>${rows.length?`<table><thead><tr><th>When</th><th>User</th><th>Module</th><th>Action</th><th>Record</th><th>Project</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${escHtml(row.created_at)}</td><td>${escHtml(row.user_name||row.user_id)}</td><td>${escHtml(row.module)}</td><td><span class="badge ${badgeClass(row.action)}">${escHtml(row.action)}</span></td><td>${escHtml(row.record_id)}</td><td>${escHtml(row.project_id)}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">No audit events found for this scope.</div>'}</div>`;
}

function statusSlug(status){
  const s=(status||'').toLowerCase();
  if(s.includes('completed')) return 'completed';
  if(s.includes('progress')) return 'inprogress';
  if(s.includes('delayed')) return 'delayed';
  return 'notstarted';
}

async function renderGantt(){
  const rows = await apiFetch(`/api/tasks?project_id=${currentProjectId}`);
  const withDates = rows.filter(r=>r.start && r.end);
  if(!withDates.length){
    document.getElementById('viewContent').innerHTML = '<div class="panel"><div class="empty">No tasks with start/end dates yet.</div></div>';
    return;
  }
  const starts = withDates.map(r=>new Date(r.start).getTime());
  const ends = withDates.map(r=>new Date(r.end).getTime());
  const minT = Math.min(...starts);
  const maxT = Math.max(...ends);
  const span = Math.max(maxT - minT, 1);
  const fmtShort = (t)=> new Date(t).toLocaleDateString(undefined, {month:'short', day:'numeric'});
  
  // Sort by WBS if available, otherwise by start date
  withDates.sort((a, b) => {
    if (a.wbs_code && b.wbs_code) return a.wbs_code.localeCompare(b.wbs_code, undefined, {numeric: true});
    return new Date(a.start) - new Date(b.start);
  });

  document.getElementById('viewContent').innerHTML = `
  <div class="panel">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
      <h3 style="margin-bottom:0;">Project Planning & Gantt Chart</h3>
      <div style="font-size:11px;color:var(--muted);">
        <span style="display:inline-block;width:10px;height:10px;background:var(--secondary);margin-right:4px;"></span> Summary
        <span style="display:inline-block;width:10px;height:10px;background:var(--accent);margin-left:12px;margin-right:4px;transform:rotate(45deg);"></span> Milestone
      </div>
    </div>
    <div class="gantt-scale"><div></div><div class="lbl"><span>${fmtShort(minT)}</span><span>${fmtShort(maxT)}</span></div></div>
    <div style="max-height:600px;overflow-y:auto;border-top:1px solid var(--border);">
    ${withDates.map(r=>{
      const s = new Date(r.start).getTime(), e = new Date(r.end).getTime();
      const left = ((s - minT) / span) * 100;
      const width = Math.max(((e - s) / span) * 100, 1.5);
      const isSum = r.is_summary === 1;
      const isMilestone = r.is_milestone === 1;
      const rowClass = isSum ? 'is-summary' : (isMilestone ? 'is-milestone' : '');
      
      return `<div class="gantt-row ${rowClass}">
        <div class="gantt-label" title="${escHtml(r.title)}">
          ${r.wbs_code ? `<span class="wbs">${escHtml(r.wbs_code)}</span>` : ''}
          <div style="overflow:hidden;text-overflow:ellipsis;">
            ${escHtml(r.title)}
            ${!isSum ? `<span class="sub">${escHtml(r.trade)} · ${escHtml(r.assignee||'')}</span>` : ''}
          </div>
        </div>
        <div class="gantt-track">
          <div class="gantt-bar status-${statusSlug(r.status)}" style="left:${left}%;width:${width}%;" 
               title="${escHtml(r.status)} — ${r.progress||0}% | ${r.start} to ${r.end}">
            ${!isSum && !isMilestone && width > 5 ? `${r.progress||0}%` : ''}
          </div>
        </div>
      </div>`;
    }).join('')}
    </div>
  </div>`;
}


/* ==========================================================================
   BUILDERTREND OPERATIONAL UX UPGRADES (RIBBON, 4-VIEW SCHEDULE, JOB COSTING, DAILY LOGS)
   ========================================================================== */
