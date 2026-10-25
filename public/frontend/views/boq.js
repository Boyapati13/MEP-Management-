let octoStatus = 'Pending';
async function renderOctoInbox(){
  const host = document.getElementById('viewContent');
  const projectId = currentProjectId;
  if(!['Admin','ProjectManager'].includes(ME.role)){ host.textContent='Project manager access required.'; return; }
  if(!projectId || projectId==='ALL'){ host.textContent='Select one project to view its WhatsApp inbox.'; return; }
  const [rows, groups] = await Promise.all([
    apiFetch('/api/octo/inbox?project_id='+encodeURIComponent(projectId)+'&status='+octoStatus), apiFetch('/api/octo/groups')
  ]);
  if(currentProjectId!==projectId || currentView!=='octo_inbox') return;
  host.innerHTML = `<div class="panel"><h3>WhatsApp project inbox</h3>
    <p style="margin:12px 0;color:var(--muted)">Review site messages before creating project records. Categories are keyword suggestions. Latest 200 messages.</p>
    <p id="octoError" role="alert" style="color:var(--danger)"></p>
    <div id="octoGroups"></div><div id="octoMap"></div>
    <label>Status <select id="octoFilter">${['Pending','Approved','Rejected','All'].map(s=>`<option ${s===octoStatus?'selected':''}>${s}</option>`).join('')}</select></label>
    <button class="btn" id="octoRefresh">Refresh</button><div id="octoMessages"></div><div id="octoReview"></div></div>`;
  const fail = e => { document.getElementById('octoError').textContent=e.message; };
  const mutate = async (path, body, method='POST') => { await apiFetch(path,{method,body:JSON.stringify(body)}); await renderOctoInbox(); };
  const mapped = groups.filter(g=>g.project_id===projectId);
  const groupHost=document.getElementById('octoGroups');
  groupHost.textContent=mapped.length ? '' : 'No groups mapped yet. Pair Octo, then map a group to this project.';
  mapped.forEach(g=>{
    const p=document.createElement('p'); p.style.margin='12px 0';
    const label=document.createElement('span'); label.textContent=g.name+' · '+g.group_id+' · '+(g.active?'Enabled':'Paused'); p.append(label);
    if(ME.role==='Admin'){
      const btn=document.createElement('button'); btn.className='btn'; btn.textContent=g.active?'Pause':'Enable';
      btn.onclick=async()=>{ btn.disabled=true; try{await mutate('/api/octo/groups',{...g,active:!g.active},'PUT');}catch(e){fail(e);btn.disabled=false;} };p.append(btn);
    } groupHost.append(p);
  });
  if(ME.role==='Admin'){
    document.getElementById('octoMap').innerHTML=`<form id="octoMapForm" style="margin:16px 0;display:flex;gap:8px;flex-wrap:wrap"><label>Group name <input name="name" required maxlength="200"></label><label>Group ID <input name="group" placeholder="120…@g.us" required maxlength="100"></label><button class="btn" type="submit">Map group</button></form>`;
    document.getElementById('octoMapForm').onsubmit=async e=>{
      e.preventDefault();const form=e.currentTarget; const btn=form.querySelector('button');btn.disabled=true;
      try{await mutate('/api/octo/groups',{project_id:projectId,group_id:form.elements.group.value,name:form.elements.name.value,active:true},'PUT');}catch(err){fail(err);btn.disabled=false;}
    };
  }
  document.getElementById('octoFilter').onchange=e=>{octoStatus=e.target.value;renderOctoInbox().catch(fail);};
  document.getElementById('octoRefresh').onclick=()=>renderOctoInbox().catch(fail);
  const list=document.getElementById('octoMessages');
  if(!rows.length){const p=document.createElement('p');p.style.margin='20px 0';p.textContent='No messages in this view. New text messages appear after Octo is linked and the group is enabled in both applications.';list.append(p);}
  rows.forEach(row=>{
    const article=document.createElement('article');article.className='panel';article.style.marginTop='16px';
    const meta=document.createElement('p');meta.style.color='var(--muted)';meta.textContent=[row.group_name,row.sender,new Date(row.sent_at).toLocaleString(),row.category,row.status].join(' · ');
    const body=document.createElement('p');body.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0';body.textContent=row.body;article.append(meta,body);
    if(row.record_id){const p=document.createElement('p');p.textContent='Created '+row.record_type+' · '+row.record_id;article.append(p);}
    if(row.status==='Pending'){
      const review=document.createElement('button');review.className='btn';review.textContent='Review';
      review.onclick=()=>{
        const editor=document.getElementById('octoReview');editor.innerHTML=`<form id="octoReviewForm" class="panel" style="margin-top:16px"><h3>Approve project record</h3><p id="octoSource" style="white-space:pre-wrap;margin:12px 0"></p><label>Create <select name="kind"><option value="dailylog">Site log</option><option value="task">Task</option></select></label><label style="display:block;margin:12px 0">Reviewed text<textarea name="text" required maxlength="10000" rows="4" style="width:100%"></textarea></label><p>Task titles must be 300 characters or fewer.</p><button class="btn" type="submit">Approve and create</button><button class="btn" type="button" id="octoCancel">Cancel</button></form>`;
        document.getElementById('octoSource').textContent='Source: '+row.body;
        const form=document.getElementById('octoReviewForm');form.elements.text.value=row.body;
        document.getElementById('octoCancel').onclick=()=>{editor.innerHTML='';};
        form.onsubmit=async e=>{e.preventDefault();const btn=form.querySelector('button[type=submit]');btn.disabled=true;try{await mutate('/api/octo/inbox/'+row.id+'/review',{action:'approve',record_type:form.elements.kind.value,text:form.elements.text.value});}catch(err){fail(err);btn.disabled=false;}};
        editor.scrollIntoView({behavior:'smooth',block:'nearest'});
      };
      const reject=document.createElement('button');reject.className='btn';reject.textContent='Dismiss';reject.onclick=async()=>{reject.disabled=true;try{await mutate('/api/octo/inbox/'+row.id+'/review',{action:'reject'});}catch(e){fail(e);reject.disabled=false;}};
      article.append(review,reject);
    }list.append(article);
  });
}

async function renderBOQ(){
  const rows = await apiFetch(`/api/boq_items?project_id=${currentProjectId}`);
  const canImport = ME.permissions.edit.includes('budget') && currentProjectId !== 'ALL';
  const canSchedule = ME.permissions.edit.includes('tasks') && currentProjectId !== 'ALL';
  const canMat = ME.permissions.edit.includes('material_requests') && currentProjectId !== 'ALL';
  const canEditBOQ = ME.permissions.edit.includes('budget') && currentProjectId !== 'ALL';

  const totalTender = rows.reduce((s, r) => s + Number(r.tender_amount || (Number(r.tender_quantity||0)*Number(r.tender_rate||0)) || 0), 0);
  const totalInstalledVal = rows.reduce((s, r) => s + (Number(r.installed_quantity||0) * Number(r.tender_rate||0)), 0);
  const totalCertifiedVal = rows.reduce((s, r) => s + (Number(r.certified_quantity||0) * Number(r.tender_rate||0)), 0);
  const systemsCount = new Set(rows.map(r => r.system).filter(Boolean)).size;

  document.getElementById('viewContent').innerHTML = `
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:14px;">
      <div class="stat-card"><div class="num">${rows.length}</div><div class="lbl">BOQ Line Items (${systemsCount} Systems)</div></div>
      <div class="stat-card"><div class="num">${fmtCurrency(totalTender)}</div><div class="lbl">Total Tender Value</div></div>
      <div class="stat-card"><div class="num" style="color:#38bdf8;">${fmtCurrency(totalInstalledVal)}</div><div class="lbl">Installed Work Value</div></div>
      <div class="stat-card"><div class="num" style="color:#10b981;">${fmtCurrency(totalCertifiedVal)}</div><div class="lbl">Certified Value</div></div>
    </div>
    <div class="panel">
      <h3>
        <span>BOQ / Tender Register</span>
        <span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          ${canSchedule ? '<button class="btn ghost small" id="boqGenProgrammeBtn" title="Generate 3-phase construction tasks from BOQ systems">⚡ Programme from BOQ</button>' : ''}
          ${canMat ? '<button class="btn ghost small" id="boqGenMaterialsBtn" title="Generate Material Requests for all BOQ supply lines">📦 Material List from BOQ</button>' : ''}
          ${canImport ? '<button class="btn accent small" id="boqUploadBtn">Import CSV / XLSX / PDF</button>' : '<span style="font-size:11px;color:var(--muted);">Select one project to import</span>'}
          <button class="btn ghost small" id="boqExportBtn">Export CSV</button>
        </span>
      </h3>
      <div class="api-banner" id="boqResult"></div>
      ${rows.length?`<table><thead><tr><th>Item</th><th>Description</th><th>Discipline</th><th>System</th><th>Unit</th><th>Tender qty</th><th>Installed</th><th>Claimed</th><th>Certified</th><th>Rate</th><th>Amount</th>${canSchedule||canEditBOQ?'<th>Execution</th>':''}</tr></thead><tbody>${rows.map(row=>`<tr><td style="font-family:monospace;">${escHtml(row.item_number)}</td><td><b>${escHtml(row.description)}</b></td><td><span class="disc-pill ${disciplineClass(row.discipline)}">${escHtml(row.discipline||'MEP')}</span></td><td>${escHtml(row.system)}</td><td>${escHtml(row.unit)}</td><td>${row.tender_quantity||0}</td><td>${row.installed_quantity||0}</td><td>${row.claimed_quantity||0}</td><td>${row.certified_quantity||0}</td><td>${fmtCurrency(row.tender_rate)}</td><td><b>${fmtCurrency(row.tender_amount)}</b></td>${canSchedule||canEditBOQ?`<td class="row-actions">${canEditBOQ?`<button class="btn ghost small" data-edit-boq="${row.id}">Qty</button>`:''}${canSchedule?` <button class="btn accent small" data-schedule-boq="${row.id}">+ Plan Task</button>`:''}</td>`:''}</tr>`).join('')}</tbody></table>`:'<div class="empty">No BOQ lines imported for this project. Import a CSV, XLSX, or PDF tender schedule to generate tasks and material lists.</div>'}
    </div>`;
  document.getElementById('boqExportBtn').onclick = ()=>exportCsv('boq_items');
  document.querySelectorAll('[data-schedule-boq]').forEach(btn=>btn.onclick=()=>openBOQTaskModal(rows.find(row=>row.id===btn.dataset.scheduleBoq)));
  document.querySelectorAll('[data-edit-boq]').forEach(btn=>btn.onclick=()=>openBOQEditModal(rows.find(row=>row.id===btn.dataset.editBoq)));
  if(document.getElementById('boqGenProgrammeBtn')){
    document.getElementById('boqGenProgrammeBtn').onclick = async ()=>{
      const result = document.getElementById('boqResult');
      result.textContent = 'Generating construction programme from BOQ systems...';
      result.classList.add('show');
      try{
        const count = await generateProgrammeFromBOQ(rows);
        result.innerHTML = count > 0
          ? `✓ Added <b>${count} programme tasks</b> to Tasks & Schedule. <a href="#" id="goTasksAfterBoq" style="color:#f59e0b;font-weight:700;margin-left:8px;">Open Tasks Board →</a>`
          : `All BOQ discipline groups are already in the Tasks & Schedule board. <a href="#" id="goTasksAfterBoq" style="color:#f59e0b;font-weight:700;margin-left:8px;">Open Tasks Board →</a>`;
        const link = document.getElementById('goTasksAfterBoq');
        if(link) link.onclick = (e)=>{ e.preventDefault(); currentView='tasks'; document.getElementById('viewTitle').textContent='Tasks & Schedule'; render(); };
      }catch(err){ result.textContent = err.message; }
    };
  }
  if(document.getElementById('boqGenMaterialsBtn')){
    document.getElementById('boqGenMaterialsBtn').onclick = async ()=>{
      const result = document.getElementById('boqResult');
      result.textContent = 'Extracting supply items from BOQ into Material Requests...';
      result.classList.add('show');
      try{
        const count = await generateMaterialListFromBOQ(rows);
        result.innerHTML = count > 0
          ? `✓ Created <b>${count} Material Requests</b> from BOQ supply lines. <a href="#" id="goMatAfterBoq" style="color:#f59e0b;font-weight:700;margin-left:8px;">Open Material Requests →</a>`
          : `All BOQ supply lines already have Material Requests.`;
        const link = document.getElementById('goMatAfterBoq');
        if(link) link.onclick = (e)=>{ e.preventDefault(); currentView='material_requests'; document.getElementById('viewTitle').textContent='Material Requests'; render(); };
      }catch(err){ result.textContent = err.message; }
    };
  }
  if(canImport) document.getElementById('boqUploadBtn').onclick = async ()=>{
    const input = document.createElement('input'); input.type='file'; input.accept='.csv,.tsv,.txt,.xlsx,.xls,.pdf,.docx';
    input.onchange = async ()=>{
      const file = input.files[0]; if(!file) return;
      const form = new FormData(); form.append('project_id', currentProjectId); form.append('file', file);
      const result = document.getElementById('boqResult'); result.textContent='⏳ Scanning & importing BOQ / Contract, auto-filling project budget, work packages, tasks & material requests...'; result.classList.add('show');
      try{
        const response = await fetch(API+'/api/boq/import', {method:'POST', headers:{Authorization:'Bearer '+TOKEN}, body:form});
        const data = await response.json(); if(!response.ok) throw new Error(data.error||'Import failed');
        PROJECTS = await apiFetch('/api/projects');
        if(typeof updateJobContextRibbon === 'function') updateJobContextRibbon();
        await renderBOQ();
        const afterResult = document.getElementById('boqResult');
        if(afterResult){
          afterResult.classList.add('show');
          afterResult.innerHTML = `✓ <b>Auto-Filled from ${escHtml(file.name)}:</b> Imported <b>${data.imported_lines} BOQ lines</b> (${fmtCurrency(data.tender_amount)} tender value across ${data.systems} systems), created <b>${data.work_packages_created||0} Work Packages</b>, <b>${data.tasks_created||0} Schedule Tasks</b> & <b>${data.material_requests_created||0} Material Requests</b>.`;
        }
      }catch(error){ result.textContent=error.message; result.classList.add('show'); }
    }; input.click();
  };
}

function openBOQTaskModal(item){
  if(!item) return;
  const date=document.getElementById('siteDate')?.value||new Date().toISOString().slice(0,10);
  const html=FIELD_TEMPLATES.tasks(null).replace('id="f_title" value=""',`id="f_title" value="${escHtml(item.description)}"`);
  openModal('Schedule BOQ work',html,async()=>{
    const payload=collectFieldPayload('tasks'); payload.project_id=currentProjectId;
    if(!payload.start) payload.start=date; if(!payload.end) payload.end=date;
    await apiFetch('/api/tasks',{method:'POST',body:JSON.stringify(payload)});
  });
}

function openBOQEditModal(item){
  if(!item) return;
  const html=`<div class="form-grid"><div class="full"><label>BOQ description</label><input value="${escHtml(item.description)}" disabled></div><div><label>Revised quantity</label><input type="number" id="f_revised_quantity" value="${item.revised_quantity||0}"></div><div><label>Installed quantity</label><input type="number" id="f_installed_quantity" value="${item.installed_quantity||0}"></div><div><label>Claimed quantity</label><input type="number" id="f_claimed_quantity" value="${item.claimed_quantity||0}"></div><div><label>Certified quantity</label><input type="number" id="f_certified_quantity" value="${item.certified_quantity||0}"></div></div>`;
  openModal('Update BOQ progress',html,async()=>{
    const payload={revised_quantity:document.getElementById('f_revised_quantity').value,installed_quantity:document.getElementById('f_installed_quantity').value,claimed_quantity:document.getElementById('f_claimed_quantity').value,certified_quantity:document.getElementById('f_certified_quantity').value};
    await apiFetch(`/api/boq_items/${item.id}`,{method:'PUT',body:JSON.stringify(payload)});
  });
}
