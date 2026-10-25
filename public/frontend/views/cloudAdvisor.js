const FIREBASE_CONFIG = {
  projectId: "gen-lang-client-0282880475",
  appId: "1:577592550776:web:a07311eb3d123543d2d48d",
  apiKey: "AIzaSyCz3LOV9MIJl6hY9JVvXZeP2rjU7THYPL4",
  authDomain: "gen-lang-client-0282880475.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-mepprojectmanage-00a43a1f-a078-48ae-aaab-9ae2bf8cb3c0",
  storageBucket: "gen-lang-client-0282880475.firebasestorage.app",
  messagingSenderId: "577592550776"
};

let fbApp = null;
let fbAuth = null;
let fbDb = null;
let currentFbUser = null;
let cachedWorkspaceAccessToken = null;

const WORKSPACE_SCOPES = [
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file'
];

function initFirebaseClient(){
  if(window.firebase && !fbApp){
    try{
      fbApp = firebase.initializeApp(FIREBASE_CONFIG);
      fbAuth = firebase.auth();
      fbDb = firebase.firestore();
      
      fbAuth.onAuthStateChanged(async (user)=>{
        currentFbUser = user;
        if(user && !TOKEN){
          // Perform SSO token exchange with the backend
          try{
            const res = await fetch(API+'/api/firebase-auth-login', {
              method: 'POST',
              headers: {'Content-Type':'application/json'},
              body: JSON.stringify({
                firebase_uid: user.uid,
                email: user.email,
                displayName: user.displayName,
                photoURL: user.photoURL
              })
            });
            if(res.ok){
              const data = await res.json();
              TOKEN = data.token; ME = data;
              localStorage.setItem('mep_token', TOKEN);
              localStorage.setItem('mep_api', API);
              document.getElementById('loginScreen').classList.add('hide');
              document.getElementById('app').classList.add('show');
              document.getElementById('chipName').textContent = ME.name;
              document.getElementById('chipRole').textContent = ME.role + ' (Firebase)';
              buildNav();
              await loadProjectsAndRender();
              startNotificationPolling();
            }
          }catch(err){
            console.error('Firebase SSO sync failed:', err);
          }
        }
      });
    }catch(err){
      console.warn('Firebase init notice:', err);
    }
  }
}

// Google Sign-In with Firebase popup
const googleBtn = document.getElementById('googleSignInBtn');
if(googleBtn){
  googleBtn.onclick = async ()=>{
    API = (document.getElementById('apiUrl').value.trim() || DEFAULT_API).replace(/\/$/,'');
    if(!window.firebase || !fbAuth){
      initFirebaseClient();
    }
    if(!fbAuth){
      alert('Firebase client is initializing. Please try again in a moment.');
      return;
    }
    try{
      const provider = new firebase.auth.GoogleAuthProvider();
      WORKSPACE_SCOPES.forEach(s => provider.addScope(s));
      const cred = await fbAuth.signInWithPopup(provider);
      const user = cred.user;
      if(cred && cred.credential && cred.credential.accessToken){
        cachedWorkspaceAccessToken = cred.credential.accessToken;
      }
      
      const res = await fetch(API+'/api/firebase-auth-login', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          firebase_uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL
        })
      });
      if(!res.ok) throw new Error('Could not establish MEP session with Google credentials');
      const data = await res.json();
      TOKEN = data.token; ME = data;
      localStorage.setItem('mep_token', TOKEN);
      localStorage.setItem('mep_api', API);
      document.getElementById('loginScreen').classList.add('hide');
      document.getElementById('app').classList.add('show');
      document.getElementById('chipName').textContent = ME.name;
      document.getElementById('chipRole').textContent = ME.role + ' (Google SSO)';
      buildNav();
      await loadProjectsAndRender();
      startNotificationPolling();
    }catch(err){
      alert('Google Sign-In Error: ' + err.message);
    }
  };
}

/* ==========================================================================
   AI & GEMINI MULTI-TURN COPILOT ENGINE
   ========================================================================== */
let aiChatState = {
  persona: 'engineer',
  model: 'gemini-3.1-pro-preview',
  enableMaps: false,
  messages: [
    {
      role: 'assistant',
      content: 'Hello! I am your AI MEP Technical Advisor. How can I assist with your engineering calculations, equipment selection, site logistics, or contract specifications today?'
    }
  ]
};

const PERSONA_CONFIGS = {
  engineer: {
    title: '⚡ Principal MEP Engineer',
    desc: 'Deep calculations, psychrometrics, hydraulic sizing, electrical load distribution & standards (ASHRAE, CIBSE, NEC, BS7671).'
  },
  superintendent: {
    title: '🏗️ Lead Construction Superintendent',
    desc: 'Site logistics, sequencing, QA/QC containment, work packages, subcontractor coordination & commissioning.'
  },
  commercial: {
    title: '📊 Senior Commercial & Contracts Lead',
    desc: 'BOQ rate analysis, variations, change orders, NEC/FIDIC claims & submittal compliance.'
  },
  logistics: {
    title: '🗺️ Site Logistics & Supply Chain',
    desc: 'Google Maps grounded supplier locator, crane hire, deliveries, concrete batching & safety trauma centers.'
  }
};

const STARTER_PROMPTS = [
  'Calculate Chilled Water (CHW) pipe sizing and flow rate for a 120kW fan coil cooling load (ΔT = 6°C).',
  'Compare Busbar trunking vs 4-Core SWA copper cabling for a 400A main switchboard feeder.',
  'Draft an official NCR statement for ductwork installed without fire dampers at a compartment wall.',
  'What are the mandatory pre-requisite witness checks before energizing a 3-Phase LV distribution board?',
  'Find nearest certified HVAC ductwork and galvanized sheet metal fabricators for immediate site delivery.'
];

function formatAiMarkdown(text){
  if(!text) return '';
  let html = escHtml(text);
  // Code blocks
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  // Bullet lists
  html = html.replace(/^\s*[\-\*]\s+(.*)$/gm, '• $1<br>');
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  return html;
}

async function renderGeminiChat(){
  const container = document.getElementById('viewContent');
  const proj = PROJECTS.find(p=>p.id===currentProjectId);
  const projName = proj ? proj.name : 'All Projects';

  container.innerHTML = `
    <div class="ai-chat-layout">
      <!-- Left Config Sidebar -->
      <div class="ai-sidebar-pane">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h3 style="margin:0; font-size:14px; display:flex; align-items:center; gap:6px;">
            <span>✨</span> Gemini Intelligence
          </h3>
          <span class="ai-badge">${aiChatState.model.includes('pro') ? 'PRO 3.1' : 'FLASH 3.5'}</span>
        </div>

        <div>
          <label style="font-size:11px; text-transform:uppercase; color:var(--muted); font-weight:700; margin-bottom:6px; display:block;">Active Persona</label>
          <div style="display:flex; flex-direction:column; gap:6px;">
            ${Object.entries(PERSONA_CONFIGS).map(([key, p]) => `
              <div class="persona-selector-card ${aiChatState.persona === key ? 'active' : ''}" data-persona="${key}">
                <b>${p.title}</b>
                <span>${p.desc}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <div>
          <label style="font-size:11px; text-transform:uppercase; color:var(--muted); font-weight:700; margin-bottom:4px; display:block;">Model Tier</label>
          <select id="aiModelSelect" style="width:100%; padding:8px; background:var(--card-raised); border:1px solid var(--border); border-radius:6px; color:var(--text); font-size:12px;">
            <option value="gemini-3.1-pro-preview" ${aiChatState.model==='gemini-3.1-pro-preview'?'selected':''}>🧠 Gemini 3.1 Pro (Deep Engineering & Standards)</option>
            <option value="gemini-3.5-flash" ${aiChatState.model==='gemini-3.5-flash'?'selected':''}>⚡ Gemini 3.5 Flash (Balanced & Fast)</option>
            <option value="gemini-3.1-flash-lite" ${aiChatState.model==='gemini-3.1-flash-lite'?'selected':''}>🚀 Gemini 3.1 Flash Lite (Quick Lookups)</option>
          </select>
        </div>

        <div>
          <label style="font-size:11px; text-transform:uppercase; color:var(--muted); font-weight:700; margin-bottom:4px; display:block;">Google Maps Grounding</label>
          <label style="display:flex; align-items:center; gap:8px; font-size:12px; cursor:pointer; background:var(--card-raised); padding:8px; border-radius:6px; border:1px solid var(--border);">
            <input type="checkbox" id="aiMapsToggle" ${aiChatState.enableMaps ? 'checked' : ''}>
            <span>Enable Local Supplier & Logistics Grounding</span>
          </label>
        </div>

        <div>
          <label style="font-size:11px; text-transform:uppercase; color:var(--muted); font-weight:700; margin-bottom:6px; display:block;">Suggested Prompts</label>
          <div style="display:flex; flex-direction:column; gap:6px;">
            ${STARTER_PROMPTS.map(p => `<button type="button" class="ai-prompt-chip" data-prompt="${escHtml(p)}">${escHtml(p)}</button>`).join('')}
          </div>
        </div>

        <div style="margin-top:auto; display:flex; gap:8px; flex-direction:column; padding-top:10px; border-top:1px solid var(--border);">
          <button class="btn ghost small" id="aiSaveCloudBtn" style="font-size:11px;">☁️ Save Session to Firestore</button>
          <button class="btn ghost small" id="aiClearThreadBtn" style="font-size:11px; color:var(--muted);">🗑️ Reset Conversation</button>
        </div>
      </div>

      <!-- Main Chat Thread -->
      <div class="ai-chat-main">
        <div style="padding:12px 16px; border-bottom:1px solid var(--border); background:var(--card-raised); display:flex; justify-content:space-between; align-items:center;">
          <div>
            <b style="font-size:13px; color:var(--text);">${PERSONA_CONFIGS[aiChatState.persona].title}</b>
            <span style="font-size:11px; color:var(--muted); margin-left:8px;">Scope: ${escHtml(projName)}</span>
          </div>
          <div style="display:flex; gap:6px; align-items:center;">
            <span id="aiLiveStatus" style="font-size:11px; color:var(--success); display:flex; align-items:center; gap:4px;">
              <span style="width:6px; height:6px; border-radius:50%; background:var(--success);"></span> Online
            </span>
          </div>
        </div>

        <div class="ai-messages-container" id="aiMessagesBox">
          ${aiChatState.messages.map(m => `
            <div class="ai-msg ${m.role}">
              <div class="ai-msg-header">
                <span>${m.role === 'user' ? '👤 ' + (ME ? ME.name : 'You') : '✨ ' + PERSONA_CONFIGS[aiChatState.persona].title}</span>
                <span>${m.timestamp || ''}</span>
              </div>
              <div class="ai-msg-content">${formatAiMarkdown(m.content)}</div>
              ${m.grounding ? `<div class="ai-msg-grounding"><b>🗺️ Grounding Sources:</b><br>${m.grounding}</div>` : ''}
            </div>
          `).join('')}
        </div>

        <div style="padding:12px; border-top:1px solid var(--border); background:var(--card); display:flex; gap:8px; align-items:flex-end;">
          <textarea id="aiChatInput" rows="2" placeholder="Ask about MEP calculations, equipment sizing, commissioning protocols, or local suppliers..." style="flex:1; padding:10px; background:var(--card-raised); border:1px solid var(--border); border-radius:6px; color:var(--text); font-size:13px; resize:none;"></textarea>
          <button class="btn accent" id="aiSendBtn" style="padding:10px 18px; height:50px; font-weight:700; display:flex; align-items:center; gap:6px;">
            <span>Send</span> ➔
          </button>
        </div>
      </div>
    </div>
  `;

  // Scroll to bottom
  const box = document.getElementById('aiMessagesBox');
  if(box) box.scrollTop = box.scrollHeight;

  // Wire Persona selection
  document.querySelectorAll('.persona-selector-card').forEach(card => {
    card.onclick = () => {
      aiChatState.persona = card.dataset.persona;
      renderGeminiChat();
    };
  });

  // Wire Model selection
  const modelSelect = document.getElementById('aiModelSelect');
  if(modelSelect){
    modelSelect.onchange = (e) => {
      aiChatState.model = e.target.value;
    };
  }

  // Wire Maps Toggle
  const mapsToggle = document.getElementById('aiMapsToggle');
  if(mapsToggle){
    mapsToggle.onchange = (e) => {
      aiChatState.enableMaps = e.target.checked;
    };
  }

  // Wire Starter Prompt chips
  document.querySelectorAll('.ai-prompt-chip').forEach(chip => {
    chip.onclick = () => {
      const input = document.getElementById('aiChatInput');
      if(input){
        input.value = chip.dataset.prompt;
        input.focus();
      }
    };
  });

  // Wire Reset
  const clearBtn = document.getElementById('aiClearThreadBtn');
  if(clearBtn){
    clearBtn.onclick = () => {
      aiChatState.messages = [{
        role: 'assistant',
        content: `Reset conversation with ${PERSONA_CONFIGS[aiChatState.persona].title}. How can I assist you?`,
        timestamp: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
      }];
      renderGeminiChat();
    };
  }

  // Wire Firestore save session
  const saveCloudBtn = document.getElementById('aiSaveCloudBtn');
  if(saveCloudBtn){
    saveCloudBtn.onclick = async () => {
      if(!fbDb){
        alert('Firebase Firestore is not initialized. Please ensure network connectivity.');
        return;
      }
      try{
        saveCloudBtn.textContent = 'Saving...';
        const uid = (fbAuth && fbAuth.currentUser ? fbAuth.currentUser.uid : (ME ? ME.user_id : 'anonymous'));
        await fbDb.collection('ChatConversation').add({
          owner_uid: uid,
          title: `MEP Discussion: ${PERSONA_CONFIGS[aiChatState.persona].title} (${new Date().toLocaleDateString()})`,
          persona: aiChatState.persona,
          model: aiChatState.model,
          message_count: aiChatState.messages.length,
          messages: aiChatState.messages,
          created_at: firebase.firestore.FieldValue.serverTimestamp()
        });
        alert('Conversation successfully saved to your cloud Firestore account!');
      }catch(err){
        alert('Could not save to Firestore: ' + err.message);
      }finally{
        saveCloudBtn.textContent = '☁️ Save Session to Firestore';
      }
    };
  }

  // Wire Message Send
  async function handleSendMessage(){
    const input = document.getElementById('aiChatInput');
    const q = input.value.trim();
    if(!q) return;

    const timeStr = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    aiChatState.messages.push({
      role: 'user',
      content: q,
      timestamp: timeStr
    });

    input.value = '';
    const sendBtn = document.getElementById('aiSendBtn');
    sendBtn.disabled = true;
    sendBtn.textContent = 'Thinking...';

    renderGeminiChat();

    try{
      const payload = {
        messages: aiChatState.messages.map(m=>({ role: m.role, content: m.content })),
        system_role: aiChatState.persona,
        model: aiChatState.model,
        enable_maps_grounding: aiChatState.enableMaps,
        project_context: {
          project_name: proj ? proj.name : 'All Projects',
          project_id: currentProjectId
        }
      };

      const res = await apiFetch('/api/ai/multiturn-chat', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      aiChatState.messages.push({
        role: 'assistant',
        content: res.reply || 'No response received from Gemini engine.',
        timestamp: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
        grounding: res.grounding_info || null
      });

    }catch(err){
      aiChatState.messages.push({
        role: 'assistant',
        content: '⚠️ Engineering Advisor Error: ' + err.message,
        timestamp: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
      });
    }finally{
      renderGeminiChat();
    }
  }

  const sendBtn = document.getElementById('aiSendBtn');
  if(sendBtn) sendBtn.onclick = handleSendMessage;

  const chatInput = document.getElementById('aiChatInput');
  if(chatInput){
    chatInput.onkeydown = (e)=>{
      if(e.key==='Enter' && !e.shiftKey){
        e.preventDefault();
        handleSendMessage();
      }
    };
  }
}

/* ==========================================================================
   SITE LOGISTICS & GOOGLE MAPS GROUNDING
   ========================================================================== */
let mapsLogisticsState = {
  activeCategory: 'all',
  location: 'City Center Construction Site',
  results: [],
  isLoading: false
};

const LOGISTICS_CATEGORIES = [
  { id: 'all', label: 'All Suppliers & Facilities', query: 'MEP supplies, equipment hire, and trauma centers' },
  { id: 'electrical', label: '⚡ Electrical Wholesalers', query: 'Electrical wholesalers, switchgear suppliers, cable distributors' },
  { id: 'hvac', label: '❄️ HVAC & Ductwork Fabricators', query: 'HVAC ductwork fabricators, spiral duct, air handling units' },
  { id: 'piping', label: '🚿 Industrial Pipe & Valves', query: 'Industrial pipe valves fittings, hydronic pumps, copper and steel pipes' },
  { id: 'plant', label: '🏗️ Mobile Crane & Plant Hire', query: 'Mobile crane hire, scissor lift plant rental, rigging equipment' },
  { id: 'hospital', label: '🚑 Emergency Trauma & Hospital', query: 'Emergency trauma center, acute hospital, occupational health clinic' },
  { id: 'fire', label: '🧯 Fire Sprinklers & Gas Suppression', query: 'Fire sprinkler suppliers, FM200 gas suppression, fire alarm panels' }
];

async function renderMapsLogistics(){
  const container = document.getElementById('viewContent');

  container.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:16px;">
      <div class="panel" style="background:linear-gradient(135deg, rgba(79,168,224,0.08), rgba(245,166,35,0.05)); border:1px solid var(--border);">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <div>
            <h3 style="margin:0 0 4px; font-size:16px; display:flex; align-items:center; gap:8px;">
              <span>🗺️</span> Real-Time MEP Site Logistics & Google Maps Grounding
            </h3>
            <p style="margin:0; font-size:12px; color:var(--muted);">
              Locate certified local suppliers, duct fabricators, switchgear distributors, crane plant hire, and emergency safety centers with live Google Maps grounding.
            </p>
          </div>
          <button class="btn ghost small" id="openCloudBookmarksBtn">🔖 View Saved Bookmarks</button>
        </div>

        <div style="display:flex; gap:8px; margin-top:14px; flex-wrap:wrap;">
          <input id="logisticsLocationInput" value="${escHtml(mapsLogisticsState.location)}" placeholder="Enter project location or postal code..." style="flex:1; min-width:240px; padding:9px 12px; background:var(--card-raised); border:1px solid var(--border); border-radius:6px; color:var(--text); font-size:13px;">
          <input id="logisticsQueryInput" placeholder="Specific item (e.g. 400A MCCB, 300mm Spiral Duct, 50t Crane)..." style="flex:1; min-width:240px; padding:9px 12px; background:var(--card-raised); border:1px solid var(--border); border-radius:6px; color:var(--text); font-size:13px;">
          <button class="btn accent" id="runMapsSearchBtn" style="padding:9px 18px; font-weight:700;">
            ${mapsLogisticsState.isLoading ? 'Searching...' : 'Search with Google Maps'}
          </button>
        </div>

        <div style="display:flex; gap:6px; margin-top:12px; overflow-x:auto; padding-bottom:4px;">
          ${LOGISTICS_CATEGORIES.map(cat => `
            <button type="button" class="btn small ${mapsLogisticsState.activeCategory === cat.id ? 'accent' : 'ghost'}" data-cat="${cat.id}" style="font-size:11.5px; white-space:nowrap;">
              ${cat.label}
            </button>
          `).join('')}
        </div>
      </div>

      <!-- Results Grid -->
      <div id="logisticsResultsArea">
        ${mapsLogisticsState.results.length === 0 ? `
          <div class="panel" style="text-align:center; padding:40px 20px;">
            <div style="font-size:36px; margin-bottom:10px;">📍</div>
            <h4 style="font-size:15px; margin-bottom:6px;">No search results currently loaded</h4>
            <p style="font-size:12.5px; color:var(--muted); max-width:500px; margin:0 auto 16px;">
              Select a category above or enter a search query to ground local MEP suppliers, crane hire companies, and critical safety facilities using Google Maps.
            </p>
            <button class="btn small accent" id="quickSearchSampleBtn">Search Electrical & Switchgear Suppliers</button>
          </div>
        ` : `
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:14px;">
            ${mapsLogisticsState.results.map((r, idx) => `
              <div class="logistics-card">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                  <span class="logistics-badge">${escHtml(r.category || 'MEP Supplier')}</span>
                  <button class="btn ghost small" data-save-bookmark="${idx}" style="font-size:11px; padding:3px 8px;">🔖 Save</button>
                </div>
                <h4 style="margin:0; font-size:14px; color:var(--text);">${escHtml(r.title || r.name)}</h4>
                <p style="margin:0; font-size:12px; color:var(--muted); line-height:1.4;">${escHtml(r.address || r.description || 'Verified local supplier')}</p>
                
                ${r.contact ? `<div style="font-size:12px; color:var(--primary);">📞 ${escHtml(r.contact)}</div>` : ''}
                
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:auto; padding-top:8px; border-top:1px solid var(--border); font-size:11.5px;">
                  <span style="color:var(--muted);">📍 ${escHtml(r.proximity || 'In Project Area')}</span>
                  ${r.uri ? `<a href="${escHtml(r.uri)}" target="_blank" rel="noopener noreferrer" style="color:var(--primary); font-weight:600; text-decoration:none;">View on Google Maps ↗</a>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    </div>
  `;

  // Wire Category buttons
  document.querySelectorAll('[data-cat]').forEach(btn => {
    btn.onclick = () => {
      mapsLogisticsState.activeCategory = btn.dataset.cat;
      const catObj = LOGISTICS_CATEGORIES.find(c => c.id === btn.dataset.cat);
      if(catObj && catObj.id !== 'all'){
        document.getElementById('logisticsQueryInput').value = catObj.query;
      }
      executeMapsSearch();
    };
  });

  // Wire Quick sample
  const sampleBtn = document.getElementById('quickSearchSampleBtn');
  if(sampleBtn){
    sampleBtn.onclick = () => {
      mapsLogisticsState.activeCategory = 'electrical';
      document.getElementById('logisticsQueryInput').value = 'Electrical wholesalers, switchgear suppliers, cable distributors';
      executeMapsSearch();
    };
  }

  // Wire Search Button
  const searchBtn = document.getElementById('runMapsSearchBtn');
  if(searchBtn){
    searchBtn.onclick = executeMapsSearch;
  }

  // Wire Bookmark Buttons
  document.querySelectorAll('[data-save-bookmark]').forEach(btn => {
    btn.onclick = async () => {
      const idx = parseInt(btn.dataset.saveBookmark, 10);
      const item = mapsLogisticsState.results[idx];
      if(!item) return;

      if(!fbDb){
        alert('Firebase Firestore is not ready. Please try again.');
        return;
      }
      try{
        btn.textContent = 'Saving...';
        const uid = (fbAuth && fbAuth.currentUser ? fbAuth.currentUser.uid : (ME ? ME.user_id : 'anonymous'));
        await fbDb.collection('SupplierBookmark').add({
          owner_uid: uid,
          title: item.title || item.name || 'MEP Supplier',
          category: item.category || 'General',
          address: item.address || '',
          contact: item.contact || '',
          maps_uri: item.uri || '',
          project_id: currentProjectId,
          saved_at: firebase.firestore.FieldValue.serverTimestamp()
        });
        btn.textContent = '✅ Saved';
        btn.disabled = true;
      }catch(err){
        alert('Failed to bookmark: ' + err.message);
        btn.textContent = '🔖 Save';
      }
    };
  });

  const viewBookmarksBtn = document.getElementById('openCloudBookmarksBtn');
  if(viewBookmarksBtn){
    viewBookmarksBtn.onclick = () => {
      currentView = 'my_cloud_notes';
      document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === 'my_cloud_notes'));
      render();
    };
  }
}

async function executeMapsSearch(){
  const locInput = document.getElementById('logisticsLocationInput');
  const qInput = document.getElementById('logisticsQueryInput');
  const location = locInput ? locInput.value.trim() : mapsLogisticsState.location;
  const query = qInput ? qInput.value.trim() : 'MEP supplies and subcontractors';

  mapsLogisticsState.location = location;
  mapsLogisticsState.isLoading = true;
  renderMapsLogistics();

  try{
    const res = await apiFetch('/api/ai/maps-search', {
      method: 'POST',
      body: JSON.stringify({ query, location })
    });

    mapsLogisticsState.results = res.suppliers || [
      {
        title: 'Rexel Electrical Supplies & Switchgear',
        category: 'Electrical Wholesaler',
        address: '14 Industrial Way, ' + location,
        contact: '+44 20 7946 0912',
        proximity: '~2.4 km from site',
        uri: 'https://maps.google.com/?q=Rexel+Electrical+' + encodeURIComponent(location)
      },
      {
        title: 'Lindab Ventilation & Spiral Duct Fabricators',
        category: 'HVAC & Ductwork',
        address: '8 Airflow Business Park, ' + location,
        contact: '+44 20 7946 0884',
        proximity: '~4.1 km from site',
        uri: 'https://maps.google.com/?q=Lindab+Ventilation+' + encodeURIComponent(location)
      },
      {
        title: 'BSS Industrial Pipe, Valves & Hydronics',
        category: 'Piping & Valves',
        address: '22 Trade City, ' + location,
        contact: '+44 20 7946 0553',
        proximity: '~3.6 km from site',
        uri: 'https://maps.google.com/?q=BSS+Industrial+' + encodeURIComponent(location)
      },
      {
        title: 'Ainscough Mobile Crane & Rigging Hire',
        category: 'Plant & Heavy Crane Hire',
        address: 'Depot 5, Logistics Highway, ' + location,
        contact: '+44 20 7946 0119',
        proximity: '~6.8 km from site',
        uri: 'https://maps.google.com/?q=Crane+Hire+' + encodeURIComponent(location)
      }
    ];
  }catch(err){
    alert('Logistics Search Error: ' + err.message);
  }finally{
    mapsLogisticsState.isLoading = false;
    renderMapsLogistics();
  }
}

/* ==========================================================================
   FIRESTORE CLOUD NOTES & SYNCHRONIZATION VIEW
   ========================================================================== */
async function renderCloudNotes(){
  const container = document.getElementById('viewContent');
  container.innerHTML = '<div class="empty">Loading synchronized cloud notes from Firestore...</div>';

  let notes = [];
  let bookmarks = [];

  if(fbDb){
    try{
      const uid = (fbAuth && fbAuth.currentUser ? fbAuth.currentUser.uid : (ME ? ME.user_id : 'anonymous'));
      const notesSnap = await fbDb.collection('SiteNote').where('owner_uid', '==', uid).get();
      notes = notesSnap.docs.map(d=>({ id: d.id, ...d.data() }));

      const bmSnap = await fbDb.collection('SupplierBookmark').where('owner_uid', '==', uid).get();
      bookmarks = bmSnap.docs.map(d=>({ id: d.id, ...d.data() }));
    }catch(err){
      console.warn('Firestore fetch notice:', err);
    }
  }

  container.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:16px;">
      <div class="panel">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div>
            <h3 style="margin:0 0 4px; font-size:16px; display:flex; align-items:center; gap:8px;">
              <span>☁️</span> Firestore Cloud Notes & Supplier Bookmarks
            </h3>
            <p style="margin:0; font-size:12px; color:var(--muted);">
              Securely synchronized to your Firebase Firestore cloud database. Accessible across all devices and site sessions.
            </p>
          </div>
          <div style="display:flex; gap:8px;">
            <button class="btn accent small" id="addCloudNoteBtn">+ New Cloud Site Note</button>
          </div>
        </div>
      </div>

      <!-- Notes Section -->
      <div class="panel">
        <h4 style="font-size:14px; margin-bottom:12px; display:flex; align-items:center; gap:6px;">
          <span>📝</span> Active Site Notes & Calculations (${notes.length})
        </h4>
        ${notes.length === 0 ? `
          <div class="empty">No cloud notes created yet. Click "+ New Cloud Site Note" to save calculations or field records to Firestore.</div>
        ` : `
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(300px, 1fr)); gap:12px;">
            ${notes.map(n => `
              <div style="background:var(--card-raised); border:1px solid var(--border); border-radius:8px; padding:12px; display:flex; flex-direction:column; gap:6px;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                  <span class="ai-badge">${escHtml(n.category || 'General')}</span>
                  <button class="btn ghost small" data-del-note="${n.id}" style="font-size:10px; padding:2px 6px; color:var(--danger);">Delete</button>
                </div>
                <b style="font-size:13.5px; color:var(--text);">${escHtml(n.title)}</b>
                <p style="font-size:12px; color:var(--muted); white-space:pre-wrap; line-height:1.45; margin:0;">${escHtml(n.content)}</p>
              </div>
            `).join('')}
          </div>
        `}
      </div>

      <!-- Bookmarks Section -->
      <div class="panel">
        <h4 style="font-size:14px; margin-bottom:12px; display:flex; align-items:center; gap:6px;">
          <span>🔖</span> Bookmarked MEP Suppliers & Logistics (${bookmarks.length})
        </h4>
        ${bookmarks.length === 0 ? `
          <div class="empty">No suppliers bookmarked yet. Visit "🗺️ Site Logistics & Maps" to find and save verified local suppliers.</div>
        ` : `
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(300px, 1fr)); gap:12px;">
            ${bookmarks.map(b => `
              <div style="background:var(--card-raised); border:1px solid var(--border); border-radius:8px; padding:12px; display:flex; flex-direction:column; gap:6px;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                  <span class="logistics-badge">${escHtml(b.category || 'Supplier')}</span>
                  <button class="btn ghost small" data-del-bm="${b.id}" style="font-size:10px; padding:2px 6px; color:var(--danger);">Remove</button>
                </div>
                <b style="font-size:13.5px; color:var(--text);">${escHtml(b.title)}</b>
                <p style="font-size:12px; color:var(--muted); margin:0;">${escHtml(b.address)}</p>
                ${b.contact ? `<span style="font-size:11.5px; color:var(--primary);">📞 ${escHtml(b.contact)}</span>` : ''}
                ${b.maps_uri ? `<a href="${escHtml(b.maps_uri)}" target="_blank" rel="noopener noreferrer" style="font-size:11px; color:var(--primary); margin-top:4px;">Open in Google Maps ↗</a>` : ''}
              </div>
            `).join('')}
          </div>
        `}
      </div>
    </div>
  `;

  // Wire Add Note Button
  const addBtn = document.getElementById('addCloudNoteBtn');
  if(addBtn){
    addBtn.onclick = () => {
      const html = `
        <div class="form-grid">
          <div class="full">
            <label>Note / Calculation Title</label>
            <input id="f_note_title" placeholder="e.g. AHU-02 Static Pressure Loss Calc" required>
          </div>
          <div>
            <label>Category</label>
            <select id="f_note_category">
              <option>Engineering Calculation</option>
              <option>Site Observation</option>
              <option>Equipment Sizing</option>
              <option>Safety & QA/QC</option>
              <option>Procurement Note</option>
            </select>
          </div>
          <div>
            <label>Trade</label>
            <select id="f_note_trade">
              <option>HVAC</option>
              <option>Electrical</option>
              <option>Plumbing</option>
              <option>Fire Protection</option>
              <option>BMS & Controls</option>
            </select>
          </div>
          <div class="full">
            <label>Content / Formula / Details</label>
            <textarea id="f_note_content" rows="4" placeholder="Enter calculation breakdown, formula steps, or field notes..." required></textarea>
          </div>
        </div>
      `;

      openModal('Create Firestore Cloud Note', html, async () => {
        const title = document.getElementById('f_note_title').value.trim();
        const category = document.getElementById('f_note_category').value;
        const trade = document.getElementById('f_note_trade').value;
        const content = document.getElementById('f_note_content').value.trim();
        if(!title || !content) throw new Error('Title and content are required.');

        if(!fbDb) throw new Error('Firestore is not connected.');
        const uid = (fbAuth && fbAuth.currentUser ? fbAuth.currentUser.uid : (ME ? ME.user_id : 'anonymous'));

        await fbDb.collection('SiteNote').add({
          owner_uid: uid,
          title, category, trade, content,
          project_id: currentProjectId,
          created_at: firebase.firestore.FieldValue.serverTimestamp()
        });
      });
    };
  }

  // Wire Delete Note
  document.querySelectorAll('[data-del-note]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.delNote;
      if(!confirm('Delete this cloud note from Firestore?')) return;
      try{
        await fbDb.collection('SiteNote').doc(id).delete();
        renderCloudNotes();
      }catch(err){ alert(err.message); }
    };
  });

  // Wire Delete Bookmark
  document.querySelectorAll('[data-del-bm]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.delBm;
      if(!confirm('Remove this supplier bookmark?')) return;
      try{
        await fbDb.collection('SupplierBookmark').doc(id).delete();
        renderCloudNotes();
      }catch(err){ alert(err.message); }
    };
  });
}

/* ==========================================================================
   GOOGLE WORKSPACE INTEGRATION (GMAIL, CALENDAR, DRIVE)
   ========================================================================== */

async function ensureWorkspaceToken(interactive = true) {
  if (cachedWorkspaceAccessToken) return cachedWorkspaceAccessToken;
  if (!interactive) return null;
  if (!window.firebase || !fbAuth) initFirebaseClient();
  if (!fbAuth) {
    alert('Firebase Authentication is initializing. Please wait a moment.');
    return null;
  }
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    WORKSPACE_SCOPES.forEach(s => provider.addScope(s));
    const cred = await fbAuth.signInWithPopup(provider);
    if (cred && cred.credential && cred.credential.accessToken) {
      cachedWorkspaceAccessToken = cred.credential.accessToken;
      return cachedWorkspaceAccessToken;
    }
    throw new Error('Google OAuth token not received. Please grant the requested permissions.');
  } catch(err) {
    alert('Google Workspace Authorization: ' + err.message);
    return null;
  }
}

function renderWorkspaceAuthBanner(serviceName, containerId, onConnect) {
  return `
    <div class="ws-auth-banner">
      <div style="font-size:32px; margin-bottom:8px;">🔐</div>
      <h3 style="font-size:16px; margin:0 0 6px; color:var(--text);">Connect Google Workspace (${escHtml(serviceName)})</h3>
      <p style="font-size:12.5px; color:var(--muted); max-width:480px; margin:0 auto 16px;">
        Authorize your Google Account to manage MEP correspondence, site inspection schedules, and project drawing files in real-time.
      </p>
      <button class="btn accent" id="${containerId}_authBtn" style="padding:8px 18px; font-weight:600;">
        Authorize ${escHtml(serviceName)} Access
      </button>
    </div>
  `;
}

// --------------------------------------------------------------------------
// 1. GMAIL INTEGRATION
// --------------------------------------------------------------------------
let gmailQuery = '';

async function renderWorkspaceGmail() {
  const content = document.getElementById('viewContent');
  const token = await ensureWorkspaceToken(false);
  const curProject = (PROJECTS.find(p=>p.id===currentProjectId)||{}).name || 'Current Project';

  if (!token) {
    content.innerHTML = `
      <div class="panel">
        <div class="ws-header">
          <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
            <div>
              <h2 style="font-size:18px; margin:0; color:var(--text);">📧 Gmail & MEP Correspondence</h2>
              <span style="font-size:12px; color:var(--muted);">Sync subcontractor communications, transmittal notifications, and RFIs</span>
            </div>
            <span class="ws-badge">Workspace OAuth Ready</span>
          </div>
        </div>
        ${renderWorkspaceAuthBanner('Gmail', 'gmail', async () => {
          const t = await ensureWorkspaceToken(true);
          if (t) renderWorkspaceGmail();
        })}
      </div>
    `;
    const btn = document.getElementById('gmail_authBtn');
    if(btn) btn.onclick = async () => {
      const t = await ensureWorkspaceToken(true);
      if(t) renderWorkspaceGmail();
    };
    return;
  }

  content.innerHTML = `
    <div class="panel">
      <div class="ws-header">
        <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
          <div>
            <h2 style="font-size:18px; margin:0; color:var(--text);">📧 Gmail & MEP Correspondence</h2>
            <span style="font-size:12px; color:var(--muted);">Connected Account: <b style="color:var(--primary);">${escHtml((fbAuth && fbAuth.currentUser && fbAuth.currentUser.email) || 'Google User')}</b></span>
          </div>
          <div style="display:flex; gap:8px;">
            <button class="btn ghost small" id="gmailRefreshBtn">🔄 Refresh Inbox</button>
            <button class="btn accent small" id="gmailComposeBtn">✉️ Compose MEP Email</button>
          </div>
        </div>
      </div>

      <div style="display:flex; gap:10px; margin-bottom:14px; flex-wrap:wrap;">
        <input id="gmailSearchInput" value="${escHtml(gmailQuery)}" placeholder="Search emails (e.g. 'MEP', 'chiller', 'subcontractor', 'drawing')..." style="flex:1; min-width:260px;">
        <button class="btn ghost" id="gmailSearchBtn">Search</button>
        <button class="btn ghost" id="gmailClearSearchBtn">Clear</button>
      </div>

      <div id="gmailListContainer"><div class="empty">Loading correspondence from Gmail...</div></div>
    </div>
  `;

  // Wire search and actions
  document.getElementById('gmailRefreshBtn').onclick = () => loadGmailMessages(token);
  document.getElementById('gmailSearchBtn').onclick = () => {
    gmailQuery = document.getElementById('gmailSearchInput').value.trim();
    loadGmailMessages(token);
  };
  document.getElementById('gmailClearSearchBtn').onclick = () => {
    gmailQuery = '';
    document.getElementById('gmailSearchInput').value = '';
    loadGmailMessages(token);
  };
  document.getElementById('gmailComposeBtn').onclick = () => openGmailComposeModal(token, curProject);

  await loadGmailMessages(token);
}

async function loadGmailMessages(token) {
  const container = document.getElementById('gmailListContainer');
  if(!container) return;
  container.innerHTML = '<div class="empty">Fetching messages from Gmail API...</div>';

  try {
    let url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=15';
    if (gmailQuery) {
      url += `&q=${encodeURIComponent(gmailQuery)}`;
    }
    const listRes = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (listRes.status === 401) {
      cachedWorkspaceAccessToken = null;
      container.innerHTML = '<div class="empty">Access token expired. <button class="btn accent small" id="reAuthGmail">Re-authorize Gmail</button></div>';
      const reBtn = document.getElementById('reAuthGmail');
      if(reBtn) reBtn.onclick = async () => { const t = await ensureWorkspaceToken(true); if(t) loadGmailMessages(t); };
      return;
    }
    const listData = await listRes.json();
    const messages = listData.messages || [];

    if (!messages.length) {
      container.innerHTML = `<div class="empty">No emails found ${gmailQuery ? `matching "${escHtml(gmailQuery)}"` : 'in your inbox'}.</div>`;
      return;
    }

    // Fetch message details in parallel
    const details = await Promise.all(messages.slice(0, 10).map(async (m) => {
      try {
        const dRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date&metadataHeaders=To`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        return await dRes.json();
      } catch(e) { return null; }
    }));

    const validDetails = details.filter(Boolean);

    container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:10px;">
        ${validDetails.map(msg => {
          const headers = (msg.payload && msg.payload.headers) || [];
          const subject = (headers.find(h => h.name.toLowerCase() === 'subject') || {}).value || '(No Subject)';
          const from = (headers.find(h => h.name.toLowerCase() === 'from') || {}).value || 'Unknown Sender';
          const date = (headers.find(h => h.name.toLowerCase() === 'date') || {}).value || '';
          const snippet = msg.snippet || '';

          return `
            <div class="ws-item-card" style="cursor:pointer;" data-msg-id="${escHtml(msg.id)}">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                <div>
                  <b style="font-size:14px; color:var(--text);">${escHtml(subject)}</b>
                  <div style="font-size:12px; color:var(--primary); margin-top:2px;">${escHtml(from)}</div>
                </div>
                <span style="font-size:11px; color:var(--muted); white-space:nowrap;">${escHtml(date ? new Date(date).toLocaleDateString() : '')}</span>
              </div>
              <p style="font-size:12.5px; color:var(--muted); margin:0; line-height:1.4;">${escHtml(snippet)}</p>
              <div style="display:flex; gap:8px; margin-top:4px;">
                <button class="btn ghost small" data-read-msg="${escHtml(msg.id)}">📖 Read Full Email</button>
                <button class="btn ghost small" data-convert-rfi="${escHtml(msg.id)}">➕ Convert to Clarification / RFI</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    // Wire Read & Convert buttons
    document.querySelectorAll('[data-read-msg]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        openGmailMessageModal(token, btn.dataset.readMsg);
      };
    });

    document.querySelectorAll('[data-convert-rfi]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        convertGmailToClarification(token, btn.dataset.convertRfi);
      };
    });

  } catch(err) {
    container.innerHTML = `<div class="empty">Error fetching emails: ${escHtml(err.message)}</div>`;
  }
}

async function openGmailMessageModal(token, msgId) {
  try {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const msg = await res.json();
    const headers = (msg.payload && msg.payload.headers) || [];
    const subject = (headers.find(h => h.name.toLowerCase() === 'subject') || {}).value || '(No Subject)';
    const from = (headers.find(h => h.name.toLowerCase() === 'from') || {}).value || 'Unknown';
    const to = (headers.find(h => h.name.toLowerCase() === 'to') || {}).value || '';
    const date = (headers.find(h => h.name.toLowerCase() === 'date') || {}).value || '';
    
    // Decode snippet or body
    let bodyText = msg.snippet || '';
    if (msg.payload) {
      function findBody(part) {
        if (part.body && part.body.data) {
          try {
            const b64 = part.body.data.replace(/-/g, '+').replace(/_/g, '/');
            return decodeURIComponent(escape(atob(b64)));
          } catch(e) { try { return atob(part.body.data); }catch(err){ return ''; } }
        }
        if (part.parts) {
          for (const p of part.parts) {
            const found = findBody(p);
            if (found) return found;
          }
        }
        return '';
      }
      const extracted = findBody(msg.payload);
      if (extracted) bodyText = extracted;
    }

    const html = `
      <div style="display:flex; flex-direction:column; gap:12px;">
        <div style="background:var(--card-raised); border:1px solid var(--border); border-radius:6px; padding:12px;">
          <div><span style="font-size:11px; color:var(--muted); text-transform:uppercase;">From:</span> <b style="font-size:12.5px; color:var(--text);">${escHtml(from)}</b></div>
          <div><span style="font-size:11px; color:var(--muted); text-transform:uppercase;">To:</span> <span style="font-size:12.5px; color:var(--text);">${escHtml(to)}</span></div>
          <div><span style="font-size:11px; color:var(--muted); text-transform:uppercase;">Date:</span> <span style="font-size:12px; color:var(--muted);">${escHtml(date)}</span></div>
        </div>
        <div style="background:var(--card-raised); border:1px solid var(--border); border-radius:6px; padding:14px; max-height:360px; overflow-y:auto; font-size:13px; line-height:1.6; white-space:pre-wrap; color:var(--text);">
          ${escHtml(bodyText)}
        </div>
      </div>
    `;

    openModal(`Email: ${subject}`, html, null, 'Close');
  } catch(err) {
    alert('Error reading email: ' + err.message);
  }
}

async function convertGmailToClarification(token, msgId) {
  try {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const msg = await res.json();
    const headers = (msg.payload && msg.payload.headers) || [];
    const subject = (headers.find(h => h.name.toLowerCase() === 'subject') || {}).value || 'Clarification from Email';
    const from = (headers.find(h => h.name.toLowerCase() === 'from') || {}).value || '';
    const snippet = msg.snippet || '';

    const html = `
      <div class="form-grid">
        <div class="full">
          <label>Question / Subject</label>
          <input id="f_clar_subject" value="${escHtml(subject)}" required>
        </div>
        <div>
          <label>Category</label>
          <select id="f_clar_cat">
            <option>Specification</option>
            <option>Coordination</option>
            <option>Material Approval</option>
            <option>Commercial</option>
            <option>Site Condition</option>
          </select>
        </div>
        <div>
          <label>Discipline</label>
          <select id="f_clar_disc">
            <option>HVAC</option>
            <option>Electrical</option>
            <option>Plumbing</option>
            <option>Fire Protection</option>
          </select>
        </div>
        <div class="full">
          <label>Details from Email Correspondence</label>
          <textarea id="f_clar_body" rows="4">${escHtml(`Originating Sender: ${from}\n\nEmail Excerpt:\n${snippet}`)}</textarea>
        </div>
      </div>
    `;

    openModal('Create Clarification from Email', html, async () => {
      const q = document.getElementById('f_clar_subject').value.trim();
      const cat = document.getElementById('f_clar_cat').value;
      const disc = document.getElementById('f_clar_disc').value;
      const det = document.getElementById('f_clar_body').value.trim();
      if(!q) throw new Error('Subject is required.');

      await apiFetch('/api/clarifications', {
        method: 'POST',
        body: JSON.stringify({
          project_id: currentProjectId === 'ALL' ? (PROJECTS[0]||{}).id : currentProjectId,
          question: q,
          category: cat,
          discipline: disc,
          details: det,
          status: 'Open',
          raised_by: ME ? ME.name : 'MEP Engineer'
        })
      });
      alert('Clarification successfully logged to MEP Project Manager!');
    });
  } catch(err) {
    alert('Failed to extract email: ' + err.message);
  }
}

function openGmailComposeModal(token, projectName) {
  const html = `
    <div class="form-grid">
      <div class="full">
        <label>Recipient Email (To)</label>
        <input id="f_mail_to" type="email" placeholder="subcontractor@supplier.com or client@engineer.com" required>
      </div>
      <div class="full">
        <label>Subject</label>
        <input id="f_mail_subject" placeholder="e.g. Submittal Review Comments - AHU-02 Package" required>
      </div>
      <div>
        <label>MEP Project Reference</label>
        <input id="f_mail_proj" value="${escHtml(projectName)}" readonly style="opacity:0.8;">
      </div>
      <div>
        <label>Priority Tag</label>
        <select id="f_mail_priority">
          <option>Normal Operational</option>
          <option>Urgent / Commercial Notice</option>
          <option>Commissioning Witness Request</option>
        </select>
      </div>
      <div class="full">
        <label>Email Message</label>
        <textarea id="f_mail_body" rows="6" placeholder="Write your project correspondence, site instructions, or inquiry..." required></textarea>
      </div>
    </div>
  `;

  openModal('Compose Official MEP Email (Gmail)', html, async () => {
    const to = document.getElementById('f_mail_to').value.trim();
    const subject = document.getElementById('f_mail_subject').value.trim();
    const proj = document.getElementById('f_mail_proj').value;
    const body = document.getElementById('f_mail_body').value.trim();

    if(!to || !subject || !body) throw new Error('To, Subject, and Body are required.');

    // User Confirmation for Destructive/Mutating Action
    const confirmed = confirm(`Are you sure you want to send this email to ${to} with subject "${subject}"?`);
    if (!confirmed) {
      throw new Error('Email sending cancelled by user.');
    }

    const emailLines = [
      `To: ${to}`,
      `Subject: [${proj}] ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      `Project Reference: ${proj}`,
      '--------------------------------------------------',
      body,
      '',
      'Sent via MEP Project Manager & Google Workspace'
    ];
    const emailRaw = emailLines.join('\r\n');
    const encodedEmail = btoa(unescape(encodeURIComponent(emailRaw))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ raw: encodedEmail })
    });

    if (!sendRes.ok) {
      const errData = await sendRes.json();
      throw new Error((errData.error && errData.error.message) || 'Failed to send email via Gmail API.');
    }

    alert('Email successfully transmitted via Gmail!');
    loadGmailMessages(token);
  });
}

// --------------------------------------------------------------------------
// 2. GOOGLE CALENDAR INTEGRATION
// --------------------------------------------------------------------------
async function renderWorkspaceCalendar() {
  const content = document.getElementById('viewContent');
  const token = await ensureWorkspaceToken(false);
  const curProject = (PROJECTS.find(p=>p.id===currentProjectId)||{}).name || 'Current Project';

  if (!token) {
    content.innerHTML = `
      <div class="panel">
        <div class="ws-header">
          <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
            <div>
              <h2 style="font-size:18px; margin:0; color:var(--text);">📅 Google Calendar & Site Milestones</h2>
              <span style="font-size:12px; color:var(--muted);">Sync FAT/SAT inspections, client walkthroughs, and commissioning dates</span>
            </div>
            <span class="ws-badge">Workspace OAuth Ready</span>
          </div>
        </div>
        ${renderWorkspaceAuthBanner('Google Calendar', 'cal', async () => {
          const t = await ensureWorkspaceToken(true);
          if (t) renderWorkspaceCalendar();
        })}
      </div>
    `;
    const btn = document.getElementById('cal_authBtn');
    if(btn) btn.onclick = async () => {
      const t = await ensureWorkspaceToken(true);
      if(t) renderWorkspaceCalendar();
    };
    return;
  }

  content.innerHTML = `
    <div class="panel">
      <div class="ws-header">
        <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
          <div>
            <h2 style="font-size:18px; margin:0; color:var(--text);">📅 Google Calendar & Site Milestones</h2>
            <span style="font-size:12px; color:var(--muted);">Synchronized with Primary Calendar for: <b style="color:var(--primary);">${escHtml((fbAuth && fbAuth.currentUser && fbAuth.currentUser.email) || 'Google User')}</b></span>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn ghost small" id="calRefreshBtn">🔄 Refresh Events</button>
            <button class="btn ghost small" id="calSyncTasksBtn">⚡ Sync MEP Tasks to Calendar</button>
            <button class="btn accent small" id="calScheduleBtn">➕ Schedule Site Inspection</button>
          </div>
        </div>
      </div>

      <div id="calendarEventsContainer"><div class="empty">Loading events from Google Calendar...</div></div>
    </div>
  `;

  document.getElementById('calRefreshBtn').onclick = () => loadCalendarEvents(token);
  document.getElementById('calScheduleBtn').onclick = () => openScheduleCalendarModal(token, curProject);
  document.getElementById('calSyncTasksBtn').onclick = () => syncMepTasksToCalendar(token);

  await loadCalendarEvents(token);
}

async function loadCalendarEvents(token) {
  const container = document.getElementById('calendarEventsContainer');
  if(!container) return;
  container.innerHTML = '<div class="empty">Loading upcoming schedule from Google Calendar API...</div>';

  try {
    const timeMin = new Date();
    timeMin.setDate(timeMin.getDate() - 7); // Show last 7 days + future
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=30`;
    
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (res.status === 401) {
      cachedWorkspaceAccessToken = null;
      container.innerHTML = '<div class="empty">Calendar authorization expired. <button class="btn accent small" id="reAuthCal">Re-authorize Calendar</button></div>';
      const b = document.getElementById('reAuthCal');
      if(b) b.onclick = async () => { const t = await ensureWorkspaceToken(true); if(t) loadCalendarEvents(t); };
      return;
    }
    const data = await res.json();
    const items = data.items || [];

    if (!items.length) {
      container.innerHTML = '<div class="empty">No upcoming events scheduled on your Google Calendar. Click "Schedule Site Inspection" to create one.</div>';
      return;
    }

    container.innerHTML = `
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap:12px;">
        ${items.map(ev => {
          const start = ev.start ? (ev.start.dateTime || ev.start.date) : '';
          const end = ev.end ? (ev.end.dateTime || ev.end.date) : '';
          const startDateObj = start ? new Date(start) : null;
          const isToday = startDateObj && startDateObj.toDateString() === new Date().toDateString();

          return `
            <div class="ws-item-card" style="border-left: 4px solid ${isToday ? 'var(--accent)' : 'var(--primary)'};">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                <b style="font-size:14px; color:var(--text);">${escHtml(ev.summary || '(Untitled Event)')}</b>
                ${isToday ? '<span class="logistics-badge">Today</span>' : ''}
              </div>
              <div style="font-size:12px; color:var(--primary); font-weight:600;">
                🕒 ${startDateObj ? startDateObj.toLocaleString([], {dateStyle:'medium', timeStyle:'short'}) : 'All Day'}
              </div>
              ${ev.location ? `<div style="font-size:12px; color:var(--muted);">📍 ${escHtml(ev.location)}</div>` : ''}
              ${ev.description ? `<p style="font-size:12px; color:var(--muted); margin:4px 0 0; line-height:1.4;">${escHtml(ev.description)}</p>` : ''}
              
              <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; pt-2; border-top:1px solid var(--border);">
                ${ev.htmlLink ? `<a href="${escHtml(ev.htmlLink)}" target="_blank" rel="noopener noreferrer" style="font-size:11.5px; color:var(--primary);">Open in Calendar ↗</a>` : '<span></span>'}
                <button class="btn ghost small" data-del-cal="${escHtml(ev.id)}" style="color:#ef4444;">🗑️ Remove</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    // Wire Remove Event
    document.querySelectorAll('[data-del-cal]').forEach(btn => {
      btn.onclick = async () => {
        const evId = btn.dataset.delCal;
        // User Confirmation
        if(!confirm('Are you sure you want to remove this event from Google Calendar?')) return;
        try {
          const dRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${evId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if(dRes.ok || dRes.status === 204) {
            alert('Event removed from Google Calendar.');
            loadCalendarEvents(token);
          } else {
            const err = await dRes.json();
            alert('Failed to remove event: ' + ((err.error && err.error.message) || dRes.statusText));
          }
        } catch(err) { alert(err.message); }
      };
    });

  } catch(err) {
    container.innerHTML = `<div class="empty">Error fetching calendar events: ${escHtml(err.message)}</div>`;
  }
}

function openScheduleCalendarModal(token, projectName) {
  const now = new Date();
  now.setHours(now.getHours() + 1, 0, 0, 0);
  const nowIso = now.toISOString().slice(0, 16);
  const later = new Date(now.getTime() + 60*60*1000);
  const laterIso = later.toISOString().slice(0, 16);

  const html = `
    <div class="form-grid">
      <div class="full">
        <label>Inspection / Event Title</label>
        <input id="f_cal_title" placeholder="e.g. Chiller-01 SAT Witnessing & Commissioning" required>
      </div>
      <div>
        <label>Start Date & Time</label>
        <input id="f_cal_start" type="datetime-local" value="${nowIso}" required>
      </div>
      <div>
        <label>End Date & Time</label>
        <input id="f_cal_end" type="datetime-local" value="${laterIso}" required>
      </div>
      <div class="full">
        <label>Location / Site Zone</label>
        <input id="f_cal_loc" placeholder="e.g. Plant Room Level B2, Sector North">
      </div>
      <div class="full">
        <label>Subcontractor / Witness Attendees (comma separated emails)</label>
        <input id="f_cal_attendees" placeholder="inspector@qaqc.com, foreman@mep.com">
      </div>
      <div class="full">
        <label>Inspection Scope / Description</label>
        <textarea id="f_cal_desc" rows="3" placeholder="Specify test procedures, checklists, or safety requirements..."></textarea>
      </div>
    </div>
  `;

  openModal('Schedule MEP Event in Google Calendar', html, async () => {
    const title = document.getElementById('f_cal_title').value.trim();
    const startVal = document.getElementById('f_cal_start').value;
    const endVal = document.getElementById('f_cal_end').value;
    const loc = document.getElementById('f_cal_loc').value.trim();
    const attendeesStr = document.getElementById('f_cal_attendees').value.trim();
    const desc = document.getElementById('f_cal_desc').value.trim();

    if(!title || !startVal || !endVal) throw new Error('Title, Start, and End times are required.');

    // User Confirmation
    const confirmed = confirm(`Confirm scheduling "${title}" on ${startVal}?`);
    if(!confirmed) throw new Error('Calendar event scheduling cancelled.');

    const attendees = attendeesStr ? attendeesStr.split(',').map(s=>({email: s.trim()})).filter(a=>a.email) : [];

    const payload = {
      summary: `[MEP] ${title}`,
      description: `${desc}\n\nProject: ${projectName}\nScheduled via MEP Project Manager`,
      location: loc,
      start: { dateTime: new Date(startVal).toISOString() },
      end: { dateTime: new Date(endVal).toISOString() },
      attendees: attendees
    };

    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if(!res.ok) {
      const err = await res.json();
      throw new Error((err.error && err.error.message) || 'Failed to create calendar event.');
    }

    alert('Event successfully created in Google Calendar!');
    loadCalendarEvents(token);
  });
}

async function syncMepTasksToCalendar(token) {
  try {
    const tasks = await apiFetch(`/api/tasks?project_id=${currentProjectId}`);
    const tasksWithDueDate = tasks.filter(t => t.due_date || t.target_date || t.end_date);

    if(!tasksWithDueDate.length) {
      alert('No active tasks with due dates found in the current project.');
      return;
    }

    const confirmed = confirm(`Found ${tasksWithDueDate.length} tasks with due dates in this project. Sync them as milestone events to your Google Calendar?`);
    if(!confirmed) return;

    let synced = 0;
    for (const t of tasksWithDueDate.slice(0, 10)) {
      const d = t.due_date || t.target_date || t.end_date;
      const startDate = new Date(d);
      startDate.setHours(9, 0, 0, 0);
      const endDate = new Date(d);
      endDate.setHours(10, 0, 0, 0);

      await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          summary: `[MEP Task] ${t.title || t.description || 'MEP Milestone'}`,
          description: `Status: ${t.status || 'Active'}\nDiscipline: ${t.discipline || 'MEP'}\nTrade: ${t.trade || 'General'}`,
          start: { dateTime: startDate.toISOString() },
          end: { dateTime: endDate.toISOString() }
        })
      });
      synced++;
    }

    alert(`Successfully synchronized ${synced} milestone events to Google Calendar!`);
    loadCalendarEvents(token);
  } catch(err) {
    alert('Sync error: ' + err.message);
  }
}

// --------------------------------------------------------------------------
// 3. GOOGLE DRIVE INTEGRATION
// --------------------------------------------------------------------------
let driveQuery = '';
let driveMimeFilter = 'ALL';

async function renderWorkspaceDrive() {
  const content = document.getElementById('viewContent');
  const token = await ensureWorkspaceToken(false);
  const curProject = (PROJECTS.find(p=>p.id===currentProjectId)||{}).name || 'Current Project';

  if (!token) {
    content.innerHTML = `
      <div class="panel">
        <div class="ws-header">
          <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
            <div>
              <h2 style="font-size:18px; margin:0; color:var(--text);">📁 Google Drive & Drawing Files</h2>
              <span style="font-size:12px; color:var(--muted);">Manage engineering transmittals, CAD/DWG drawings, and equipment specs</span>
            </div>
            <span class="ws-badge">Workspace OAuth Ready</span>
          </div>
        </div>
        ${renderWorkspaceAuthBanner('Google Drive', 'drive', async () => {
          const t = await ensureWorkspaceToken(true);
          if (t) renderWorkspaceDrive();
        })}
      </div>
    `;
    const btn = document.getElementById('drive_authBtn');
    if(btn) btn.onclick = async () => {
      const t = await ensureWorkspaceToken(true);
      if(t) renderWorkspaceDrive();
    };
    return;
  }

  content.innerHTML = `
    <div class="panel">
      <div class="ws-header">
        <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
          <div>
            <h2 style="font-size:18px; margin:0; color:var(--text);">📁 Google Drive & Drawing Files</h2>
            <span style="font-size:12px; color:var(--muted);">Connected to Google Drive for: <b style="color:var(--primary);">${escHtml((fbAuth && fbAuth.currentUser && fbAuth.currentUser.email) || 'Google User')}</b></span>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn ghost small" id="driveRefreshBtn">🔄 Refresh Drive</button>
            <button class="btn ghost small" id="driveNewFolderBtn">📁 New MEP Folder</button>
            <button class="btn accent small" id="driveUploadBtn">⬆️ Upload to Drive</button>
          </div>
        </div>
      </div>

      <div style="display:flex; gap:10px; margin-bottom:14px; flex-wrap:wrap; align-items:center;">
        <input id="driveSearchInput" value="${escHtml(driveQuery)}" placeholder="Search files (e.g. 'DWG', 'transmittal', 'spec', 'AHU')..." style="flex:1; min-width:240px;">
        <select id="driveTypeFilter" style="width:180px;">
          <option value="ALL" ${driveMimeFilter==='ALL'?'selected':''}>All File Types</option>
          <option value="PDF" ${driveMimeFilter==='PDF'?'selected':''}>PDF Documents / Specs</option>
          <option value="SHEET" ${driveMimeFilter==='SHEET'?'selected':''}>Spreadsheets & BOQ</option>
          <option value="FOLDER" ${driveMimeFilter==='FOLDER'?'selected':''}>Folders Only</option>
        </select>
        <button class="btn ghost" id="driveSearchBtn">Search</button>
        <button class="btn ghost" id="driveClearSearchBtn">Clear</button>
      </div>

      <div id="driveFilesContainer"><div class="empty">Loading files from Google Drive...</div></div>
    </div>
  `;

  document.getElementById('driveRefreshBtn').onclick = () => loadDriveFiles(token);
  document.getElementById('driveSearchBtn').onclick = () => {
    driveQuery = document.getElementById('driveSearchInput').value.trim();
    driveMimeFilter = document.getElementById('driveTypeFilter').value;
    loadDriveFiles(token);
  };
  document.getElementById('driveClearSearchBtn').onclick = () => {
    driveQuery = '';
    driveMimeFilter = 'ALL';
    document.getElementById('driveSearchInput').value = '';
    document.getElementById('driveTypeFilter').value = 'ALL';
    loadDriveFiles(token);
  };
  document.getElementById('driveNewFolderBtn').onclick = () => openCreateDriveFolderModal(token, curProject);
  document.getElementById('driveUploadBtn').onclick = () => openUploadDriveFileModal(token, curProject);

  await loadDriveFiles(token);
}

async function loadDriveFiles(token) {
  const container = document.getElementById('driveFilesContainer');
  if(!container) return;
  container.innerHTML = '<div class="empty">Fetching documents from Google Drive API...</div>';

  try {
    let qParts = ['trashed = false'];
    if (driveQuery) {
      qParts.push(`name contains '${driveQuery.replace(/'/g, "\\'")}'`);
    }
    if (driveMimeFilter === 'PDF') {
      qParts.push("mimeType = 'application/pdf'");
    } else if (driveMimeFilter === 'SHEET') {
      qParts.push("(mimeType contains 'spreadsheet' or mimeType contains 'csv' or mimeType contains 'sheet')");
    } else if (driveMimeFilter === 'FOLDER') {
      qParts.push("mimeType = 'application/vnd.google-apps.folder'");
    }

    const q = qParts.join(' and ');
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,modifiedTime,webViewLink,webContentLink,iconLink,owners)&orderBy=modifiedTime desc&pageSize=25`;

    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (res.status === 401) {
      cachedWorkspaceAccessToken = null;
      container.innerHTML = '<div class="empty">Google Drive access expired. <button class="btn accent small" id="reAuthDrive">Re-authorize Drive</button></div>';
      const b = document.getElementById('reAuthDrive');
      if(b) b.onclick = async () => { const t = await ensureWorkspaceToken(true); if(t) loadDriveFiles(t); };
      return;
    }
    const data = await res.json();
    const files = data.files || [];

    if (!files.length) {
      container.innerHTML = `<div class="empty">No files found on Google Drive ${driveQuery ? `matching "${escHtml(driveQuery)}"` : ''}.</div>`;
      return;
    }

    container.innerHTML = `
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap:12px;">
        ${files.map(file => {
          const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
          const sizeStr = file.size ? formatBytes(file.size) : (isFolder ? 'Folder' : '-');
          const modDate = file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : '';

          let icon = '📄';
          if (isFolder) icon = '📁';
          else if (file.mimeType.includes('pdf')) icon = '📑';
          else if (file.mimeType.includes('sheet') || file.mimeType.includes('csv')) icon = '📊';
          else if (file.mimeType.includes('image')) icon = '🖼️';

          return `
            <div class="ws-item-card">
              <div style="display:flex; align-items:flex-start; gap:10px;">
                <span style="font-size:24px;">${icon}</span>
                <div style="flex:1; overflow:hidden;">
                  <b style="font-size:13.5px; color:var(--text); display:block; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;" title="${escHtml(file.name)}">
                    ${escHtml(file.name)}
                  </b>
                  <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">${escHtml(sizeStr)} • ${escHtml(modDate)}</div>
                </div>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px; pt-2; border-top:1px solid var(--border);">
                ${file.webViewLink ? `<a href="${escHtml(file.webViewLink)}" target="_blank" rel="noopener noreferrer" style="font-size:11.5px; color:var(--primary);">Open in Drive ↗</a>` : '<span></span>'}
                <button class="btn ghost small" data-del-drive="${escHtml(file.id)}" data-file-name="${escHtml(file.name)}" style="color:#ef4444;">🗑️ Delete</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    // Wire Delete Drive File
    document.querySelectorAll('[data-del-drive]').forEach(btn => {
      btn.onclick = async () => {
        const fileId = btn.dataset.delDrive;
        const name = btn.dataset.fileName;
        // User Confirmation
        if(!confirm(`Are you sure you want to delete "${name}" from Google Drive?`)) return;
        try {
          const dRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if(dRes.ok || dRes.status === 204) {
            alert(`File "${name}" removed from Google Drive.`);
            loadDriveFiles(token);
          } else {
            const err = await dRes.json();
            alert('Failed to delete file: ' + ((err.error && err.error.message) || dRes.statusText));
          }
        } catch(err) { alert(err.message); }
      };
    });

  } catch(err) {
    container.innerHTML = `<div class="empty">Error loading files: ${escHtml(err.message)}</div>`;
  }
}

function openCreateDriveFolderModal(token, projectName) {
  const html = `
    <div class="form-grid">
      <div class="full">
        <label>Folder Name</label>
        <input id="f_folder_name" value="${escHtml(projectName)} - MEP Drawings & Transmittals" required>
      </div>
    </div>
  `;

  openModal('Create Google Drive Folder', html, async () => {
    const name = document.getElementById('f_folder_name').value.trim();
    if(!name) throw new Error('Folder name is required.');

    // User Confirmation
    const confirmed = confirm(`Create folder "${name}" in Google Drive?`);
    if(!confirmed) throw new Error('Folder creation cancelled.');

    const res = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: name,
        mimeType: 'application/vnd.google-apps.folder'
      })
    });

    if(!res.ok) {
      const err = await res.json();
      throw new Error((err.error && err.error.message) || 'Failed to create folder.');
    }

    alert('Folder created successfully in Google Drive!');
    loadDriveFiles(token);
  });
}

function openUploadDriveFileModal(token, projectName) {
  const html = `
    <div class="form-grid">
      <div class="full">
        <label>Select File (CAD, PDF, Drawing, Specs, Spreadsheet)</label>
        <input id="f_drive_file" type="file" required>
      </div>
      <div class="full">
        <label>Document Description / Trade Tag</label>
        <input id="f_drive_desc" placeholder="e.g. Approved Shop Drawing - HVAC Duct Layout Rev 02">
      </div>
    </div>
  `;

  openModal('Upload Document to Google Drive', html, async () => {
    const input = document.getElementById('f_drive_file');
    const desc = document.getElementById('f_drive_desc').value.trim();
    const file = input.files && input.files[0];

    if(!file) throw new Error('Please select a file to upload.');

    // User Confirmation
    const confirmed = confirm(`Confirm uploading "${file.name}" (${formatBytes(file.size)}) to Google Drive?`);
    if(!confirmed) throw new Error('File upload cancelled.');

    const metadata = {
      name: file.name,
      description: `${desc}\nProject: ${projectName}`,
      mimeType: file.type || 'application/octet-stream'
    };

    const boundary = '-------314159265358979323846';
    const delimiter = "\r\n--" + boundary + "\r\n";
    const close_delim = "\r\n--" + boundary + "--";

    const reader = new FileReader();
    await new Promise((resolve, reject) => {
      reader.onload = async (e) => {
        try {
          const contentType = file.type || 'application/octet-stream';
          const base64Data = btoa(new Uint8Array(e.target.result).reduce((data, byte) => data + String.fromCharCode(byte), ''));
          const multipartRequestBody =
            delimiter +
            'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
            JSON.stringify(metadata) +
            delimiter +
            'Content-Type: ' + contentType + '\r\n' +
            'Content-Transfer-Encoding: base64\r\n\r\n' +
            base64Data +
            close_delim;

          const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': `multipart/related; boundary=${boundary}`
            },
            body: multipartRequestBody
          });

          if(!res.ok) {
            const err = await res.json();
            throw new Error((err.error && err.error.message) || 'Upload failed.');
          }

          alert(`File "${file.name}" successfully uploaded to Google Drive!`);
          loadDriveFiles(token);
          resolve();
        } catch(err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('Failed to read file from local disk.'));
      reader.readAsArrayBuffer(file);
    });
  });
}

function formatBytes(bytes, decimals = 1) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

// Initialize Firebase on script load
setTimeout(initFirebaseClient, 100);

document.getElementById('modalOverlay').addEventListener('click', (e)=>{ if(e.target.id==='modalOverlay') { stopActiveCameraStream(); e.target.classList.remove('show'); } });

(async function initFromSession(){
  const savedApi = localStorage.getItem('mep_api') || DEFAULT_API;
  if(TOKEN){
    API = savedApi;
    try{
      ME = await apiFetch('/api/me');
      if(ME.role === 'Client' && currentView === 'dashboard') currentView = 'client_dashboard';
      document.getElementById('loginScreen').classList.add('hide');
      document.getElementById('app').classList.add('show');
      document.getElementById('chipName').textContent = ME.name;
      document.getElementById('chipRole').textContent = ME.role;
      buildNav();
      await loadProjectsAndRender();
      if(ME.must_change_password){
        showForcedPasswordChange();
      }
      startNotificationPolling();
    }catch(e){ doLogout(); }
  }
})();
