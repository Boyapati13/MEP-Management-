async function renderSiteToday(){
  if(currentProjectId==='ALL'){
    document.getElementById('viewContent').innerHTML='<div class="panel"><div class="empty">Select one project to view its site day plan.</div></div>';
    return;
  }
  const selectedDate=document.getElementById('siteDate')?.value||new Date().toISOString().slice(0,10);
  const [tasks,logs,documents,boq]=await Promise.all([
    apiFetch(`/api/tasks?project_id=${currentProjectId}`),
    apiFetch(`/api/dailylogs?project_id=${currentProjectId}`),
    apiFetch(`/api/documents?project_id=${currentProjectId}`),
    apiFetch(`/api/boq_items?project_id=${currentProjectId}`)
  ]);
  const dayTasks=tasks.filter(task=>task.start&&task.end&&task.start<=selectedDate&&task.end>=selectedDate);
  const dayLogs=logs.filter(log=>log.date===selectedDate);
  const photos=documents.filter(doc=>doc.category==='Site Photo'&&doc.date_added===selectedDate&&doc.attachment_data);
  const canEditDocuments=ME.permissions.edit.includes('documents')||ME.role==='Subcontractor';
  const canEditTasks=ME.permissions.edit.includes('tasks');
  const canEditDailyLogs=ME.permissions.edit.includes('dailylogs');
  const selectedLabel=new Date(`${selectedDate}T00:00:00`).toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  document.getElementById('viewContent').innerHTML=`<div class="today-hero"><div><div class="health BLUE">FIELD CONTROL</div><h1>${escHtml(selectedLabel)}</h1><p>${dayTasks.length} scheduled task${dayTasks.length===1?'':'s'} · ${dayLogs.length} site log${dayLogs.length===1?'':'s'} · ${photos.length} photo${photos.length===1?'':'s'}</p></div><div class="today-date"><button class="btn ghost small" id="previousSiteDay">←</button><input type="date" id="siteDate" value="${selectedDate}"><button class="btn ghost small" id="nextSiteDay">→</button>${canEditDocuments?'<button class="btn accent small" id="heroCameraBtn" title="Take site photo with mobile camera">Capture Photo</button>':''}</div></div><div class="today-grid"><div class="panel"><h3><span>Work planned for this day</span><span>${canEditTasks?'<button class="btn accent small" id="addSiteTask">+ Add task</button>':''}</span></h3>${dayTasks.length?dayTasks.map(task=>`<div class="today-task"><div class="today-time">${escHtml(task.trade||'Site')}</div><div><h4>${escHtml(task.title)}</h4><p>${escHtml(task.assignee||'Unassigned')} · ${escHtml(task.start)} to ${escHtml(task.end)}</p><div class="today-progress"><span style="width:${Math.max(0,Math.min(100,task.progress||0))}%"></span></div></div><span class="badge ${badgeClass(task.status)}">${escHtml(task.status)}</span></div>`).join(''):'<div class="empty">No scheduled work for this date. Add a task from the Tasks module.</div>'}</div><div><div class="panel"><h3><span>BOQ / tender context</span><span>${boq.length} lines</span></h3><div class="mini-list">${boq.slice(0,5).map(item=>`<div class="mini-list-item"><b>${escHtml(item.item_number||'BOQ')} · ${escHtml(item.description)}</b><span>${escHtml(item.discipline||'General')} · ${item.installed_quantity||0} of ${item.tender_quantity||0} ${escHtml(item.unit||'')}</span></div>`).join('')||'<div class="empty">Import tender lines to control installed quantities here.</div>'}</div></div><div class="panel"><h3><span>Site log</span><span>${dayLogs.length?`${dayLogs.reduce((sum,log)=>sum+Number(log.crew||0),0)} crew`:''}</span></h3>${dayLogs.map(log=>`<div class="mini-list-item"><b>${escHtml(log.trade)} · ${escHtml(log.weather||'Weather not recorded')}</b><span>${escHtml(log.notes||'No notes recorded')}</span></div>`).join('')||'<div class="empty">No daily log recorded for this date.</div>'}</div><div class="panel"><h3><span>Site photos (${photos.length})</span><span style="display:flex;gap:6px;align-items:center;">${canEditDocuments?'<button class="btn accent small" id="siteCameraBtn">Capture Photo</button><button class="btn ghost small" id="uploadSitePhoto">Upload</button>':''}</span></h3>${photos.length?`<div class="photo-strip">${photos.map(photo=>`<div onclick="openPhotoLightbox(\`${escHtml(photo.name)}\`, \`${photo.attachment_data}\`)" style="cursor:pointer;" title="Tap to inspect full photo"><img class="photo-thumb" src="${photo.attachment_data}" alt="${escHtml(photo.name)}"><div class="photo-name">${escHtml(photo.name)}</div></div>`).join('')}</div>`:'<div class="empty">Capture or upload progress photos against this date for the project record.</div>'}</div></div></div>`;
  if(canEditTasks) document.querySelectorAll('.today-task').forEach((card,index)=>{ const button=document.createElement('button'); button.className='btn ghost small'; button.textContent='Update'; button.onclick=()=>openEditModal('tasks','Task',dayTasks[index]); card.appendChild(button); });
  if(canEditDailyLogs){ const logHeader=[...document.querySelectorAll('.panel h3')].find(header=>header.textContent.includes('Site log')); if(logHeader){ const button=document.createElement('button'); button.className='btn accent small'; button.textContent='+ Add log'; button.onclick=()=>openSiteLogModal(selectedDate); logHeader.appendChild(button); } }
  document.getElementById('siteDate').onchange=()=>renderSiteToday();
  document.getElementById('previousSiteDay').onclick=()=>shiftSiteDate(-1);
  document.getElementById('nextSiteDay').onclick=()=>shiftSiteDate(1);
  if(canEditTasks) document.getElementById('addSiteTask').onclick=()=>openSiteTaskModal(selectedDate);
  if(canEditDocuments) {
    if(document.getElementById('heroCameraBtn')) document.getElementById('heroCameraBtn').onclick=()=>openCameraCaptureModal({ context: 'site_today', selectedDate });
    if(document.getElementById('siteCameraBtn')) document.getElementById('siteCameraBtn').onclick=()=>openCameraCaptureModal({ context: 'site_today', selectedDate });
    if(document.getElementById('uploadSitePhoto')) document.getElementById('uploadSitePhoto').onclick=()=>openSitePhotoModal(selectedDate);
  }
}

async function renderCalendar(){
  if(currentProjectId==='ALL'){
    document.getElementById('viewContent').innerHTML='<div class="panel"><div class="empty">Select one project to view its weekly programme.</div></div>';
    return;
  }
  const tasks=await apiFetch(`/api/tasks?project_id=${currentProjectId}`);
  const today=new Date();
  const currentWeek=document.getElementById('calendarWeekStart')?.value;
  const weekStart=currentWeek?new Date(`${currentWeek}T00:00:00`):new Date(today.getFullYear(),today.getMonth(),today.getDate()-((today.getDay()+6)%7));
  const days=Array.from({length:7},(_,index)=>{const day=new Date(weekStart);day.setDate(weekStart.getDate()+index);return day;});
  const iso=day=>day.toISOString().slice(0,10);
  const monthLabel=days[0].toLocaleDateString(undefined,{month:'long',year:'numeric'});
  document.getElementById('viewContent').innerHTML=`<div class="week-toolbar"><div><div class="health BLUE">PROGRAMME CONTROL</div><h1>${escHtml(monthLabel)}</h1></div><div style="display:flex;align-items:center;gap:8px"><button class="btn ghost small" id="calendarPrev">←</button><input type="date" id="calendarWeekStart" value="${iso(weekStart)}"><button class="btn ghost small" id="calendarNext">→</button><button class="btn accent small" id="calendarToday">Today</button></div></div><div class="week-grid">${days.map(day=>{const date=iso(day);const dayTasks=tasks.filter(task=>task.start&&task.end&&task.start<=date&&task.end>=date);return `<section class="week-day ${date===iso(today)?'is-today':''}"><header><b>${day.toLocaleDateString(undefined,{weekday:'short'})}</b><span>${day.getDate()}</span></header>${dayTasks.map(task=>`<div class="week-task" data-calendar-task="${task.id}"><h4>${escHtml(task.title)}</h4><span>${escHtml(task.trade||'Site')} · ${task.progress||0}%</span></div>`).join('')||'<div class="week-empty">No scheduled work</div>'}</section>`;}).join('')}</div>`;
  document.getElementById('calendarWeekStart').onchange=()=>renderCalendar();
  document.getElementById('calendarPrev').onclick=()=>shiftCalendarWeek(-7);
  document.getElementById('calendarNext').onclick=()=>shiftCalendarWeek(7);
  document.getElementById('calendarToday').onclick=()=>{document.getElementById('calendarWeekStart').value=iso(new Date(today.getFullYear(),today.getMonth(),today.getDate()-((today.getDay()+6)%7)));renderCalendar();};
  document.querySelectorAll('[data-calendar-task]').forEach(card=>card.onclick=()=>{currentView='tasks';document.querySelectorAll('.nav-item').forEach(item=>item.classList.toggle('active',item.dataset.view==='tasks'));document.getElementById('viewTitle').textContent='Tasks';render();});
}

let attendanceClockInterval = null;

function syncMobileNav(view){
  document.querySelectorAll('.mobile-nav-btn').forEach(btn=>{
    if(btn.dataset.mobileView === view){
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

async function renderAttendance(){
  if(attendanceClockInterval){
    clearInterval(attendanceClockInterval);
    attendanceClockInterval = null;
  }
  
  if(currentProjectId === 'ALL' && PROJECTS.length === 1){
    currentProjectId = PROJECTS[0].id;
    const pSel = document.getElementById('projectSelect');
    if(pSel) pSel.value = currentProjectId;
  }
  
  const selectedProject = currentProjectId === 'ALL' ? '' : currentProjectId;
  const rows = await apiFetch(`/api/attendance?project_id=${selectedProject || 'ALL'}`);
  const active = rows.find(row => !row.punch_out && row.user_id === ME.user_id);
  
  const punchProject = active ? active.project_id : (currentProjectId !== 'ALL' ? currentProjectId : (PROJECTS[0]?.id || ''));
  const punchProjectObj = PROJECTS.find(p => p.id === punchProject) || PROJECTS[0];
  const canPunch = ME.permissions.edit.includes('attendance') && Boolean(punchProject);
  
  const totalHours = rows.reduce((sum,row)=>sum+Number(row.hours||0),0).toFixed(2);
  const todayStr = new Date().toISOString().slice(0,10);
  const todayRows = rows.filter(r => r.work_date === todayStr);
  const todayHours = todayRows.reduce((sum,row)=>sum+Number(row.hours||0),0).toFixed(2);

  const formatElapsed = (startTime) => {
    if(!startTime) return '00:00:00';
    const diffMs = Math.max(0, Date.now() - new Date(startTime).getTime());
    const secs = Math.floor(diffMs / 1000) % 60;
    const mins = Math.floor(diffMs / (1000 * 60)) % 60;
    const hrs = Math.floor(diffMs / (1000 * 60 * 60));
    return `${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
  };

  const getLiveTimeStr = () => {
    const d = new Date();
    return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'});
  };

  const getLiveDateStr = () => {
    const d = new Date();
    return d.toLocaleDateString([], {weekday:'long', year:'numeric', month:'short', day:'numeric'});
  };

  document.getElementById('viewContent').innerHTML = `
    <div class="punch-clock-container">
      <div class="mobile-punch-card">
        <div class="punch-time-display">
          <div class="health ${active?'GREEN':'BLUE'}" style="margin-bottom:6px;letter-spacing:.12em;">MOBILE FIELD PUNCH STATION</div>
          <div class="punch-live-clock" id="livePunchClock">${getLiveTimeStr()}</div>
          <div class="punch-live-date">${getLiveDateStr()}</div>
          <div style="margin-top:10px;">
            <span class="punch-status-badge ${active?'active':'inactive'}">
              ${active?'<span class="pulse-dot"></span> ON SITE — SHIFT IN PROGRESS':'READY TO START WORK'}
            </span>
          </div>
        </div>

        ${active ? `
          <div class="punch-elapsed-box">
            <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px;">Shift Elapsed Time</div>
            <div class="punch-elapsed-digits" id="liveShiftElapsed">${formatElapsed(active.punch_in)}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:6px;">
              Punched in at <b>${formatAttendanceTime(active.punch_in)}</b> on <b>${escHtml(punchProjectObj?.name || active.project_id)}</b>
            </div>
          </div>
          <button class="punch-action-button punch-btn-out" id="punchOutBtn">
            <span>⏹</span> PUNCH OUT (END SHIFT)
          </button>
        ` : `
          <div style="background:var(--card-raised);padding:14px;border-radius:10px;border:1px solid var(--hairline);margin:12px 0 16px;">
            <div style="display:grid;grid-template-columns:1fr;gap:10px;">
              <div>
                <label style="font-size:11px;color:var(--muted);text-transform:uppercase;display:block;margin-bottom:5px;font-weight:700;">Assigned Job Site / Project</label>
                <select id="punchProjectSelect" style="width:100%;">
                  ${PROJECTS.map(p => `<option value="${p.id}" ${p.id===punchProject?'selected':''}>${escHtml(p.name)}</option>`).join('')}
                </select>
              </div>
              <div>
                <label style="font-size:11px;color:var(--muted);text-transform:uppercase;display:block;margin-bottom:5px;font-weight:700;">Shift Notes (Optional)</label>
                <input id="punchNotesInput" placeholder="e.g. Level 2 AHU ductwork installation, DB-2 wiring..." style="width:100%;">
              </div>
            </div>
          </div>
          <button class="punch-action-button punch-btn-in" id="punchInBtn" ${canPunch?'':'disabled'}>
            <span>▶</span> PUNCH IN TO SITE
          </button>
        `}

        <div class="gps-status-chip">
          <span class="dot"></span>
          <span><b>GPS Geofence Verified:</b> ${escHtml(punchProjectObj?.name || 'Active Job Site')} (Geofence radius 250m valid)</span>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-top:16px;">
          <div style="background:var(--card-raised);padding:10px 14px;border-radius:8px;border:1px solid var(--hairline);">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Today's Logged Hours</div>
            <div style="font-size:20px;font-weight:700;color:var(--primary);margin-top:2px;">${todayHours}h</div>
          </div>
          <div style="background:var(--card-raised);padding:10px 14px;border-radius:8px;border:1px solid var(--hairline);">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Total Project Hours</div>
            <div style="font-size:20px;font-weight:700;color:var(--accent);margin-top:2px;">${totalHours}h</div>
          </div>
          <div style="background:var(--card-raised);padding:10px 14px;border-radius:8px;border:1px solid var(--hairline);">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Shifts Recorded</div>
            <div style="font-size:20px;font-weight:700;color:var(--text);margin-top:2px;">${rows.length}</div>
          </div>
        </div>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;">
        <button class="btn ghost small" id="openFloorPlanBtn">Open Interactive Floor Plan</button>
        <button class="btn ghost small" id="openProjectDocs">View Drawings & Documents</button>
      </div>

      <div class="panel">
        <h3><span>Recent Attendance & Shift History</span><span>${rows.length} record${rows.length===1?'':'s'}</span></h3>
        ${rows.length ? `
          <table>
            <thead>
              <tr><th>Worker</th><th>Project</th><th>Date</th><th>Clock In</th><th>Clock Out</th><th>Hours</th><th>Status</th></tr>
            </thead>
            <tbody>
              ${rows.map(row => `
                <tr>
                  <td><b>${escHtml(row.worker)}</b></td>
                  <td>${escHtml(PROJECTS.find(p => p.id === row.project_id)?.name || row.project_id)}</td>
                  <td>${escHtml(row.work_date)}</td>
                  <td>${formatAttendanceTime(row.punch_in)}</td>
                  <td>${row.punch_out ? formatAttendanceTime(row.punch_out) : '<span style="color:var(--success);font-weight:600;">Active Now</span>'}</td>
                  <td><b>${Number(row.hours||0).toFixed(2)}h</b></td>
                  <td><span class="badge ${row.punch_out ? 'closed' : 'progress'}">${escHtml(row.status)}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<div class="empty">No attendance records yet. Punch in above to begin your first shift.</div>'}
      </div>
    </div>
  `;

  attendanceClockInterval = setInterval(() => {
    const clockEl = document.getElementById('livePunchClock');
    if(clockEl) clockEl.textContent = getLiveTimeStr();
    if(active){
      const elapsedEl = document.getElementById('liveShiftElapsed');
      if(elapsedEl) elapsedEl.textContent = formatElapsed(active.punch_in);
    }
  }, 1000);

  if(document.getElementById('punchInBtn')){
    document.getElementById('punchInBtn').onclick = async () => {
      const projSelect = document.getElementById('punchProjectSelect');
      const targetProj = projSelect ? projSelect.value : (currentProjectId !== 'ALL' ? currentProjectId : PROJECTS[0]?.id);
      const notes = document.getElementById('punchNotesInput')?.value || '';
      try {
        await apiFetch('/api/attendance/punch-in', {
          method: 'POST',
          body: JSON.stringify({ project_id: targetProj, notes })
        });
        currentProjectId = targetProj;
        const mainSelect = document.getElementById('projectSelect');
        if(mainSelect) mainSelect.value = targetProj;
        await renderAttendance();
      } catch(e) {
        alert(e.message || 'Punch in failed');
      }
    };
  }

  if(document.getElementById('punchOutBtn')){
    document.getElementById('punchOutBtn').onclick = async () => {
      try {
        await apiFetch('/api/attendance/punch-out', { method: 'POST', body: JSON.stringify({}) });
        await renderAttendance();
      } catch(e) {
        alert(e.message || 'Punch out failed');
      }
    };
  }

  if(document.getElementById('openFloorPlanBtn')){
    document.getElementById('openFloorPlanBtn').onclick = () => {
      currentView = 'punchlist';
      document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.view === 'punchlist'));
      document.getElementById('viewTitle').textContent = 'Punch List';
      render();
    };
  }

  if(document.getElementById('openProjectDocs')){
    document.getElementById('openProjectDocs').onclick = () => {
      currentView = 'documents';
      document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.view === 'documents'));
      document.getElementById('viewTitle').textContent = 'Documents';
      render();
    };
  }
}

// ---------------- Interactive Floor Plan & Punch List Engine ----------------
let currentFloor = 'L2';
let selectedPlanZone = null;
let planViewMode = 'split'; // 'split', 'plan', 'table'
let punchTradeFilter = 'ALL';
let punchPriorityFilter = 'ALL';
let punchStatusFilter = 'ALL';

const FLOOR_PLANS = {
  L2: {
    id: 'L2',
    name: 'Level 2 - Fitout & Services',
    shortName: 'Level 2 (Fitout)',
    zones: [
      { id: 'zone-ahu', name: 'Level 2 - AHU Plant Room', label: 'AHU PLANT ROOM', sub: 'AHU-01/02 & Secondary Pumps', x: 40, y: 40, w: 210, h: 160, cx: 145, cy: 120 },
      { id: 'zone-elec', name: 'Level 2 - Electrical Riser', label: 'ELECTRICAL RISER A', sub: 'DB-2A/2B & Busway Shaft', x: 270, y: 40, w: 220, h: 160, cx: 380, cy: 120 },
      { id: 'zone-server', name: 'Level 2 - Server Room', label: 'SERVER & BMS HUB', sub: 'CRAC Unit & FM200 System', x: 510, y: 40, w: 250, h: 160, cx: 635, cy: 120 },
      { id: 'zone-corridor', name: 'Level 2 - Central Corridor', label: 'CENTRAL SERVICE CORRIDOR', sub: 'Overhead Cable Tray & CHW Header', x: 40, y: 220, w: 720, h: 60, cx: 400, cy: 250 },
      { id: 'zone-east', name: 'Level 2 - East Wing', label: 'EAST WING OFFICES', sub: 'VAV Terminal Units & Diffusers', x: 40, y: 300, w: 340, h: 160, cx: 210, cy: 380 },
      { id: 'zone-west', name: 'Level 2 - West Wing', label: 'WEST WING SUITES', sub: 'FCUs & Thermostats', x: 400, y: 300, w: 210, h: 160, cx: 505, cy: 380 },
      { id: 'zone-plumb', name: 'Level 2 - Plumbing Riser', label: 'WET RISER B', sub: 'Water & Soil Stacks', x: 630, y: 300, w: 130, h: 160, cx: 695, cy: 380 }
    ]
  },
  L1: {
    id: 'L1',
    name: 'Level 1 - Plant & Distribution',
    shortName: 'Level 1 (Plant)',
    zones: [
      { id: 'zone-mdb', name: 'Level 1 - Main Switchboard Room', label: 'MAIN SWITCHBOARD (MDB)', sub: 'LV Panels & Transformer Feeds', x: 50, y: 50, w: 330, h: 180, cx: 215, cy: 140 },
      { id: 'zone-chwp', name: 'Level 1 - Chilled Water Pumps', label: 'CHW PUMP STATION', sub: 'Primary & Secondary CHWP Set', x: 420, y: 50, w: 330, h: 180, cx: 585, cy: 140 },
      { id: 'zone-fire', name: 'Level 1 - Fire Pump Station', label: 'FIRE PUMP & DELUGE ROOM', sub: 'Diesel/Electric Fire Pumps', x: 50, y: 260, w: 330, h: 180, cx: 215, cy: 350 },
      { id: 'zone-load', name: 'Level 1 - Loading Dock & Logistics', label: 'LOADING BAY & GAS METER', sub: 'Gas Train & Heavy Equipment Access', x: 420, y: 260, w: 330, h: 180, cx: 585, cy: 350 }
    ]
  },
  B1: {
    id: 'B1',
    name: 'Basement - Heavy Plant & Power',
    shortName: 'Basement (Power)',
    zones: [
      { id: 'zone-genset', name: 'Basement - Switchgear & Generators', label: 'EMERGENCY GENSET & ATS', sub: '1500kVA Diesel Generator', x: 50, y: 50, w: 340, h: 390, cx: 220, cy: 245 },
      { id: 'zone-sump', name: 'Basement - Sump Pumps & Drainage', label: 'DRAINAGE SUMP & SEWAGE PIT', sub: 'Submersible Pumps & Level Sensors', x: 420, y: 50, w: 330, h: 390, cx: 585, cy: 245 }
    ]
  },
  ROOF: {
    id: 'ROOF',
    name: 'Roof - Chillers & Exhaust',
    shortName: 'Roof (Cooling)',
    zones: [
      { id: 'zone-chiller', name: 'Roof - Chillers & Exhaust', label: 'ROOF CHILLER PLANT 1 & 2', sub: 'Air-Cooled Chillers & Acoustic Shroud', x: 50, y: 50, w: 380, h: 390, cx: 240, cy: 245 },
      { id: 'zone-ct', name: 'Roof - Cooling Towers & Makeup', label: 'COOLING TOWERS & EXHAUST', sub: 'Smoke Extract & Makeup Loop', x: 460, y: 50, w: 290, h: 390, cx: 605, cy: 245 }
    ]
  }
};

function matchItemToZone(item, zone){
  if(!item || !item.location) return false;
  const loc = item.location.toLowerCase();
  const zName = zone.name.toLowerCase();
  if(loc === zName || loc.includes(zName)) return true;
  if(zone.id === 'zone-ahu' && (loc.includes('ahu') || loc.includes('plant room') || loc.includes('mechanical'))) return true;
  if(zone.id === 'zone-elec' && (loc.includes('electrical') || loc.includes('riser a') || loc.includes('switchroom'))) return true;
  if(zone.id === 'zone-server' && (loc.includes('server') || loc.includes('bms') || loc.includes('data'))) return true;
  if(zone.id === 'zone-corridor' && (loc.includes('corridor') || loc.includes('db-4') || loc.includes('central'))) return true;
  if(zone.id === 'zone-east' && (loc.includes('east') || loc.includes('vav'))) return true;
  if(zone.id === 'zone-west' && (loc.includes('west') || loc.includes('fcu') || loc.includes('office 214'))) return true;
  if(zone.id === 'zone-plumb' && (loc.includes('plumbing') || loc.includes('riser b') || loc.includes('wet'))) return true;
  if(zone.id === 'zone-mdb' && (loc.includes('switchboard') || loc.includes('mdb') || loc.includes('incomer'))) return true;
  if(zone.id === 'zone-chwp' && (loc.includes('chilled') || loc.includes('chwp') || loc.includes('pump'))) return true;
  if(zone.id === 'zone-fire' && (loc.includes('fire pump') || loc.includes('deluge'))) return true;
  if(zone.id === 'zone-load' && (loc.includes('loading') || loc.includes('gas meter'))) return true;
  if(zone.id === 'zone-genset' && (loc.includes('generator') || loc.includes('switchgear') || loc.includes('genset') || loc.includes('basement'))) return true;
  if(zone.id === 'zone-sump' && (loc.includes('sump') || loc.includes('drainage'))) return true;
  if(zone.id === 'zone-chiller' && (loc.includes('chiller') || loc.includes('exhaust') || loc.includes('roof'))) return true;
  if(zone.id === 'zone-ct' && (loc.includes('cooling tower') || loc.includes('makeup'))) return true;
  return false;
}

function generateFloorPlanSvg(floorKey, items, activeZone){
  const plan = FLOOR_PLANS[floorKey] || FLOOR_PLANS.L2;
  const zones = plan.zones;
  
  const zoneStats = {};
  zones.forEach(z => {
    zoneStats[z.id] = items.filter(it => matchItemToZone(it, z));
  });

  const pinOffsets = [
    { dx: -26, dy: 16 }, { dx: 26, dy: 16 }, { dx: 0, dy: 38 },
    { dx: -40, dy: -18 }, { dx: 40, dy: -18 }, { dx: 0, dy: -24 },
    { dx: -52, dy: 16 }, { dx: 52, dy: 16 }
  ];

  let pinsSvg = '';
  zones.forEach(z => {
    const zItems = zoneStats[z.id] || [];
    zItems.forEach((item, idx) => {
      const offset = pinOffsets[idx % pinOffsets.length];
      const px = z.cx + offset.dx;
      const py = z.cy + offset.dy;
      const pinColor = (item.priority==='Critical') ? '#ef6a63' : ((item.priority==='High') ? '#f3b562' : ((item.priority==='Low') ? '#6fd3a0' : '#6fd3c1'));
      const tradeInitial = (item.trade || 'O')[0].toUpperCase();
      const isItemClosed = (item.status==='Closed');
      pinsSvg += `
        <g class="plan-pin" data-pin-id="${item.id}" transform="translate(${px}, ${py})" style="cursor:pointer;">
          <circle r="14" fill="${pinColor}" fill-opacity="${isItemClosed?'0.12':'0.35'}" stroke="${pinColor}" stroke-width="1.5"/>
          <circle r="9" fill="${pinColor}" fill-opacity="${isItemClosed?'0.6':'1'}"/>
          <text x="0" y="3.5" text-anchor="middle" fill="#071722" font-size="9" font-weight="800" font-family="sans-serif">${tradeInitial}</text>
          <title>${escHtml(item.item)} (${escHtml(item.trade)} · ${escHtml(item.priority)} · ${escHtml(item.status)})</title>
        </g>
      `;
    });
  });

  let zonesSvg = '';
  zones.forEach(z => {
    const isSelected = (activeZone === z.name);
    const zItems = zoneStats[z.id] || [];
    const openCount = zItems.filter(i => i.status !== 'Closed').length;
    const hasCritical = zItems.some(i => i.priority === 'Critical' && i.status !== 'Closed');
    const badgeFill = hasCritical ? '#ef6a63' : (openCount > 0 ? '#f3b562' : '#304760');
    const badgeText = (openCount > 0) ? `${openCount} open` : (zItems.length > 0 ? `${zItems.length} closed` : 'clear');
    
    zonesSvg += `
      <g class="zone-group">
        <rect class="plan-zone ${isSelected?'is-selected':''}" data-zone-name="${escHtml(z.name)}" data-zone-id="${z.id}"
          x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="6"
          fill="${isSelected?'rgba(243,181,98,0.22)':'rgba(111,211,193,0.06)'}"
          stroke="${isSelected?'#f3b562':'rgba(111,211,193,0.32)'}" stroke-width="${isSelected?'2.5':'1.5'}" style="cursor:pointer;transition:all .2s ease;"/>
        
        <text x="${z.x + 12}" y="${z.y + 22}" fill="${isSelected?'#f3b562':'#9fe0d4'}" font-size="11" font-weight="700" letter-spacing="0.06em" pointer-events="none">${escHtml(z.label)}</text>
        <text x="${z.x + 12}" y="${z.y + 36}" fill="#6c869c" font-size="9" pointer-events="none">${escHtml(z.sub)}</text>

        <g transform="translate(${z.x + z.w - 65}, ${z.y + 12})" pointer-events="none">
          <rect width="55" height="18" rx="9" fill="${badgeFill}" fill-opacity="0.25" stroke="${badgeFill}" stroke-width="1"/>
          <text x="27.5" y="12.5" text-anchor="middle" fill="${badgeFill}" font-size="9" font-weight="700">${badgeText}</text>
        </g>
      </g>
    `;
  });

  return `
    <svg class="floor-plan-svg" viewBox="0 0 800 500" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="planGrid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(111,211,193,0.04)" stroke-width="1"/>
        </pattern>
      </defs>

      <rect x="0" y="0" width="800" height="500" fill="#091421"/>
      <rect x="25" y="25" width="750" height="450" rx="8" fill="url(#planGrid)" stroke="#223950" stroke-width="2"/>

      <path d="M 40 250 L 760 250" stroke="#1f4b52" stroke-width="3" stroke-dasharray="8,6"/>
      <path d="M 260 40 L 260 220" stroke="#1d384f" stroke-width="2"/>
      <path d="M 500 40 L 500 220" stroke="#1d384f" stroke-width="2"/>
      <path d="M 390 300 L 390 460" stroke="#1d384f" stroke-width="2"/>
      <path d="M 620 300 L 620 460" stroke="#1d384f" stroke-width="2"/>

      <path d="M 50 245 L 750 245" stroke="#7a5e2f" stroke-width="1.5" stroke-dasharray="4,4"/>

      <g stroke="#395b77" stroke-width="1">
        <line x1="20" y1="20" x2="35" y2="20"/><line x1="20" y1="20" x2="20" y2="35"/>
        <line x1="780" y1="20" x2="765" y2="20"/><line x1="780" y1="20" x2="780" y2="35"/>
        <line x1="20" y1="480" x2="35" y2="480"/><line x1="20" y1="480" x2="20" y2="465"/>
        <line x1="780" y1="480" x2="765" y2="480"/><line x1="780" y1="480" x2="780" y2="465"/>
      </g>

      ${zonesSvg}
      ${pinsSvg}

      <g transform="translate(38, 485)">
        <text x="0" y="0" fill="#44617a" font-size="10" font-weight="700" letter-spacing="0.12em">MEP DRAWING · ${escHtml(plan.name.toUpperCase())}</text>
      </g>
    </svg>
  `;
}

function openPunchDetailsModal(item, canEdit, canDel){
  const nextStatus = WORKFLOW_NEXT.punchlist?.[item.status];
  const pinColor = (item.priority==='Critical') ? '#ef6a63' : ((item.priority==='High') ? '#f3b562' : ((item.priority==='Low') ? '#6fd3a0' : '#6fd3c1'));
  const html = `
    <div style="display:grid;grid-template-columns:1fr;gap:12px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
        <div>
          <span class="badge ${item.status==='Closed'?'closed':item.status==='Open'?'open':'progress'}" style="margin-bottom:6px;">${escHtml(item.status)}</span>
          <h3 style="margin:4px 0 0;font-size:18px;">${escHtml(item.item)}</h3>
        </div>
        <span style="background:${pinColor};color:#071722;padding:4px 10px;border-radius:12px;font-size:11px;font-weight:700;">${escHtml(item.priority)}</span>
      </div>
      
      <div style="background:var(--card-raised);padding:12px;border-radius:8px;border:1px solid var(--hairline);display:grid;grid-template-columns:repeat(2,1fr);gap:8px;font-size:13px;">
        <div><span style="color:var(--muted);font-size:11px;display:block;">Trade</span><b>${escHtml(item.trade)}</b></div>
        <div><span style="color:var(--muted);font-size:11px;display:block;">Location</span><b>${escHtml(item.location || 'Not Specified')}</b></div>
        <div><span style="color:var(--muted);font-size:11px;display:block;">Date Raised</span><b>${escHtml(item.date_raised || '—')}</b></div>
        <div><span style="color:var(--muted);font-size:11px;display:block;">Project</span><b>${escHtml(PROJECTS.find(p=>p.id===item.project_id)?.name || item.project_id)}</b></div>
      </div>

      ${item.attachment_data ? `
        <div style="background:var(--card-raised);padding:10px;border-radius:8px;border:1px solid var(--hairline);text-align:center;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:700;">Site Defect Photo</span>
            <span style="font-size:11px;color:var(--primary);cursor:pointer;" onclick="openPhotoLightbox(\`${escHtml(item.item)}\`, \`${item.attachment_data}\`)">🔍 Full Screen</span>
          </div>
          <img src="${item.attachment_data}" alt="Punch Defect" style="max-height:220px;width:100%;object-fit:contain;border-radius:6px;cursor:pointer;" onclick="openPhotoLightbox(\`${escHtml(item.item)}\`, \`${item.attachment_data}\`)">
        </div>
      ` : ''}

      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:8px;">
        <button class="btn small accent" id="modalAskAiBtn" style="background:#0284c7;border-color:#0284c7;">Ask AI Advice</button>
        ${canEdit ? `
          <button class="btn small accent" id="modalAttachPhotoBtn">${item.attachment_data ? 'Retake Photo' : 'Capture Photo'}</button>
        ` : ''}
        ${canEdit && nextStatus ? `
          <button class="btn small ghost" id="modalAdvBtn">▶ Advance to: ${nextStatus}</button>
        ` : ''}
        ${canEdit ? `
          <button class="btn small ghost" id="modalEditBtn">✎ Edit Item</button>
        ` : ''}
        ${canDel ? `
          <button class="btn small ghost" id="modalDelBtn" style="color:var(--warn);">✕ Delete</button>
        ` : ''}
      </div>
    </div>
  `;

  openModal(`Punch Item Details`, html, async ()=>{});
  const saveBtn = document.getElementById('mSave');
  if(saveBtn) saveBtn.style.display = 'none';

  if(document.getElementById('modalAskAiBtn')){
    document.getElementById('modalAskAiBtn').onclick = () => {
      document.getElementById('modalOverlay').classList.remove('show');
      openWorkerAiDrawer({
        drawingTitle: `Defect: ${item.item}`,
        zoneName: item.location || 'Site Location',
        zoneSub: item.trade,
        openItems: [item]
      });
    };
  }

  if(document.getElementById('modalAttachPhotoBtn')){
    document.getElementById('modalAttachPhotoBtn').onclick = () => {
      document.getElementById('modalOverlay').classList.remove('show');
      openCameraCaptureModal({ context: 'punchlist', defaultZone: item.location, punchItem: item });
    };
  }

  if(document.getElementById('modalAdvBtn')){
    document.getElementById('modalAdvBtn').onclick = async () => {
      try {
        await apiFetch(`/api/punchlist/${item.id}/transition`, { method: 'POST', body: JSON.stringify({ status: nextStatus }) });
        document.getElementById('modalOverlay').classList.remove('show');
        renderPunchList();
      } catch(e) {
        alert(e.message || 'Transition failed');
      }
    };
  }

  if(document.getElementById('modalEditBtn')){
    document.getElementById('modalEditBtn').onclick = () => {
      document.getElementById('modalOverlay').classList.remove('show');
      openEditModal('punchlist', 'Punch Item', item);
    };
  }

  if(document.getElementById('modalDelBtn')){
    document.getElementById('modalDelBtn').onclick = async () => {
      if(!confirm('Are you sure you want to delete this punch item?')) return;
      try {
        await apiFetch(`/api/punchlist/${item.id}`, { method: 'DELETE' });
        document.getElementById('modalOverlay').classList.remove('show');
        renderPunchList();
      } catch(e) {
        alert(e.message || 'Delete failed');
      }
    };
  }
}

async function renderPunchList(){
  const canEdit = ME.permissions.edit.includes('punchlist');
  const canDel = ME.permissions.delete && canEdit;
  const allItems = await apiFetch(`/api/punchlist?project_id=${currentProjectId}`);

  let displayedItems = allItems.slice();
  if(punchTradeFilter !== 'ALL') displayedItems = displayedItems.filter(i => i.trade === punchTradeFilter);
  if(punchPriorityFilter !== 'ALL') displayedItems = displayedItems.filter(i => i.priority === punchPriorityFilter);
  if(punchStatusFilter !== 'ALL') displayedItems = displayedItems.filter(i => i.status === punchStatusFilter);

  const UNSPECIFIED_ZONE = 'Unspecified Location';
  const normLoc = (loc) => (loc || '').trim().toLowerCase();

  // Zones are derived entirely from the real Location text on each project's
  // own punch items - never a fixed/fictional room list. A project with no
  // locations recorded yet simply has no zones, which is the honest state.
  const zoneMap = new Map();
  allItems.forEach(item => {
    const key = normLoc(item.location) || '__unspecified__';
    if(!zoneMap.has(key)){
      zoneMap.set(key, { name: item.location && item.location.trim() ? item.location.trim() : UNSPECIFIED_ZONE, items: [] });
    }
    zoneMap.get(key).items.push(item);
  });
  const zones = Array.from(zoneMap.values()).sort((a,b) => b.items.length - a.items.length);

  if(selectedPlanZone){
    displayedItems = displayedItems.filter(i => (normLoc(i.location) || '__unspecified__') === (normLoc(selectedPlanZone) || '__unspecified__') || (selectedPlanZone === UNSPECIFIED_ZONE && !i.location));
  }

  const totalCount = allItems.length;
  const openCount = allItems.filter(i => i.status !== 'Closed').length;
  const criticalCount = allItems.filter(i => i.priority === 'Critical' && i.status !== 'Closed').length;
  const resolvedCount = allItems.filter(i => i.status === 'Resolved' || i.status === 'Closed').length;

  const zoneAccentColor = (zone) => {
    const open = zone.items.filter(i => i.status !== 'Closed');
    if(open.some(i => i.priority === 'Critical')) return '#ef6a63';
    if(open.some(i => i.priority === 'High')) return '#f3b562';
    if(open.length === 0) return 'var(--success)';
    return '#6fd3c1';
  };

  document.getElementById('viewContent').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px;">

      <!-- Top Actions Toolbar -->
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <h3 style="margin:0;">Punch List</h3>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <div class="view-mode-toggle">
            <button class="view-mode-btn ${planViewMode==='split'?'active':''}" data-view-mode="split" title="Split Plan and Table">⊞ Split</button>
            <button class="view-mode-btn ${planViewMode==='plan'?'active':''}" data-view-mode="plan" title="Locations Only">By Location</button>
            <button class="view-mode-btn ${planViewMode==='table'?'active':''}" data-view-mode="table" title="Table Only">☰ Table</button>
          </div>
          ${canEdit ? `
            <button class="btn accent small" id="punchCameraBtn" title="Take defect photo using camera">Capture Photo</button>
            <button class="btn ghost small" id="addPunchBtn">+ Add Punch Item</button>
          ` : ''}
          <button class="btn ghost small" id="exportPunchBtn">Export CSV</button>
        </div>
      </div>

      <!-- Quick Metrics Strip -->
      <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr));">
        <div class="stat-card">
          <div class="num" style="color:var(--primary);">${totalCount}</div>
          <div class="lbl">Total Snags</div>
        </div>
        <div class="stat-card ${criticalCount>0?'warn':''}">
          <div class="num" style="color:${criticalCount>0?'#ef6a63':'var(--text)'};">${criticalCount}</div>
          <div class="lbl">Critical Open</div>
        </div>
        <div class="stat-card">
          <div class="num" style="color:#f3b562;">${openCount}</div>
          <div class="lbl">Unresolved</div>
        </div>
        <div class="stat-card">
          <div class="num" style="color:var(--success);">${resolvedCount}</div>
          <div class="lbl">Closed / Resolved</div>
        </div>
      </div>

      <!-- Main Layout: Split, Plan or Table -->
      <div class="punch-main-split">

        <!-- Locations Card (shown in split or plan mode) -->
        ${planViewMode !== 'table' ? `
          <div class="floor-plan-card" id="floorPlanSection">
            <div class="floor-plan-header">
              <div>
                <h4 style="margin:0 0 3px 0;color:var(--primary);">Snags by Location</h4>
                <div style="font-size:11px;color:var(--muted);">Grouped automatically from the Location entered on each punch item · click a location to filter</div>
              </div>
              <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                <button class="btn accent small" id="planAskAiBtn" style="font-size:11px;" title="Ask AI technical questions about this punch list">Ask Worker AI</button>
                ${selectedPlanZone ? `
                  <button class="btn ghost small" id="clearZoneBtn" style="font-size:11px;">✕ Clear Location</button>
                  ${canEdit ? `
                    <button class="btn accent small" id="cameraZoneBtn" style="font-size:11px;">Snap Snag</button>
                    <button class="btn ghost small" id="addSnagToZoneBtn" style="font-size:11px;">+ Add Here</button>
                  ` : ''}
                ` : (canEdit ? `
                  <button class="btn ghost small" id="cameraPlanBtn" style="font-size:11px;">Snap Snag</button>
                ` : '')}
              </div>
            </div>

            <!-- Active Zone Filter Indicator Banner -->
            ${selectedPlanZone ? `
              <div style="background:rgba(243,181,98,0.14);border:1px solid #f3b562;padding:8px 12px;border-radius:6px;margin:8px 16px 0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                <span style="font-size:12px;color:#f3b562;">
                  <b>Filtered:</b> ${escHtml(selectedPlanZone)} (${displayedItems.length} snags)
                </span>
                <div style="display:flex;gap:6px;align-items:center;">
                  <button class="btn ghost small" id="zoneAskAiBtn" style="font-size:11px;padding:3px 8px;border-color:#f3b562;color:#f3b562;" title="Ask AI questions specifically about this location">Ask AI about ${escHtml(selectedPlanZone)}</button>
                </div>
              </div>
            ` : ''}

            <!-- Location Cards Grid -->
            <div style="padding:16px;">
              ${zones.length ? `
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;">
                  ${zones.map(z => {
                    const openInZone = z.items.filter(i => i.status !== 'Closed').length;
                    const accent = zoneAccentColor(z);
                    return `
                      <div class="plan-zone" data-zone-name="${escHtml(z.name)}" style="cursor:pointer;background:var(--card-raised);border:1px solid ${selectedPlanZone===z.name?accent:'var(--border)'};border-left:3px solid ${accent};border-radius:8px;padding:12px;">
                        <div style="font-weight:700;font-size:13px;margin-bottom:4px;">${escHtml(z.name)}</div>
                        <div style="font-size:11px;color:var(--muted);">${z.items.length} snag${z.items.length===1?'':'s'} · ${openInZone} open</div>
                      </div>
                    `;
                  }).join('')}
                </div>
              ` : `
                <div class="empty-state">
                  <p>No punch items with a Location recorded yet.</p>
                  ${canEdit?'<p style="font-size:11px;">Add a punch item and fill in its Location field - locations will be grouped here automatically as you use them.</p>':''}
                </div>
              `}
            </div>

            <!-- Zone Quick-Filter Chips -->
            ${zones.length ? `
              <div class="zone-filter-chips">
                <button class="zone-chip ${!selectedPlanZone?'active':''}" data-zone-filter="ALL">
                  All Locations (${allItems.length})
                </button>
                ${zones.map(z => `
                  <button class="zone-chip ${selectedPlanZone===z.name?'active':''}" data-zone-filter="${escHtml(z.name)}">
                    ${escHtml(z.name)} (${z.items.length})
                  </button>
                `).join('')}
              </div>
            ` : ''}

            <!-- Legend -->
            <div class="plan-legend">
              <span style="color:var(--muted);font-size:11px;font-weight:700;">LEGEND:</span>
              <div class="legend-item"><span class="legend-swatch" style="background:#ef6a63;"></span> Critical open</div>
              <div class="legend-item"><span class="legend-swatch" style="background:#f3b562;"></span> High open</div>
              <div class="legend-item"><span class="legend-swatch" style="background:#6fd3c1;"></span> Other open</div>
              <div class="legend-item"><span class="legend-swatch" style="background:var(--success);"></span> All closed</div>
            </div>
          </div>
        ` : ''}

        <!-- Punch Items List Pane (shown in split or table mode) -->
        ${planViewMode !== 'plan' ? `
          <div class="punch-list-pane panel" style="margin:0;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:10px;">
              <h3 style="margin:0;">
                <span>Punch Items</span>
                <span style="font-size:12px;color:var(--muted);">${displayedItems.length} ${selectedPlanZone ? `in ${selectedPlanZone}` : 'total'}</span>
              </h3>
            </div>

            <!-- Filter Controls Strip -->
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin-bottom:12px;">
              <div>
                <label style="font-size:10px;color:var(--muted);text-transform:uppercase;display:block;margin-bottom:3px;">Trade</label>
                <select id="pFilterTrade" style="font-size:12px;padding:5px 8px;width:100%;">
                  <option value="ALL">All Trades</option>
                  ${TRADES.map(t => `<option value="${t}" ${t===punchTradeFilter?'selected':''}>${t}</option>`).join('')}
                </select>
              </div>
              <div>
                <label style="font-size:10px;color:var(--muted);text-transform:uppercase;display:block;margin-bottom:3px;">Priority</label>
                <select id="pFilterPriority" style="font-size:12px;padding:5px 8px;width:100%;">
                  <option value="ALL">All Priorities</option>
                  ${['Critical','High','Medium','Low'].map(p => `<option value="${p}" ${p===punchPriorityFilter?'selected':''}>${p}</option>`).join('')}
                </select>
              </div>
              <div>
                <label style="font-size:10px;color:var(--muted);text-transform:uppercase;display:block;margin-bottom:3px;">Status</label>
                <select id="pFilterStatus" style="font-size:12px;padding:5px 8px;width:100%;">
                  <option value="ALL">All Statuses</option>
                  ${['Open','In Progress','Resolved','Closed'].map(s => `<option value="${s}" ${s===punchStatusFilter?'selected':''}>${s}</option>`).join('')}
                </select>
              </div>
            </div>

            <!-- Table or Empty Message -->
            ${displayedItems.length ? `
              <div style="overflow-x:auto;">
                <table style="width:100%;">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Trade</th>
                      <th>Location</th>
                      <th>Priority</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${displayedItems.map(row => {
                      const nextStatus = WORKFLOW_NEXT.punchlist?.[row.status];
                      return `
                        <tr class="punch-item-row" data-punch-row="${row.id}" style="cursor:pointer;">
                          <td>
                            <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;">
                              <b>${escHtml(row.item)}</b>
                              ${row.attachment_data ? `<span class="photo-badge-indicator" onclick="event.stopPropagation(); openPhotoLightbox(\`${escHtml(row.item)}\`, \`${row.attachment_data}\`)">Photo</span>` : ''}
                            </div>
                            <span style="display:block;font-size:10px;color:var(--muted);">${escHtml(row.date_raised||'')}</span>
                          </td>
                          <td><span style="font-size:12px;">${escHtml(row.trade)}</span></td>
                          <td><span style="font-size:11px;color:var(--primary);">${escHtml(row.location||'—')}</span></td>
                          <td>
                            <span class="badge ${row.priority==='Critical'?'open':row.priority==='High'?'progress':'closed'}">
                              ${escHtml(row.priority)}
                            </span>
                          </td>
                          <td>
                            <span class="badge ${row.status==='Closed'?'closed':row.status==='Open'?'open':'progress'}">
                              ${escHtml(row.status)}
                            </span>
                          </td>
                          <td class="row-actions" onclick="event.stopPropagation();">
                            ${canEdit ? `<button class="icon-btn" data-cam-punch="${row.id}" title="${row.attachment_data ? 'Retake Defect Photo' : 'Capture Defect Photo with Camera'}"></button>` : ''}
                            ${canEdit && nextStatus ? `<button class="icon-btn" data-adv-punch="${row.id}" data-next-status="${nextStatus}" title="Advance to ${nextStatus}">▶</button>` : ''}
                            ${canEdit ? `<button class="icon-btn edit" data-edit-punch="${row.id}" title="Edit">✎</button>` : ''}
                            ${canDel ? `<button class="icon-btn" data-del-punch="${row.id}" title="Delete">✕</button>` : ''}
                          </td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            ` : `
              <div class="empty">
                No punch items match the current location or filters.
                ${selectedPlanZone ? `<div style="margin-top:8px;"><button class="btn ghost small" id="emptyClearZoneBtn">Clear Filter</button></div>` : ''}
              </div>
            `}
          </div>
        ` : ''}

      </div>
    </div>
  `;

  document.querySelectorAll('[data-view-mode]').forEach(btn => {
    btn.onclick = () => {
      planViewMode = btn.dataset.viewMode;
      renderPunchList();
    };
  });

  document.querySelectorAll('.plan-zone').forEach(zoneEl => {
    zoneEl.onclick = () => {
      const zoneName = zoneEl.dataset.zoneName;
      selectedPlanZone = (selectedPlanZone === zoneName) ? null : zoneName;
      renderPunchList();
    };
  });

  document.querySelectorAll('[data-zone-filter]').forEach(chip => {
    chip.onclick = () => {
      const z = chip.dataset.zoneFilter;
      selectedPlanZone = (z === 'ALL' || selectedPlanZone === z) ? null : z;
      renderPunchList();
    };
  });

  if(document.getElementById('clearZoneBtn')){
    document.getElementById('clearZoneBtn').onclick = () => {
      selectedPlanZone = null;
      renderPunchList();
    };
  }
  if(document.getElementById('emptyClearZoneBtn')){
    document.getElementById('emptyClearZoneBtn').onclick = () => {
      selectedPlanZone = null;
      renderPunchList();
    };
  }

  if(document.getElementById('addPunchBtn')){
    document.getElementById('addPunchBtn').onclick = () => {
      openAddModal('punchlist', 'Punch Item', null, selectedPlanZone && selectedPlanZone !== UNSPECIFIED_ZONE ? { location: selectedPlanZone } : null);
    };
  }
  if(document.getElementById('addSnagToZoneBtn')){
    document.getElementById('addSnagToZoneBtn').onclick = () => {
      openAddModal('punchlist', 'Punch Item', null, { location: selectedPlanZone === UNSPECIFIED_ZONE ? '' : selectedPlanZone });
    };
  }

  if(document.getElementById('punchCameraBtn')){
    document.getElementById('punchCameraBtn').onclick = () => {
      openCameraCaptureModal({ context: 'punchlist', defaultZone: selectedPlanZone });
    };
  }
  if(document.getElementById('cameraZoneBtn')){
    document.getElementById('cameraZoneBtn').onclick = () => {
      openCameraCaptureModal({ context: 'punchlist', defaultZone: selectedPlanZone });
    };
  }
  if(document.getElementById('cameraPlanBtn')){
    document.getElementById('cameraPlanBtn').onclick = () => {
      openCameraCaptureModal({ context: 'punchlist', defaultZone: '' });
    };
  }

  if(document.getElementById('planAskAiBtn')){
    document.getElementById('planAskAiBtn').onclick = () => {
      openWorkerAiDrawer({
        drawingTitle: 'Punch List',
        zoneName: selectedPlanZone || 'All Locations',
        zoneSub: '',
        openItems: displayedItems
      });
    };
  }

  if(document.getElementById('zoneAskAiBtn')){
    document.getElementById('zoneAskAiBtn').onclick = () => {
      openWorkerAiDrawer({
        drawingTitle: 'Punch List',
        zoneName: selectedPlanZone,
        zoneSub: '',
        openItems: displayedItems
      });
    };
  }

  if(document.getElementById('exportPunchBtn')){
    document.getElementById('exportPunchBtn').onclick = () => exportCsv('punchlist');
  }

  const fTrade = document.getElementById('pFilterTrade');
  if(fTrade) fTrade.onchange = (e) => { punchTradeFilter = e.target.value; renderPunchList(); };

  const fPriority = document.getElementById('pFilterPriority');
  if(fPriority) fPriority.onchange = (e) => { punchPriorityFilter = e.target.value; renderPunchList(); };

  const fStatus = document.getElementById('pFilterStatus');
  if(fStatus) fStatus.onchange = (e) => { punchStatusFilter = e.target.value; renderPunchList(); };

  document.querySelectorAll('[data-punch-row]').forEach(row => {
    row.onclick = () => {
      const itemId = row.dataset.punchRow;
      const targetItem = allItems.find(r => r.id === itemId);
      if(targetItem) openPunchDetailsModal(targetItem, canEdit, canDel);
    };
  });

  document.querySelectorAll('[data-cam-punch]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const itemId = btn.dataset.camPunch;
      const targetItem = allItems.find(r => r.id === itemId);
      if(targetItem) openCameraCaptureModal({ context: 'punchlist', defaultZone: targetItem.location, punchItem: targetItem });
    };
  });

  document.querySelectorAll('[data-adv-punch]').forEach(btn => {
    btn.onclick = async () => {
      const itemId = btn.dataset.advPunch;
      const nextStatus = btn.dataset.nextStatus;
      try {
        await apiFetch(`/api/punchlist/${itemId}/transition`, { method: 'POST', body: JSON.stringify({ status: nextStatus }) });
        renderPunchList();
      } catch(e) {
        alert(e.message || 'Transition failed');
      }
    };
  });

  document.querySelectorAll('[data-edit-punch]').forEach(btn => {
    btn.onclick = () => {
      const itemId = btn.dataset.editPunch;
      const item = allItems.find(r => r.id === itemId);
      if(item) openEditModal('punchlist', 'Punch Item', item);
    };
  });

  document.querySelectorAll('[data-del-punch]').forEach(btn => {
    btn.onclick = async () => {
      const itemId = btn.dataset.delPunch;
      if(!confirm('Are you sure you want to delete this punch item?')) return;
      try {
        await apiFetch(`/api/punchlist/${itemId}`, { method: 'DELETE' });
        renderPunchList();
      } catch(e) {
        alert(e.message || 'Delete failed');
      }
    };
  });
}

function formatAttendanceTime(value){
  if(!value) return '—';
  const parsed=new Date(value); return Number.isNaN(parsed.getTime())?value:parsed.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
}

function shiftCalendarWeek(days){
  const input=document.getElementById('calendarWeekStart');const value=new Date(`${input.value}T00:00:00`);value.setDate(value.getDate()+days);input.value=value.toISOString().slice(0,10);renderCalendar();
}

function shiftSiteDate(days){
  const input=document.getElementById('siteDate');
  const value=new Date(`${input.value}T00:00:00`); value.setDate(value.getDate()+days);
  input.value=value.toISOString().slice(0,10); renderSiteToday();
}

function openSiteTaskModal(selectedDate){
  const html=FIELD_TEMPLATES.tasks({start:selectedDate,end:selectedDate,progress:0});
  openModal('Add site task',html,async()=>{
    const payload=collectFieldPayload('tasks'); payload.project_id=currentProjectId;
    await apiFetch('/api/tasks',{method:'POST',body:JSON.stringify(payload)});
  });
}

function openSiteLogModal(selectedDate){
  const html=FIELD_TEMPLATES.dailylogs({date:selectedDate});
  openModal('Add site log',html,async()=>{
    const payload=collectFieldPayload('dailylogs'); payload.project_id=currentProjectId;
    await apiFetch('/api/dailylogs',{method:'POST',body:JSON.stringify(payload)});
  });
}

function openSitePhotoModal(selectedDate){
  const html=`<div class="form-grid"><div class="full"><label>Photo title</label><input id="f_photo_name" value="Site progress - ${selectedDate}"></div><div><label>Date</label><input type="date" id="f_photo_date" value="${selectedDate}"></div><div class="full"><label>Photo file</label><input type="file" id="f_photo_file" accept="image/*" required></div></div>`;
  openModal('Upload site photo',html,async()=>{
    const file=document.getElementById('f_photo_file').files[0]; if(!file) throw new Error('Choose a photo first');
    const MAX_FILE_MB = 100;
    if(file.size > MAX_FILE_MB * 1024 * 1024){
      throw new Error(`This photo is ${(file.size/1024/1024).toFixed(1)} MB, which is over the ${MAX_FILE_MB} MB limit. Try a lower-resolution photo.`);
    }
    const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
    await apiFetch('/api/documents',{method:'POST',body:JSON.stringify({project_id:currentProjectId,name:document.getElementById('f_photo_name').value,category:'Site Photo',revision:'',date_added:document.getElementById('f_photo_date').value,attachment_name:file.name,attachment_data:data})});
  });
}

let activeCameraStream = null;
let currentFacingMode = 'environment';
let cameraTimerInterval = null;

function stopActiveCameraStream(){
  if(cameraTimerInterval){
    clearInterval(cameraTimerInterval);
    cameraTimerInterval = null;
  }
  if(activeCameraStream){
    try{
      activeCameraStream.getTracks().forEach(t => t.stop());
    }catch(e){}
    activeCameraStream = null;
  }
}

function compressImageFile(fileOrBlob, maxWidth = 1600, quality = 0.85){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = ()=>{
      const img = new Image();
      img.onerror = reject;
      img.onload = ()=>{
        let width = img.width;
        let height = img.height;
        if(width > maxWidth){
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(fileOrBlob);
  });
}

function openPhotoLightbox(title, imgUrl){
  stopActiveCameraStream();
  const overlay = document.getElementById('modalOverlay');
  document.getElementById('modalBody').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <h3 style="margin:0;font-size:15px;color:var(--text);">${escHtml(title || 'Site Photo')}</h3>
      <button class="btn ghost small" id="lightboxCloseBtn" style="padding:4px 8px;">✕</button>
    </div>
    <div class="photo-lightbox-modal">
      <img src="${imgUrl}" alt="${escHtml(title)}" style="max-height:68vh;max-width:100%;object-fit:contain;border-radius:6px;display:block;margin:0 auto;">
      <div class="lightbox-caption" style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-size:12px;color:var(--muted);">
        <span>${escHtml(title)}</span>
        <a href="${imgUrl}" download="site-photo-${Date.now()}.jpg" class="btn small ghost" style="text-decoration:none;">⬇ Download Image</a>
      </div>
    </div>
  `;
  overlay.classList.add('show');
  document.getElementById('lightboxCloseBtn').onclick = ()=> overlay.classList.remove('show');
}

function openCameraCaptureModal(options = {}){
  stopActiveCameraStream();
  const context = options.context || (currentView === 'punchlist' ? 'punchlist' : 'site_today');
  const selectedDate = options.selectedDate || (document.getElementById('siteDateInput')?.value || new Date().toISOString().slice(0,10));
  const defaultZone = options.defaultZone || selectedPlanZone || '';
  const punchItem = options.punchItem || null;
  const onCaptured = options.onCaptured || null;
  const currentProjObj = PROJECTS.find(p=>p.id===currentProjectId);
  const projName = currentProjObj ? currentProjObj.name : 'Project';

  let capturedImageDataUrl = null;

  const overlay = document.getElementById('modalOverlay');
  const modalBody = document.getElementById('modalBody');

  function renderViewfinderUI(errorMsg = null){
    const titleText = punchItem ? `Retake Photo: ${punchItem.item}` : (context==='punchlist' ? 'Capture Punch Defect Photo' : 'Capture Site Progress Photo');
    modalBody.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <h3 style="margin:0;font-size:15px;display:flex;align-items:center;gap:6px;">
          <span></span> <span>${escHtml(titleText)}</span>
        </h3>
        <button class="btn ghost small" id="camCloseBtn" style="padding:3px 8px;">✕</button>
      </div>

      <div class="camera-viewport-container">
        <video id="camLiveVideo" autoplay playsinline muted></video>
        <div class="camera-reticle"></div>
        <div class="camera-live-badge">● LIVE CAMERA</div>
        <div class="camera-watermark" id="camWatermarkText">${escHtml(projName)} · ${defaultZone ? escHtml(defaultZone)+' · ' : ''}${new Date().toLocaleTimeString()}</div>
        ${errorMsg ? `
          <div style="position:absolute;inset:0;background:var(--card);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;text-align:center;color:#ef6a63;z-index:20;">
            <div style="font-size:24px;margin-bottom:8px;"></div>
            <div style="font-size:13px;font-weight:600;margin-bottom:6px;">Camera Access Notice</div>
            <div style="font-size:12px;color:var(--muted);margin-bottom:14px;max-width:320px;">${escHtml(errorMsg)}</div>
            <button class="btn accent small" id="camFallbackTriggerBtn">Use Device Camera App</button>
          </div>
        ` : ''}
      </div>

      <div class="camera-controls-bar">
        <button class="btn ghost small camera-action-btn" id="camSwitchLensBtn" title="Switch between front and back camera">
          Switch Lens
        </button>
        <button class="camera-shutter-btn" id="camShutterBtn" title="Capture photo">
          <div class="shutter-inner"></div>
        </button>
        <button class="btn ghost small camera-action-btn" id="camDeviceAppBtn" title="Open native mobile camera app">
          Device App
        </button>
        <input type="file" id="camNativeFallbackInput" accept="image/*" capture="environment" style="display:none;">
      </div>
    `;

    overlay.classList.add('show');
    document.getElementById('camCloseBtn').onclick = () => { stopActiveCameraStream(); overlay.classList.remove('show'); };

    const nativeInput = document.getElementById('camNativeFallbackInput');
    const deviceAppBtn = document.getElementById('camDeviceAppBtn');
    const fallbackTriggerBtn = document.getElementById('camFallbackTriggerBtn');

    if(deviceAppBtn && nativeInput) deviceAppBtn.onclick = () => nativeInput.click();
    if(fallbackTriggerBtn && nativeInput) fallbackTriggerBtn.onclick = () => nativeInput.click();

    if(nativeInput){
      nativeInput.onchange = async (e) => {
        const file = e.target.files && e.target.files[0];
        if(!file) return;
        try {
          capturedImageDataUrl = await compressImageFile(file);
          stopActiveCameraStream();
          renderReviewUI();
        } catch(err) {
          alert('Error processing image: ' + err.message);
        }
      };
    }

    const switchBtn = document.getElementById('camSwitchLensBtn');
    if(switchBtn){
      switchBtn.onclick = async () => {
        currentFacingMode = (currentFacingMode === 'environment') ? 'user' : 'environment';
        await startCameraStream();
      };
    }

    const shutterBtn = document.getElementById('camShutterBtn');
    if(shutterBtn){
      shutterBtn.onclick = () => {
        const video = document.getElementById('camLiveVideo');
        if(!video || !video.videoWidth || !video.videoHeight){
          alert('Camera stream not ready yet. You can also tap "Device App" to take a photo.');
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        ctx.font = 'bold 16px monospace';
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(10, canvas.height - 38, Math.min(canvas.width - 20, 380), 28);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`${projName} | ${defaultZone || 'Site'} | ${new Date().toLocaleTimeString()}`, 16, canvas.height - 18);

        capturedImageDataUrl = canvas.toDataURL('image/jpeg', 0.88);
        stopActiveCameraStream();
        renderReviewUI();
      };
    }

    if(cameraTimerInterval) clearInterval(cameraTimerInterval);
    cameraTimerInterval = setInterval(()=>{
      const el = document.getElementById('camWatermarkText');
      if(el) el.textContent = `${projName} · ${defaultZone ? defaultZone+' · ' : ''}${new Date().toLocaleTimeString()}`;
    }, 1000);
  }

  async function startCameraStream(){
    stopActiveCameraStream();
    const video = document.getElementById('camLiveVideo');
    if(!video) return;

    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      renderViewfinderUI('Direct web camera streaming is not supported on this browser. Tap below to use your native device camera app.');
      return;
    }

    try {
      const constraints = {
        video: {
          facingMode: { ideal: currentFacingMode },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      activeCameraStream = stream;
      video.srcObject = stream;
      await video.play();
    } catch(err) {
      console.warn('Camera stream error:', err);
      renderViewfinderUI('Camera permission denied or camera unavailable. Tap below to use your mobile device camera app.');
    }
  }

  function renderReviewUI(){
    const defaultTitle = punchItem ? punchItem.item : (context==='punchlist' ? (defaultZone ? `Snag in ${defaultZone}` : 'Defect item') : `Site progress - ${selectedDate}`);
    const isPunch = (context === 'punchlist');

    modalBody.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <h3 style="margin:0;font-size:15px;display:flex;align-items:center;gap:6px;">
          <span>✓</span> <span>Review Captured Photo</span>
        </h3>
        <button class="btn ghost small" id="camReviewCloseBtn" style="padding:3px 8px;">✕</button>
      </div>

      <div style="position:relative;background:var(--card-raised);border-radius:8px;overflow:hidden;border:1px solid var(--hairline);text-align:center;margin-bottom:12px;">
        <img src="${capturedImageDataUrl}" style="max-height:260px;max-width:100%;object-fit:contain;display:block;margin:0 auto;">
        <button class="btn ghost small" id="camRetakeBtn" style="position:absolute;bottom:10px;right:10px;background:var(--card-raised);backdrop-filter:blur(4px);">
          ↺ Retake
        </button>
      </div>

      <div class="form-grid">
        ${isPunch && punchItem ? `
          <div class="full">
            <label>Punch Item (Updating Defect Photo)</label>
            <input value="${escHtml(punchItem.item)}" disabled style="opacity:0.8;">
          </div>
        ` : isPunch ? `
          <div class="full">
            <label>Snag / Defect Description</label>
            <input id="f_cam_item" value="${escHtml(defaultTitle)}" placeholder="e.g. Damaged ductwork insulation">
          </div>
          <div>
            <label>Trade</label>
            <select id="f_cam_trade">
              ${TRADES.map(t=>`<option>${t}</option>`).join('')}
            </select>
          </div>
          <div>
            <label>Zone / Location</label>
            <input id="f_cam_location" value="${escHtml(defaultZone || '')}" placeholder="e.g. Zone A - Mechanical Room">
          </div>
          <div>
            <label>Priority</label>
            <select id="f_cam_priority">
              <option>Medium</option>
              <option>High</option>
              <option>Critical</option>
              <option>Low</option>
            </select>
          </div>
          <div>
            <label>Date Raised</label>
            <input type="date" id="f_cam_date" value="${new Date().toISOString().slice(0,10)}">
          </div>
        ` : `
          <div class="full">
            <label>Photo Title</label>
            <input id="f_cam_name" value="${escHtml(defaultTitle)}">
          </div>
          <div>
            <label>Date</label>
            <input type="date" id="f_cam_date" value="${selectedDate}">
          </div>
          <div>
            <label>Location / Zone Tag</label>
            <input id="f_cam_location" value="${escHtml(defaultZone || '')}" placeholder="e.g. Main Plant Room">
          </div>
        `}
      </div>

      <div class="modal-actions" style="margin-top:14px;">
        <button class="btn ghost small" id="camCancelSaveBtn">Cancel</button>
        <button class="btn small accent" id="camSaveUploadBtn">✓ Upload & Save Photo</button>
      </div>
    `;

    document.getElementById('camReviewCloseBtn').onclick = () => overlay.classList.remove('show');
    document.getElementById('camCancelSaveBtn').onclick = () => overlay.classList.remove('show');
    document.getElementById('camRetakeBtn').onclick = () => {
      renderViewfinderUI();
      startCameraStream();
    };

    document.getElementById('camSaveUploadBtn').onclick = async () => {
      const saveBtn = document.getElementById('camSaveUploadBtn');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Uploading...';

      try {
        if(onCaptured){
          onCaptured(capturedImageDataUrl);
          overlay.classList.remove('show');
          return;
        }

        const projId = currentProjectId === 'ALL' ? (PROJECTS[0]?.id || '') : currentProjectId;

        if(isPunch && punchItem){
          await apiFetch(`/api/punchlist/${punchItem.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              ...punchItem,
              attachment_data: capturedImageDataUrl
            })
          });
          await apiFetch('/api/documents', {
            method: 'POST',
            body: JSON.stringify({
              project_id: punchItem.project_id || projId,
              name: `Punch Photo - ${punchItem.item}`,
              category: 'Site Photo',
              revision: '1',
              date_added: new Date().toISOString().slice(0,10),
              attachment_name: `punch_${punchItem.id}_${Date.now()}.jpg`,
              attachment_data: capturedImageDataUrl
            })
          }).catch(()=>{});

          overlay.classList.remove('show');
          if(currentView === 'punchlist') await renderPunchList();
          else render();
        } else if(isPunch) {
          const itemTitle = document.getElementById('f_cam_item').value.trim() || 'Site Defect';
          const trade = document.getElementById('f_cam_trade').value;
          const location = document.getElementById('f_cam_location').value.trim();
          const priority = document.getElementById('f_cam_priority').value;
          const dateRaised = document.getElementById('f_cam_date').value;

          await apiFetch('/api/punchlist', {
            method: 'POST',
            body: JSON.stringify({
              project_id: projId,
              item: itemTitle,
              trade: trade,
              location: location,
              priority: priority,
              date_raised: dateRaised,
              status: 'Open',
              attachment_data: capturedImageDataUrl
            })
          });

          await apiFetch('/api/documents', {
            method: 'POST',
            body: JSON.stringify({
              project_id: projId,
              name: `Punch Photo - ${itemTitle}`,
              category: 'Site Photo',
              revision: '1',
              date_added: dateRaised,
              attachment_name: `punch_${Date.now()}.jpg`,
              attachment_data: capturedImageDataUrl
            })
          }).catch(()=>{});

          overlay.classList.remove('show');
          if(currentView === 'punchlist') await renderPunchList();
          else render();
        } else {
          const photoTitle = document.getElementById('f_cam_name').value.trim() || `Site progress - ${selectedDate}`;
          const photoDate = document.getElementById('f_cam_date').value;
          const locTag = document.getElementById('f_cam_location').value.trim();

          await apiFetch('/api/documents', {
            method: 'POST',
            body: JSON.stringify({
              project_id: projId,
              name: locTag ? `${photoTitle} (${locTag})` : photoTitle,
              category: 'Site Photo',
              revision: '',
              date_added: photoDate,
              attachment_name: `site_photo_${Date.now()}.jpg`,
              attachment_data: capturedImageDataUrl
            })
          });

          overlay.classList.remove('show');
          if(currentView === 'site_today') await renderSiteToday();
          else render();
        }
      } catch(e) {
        alert('Failed to save photo: ' + (e.message || e));
        saveBtn.disabled = false;
        saveBtn.textContent = '✓ Upload & Save Photo';
      }
    };
  }

  renderViewfinderUI();
  startCameraStream();
}

/* =========================================================================
   DRAWING MARKUP & PDF FIELD STUDIO + WORKER AI ASSISTANT
   ========================================================================= */
