/**
 * Populate all 10 Engineering Drawings in the database with rich technical SVG data URLs
 * Project: BOV St. Venera (Job 2618)
 * Consultant: Enser Ltd Consulting Engineers
 */

import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('mep_pm.db');
db.exec('PRAGMA busy_timeout = 10000;');

const projectId = 'bov-st-venera-2618';

function createSvgDataUrl(drawingNo: string, title: string, discipline: string, contentSvg: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" width="100%" height="100%" style="background:#0b1329;font-family:'Segoe UI',Roboto,Helvetica,sans-serif;">
  <defs>
    <!-- Technical Grid Pattern -->
    <pattern id="grid-sub" width="20" height="20" patternUnits="userSpaceOnUse">
      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#1e293b" stroke-width="0.5" opacity="0.4"/>
    </pattern>
    <pattern id="grid-main" width="100" height="100" patternUnits="userSpaceOnUse">
      <rect width="100" height="100" fill="url(#grid-sub)"/>
      <path d="M 100 0 L 0 0 0 100" fill="none" stroke="#334155" stroke-width="1" opacity="0.6"/>
    </pattern>
    
    <!-- Symbols & Markers -->
    <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#38bdf8"/>
    </marker>
    <marker id="arrow-amber" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#f59e0b"/>
    </marker>
    <marker id="arrow-emerald" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#10b981"/>
    </marker>
  </defs>

  <!-- Drawing Board Background -->
  <rect width="1600" height="1000" fill="#090d16"/>
  <rect x="20" y="20" width="1560" height="960" fill="url(#grid-main)"/>
  
  <!-- Outer Technical Border (BS 8888 Sheet Layout) -->
  <rect x="25" y="25" width="1550" height="950" fill="none" stroke="#475569" stroke-width="2"/>
  <rect x="30" y="30" width="1540" height="940" fill="none" stroke="#64748b" stroke-width="1"/>

  <!-- Coordinates Grid (A, B, C, D / 1, 2, 3, 4) -->
  <g fill="#64748b" font-size="11" font-weight="bold" font-family="monospace">
    <text x="35" y="260">A</text><text x="35" y="490">B</text><text x="35" y="720">C</text><text x="35" y="930">D</text>
    <text x="1555" y="260">A</text><text x="1555" y="490">B</text><text x="1555" y="720">C</text><text x="1555" y="930">D</text>
    <text x="220" y="45">1</text><text x="520" y="45">2</text><text x="820" y="45">3</text><text x="1120" y="45">4</text><text x="1420" y="45">5</text>
    <text x="220" y="960">1</text><text x="520" y="960">2</text><text x="820" y="960">3</text><text x="1120" y="960">4</text><text x="1420" y="960">5</text>
  </g>

  <!-- Technical Schematic / Layout Vector Graphics -->
  ${contentSvg}

  <!-- Master Engineering Title Block (Bottom Right Corner) -->
  <g transform="translate(1080, 770)">
    <!-- Title Box Border -->
    <rect width="480" height="190" fill="#0f172a" stroke="#38bdf8" stroke-width="2" rx="4"/>
    <line x1="0" y1="50" x2="480" y2="50" stroke="#334155" stroke-width="1.5"/>
    <line x1="0" y1="100" x2="480" y2="100" stroke="#334155" stroke-width="1.5"/>
    <line x1="0" y1="140" x2="480" y2="140" stroke="#334155" stroke-width="1.5"/>
    <line x1="240" y1="50" x2="240" y2="140" stroke="#334155" stroke-width="1.5"/>
    <line x1="360" y1="100" x2="360" y2="190" stroke="#334155" stroke-width="1.5"/>

    <!-- Section 1: Client & Consultant Header -->
    <text x="15" y="22" fill="#94a3b8" font-size="10" font-weight="bold" letter-spacing="1">CLIENT:</text>
    <text x="15" y="40" fill="#f8fafc" font-size="14" font-weight="bold">BANK OF VALLETTA P.L.C.</text>
    <text x="250" y="22" fill="#94a3b8" font-size="10" font-weight="bold" letter-spacing="1">CONSULTING ENGINEERS:</text>
    <text x="250" y="40" fill="#38bdf8" font-size="14" font-weight="bold">ENSER LTD — MALTA</text>

    <!-- Section 2: Project Description -->
    <text x="15" y="68" fill="#94a3b8" font-size="9" font-weight="bold" letter-spacing="1">PROJECT:</text>
    <text x="15" y="86" fill="#f8fafc" font-size="12" font-weight="semibold">BOV ST. VENERA - L1 &amp; L2 REFURBISHMENT</text>
    
    <text x="255" y="68" fill="#94a3b8" font-size="9" font-weight="bold" letter-spacing="1">DISCIPLINE:</text>
    <text x="255" y="88" fill="#fbbf24" font-size="12" font-weight="bold">${discipline.toUpperCase()}</text>

    <!-- Section 3: Sheet Title -->
    <text x="15" y="118" fill="#94a3b8" font-size="9" font-weight="bold" letter-spacing="1">DRAWING TITLE:</text>
    <text x="15" y="133" fill="#38bdf8" font-size="11" font-weight="bold">${title.substring(0, 42)}</text>

    <text x="255" y="118" fill="#94a3b8" font-size="9" font-weight="bold" letter-spacing="1">SCALE / STATUS:</text>
    <text x="255" y="133" fill="#10b981" font-size="11" font-weight="bold">1:100 @ A1 | APPROVED FOR CONST.</text>

    <!-- Section 4: Drawing Number & Revision Stamp -->
    <text x="15" y="158" fill="#94a3b8" font-size="9" font-weight="bold" letter-spacing="1">DRAWING NUMBER (ENSER SERIES):</text>
    <text x="15" y="180" fill="#f8fafc" font-size="16" font-weight="extrabold" font-family="monospace">${drawingNo}</text>

    <text x="375" y="158" fill="#94a3b8" font-size="9" font-weight="bold" letter-spacing="1">REVISION:</text>
    <text x="385" y="182" fill="#38bdf8" font-size="18" font-weight="black" font-family="monospace">REV A</text>
  </g>

  <!-- Drawing Stamp & Watermark -->
  <g transform="translate(60, 60)">
    <rect width="210" height="32" rx="6" fill="#0284c7" opacity="0.9"/>
    <text x="15" y="21" fill="#ffffff" font-size="12" font-weight="bold" letter-spacing="1">ENSER LTD • JOB 2618</text>
  </g>
</svg>`;

  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

// 1. 2618-S-ELE-01: Electrical Schematic (Rising Mains, MSB, Sub-boards, UPS, Generator)
const svgEleSchematic = `
  <g id="schematic-elements" transform="translate(60, 110)">
    <!-- Main incoming 400V Enemalta Substation connection -->
    <rect x="40" y="40" width="180" height="90" fill="#1e293b" stroke="#38bdf8" stroke-width="2" rx="6"/>
    <text x="55" y="70" fill="#38bdf8" font-size="14" font-weight="bold">ENEMALTA INCOMING</text>
    <text x="55" y="92" fill="#94a3b8" font-size="11">400V 3PH 50Hz 400A</text>
    <text x="55" y="112" fill="#10b981" font-size="10" font-weight="bold">KWh Meter Cabinet (E-01)</text>

    <line x1="220" y1="85" x2="310" y2="85" stroke="#38bdf8" stroke-width="4" marker-end="url(#arrow)"/>

    <!-- Generator & ATS Changeover -->
    <rect x="40" y="170" width="180" height="90" fill="#1e293b" stroke="#f59e0b" stroke-width="2" rx="6"/>
    <text x="55" y="200" fill="#f59e0b" font-size="14" font-weight="bold">STANDBY DIESEL GEN</text>
    <text x="55" y="222" fill="#94a3b8" font-size="11">100kVA Sound Attenuated</text>
    <text x="55" y="242" fill="#fbbf24" font-size="10" font-weight="bold">Auto-Start on Mains Fail</text>

    <line x1="220" y1="215" x2="310" y2="150" stroke="#f59e0b" stroke-width="3" stroke-dasharray="6,4"/>

    <!-- ATS Switch -->
    <rect x="310" y="60" width="130" height="110" fill="#0f172a" stroke="#e2e8f0" stroke-width="2" rx="4"/>
    <text x="325" y="95" fill="#f8fafc" font-size="13" font-weight="bold">4-POLE ATS</text>
    <text x="325" y="115" fill="#94a3b8" font-size="10">400A Motorized</text>
    <text x="325" y="135" fill="#38bdf8" font-size="10">Auto Transfer</text>

    <line x1="440" y1="115" x2="520" y2="115" stroke="#38bdf8" stroke-width="5" marker-end="url(#arrow)"/>

    <!-- Main Switchboard MSB-01 -->
    <rect x="520" y="30" width="220" height="230" fill="#1e1e38" stroke="#818cf8" stroke-width="2.5" rx="8"/>
    <text x="535" y="60" fill="#c7d2fe" font-size="15" font-weight="bold">MAIN SWITCHBOARD</text>
    <text x="535" y="80" fill="#818cf8" font-size="12" font-weight="bold">MSB-01 (Form 4b Type 2)</text>
    <line x1="535" y1="90" x2="725" y2="90" stroke="#4338ca" stroke-width="1.5"/>
    <text x="535" y="112" fill="#f8fafc" font-size="11">• Incomer: 400A 4P MCCB</text>
    <text x="535" y="132" fill="#f8fafc" font-size="11">• Surge Protection: Class I+II</text>
    <text x="535" y="152" fill="#f8fafc" font-size="11">• Feeder 1: 160A to DB-L1A</text>
    <text x="535" y="172" fill="#f8fafc" font-size="11">• Feeder 2: 160A to DB-L2A</text>
    <text x="535" y="192" fill="#f8fafc" font-size="11">• Feeder 3: 125A to 40kVA UPS</text>
    <text x="535" y="212" fill="#f8fafc" font-size="11">• Feeder 4: 100A to HVAC/VRF</text>
    <text x="535" y="232" fill="#f8fafc" font-size="11">• Power Factor Correction (PFC)</text>

    <!-- Rising Busbar Riser -->
    <rect x="790" y="30" width="40" height="480" fill="#334155" stroke="#94a3b8" stroke-width="1.5"/>
    <text x="803" y="260" fill="#38bdf8" font-size="12" font-weight="bold" transform="rotate(-90 803 260)">400A COPPER RISING BUSBAR RISER (E-03)</text>

    <line x1="740" y1="115" x2="790" y2="115" stroke="#818cf8" stroke-width="4"/>

    <!-- Tap-off 1: Level 1 DBs -->
    <line x1="830" y1="120" x2="900" y2="120" stroke="#38bdf8" stroke-width="3" marker-end="url(#arrow)"/>
    <rect x="900" y="80" width="160" height="80" fill="#1e293b" stroke="#38bdf8" stroke-width="1.5" rx="4"/>
    <text x="915" y="105" fill="#f8fafc" font-size="12" font-weight="bold">DB-L1A (Level 1 Normal)</text>
    <text x="915" y="125" fill="#94a3b8" font-size="10">24-Way TPN Type B MCBs</text>
    <text x="915" y="145" fill="#38bdf8" font-size="10">Feeds Lighting &amp; Power Ring</text>

    <!-- Tap-off 2: Level 2 DBs -->
    <line x1="830" y1="220" x2="900" y2="220" stroke="#38bdf8" stroke-width="3" marker-end="url(#arrow)"/>
    <rect x="900" y="180" width="160" height="80" fill="#1e293b" stroke="#38bdf8" stroke-width="1.5" rx="4"/>
    <text x="915" y="205" fill="#f8fafc" font-size="12" font-weight="bold">DB-L2A (Level 2 Normal)</text>
    <text x="915" y="225" fill="#94a3b8" font-size="10">24-Way TPN Type B MCBs</text>
    <text x="915" y="245" fill="#38bdf8" font-size="10">Feeds Offices &amp; IT Rooms</text>

    <!-- Tap-off 3: 40kVA UPS System -->
    <line x1="830" y1="320" x2="900" y2="320" stroke="#f59e0b" stroke-width="3" marker-end="url(#arrow-amber)"/>
    <rect x="900" y="280" width="160" height="90" fill="#2d1c03" stroke="#f59e0b" stroke-width="2" rx="4"/>
    <text x="915" y="305" fill="#fbbf24" font-size="12" font-weight="bold">40kVA MODULAR UPS</text>
    <text x="915" y="325" fill="#fde68a" font-size="10">N+1 Redundant Modules</text>
    <text x="915" y="345" fill="#f59e0b" font-size="10">30 Min VRLA Battery Bank</text>
    <text x="915" y="360" fill="#94a3b8" font-size="9">Feeds DB-UPS-L1 &amp; L2</text>

    <!-- Tap-off 4: HVAC Control Panel -->
    <line x1="830" y1="420" x2="900" y2="420" stroke="#10b981" stroke-width="3" marker-end="url(#arrow-emerald)"/>
    <rect x="900" y="390" width="160" height="70" fill="#064e3b" stroke="#10b981" stroke-width="1.5" rx="4"/>
    <text x="915" y="415" fill="#a7f3d0" font-size="12" font-weight="bold">DB-AC (Mechanical)</text>
    <text x="915" y="435" fill="#6ee7b7" font-size="10">Feeds Outdoor VRF Condensers</text>
    <text x="915" y="450" fill="#34d399" font-size="9">Interlocked with Fire Alarm</text>
  </g>
`;

// 2. 2618-L-LTG-01: Lighting Layout (Luminaires, Emergency, Sensors)
const svgLtgLayout = `
  <g id="lighting-layout" transform="translate(60, 110)">
    <!-- Floor perimeter boundaries -->
    <rect x="40" y="20" width="940" height="520" fill="#0d1829" stroke="#334155" stroke-width="2" rx="6"/>
    
    <!-- Office Partition Walls -->
    <line x1="320" y1="20" x2="320" y2="340" stroke="#475569" stroke-width="3"/>
    <line x1="40" y1="340" x2="680" y2="340" stroke="#475569" stroke-width="3"/>
    <line x1="680" y1="20" x2="680" y2="540" stroke="#475569" stroke-width="3"/>
    <line x1="680" y1="260" x2="980" y2="260" stroke="#475569" stroke-width="3"/>

    <!-- Room Labels -->
    <text x="90" y="60" fill="#64748b" font-size="12" font-weight="bold">EXECUTIVE BOARDROOM</text>
    <text x="360" y="60" fill="#64748b" font-size="12" font-weight="bold">OPEN PLAN WORKSPACE - BANKING TEAMS</text>
    <text x="720" y="60" fill="#64748b" font-size="12" font-weight="bold">COMMS / SERVER ROOM</text>
    <text x="720" y="300" fill="#64748b" font-size="12" font-weight="bold">CLIENT MEETING SUITES</text>
    <text x="90" y="380" fill="#64748b" font-size="12" font-weight="bold">STAFF BREAKOUT &amp; PANTRY</text>

    <!-- 600x600 LED Panels Grid in Open Office -->
    <g fill="#0284c7" stroke="#38bdf8" stroke-width="1.5">
      <!-- Row 1 -->
      <rect x="360" y="100" width="28" height="28" rx="2"/><rect x="430" y="100" width="28" height="28" rx="2"/><rect x="500" y="100" width="28" height="28" rx="2"/><rect x="570" y="100" width="28" height="28" rx="2"/>
      <!-- Row 2 -->
      <rect x="360" y="160" width="28" height="28" rx="2"/><rect x="430" y="160" width="28" height="28" rx="2"/><rect x="500" y="160" width="28" height="28" rx="2"/><rect x="570" y="160" width="28" height="28" rx="2"/>
      <!-- Row 3 -->
      <rect x="360" y="220" width="28" height="28" rx="2"/><rect x="430" y="220" width="28" height="28" rx="2"/><rect x="500" y="220" width="28" height="28" rx="2"/><rect x="570" y="220" width="28" height="28" rx="2"/>
      <!-- Row 4 -->
      <rect x="360" y="280" width="28" height="28" rx="2"/><rect x="430" y="280" width="28" height="28" rx="2"/><rect x="500" y="280" width="28" height="28" rx="2"/><rect x="570" y="280" width="28" height="28" rx="2"/>
    </g>

    <!-- Emergency M3 Self-Contained Exit Signs (Green) -->
    <g fill="#10b981" stroke="#34d399" stroke-width="1">
      <rect x="310" y="18" width="20" height="10" rx="1"/>
      <rect x="670" y="18" width="20" height="10" rx="1"/>
      <rect x="670" y="335" width="20" height="10" rx="1"/>
      <rect x="965" y="255" width="20" height="10" rx="1"/>
      <text x="312" y="14" fill="#34d399" font-size="8" font-weight="bold">EXIT M3</text>
      <text x="672" y="14" fill="#34d399" font-size="8" font-weight="bold">EXIT M3</text>
    </g>

    <!-- PIR Daylight & Presence Sensors (Purple circles) -->
    <g fill="#c084fc" stroke="#e9d5ff">
      <circle cx="410" cy="190" r="8"/><circle cx="530" cy="190" r="8"/>
      <circle cx="180" cy="180" r="8"/><circle cx="830" cy="140" r="8"/>
      <text x="403" y="194" fill="#1e1b4b" font-size="9" font-weight="bold">PIR</text>
      <text x="523" y="194" fill="#1e1b4b" font-size="9" font-weight="bold">PIR</text>
    </g>

    <!-- DALI Wiring Loop Line -->
    <path d="M 374 114 H 584 V 174 H 374 V 234 H 584 V 294 H 374" fill="none" stroke="#38bdf8" stroke-width="1" stroke-dasharray="4,3"/>
    <text x="600" y="210" fill="#38bdf8" font-size="10" font-weight="bold">DALI BUS LOOP D1</text>
  </g>
`;

// 3. 2618-L-PWR-01: Power Layout (Sockets, Desk Servicing, UPS)
const svgPwrLayout = `
  <g id="power-layout" transform="translate(60, 110)">
    <rect x="40" y="20" width="940" height="520" fill="#0d1829" stroke="#334155" stroke-width="2" rx="6"/>
    
    <!-- Partitions -->
    <line x1="320" y1="20" x2="320" y2="340" stroke="#475569" stroke-width="3"/>
    <line x1="40" y1="340" x2="680" y2="340" stroke="#475569" stroke-width="3"/>
    <line x1="680" y1="20" x2="680" y2="540" stroke="#475569" stroke-width="3"/>

    <!-- Workstation Desks with Power Outlets -->
    <g fill="#1e293b" stroke="#64748b" stroke-width="1.5">
      <rect x="360" y="80" width="110" height="50" rx="3"/>
      <rect x="500" y="80" width="110" height="50" rx="3"/>
      <rect x="360" y="170" width="110" height="50" rx="3"/>
      <rect x="500" y="170" width="110" height="50" rx="3"/>
      <rect x="360" y="260" width="110" height="50" rx="3"/>
      <rect x="500" y="260" width="110" height="50" rx="3"/>
    </g>

    <!-- Power Outlets Symbols: Blue = Normal 13A Twin, Red = Clean UPS Power -->
    <g transform="translate(0, 0)">
      <!-- Desk 1 -->
      <circle cx="390" cy="105" r="7" fill="#0284c7" stroke="#ffffff" stroke-width="1.5"/>
      <circle cx="440" cy="105" r="7" fill="#dc2626" stroke="#ffffff" stroke-width="1.5"/>
      <!-- Desk 2 -->
      <circle cx="530" cy="105" r="7" fill="#0284c7" stroke="#ffffff" stroke-width="1.5"/>
      <circle cx="580" cy="105" r="7" fill="#dc2626" stroke="#ffffff" stroke-width="1.5"/>
      <!-- Desk 3 -->
      <circle cx="390" cy="195" r="7" fill="#0284c7" stroke="#ffffff" stroke-width="1.5"/>
      <circle cx="440" cy="195" r="7" fill="#dc2626" stroke="#ffffff" stroke-width="1.5"/>
      <!-- Desk 4 -->
      <circle cx="530" cy="195" r="7" fill="#0284c7" stroke="#ffffff" stroke-width="1.5"/>
      <circle cx="580" cy="195" r="7" fill="#dc2626" stroke="#ffffff" stroke-width="1.5"/>
    </g>

    <!-- 3-Compartment Underfloor Screed Trunking Route -->
    <line x1="340" y1="105" x2="640" y2="105" stroke="#f59e0b" stroke-width="3" stroke-dasharray="6,3"/>
    <line x1="340" y1="195" x2="640" y2="195" stroke="#f59e0b" stroke-width="3" stroke-dasharray="6,3"/>
    <line x1="340" y1="285" x2="640" y2="285" stroke="#f59e0b" stroke-width="3" stroke-dasharray="6,3"/>
    <line x1="340" y1="105" x2="340" y2="285" stroke="#f59e0b" stroke-width="4"/>

    <!-- Comms Room Racks Dedicated Power Feeds -->
    <rect x="740" y="80" width="70" height="120" fill="#1e1b4b" stroke="#818cf8" stroke-width="2"/>
    <rect x="840" y="80" width="70" height="120" fill="#1e1b4b" stroke="#818cf8" stroke-width="2"/>
    <text x="750" y="145" fill="#c7d2fe" font-size="11" font-weight="bold">RACK 1</text>
    <text x="850" y="145" fill="#c7d2fe" font-size="11" font-weight="bold">RACK 2</text>
    <circle cx="775" cy="65" r="9" fill="#dc2626" stroke="#ffffff" stroke-width="2"/>
    <circle cx="875" cy="65" r="9" fill="#dc2626" stroke="#ffffff" stroke-width="2"/>
    <text x="760" y="50" fill="#f87171" font-size="9" font-weight="bold">32A CEEFORM (UPS)</text>

    <!-- Legend box -->
    <rect x="60" y="400" width="240" height="110" fill="#0f172a" stroke="#475569" stroke-width="1.5" rx="4"/>
    <text x="75" y="425" fill="#f8fafc" font-size="11" font-weight="bold">POWER SYMBOLS LEGEND</text>
    <circle cx="85" cy="450" r="6" fill="#0284c7" stroke="#ffffff" stroke-width="1"/><text x="105" y="454" fill="#94a3b8" font-size="10">13A Twin Switched Socket</text>
    <circle cx="85" cy="475" r="6" fill="#dc2626" stroke="#ffffff" stroke-width="1"/><text x="105" y="479" fill="#94a3b8" font-size="10">Clean UPS Power Socket (Red)</text>
    <line x1="75" y1="498" x2="95" y2="498" stroke="#f59e0b" stroke-width="3"/><text x="105" y="502" fill="#94a3b8" font-size="10">3-Compartment Floor Trunking</text>
  </g>
`;

// 4. 2618-L-DTA-01: Data & AV Layout
const svgDtaLayout = `
  <g id="data-av-layout" transform="translate(60, 110)">
    <rect x="40" y="20" width="940" height="520" fill="#0d1829" stroke="#334155" stroke-width="2" rx="6"/>
    <line x1="320" y1="20" x2="320" y2="340" stroke="#475569" stroke-width="3"/>
    <line x1="680" y1="20" x2="680" y2="540" stroke="#475569" stroke-width="3"/>

    <!-- Boardroom AV Equipment -->
    <rect x="60" y="60" width="220" height="180" fill="#1e293b" stroke="#38bdf8" stroke-width="1" rx="4"/>
    <text x="75" y="85" fill="#38bdf8" font-size="12" font-weight="bold">BOARDROOM AV SETUP</text>
    <!-- 85" Display -->
    <rect x="110" y="225" width="120" height="8" fill="#e2e8f0" stroke="#0284c7"/>
    <text x="125" y="215" fill="#e2e8f0" font-size="9" font-weight="bold">85" 4K INTERACTIVE</text>
    <!-- Ceiling Mics -->
    <circle cx="130" cy="140" r="10" fill="#10b981" stroke="#ffffff"/>
    <circle cx="210" cy="140" r="10" fill="#10b981" stroke="#ffffff"/>
    <text x="145" y="144" fill="#a7f3d0" font-size="9">DANTE BEAM MIC</text>

    <!-- Wi-Fi 6 Access Points (Diamond with radiating arcs) -->
    <g transform="translate(480, 200)">
      <polygon points="0,-12 12,0 0,12 -12,0" fill="#f59e0b" stroke="#ffffff" stroke-width="1.5"/>
      <text x="16" y="4" fill="#fbbf24" font-size="11" font-weight="bold">WAP-01 (Wi-Fi 6)</text>
    </g>
    <g transform="translate(170, 420)">
      <polygon points="0,-12 12,0 0,12 -12,0" fill="#f59e0b" stroke="#ffffff" stroke-width="1.5"/>
      <text x="16" y="4" fill="#fbbf24" font-size="11" font-weight="bold">WAP-02</text>
    </g>

    <!-- Cat6A Horizontal Cable Bundles -->
    <path d="M 740 140 H 500 V 280 H 380" fill="none" stroke="#818cf8" stroke-width="2.5" stroke-dasharray="5,2"/>
    <text x="560" y="132" fill="#818cf8" font-size="10" font-weight="bold">24x CAT6A U/UTP CABLE BUNDLE</text>
  </g>
`;

// 5. 2618-L-SEC-01: Security Layout (Access Control, Readers, Interlocks)
const svgSecLayout = `
  <g id="security-layout" transform="translate(60, 110)">
    <rect x="40" y="20" width="940" height="520" fill="#0d1829" stroke="#334155" stroke-width="2" rx="6"/>
    
    <!-- Controlled Doors with Card Readers and Mag Locks -->
    <g transform="translate(320, 160)">
      <rect x="-8" y="-30" width="16" height="60" fill="#dc2626" opacity="0.3"/>
      <!-- Proximity Card Reader -->
      <rect x="-24" y="-12" width="12" height="24" rx="2" fill="#ef4444" stroke="#ffffff"/>
      <text x="-21" y="4" fill="#ffffff" font-size="8" font-weight="bold">CR</text>
      <!-- Request to Exit PIR -->
      <polygon points="12,-8 24,-16 24,0" fill="#10b981"/>
      <!-- Mag Lock on door frame -->
      <rect x="-6" y="-30" width="12" height="8" fill="#f59e0b"/>
      <text x="30" y="5" fill="#f87171" font-size="10" font-weight="bold">DOOR D-01: ACCESS CONTROLLED</text>
    </g>

    <!-- Security Controller Cabinet -->
    <rect x="740" y="320" width="160" height="90" fill="#1e1e38" stroke="#ef4444" stroke-width="2" rx="4"/>
    <text x="755" y="345" fill="#fca5a5" font-size="12" font-weight="bold">ACCESS CONTROLLER</text>
    <text x="755" y="365" fill="#f8fafc" font-size="10">8-Door Modular Panel</text>
    <text x="755" y="385" fill="#f59e0b" font-size="10">12V 7Ah Battery Backup</text>
    <text x="755" y="400" fill="#94a3b8" font-size="9">TCP/IP Network Uplink</text>
  </g>
`;

// 6. 2618-L-CTV-01: CCTV Layout (Cameras, Fields of View, NVR)
const svgCtvLayout = `
  <g id="cctv-layout" transform="translate(60, 110)">
    <rect x="40" y="20" width="940" height="520" fill="#0d1829" stroke="#334155" stroke-width="2" rx="6"/>

    <!-- Camera 1: Entrance Dome with Field of View Cone -->
    <g transform="translate(60, 40)">
      <!-- FOV Cone -->
      <polygon points="0,0 180,60 140,160" fill="#38bdf8" opacity="0.15"/>
      <line x1="0" y1="0" x2="180" y2="60" stroke="#38bdf8" stroke-width="1" stroke-dasharray="3,3"/>
      <line x1="0" y1="0" x2="140" y2="160" stroke="#38bdf8" stroke-width="1" stroke-dasharray="3,3"/>
      <!-- Camera Symbol -->
      <circle cx="0" cy="0" r="9" fill="#0284c7" stroke="#ffffff" stroke-width="2"/>
      <text x="14" y="5" fill="#38bdf8" font-size="11" font-weight="bold">CAM-01 (4MP Mini-Dome)</text>
    </g>

    <!-- Camera 2: Open Office Coverage -->
    <g transform="translate(520, 40)">
      <polygon points="0,0 -160,220 160,220" fill="#38bdf8" opacity="0.15"/>
      <circle cx="0" cy="0" r="9" fill="#0284c7" stroke="#ffffff" stroke-width="2"/>
      <text x="14" y="5" fill="#38bdf8" font-size="11" font-weight="bold">CAM-02 (4MP 360° FOV)</text>
    </g>

    <!-- Camera 3: Vault / Cash Handling Area -->
    <g transform="translate(900, 480)">
      <polygon points="0,0 -180,-80 -80,-180" fill="#ef4444" opacity="0.2"/>
      <circle cx="0" cy="0" r="9" fill="#dc2626" stroke="#ffffff" stroke-width="2"/>
      <text x="-160" y="-10" fill="#fca5a5" font-size="11" font-weight="bold">CAM-03 (4K Bulllet)</text>
    </g>
  </g>
`;

// 7. 2618-L-FAS-01: Fire Alarm System (Detectors, Call Points, Sounders)
const svgFasLayout = `
  <g id="fire-alarm-layout" transform="translate(60, 110)">
    <rect x="40" y="20" width="940" height="520" fill="#0d1829" stroke="#334155" stroke-width="2" rx="6"/>

    <!-- Optical Smoke Detectors (Red ring with S) -->
    <g fill="#1e1e2d" stroke="#ef4444" stroke-width="2">
      <circle cx="160" cy="140" r="14"/><text x="155" y="145" fill="#ef4444" font-size="12" font-weight="bold">S</text>
      <circle cx="440" cy="140" r="14"/><text x="435" y="145" fill="#ef4444" font-size="12" font-weight="bold">S</text>
      <circle cx="600" cy="140" r="14"/><text x="595" y="145" fill="#ef4444" font-size="12" font-weight="bold">S</text>
      <circle cx="440" cy="280" r="14"/><text x="435" y="285" fill="#ef4444" font-size="12" font-weight="bold">S</text>
      <circle cx="600" cy="280" r="14"/><text x="595" y="285" fill="#ef4444" font-size="12" font-weight="bold">S</text>
    </g>

    <!-- Manual Call Points (Red Square with break-glass mark) -->
    <g fill="#dc2626" stroke="#ffffff" stroke-width="1.5">
      <rect x="38" y="260" width="18" height="18" rx="2"/><text x="42" y="274" fill="#ffffff" font-size="9" font-weight="bold">MCP</text>
      <rect x="670" y="260" width="18" height="18" rx="2"/><text x="674" y="274" fill="#ffffff" font-size="9" font-weight="bold">MCP</text>
    </g>

    <!-- Sounder Strobes (Red circle with horn symbol) -->
    <g fill="#ef4444" stroke="#ffffff" stroke-width="1.5">
      <polygon points="160,340 180,330 180,350" fill="#ef4444"/>
      <circle cx="160" cy="340" r="6" fill="#ffffff"/>
      <text x="190" y="344" fill="#fca5a5" font-size="10" font-weight="bold">100dB SOUNDER-STROBE</text>
    </g>

    <!-- 2-Core FP200 Gold Fire Alarm Loop Line -->
    <path d="M 50 260 H 160 V 140 H 600 V 280 H 440" fill="none" stroke="#ef4444" stroke-width="2" stroke-dasharray="6,3"/>
    <text x="240" y="130" fill="#fca5a5" font-size="10" font-weight="bold">LOOP 1 (BS 5839-1 CATEGORY L1)</text>
  </g>
`;

// 8. 2618-L-CON-01: Containment Layout (Cable Trays, Trunking, Ladder)
const svgConLayout = `
  <g id="containment-layout" transform="translate(60, 110)">
    <rect x="40" y="20" width="940" height="520" fill="#0d1829" stroke="#334155" stroke-width="2" rx="6"/>

    <!-- 300mm Heavy-Duty Perforated Cable Tray in Corridor -->
    <rect x="100" y="220" width="820" height="40" fill="#1e293b" stroke="#f59e0b" stroke-width="2"/>
    <!-- Perforation pattern simulation -->
    <line x1="120" y1="230" x2="900" y2="230" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="8,6"/>
    <line x1="120" y1="250" x2="900" y2="250" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="8,6"/>
    <text x="360" y="245" fill="#fbbf24" font-size="12" font-weight="bold">300mm GALVANIZED CABLE TRAY (POWER &amp; DATA SEPARATED)</text>

    <!-- 150mm Branch Cable Trays -->
    <rect x="240" y="60" width="30" height="160" fill="#1e293b" stroke="#f59e0b" stroke-width="2"/>
    <rect x="520" y="60" width="30" height="160" fill="#1e293b" stroke="#f59e0b" stroke-width="2"/>
    <rect x="760" y="60" width="30" height="160" fill="#1e293b" stroke="#f59e0b" stroke-width="2"/>
    <text x="250" y="140" fill="#fbbf24" font-size="10" font-weight="bold" transform="rotate(-90 250 140)">150mm TRAY</text>
    <text x="530" y="140" fill="#fbbf24" font-size="10" font-weight="bold" transform="rotate(-90 530 140)">150mm TRAY</text>
    <text x="770" y="140" fill="#fbbf24" font-size="10" font-weight="bold" transform="rotate(-90 770 140)">150mm TRAY</text>

    <!-- Fire Barrier Penetration Sleeves (EI 120 rated) -->
    <rect x="315" y="215" width="14" height="50" fill="#dc2626" stroke="#ffffff"/>
    <rect x="675" y="215" width="14" height="50" fill="#dc2626" stroke="#ffffff"/>
    <text x="335" y="205" fill="#fca5a5" font-size="9" font-weight="bold">EI 120 FIRE TRANSIT COLLAR</text>
  </g>
`;

// 9. 2618-L-ACD-01: Air Conditioning Layout (VRF, Indoor Cassettes, Condensers)
const svgAcdLayout = `
  <g id="ac-layout" transform="translate(60, 110)">
    <rect x="40" y="20" width="940" height="520" fill="#0d1829" stroke="#334155" stroke-width="2" rx="6"/>

    <!-- 4-Way Blow Ceiling Cassettes -->
    <g fill="#0284c7" stroke="#38bdf8" stroke-width="2">
      <!-- Cassette 1 -->
      <rect x="200" y="120" width="45" height="45" rx="4"/>
      <path d="M 210 120 L 222 135 L 235 120 M 210 165 L 222 150 L 235 165" stroke="#ffffff" stroke-width="1.5" fill="none"/>
      <text x="180" y="185" fill="#38bdf8" font-size="10" font-weight="bold">FCU-01 (5.6kW)</text>

      <!-- Cassette 2 -->
      <rect x="480" y="120" width="45" height="45" rx="4"/>
      <path d="M 490 120 L 502 135 L 515 120 M 490 165 L 502 150 L 515 165" stroke="#ffffff" stroke-width="1.5" fill="none"/>
      <text x="460" y="185" fill="#38bdf8" font-size="10" font-weight="bold">FCU-02 (7.1kW)</text>

      <!-- Cassette 3 -->
      <rect x="760" y="120" width="45" height="45" rx="4"/>
      <path d="M 770 120 L 782 135 L 795 120 M 770 165 L 782 150 L 795 165" stroke="#ffffff" stroke-width="1.5" fill="none"/>
      <text x="740" y="185" fill="#38bdf8" font-size="10" font-weight="bold">FCU-03 (7.1kW)</text>
    </g>

    <!-- Refrigerant Pipe Network (Liquid / Gas / Discharge) -->
    <path d="M 222 120 V 60 H 880 V 380" fill="none" stroke="#0ea5e9" stroke-width="3"/>
    <path d="M 502 120 V 60" fill="none" stroke="#0ea5e9" stroke-width="3"/>
    <path d="M 782 120 V 60" fill="none" stroke="#0ea5e9" stroke-width="3"/>
    <text x="320" y="50" fill="#38bdf8" font-size="11" font-weight="bold">INSULATED VRF 3-PIPE HEAT RECOVERY HEADER</text>

    <!-- Outdoor VRF Condenser Units (ODU) -->
    <rect x="840" y="380" width="90" height="120" fill="#1e293b" stroke="#10b981" stroke-width="2" rx="4"/>
    <text x="850" y="420" fill="#a7f3d0" font-size="11" font-weight="bold">ODU-01</text>
    <text x="850" y="440" fill="#94a3b8" font-size="9">VRF Outdoor</text>
    <text x="850" y="460" fill="#6ee7b7" font-size="9">28kW Capacity</text>
  </g>
`;

// 10. 2618-L-VEN-01: Ventilation Layout (Diffusers, Ductwork, Dampers)
const svgVenLayout = `
  <g id="ventilation-layout" transform="translate(60, 110)">
    <rect x="40" y="20" width="940" height="520" fill="#0d1829" stroke="#334155" stroke-width="2" rx="6"/>

    <!-- Fresh Air Supply Duct (Blue) -->
    <path d="M 60 80 H 880" stroke="#0284c7" stroke-width="18" fill="none"/>
    <text x="120" y="74" fill="#38bdf8" font-size="11" font-weight="bold">SUPPLY AIR DUCT 400x250 GALVANIZED (HRV-01)</text>

    <!-- Extract Air Duct (Orange) -->
    <path d="M 60 220 H 880" stroke="#ea580c" stroke-width="18" fill="none"/>
    <text x="120" y="214" fill="#fb923c" font-size="11" font-weight="bold">EXTRACT AIR DUCT 350x200 GALVANIZED</text>

    <!-- Supply Swirl Diffusers (Circles with radial spokes) -->
    <g fill="#0284c7" stroke="#ffffff" stroke-width="1.5">
      <circle cx="240" cy="80" r="16"/>
      <circle cx="500" cy="80" r="16"/>
      <circle cx="760" cy="80" r="16"/>
    </g>

    <!-- Extract Grilles (Rectangles with diagonal cross) -->
    <g fill="#c2410c" stroke="#ffffff" stroke-width="1.5">
      <rect x="225" y="208" width="30" height="24" rx="2"/>
      <rect x="485" y="208" width="30" height="24" rx="2"/>
      <rect x="745" y="208" width="30" height="24" rx="2"/>
    </g>

    <!-- Motorized Fire Dampers (MFD) linked to FAS -->
    <rect x="670" y="66" width="12" height="28" fill="#dc2626" stroke="#ffffff"/>
    <text x="650" y="58" fill="#f87171" font-size="9" font-weight="bold">MFD-01 (72°C)</text>
    <rect x="670" y="206" width="12" height="28" fill="#dc2626" stroke="#ffffff"/>
    <text x="650" y="198" fill="#f87171" font-size="9" font-weight="bold">MFD-02 (72°C)</text>
  </g>
`;

const drawingMap: Record<string, { title: string; discipline: string; contentSvg: string }> = {
  '2618-S-ELE-01': {
    title: 'Electrical Schematic - Rising Mains, Panels & UPS',
    discipline: 'Electrical',
    contentSvg: svgEleSchematic,
  },
  '2618-L-LTG-01': {
    title: 'Lighting Layout - First & Second Floor Luminaires & Emergency',
    discipline: 'Electrical',
    contentSvg: svgLtgLayout,
  },
  '2618-L-PWR-01': {
    title: 'Power Layout - Sockets, Desk Servicing & Clean UPS Power',
    discipline: 'Electrical',
    contentSvg: svgPwrLayout,
  },
  '2618-L-DTA-01': {
    title: 'Data and Audio Visual Layout - GOP Boxes, TVs & BGM',
    discipline: 'ELV',
    contentSvg: svgDtaLayout,
  },
  '2618-L-SEC-01': {
    title: 'Security Layout - Proximity Card Readers, Controllers & Panels',
    discipline: 'Security',
    contentSvg: svgSecLayout,
  },
  '2618-L-CTV-01': {
    title: 'CCTV Layout - Dome & Bullet Cameras First & Second Floor',
    discipline: 'Security',
    contentSvg: svgCtvLayout,
  },
  '2618-L-FAS-01': {
    title: 'Fire Alarm & Fire Fighting Layout - Detectors, Call Points & Sounders',
    discipline: 'Fire Protection',
    contentSvg: svgFasLayout,
  },
  '2618-L-CON-01': {
    title: 'Containment Layout - Cable Trays, Trunking & Floor Ducts',
    discipline: 'Containment',
    contentSvg: svgConLayout,
  },
  '2618-L-ACD-01': {
    title: 'Air Conditioning Layout - VRF & Split Units Level 1 & 2',
    discipline: 'HVAC',
    contentSvg: svgAcdLayout,
  },
  '2618-L-VEN-01': {
    title: 'Ventilation Layout - Supply & Extract Grilles, VCDs & Dampers',
    discipline: 'HVAC',
    contentSvg: svgVenLayout,
  },
};

console.log('================================================================');
console.log('POPULATING VECTOR SVGS FOR ALL 10 ENSER 2618 DRAWING SHEETS');
console.log('================================================================');

for (const [docNum, info] of Object.entries(drawingMap)) {
  const dataUrl = createSvgDataUrl(docNum, info.title, info.discipline, info.contentSvg);
  const fileName = `${docNum}.svg`;

  const res = db.prepare(`
    UPDATE documents
    SET attachment_name = ?, attachment_data = ?, visibility = 'All', status = 'Approved'
    WHERE project_id = ? AND document_number = ?
  `).run(fileName, dataUrl, projectId, docNum);

  console.log(`Updated ${docNum} (${info.title}) -> ${res.changes} row(s) updated.`);
}

console.log('Finished updating drawing attachment_data in database.');
