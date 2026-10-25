window.MEP_API_URL = window.MEP_API_URL || '';
const TRADES = ['HVAC','Electrical','Plumbing','Fire Protection','BMS/Controls','Other'];
const DEFAULT_API = window.MEP_API_URL || (window.location.protocol === 'file:' ? 'http://localhost:3000' : window.location.origin);
document.getElementById('apiUrl').value = DEFAULT_API;
let API = '';
let TOKEN = localStorage.getItem('mep_token') || '';
let ME = null;
let currentProjectId = 'ALL';
let currentView = 'dashboard';
let PROJECTS = [];
const MODULE_PERMS = {wbs_items:'wbs', procurement_items:'procurement', material_requests:'material_requests', boq_items:'budget', commissioning_tests:'commissioning', handover_items:'handover'};
const WORKFLOW_NEXT = {
  submittals:{'Draft':'Submitted','Submitted':'Under Review','Under Review':'Approved','Approved':'Closed'},
  change_orders:{'Potential Variation':'Under Preparation','Under Preparation':'Submitted','Submitted':'Technical Review','Technical Review':'Commercial Review','Commercial Review':'Approved','Approved':'PO Pending','PO Pending':'PO Issued','PO Issued':'Work In Progress','Work In Progress':'Work Complete','Work Complete':'Claimed','Claimed':'Certified','Certified':'Paid','Paid':'Closed'},
  procurement_items:{'Not Requested':'RFQ','RFQ':'Quotation Received','Quotation Received':'Under Review','Under Review':'Approved','Approved':'PO Pending','PO Pending':'Ordered','Ordered':'Manufacturing','Manufacturing':'Ready for Dispatch','Ready for Dispatch':'In Transit','In Transit':'Delivered','Delivered':'Installed'},
  ncrs:{'Open':'Under Investigation','Under Investigation':'Corrective Action','Corrective Action':'Verification','Verification':'Closed'},
  punchlist:{'Open':'In Progress','In Progress':'Resolved','Resolved':'Closed'},
  commissioning_tests:{'Planned':'Ready for Commissioning','Ready for Commissioning':'Testing','Testing':'Passed','Passed':'Accepted','Accepted':'Closed'},
  handover_items:{'Required':'Submitted','Submitted':'Under Review','Under Review':'Approved','Approved':'Closed'}
};

async function apiFetch(path, opts={}){
  opts.headers = Object.assign({'Content-Type':'application/json'}, opts.headers||{});
  if(TOKEN) opts.headers['Authorization'] = 'Bearer '+TOKEN;
  const res = await fetch(API+path, opts);
  if(res.status===401){ doLogout(); throw new Error('Unauthorized'); }
  if(!res.ok){ const e = await res.json().catch(()=>({error:res.statusText})); throw new Error(e.error||'Request failed'); }
  return res.status===204 ? null : res.json();
}

function showForcedPasswordChange(){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay show';
  overlay.id = 'forcedPwOverlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Set a new password</h3>
      <p style="font-size:12px;color:var(--muted);margin:0 0 12px;">You're signing in with a temporary password. Choose a new one to continue - this only takes a moment.</p>
      <div class="form-grid">
        <div class="full"><label>Current (temporary) password</label><input type="password" id="f_force_current"></div>
        <div class="full"><label>New password (min. 8 characters)</label><input type="password" id="f_force_new"></div>
        <div class="full"><label>Confirm new password</label><input type="password" id="f_force_confirm"></div>
      </div>
      <div id="forcedPwError" style="display:none;color:var(--danger);font-size:12px;margin-top:8px;"></div>
      <div class="modal-actions"><button class="btn small" id="forcedPwSubmit">Set password</button></div>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById('forcedPwSubmit').onclick = async () => {
    const current_password = document.getElementById('f_force_current').value;
    const new_password = document.getElementById('f_force_new').value;
    const confirm = document.getElementById('f_force_confirm').value;
    const errBox = document.getElementById('forcedPwError');
    errBox.style.display = 'none';
    if(new_password.length < 8){ errBox.textContent = 'New password must be at least 8 characters.'; errBox.style.display='block'; return; }
    if(new_password !== confirm){ errBox.textContent = 'New password and confirmation do not match.'; errBox.style.display='block'; return; }
    try{
      await apiFetch('/api/me/password', {method:'PUT', body: JSON.stringify({current_password, new_password})});
      ME.must_change_password = false;
      overlay.remove();
    }catch(err){
      errBox.textContent = err.message;
      errBox.style.display = 'block';
    }
  };
}

document.getElementById('loginBtn').addEventListener('click', async ()=>{
  API = (document.getElementById('apiUrl').value.trim() || DEFAULT_API).replace(/\/$/,'');
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  document.getElementById('loginError').style.display = 'none';
  try{
    let res;
    try {
      res = await fetch(API+'/api/login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username, password})});
    } catch (netErr) {
      API = 'http://localhost:3000';
      document.getElementById('apiUrl').value = API;
      res = await fetch(API+'/api/login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username, password})});
    }
    if(!res.ok){
      const errBody = await res.json().catch(()=>({}));
      throw new Error(errBody.error || 'Login failed');
    }
    const data = await res.json();
    TOKEN = data.token; ME = data;
    if(ME.role === 'Client') currentView = 'client_dashboard';
    localStorage.setItem('mep_token', TOKEN);
    localStorage.setItem('mep_api', API);
    document.getElementById('loginScreen').classList.add('hide');
    document.getElementById('app').classList.add('show');
    document.getElementById('chipName').textContent = ME.name;
    document.getElementById('chipRole').textContent = ME.role;
    if(ME.role === 'Client') document.getElementById('viewTitle').textContent = 'Client Portal';
    buildNav();
    await loadProjectsAndRender();
    if(ME.must_change_password){
      showForcedPasswordChange();
    }
    startNotificationPolling();
  }catch(err){
    const errEl = document.getElementById('loginError');
    errEl.textContent = (err && err.message && err.message !== 'Failed to fetch')
      ? err.message
      : 'Could not reach the API server at ' + API + '. Open http://localhost:3000 in your browser.';
    errEl.style.display = 'block';
  }
});
document.getElementById('loginPassword').addEventListener('keydown', (e)=>{ if(e.key==='Enter') document.getElementById('loginBtn').click(); });

function doLogout(){
  localStorage.removeItem('mep_token');
  TOKEN=''; ME=null;
  if(notifPollInterval){ clearInterval(notifPollInterval); notifPollInterval = null; }
  document.getElementById('app').classList.remove('show');
  document.getElementById('loginScreen').classList.remove('hide');
}
document.getElementById('logoutLink').addEventListener('click', (e)=>{ e.preventDefault(); apiFetch('/api/logout',{method:'POST'}).catch(()=>{}); doLogout(); });

function buildNav(){
  const perms = ME.permissions;
  document.querySelectorAll('.nav-group-label').forEach(label=> label.setAttribute('aria-expanded', label.parentElement.classList.contains('is-open')));
  document.getElementById('sidebarToggle').onclick = ()=>{
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('sidebar-collapsed');
    document.getElementById('sidebarToggle').title = sidebar.classList.contains('sidebar-collapsed') ? 'Expand sidebar' : 'Collapse sidebar';
  };
  document.querySelectorAll('.nav-item').forEach(el=>{
    const v = el.dataset.view;
    const isAiOrCloud = ['gemini_chat', 'maps_logistics', 'my_cloud_notes', 'workspace_gmail', 'workspace_calendar', 'workspace_drive'].includes(v);
    const allowed = (v === 'octo_inbox' ? ['Admin','ProjectManager'].includes(ME.role) : (isAiOrCloud || perms.view.includes(MODULE_PERMS[v] || v)));
    el.dataset.roleAllowed = allowed ? '1' : '0';
    el.style.display = allowed ? '' : 'none';
    el.onclick = ()=>{
      document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
      el.classList.add('active');
      currentView = el.dataset.view;
      document.getElementById('viewTitle').textContent = el.textContent.trim();
      render();
    };
  });
  document.querySelectorAll('.nav-group').forEach(group=>{
    const hasVisibleItem = Array.from(group.querySelectorAll('.nav-item')).some(el => el.dataset.roleAllowed === '1');
    group.style.display = hasVisibleItem ? '' : 'none';
  });
  const regSearch = document.getElementById('navRegisterSearch');
  if(regSearch){
    regSearch.oninput = ()=>{
      const q = regSearch.value.trim().toLowerCase();
      document.querySelectorAll('.nav-group').forEach(group=>{
        const groupTitle = (group.querySelector('.nav-group-label')?.textContent || '').toLowerCase();
        let anyMatch = false;
        group.querySelectorAll('.nav-item').forEach(el=>{
          if(el.dataset.roleAllowed !== '1'){ el.style.display = 'none'; return; }
          const txt = el.textContent.toLowerCase();
          const match = !q || txt.includes(q) || groupTitle.includes(q);
          el.style.display = match ? '' : 'none';
          if(match) anyMatch = true;
        });
        group.style.display = anyMatch ? '' : 'none';
        if(q && anyMatch) group.classList.add('is-open');
      });
    };
  }
  document.querySelectorAll('.mobile-nav-btn[data-mobile-view]').forEach(btn=>{
    btn.onclick = ()=>{
      currentView = btn.dataset.mobileView;
      document.querySelectorAll('.nav-item').forEach(n=>{
        n.classList.toggle('active', n.dataset.view === currentView);
      });
      const activeNav = document.querySelector(`.nav-item[data-view="${currentView}"]`);
      if(activeNav) document.getElementById('viewTitle').textContent = activeNav.textContent.trim();
      render();
    };
  });
  const mMenu = document.getElementById('mNavMenu');
  if(mMenu){
    mMenu.onclick = ()=>{
      const sb = document.getElementById('sidebar');
      if(sb) sb.classList.toggle('sidebar-collapsed');
    };
  }
}

document.getElementById('sidebar').addEventListener('click', (event)=>{
  const label = event.target.closest('.nav-group-label');
  if(!label) return;
  const group = label.parentElement;
  group.classList.toggle('is-open');
  const expanded = group.classList.contains('is-open');
  label.setAttribute('aria-expanded', expanded);
  const arrow = label.querySelector('span');
  if(arrow) arrow.textContent = expanded ? '⌃' : '⌄';
});

async function loadProjectsAndRender(){
  PROJECTS = await apiFetch('/api/projects');
  const sel = document.getElementById('projectSelect');
  sel.innerHTML = PROJECTS.map(p=>`<option value="${p.id}">${p.name}</option>`).join('') + '<option value="ALL">— All Projects —</option>';
  if(PROJECTS.length) { currentProjectId = ME && ME.role==='Admin' ? 'ALL' : PROJECTS[0].id; sel.value = currentProjectId; }
  sel.onchange = (e)=>{ currentProjectId = e.target.value; render(); };
  render();
}

function badgeClass(status){
  const s=(status||'').toLowerCase();
  if(s.includes('open')||s.includes('not started')||s.includes('delayed')||s.includes('rejected')||s.includes('fail')||s.includes('cancelled')||s.includes('pending')) return 'open';
  if(s.includes('progress')||s.includes('review')||s.includes('resubmit')||s.includes('ordered')||s.includes('draft')||s.includes('conditional')) return 'progress';
  if(s.includes('closed')||s.includes('completed')||s.includes('approved')||s.includes('pass')||s.includes('delivered')) return 'closed';
  return 'progress';
}
function fmtCurrency(n){ return '€'+Number(n||0).toLocaleString(); }
function escHtml(s){ return (s===undefined||s===null?'':String(s)).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

async function exportCsv(table){
  const res = await fetch(`${API}/api/export/${table}?project_id=${currentProjectId}`, {headers:{Authorization:'Bearer '+TOKEN}});
  if(!res.ok){ alert('Export failed'); return; }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${table}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function confirmAction(message){
  return new Promise((resolve)=>{
    const overlay = document.getElementById('modalOverlay');
    document.getElementById('modalBody').innerHTML = `<h3>Confirm</h3><div class="confirm-box" style="margin-top:10px;">${message}</div>
      <div class="modal-actions"><button class="btn ghost small" id="cCancel">Cancel</button><button class="btn small" id="cOk" style="background:var(--danger);">Delete</button></div>`;
    overlay.classList.add('show');
    document.getElementById('cCancel').onclick = ()=>{ overlay.classList.remove('show'); resolve(false); };
    document.getElementById('cOk').onclick = ()=>{ overlay.classList.remove('show'); resolve(true); };
  });
}

async function render(){
  const content = document.getElementById('viewContent');
  content.innerHTML = '<div class="empty">Loading...</div>';
  const fns = {
    dashboard: renderDashboard, client_dashboard: renderClientDashboard, site_today: renderSiteToday, calendar: renderCalendar, attendance: renderAttendance, tasks: renderTasksWorkspace,
    octo_inbox: renderOctoInbox,
    gantt: renderGantt,
    progress_reports: renderProgressReports,
    work_packages: renderWorkPackages,
    progress_submissions: renderProgressSubmissions,
    clarifications: renderClarifications,
    transmittals: renderTransmittals,
    rfis: ()=>renderCrud('rfis','RFI',[['number','No.'],['subject','Subject'],['trade','Trade'],['due_date','Due'],['status','Status']]),
    submittals: ()=>renderCrud('submittals','Submittal',[['number','No.'],['item','Item'],['trade','Trade'],['due_date','Due'],['status','Status']]),
    punchlist: renderPunchList,
    dailylogs: renderDailyLogsWorkspace,
    documents: renderDocuments,
    planner: renderPlanner,
    costs: renderJobCosting,
    change_orders: ()=>renderCrud('change_orders','Change Order',[['number','No.'],['title','Title'],['trade','Trade'],['cost_impact','Cost Impact'],['schedule_impact_days','Days'],['status','Status']]),
    purchase_orders: ()=>renderCrud('purchase_orders','Purchase Order',[['po_number','PO No.'],['vendor','Vendor'],['trade','Trade'],['amount','Amount'],['expected_delivery','Expected'],['status','Status']]),
    safety_incidents: ()=>renderCrud('safety_incidents','Incident',[['date','Date'],['trade','Trade'],['incident_type','Type'],['severity','Severity'],['status','Status']]),
    inspections: ()=>renderCrud('inspections','Inspection',[['date','Date'],['trade','Trade'],['inspection_type','Type'],['inspector','Inspector'],['result','Result']]),
    meeting_minutes: ()=>renderCrud('meeting_minutes','Meeting',[['date','Date'],['meeting_type','Type'],['attendees','Attendees'],['subject','Subject']]),
    timesheets: ()=>renderCrud('timesheets','Timesheet Entry',[['date','Date'],['worker','Worker'],['trade','Trade'],['task','Task'],['hours','Hours']]),
    equipment: ()=>renderCrud('equipment','Equipment',[['name','Name'],['type','Type'],['assigned_to','Assigned To'],['status','Status']]),
    wbs_items: ()=>renderCrud('wbs_items','WBS Item',[['code','Code'],['name','Name'],['level','Level'],['discipline','Discipline'],['system','System'],['active','Active']]),
    dependencies: ()=>renderCrud('dependencies','Dependency',[['task_owner','Task Owner'],['dependent_party','Dependent Party'],['description','Dependency'],['dependency_owner','Owner'],['required_date','Required'],['status','Status'],['next_action','Next Action']]),
    procurement_items: ()=>renderCrud('procurement_items','Procurement Item',[['pr_number','PR No.'],['material','Material'],['quantity','Qty'],['unit','Unit'],['required_on_site','Required'],['selected_supplier','Supplier'],['expected_delivery','Expected'],['status','Status']]),
    material_requests: ()=>renderCrud('material_requests','Material Request',[['material','Material'],['location','Location'],['discipline','Discipline'],['quantity','Qty'],['unit','Unit'],['required_date','Required'],['status','Status']]),
    risks: ()=>renderCrud('risks','Risk',[['title','Risk'],['category','Category'],['probability','Probability'],['impact','Impact'],['risk_score','Score'],['owner','Owner'],['status','Status']]),
    boq_items: renderBOQ,
    ncrs: ()=>renderCrud('ncrs','NCR',[['number','No.'],['location','Location'],['description','Description'],['responsible_party','Responsible'],['target_date','Target'],['status','Status']]),
    commissioning_tests: ()=>renderCrud('commissioning_tests','Commissioning Test',[['system','System'],['subsystem','Subsystem'],['equipment','Equipment'],['test_type','Test Type'],['test_engineer','Engineer'],['result','Result'],['status','Status']]),
    handover_items: ()=>renderCrud('handover_items','Handover Item',[['contractor','Contractor'],['system','System'],['item_type','Type'],['description','Description'],['due_date','Due'],['status','Status']]),
    companies: renderCompanies,
    audit: renderAudit, users: renderUsers,
    projects: renderProjects,
    gemini_chat: renderGeminiChat,
    maps_logistics: renderMapsLogistics,
    my_cloud_notes: renderCloudNotes,
    workspace_gmail: renderWorkspaceGmail,
    workspace_calendar: renderWorkspaceCalendar,
    workspace_drive: renderWorkspaceDrive
  };
  try{
    await fns[currentView]();
    syncMobileNav(currentView);
  }catch(err){
    content.innerHTML = `<div class="panel"><div class="empty">Error: ${err.message}</div></div>`;
  }
}

document.getElementById('searchBtn').onclick = async ()=>{
  const q = document.getElementById('globalSearch').value.trim();
  if(q.length < 2) return;
  try{
    const rows = await apiFetch(`/api/search?q=${encodeURIComponent(q)}&project_id=${currentProjectId}`);
    document.getElementById('viewTitle').textContent = `Search: ${q}`;
    document.getElementById('viewContent').innerHTML = `<div class="panel"><h3>Search Results (${rows.length})</h3>${rows.length?`<table><thead><tr><th>Module</th><th>Title</th><th>Project</th><th>Status</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${escHtml(r.module)}</td><td>${escHtml(r.title)}</td><td>${escHtml(r.project_id)}</td><td>${escHtml(r.record.status||'')}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">No confirmed information found.</div>'}</div>`;
  }catch(err){ alert(err.message||'Search failed'); }
};
document.getElementById('globalSearch').addEventListener('keydown', e=>{ if(e.key==='Enter') document.getElementById('searchBtn').click(); });
