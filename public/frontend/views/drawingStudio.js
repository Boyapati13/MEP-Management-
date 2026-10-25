function renderSimpleMarkdown(md){
  if(!md) return '';
  let html = escHtml(md);
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h3 style="color:#f3b562;font-size:14px;margin-top:10px;">$1</h3>');
  html = html.replace(/^# (.*$)/gim, '<h3 style="color:var(--primary);font-size:15px;margin-top:12px;">$1</h3>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/^\s*[-*]\s+(.*$)/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/gim, '<ul>$1</ul>');
  html = html.replace(/<\/ul>\s*<ul>/gim, '');
  html = html.replace(/\n\n/g, '<br><br>');
  return html;
}


let studioState = {
  activeTool: 'hand_pen', // 'hand_pen' | 'highlighter' | 'cloud' | 'eraser' | 'arrow' | 'rect' | 'text' | 'pin' | 'pan'
  activeColor: '#ef4444',
  activeStroke: 4,
  isDrawing: false,
  startX: 0,
  startY: 0,
  undoStack: [],
  drawingTitle: 'Level 2 - Fitout & Services',
  zoneName: '',
  zoneSub: '',
  floorKey: 'L2',
  openItems: [],
  zoom: 1.0,
  isPanning: false,
  panStartX: 0,
  panStartY: 0,
  scrollStartX: 0,
  scrollStartY: 0,
  currentPdfDoc: null,
  pdfCurrentPage: 1,
  pdfTotalPages: 1,
  pageMarkups: {}
};

let handStrokePoints = [];

function updateHandModeToast(toolName){
  const toast = document.getElementById('studioHandModeToast');
  const text = document.getElementById('studioHandToastText');
  if(!toast || !text) return;
  toast.classList.remove('fade');
  if(toolName === 'hand_pen'){
    text.textContent = 'Hand Draw Mode: Draw freely with finger or stylus directly on the PDF';
  } else if(toolName === 'highlighter'){
    text.textContent = 'Hand Highlighter: Highlight ducts, pipes, or notes with your hand';
  } else if(toolName === 'cloud'){
    text.textContent = 'Hand Revision Cloud: Trace with finger to bubble-mark MEP defects & clashes';
  } else if(toolName === 'eraser'){
    text.textContent = 'Hand Eraser: Rub with finger or stylus over hand markings to erase';
  } else if(toolName === 'pan'){
    text.textContent = 'Pan Mode: Drag with hand to inspect blueprint without drawing';
  } else if(toolName === 'arrow'){
    text.textContent = 'Arrow Tool: Drag to point out clashes or discrepancies';
  } else if(toolName === 'rect'){
    text.textContent = 'Box Tool: Drag to frame defect or penetration boundaries';
  } else if(toolName === 'text'){
    text.textContent = 'Text Note: Tap anywhere on the PDF to place an engineering note';
  } else if(toolName === 'pin'){
    text.textContent = 'Snag Pin: Tap to stamp a defect pin and create a punch ticket';
  }
  setTimeout(() => { if(toast) toast.classList.add('fade'); }, 3000);
}

function updateCanvasCursor(tool){
  const canvas = document.getElementById('studioMarkupCanvas');
  if(!canvas) return;
  canvas.classList.remove('cursor-pen', 'cursor-pan', 'cursor-eraser');
  if(tool === 'pan'){
    canvas.classList.add('cursor-pan');
  } else if(tool === 'eraser'){
    canvas.classList.add('cursor-eraser');
  } else {
    canvas.classList.add('cursor-pen');
  }
}

function setStudioZoom(newZoom){
  studioState.zoom = Math.max(0.4, Math.min(3.5, newZoom));
  const wrapper = document.getElementById('studioCanvasWrapper');
  const zoomLabel = document.getElementById('studioZoomLabel');
  if(wrapper){
    wrapper.style.transform = `scale(${studioState.zoom})`;
    wrapper.style.transformOrigin = 'top center';
  }
  if(zoomLabel){
    zoomLabel.textContent = `${Math.round(studioState.zoom * 100)}%`;
  }
}

function fitStudioZoomToView(){
  const stage = document.getElementById('studioStage');
  const baseCanvas = document.getElementById('studioBaseCanvas');
  if(!stage || !baseCanvas || !baseCanvas.width) return;
  const availW = stage.clientWidth - 40;
  const availH = stage.clientHeight - 40;
  if(availW <= 0 || availH <= 0) return;
  const scale = Math.min(availW / baseCanvas.width, availH / baseCanvas.height, 1.2);
  setStudioZoom(Math.max(0.4, scale));
}

function getCanvasCoordinates(e, canvas){
  const rect = canvas.getBoundingClientRect();
  const clientX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
  const clientY = (e.touches && e.touches.length > 0) ? e.touches[0].clientY : e.clientY;
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY
  };
}

function saveCanvasState(canvas){
  const ctx = canvas.getContext('2d');
  if(studioState.undoStack.length > 30) studioState.undoStack.shift();
  studioState.undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
}

function drawSmoothStroke(ctx, points, color, strokeWidth, tool){
  if(points.length < 2) return;
  ctx.save();
  if(tool === 'eraser'){
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.lineWidth = strokeWidth * 4.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  } else if(tool === 'highlighter'){
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = strokeWidth * 4.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = color;
    ctx.globalAlpha = 1.0;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  for(let i = 1; i < points.length - 1; i++){
    const xc = (points[i].x + points[i + 1].x) / 2;
    const yc = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
  }
  const last = points[points.length - 1];
  const secondLast = points[points.length - 2];
  ctx.quadraticCurveTo(secondLast.x, secondLast.y, last.x, last.y);
  ctx.stroke();
  ctx.restore();
}

function drawHandRevisionCloud(ctx, points, color, strokeWidth){
  if(points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();

  let p1 = points[0];
  ctx.moveTo(p1.x, p1.y);

  for(let i = 1; i < points.length; i++){
    const p2 = points[i];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if(dist >= 16 || i === points.length - 1){
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      const nx = -dy / (dist || 1) * 8;
      const ny = dx / (dist || 1) * 8;
      ctx.quadraticCurveTo(midX + nx, midY + ny, p2.x, p2.y);
      p1 = p2;
    }
  }
  ctx.stroke();
  ctx.restore();
}

function drawArrowShape(ctx, fromX, fromY, toX, toY, color, width){
  const headLen = Math.max(12, width * 3.5);
  const angle = Math.atan2(toY - fromY, toX - fromX);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - headLen * Math.cos(angle - Math.PI / 6), toY - headLen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(toX - headLen * Math.cos(angle + Math.PI / 6), toY - headLen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function drawRectShape(ctx, fromX, fromY, toX, toY, color, width){
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  const x = Math.min(fromX, toX);
  const y = Math.min(fromY, toY);
  const w = Math.abs(toX - fromX);
  const h = Math.abs(toY - fromY);
  ctx.strokeRect(x, y, w, h);
}

function updatePdfPageNavUI(){
  const navGroup = document.getElementById('studioPdfPageNav');
  const indicator = document.getElementById('studioPdfPageIndicator');
  const prevBtn = document.getElementById('studioPdfPrevPage');
  const nextBtn = document.getElementById('studioPdfNextPage');
  if(!navGroup || !indicator) return;
  if(studioState.pdfTotalPages > 1){
    navGroup.style.display = 'flex';
    indicator.textContent = `Sheet ${studioState.pdfCurrentPage} / ${studioState.pdfTotalPages}`;
    if(prevBtn) prevBtn.disabled = (studioState.pdfCurrentPage <= 1);
    if(nextBtn) nextBtn.disabled = (studioState.pdfCurrentPage >= studioState.pdfTotalPages);
  } else {
    navGroup.style.display = 'none';
  }
}

async function renderPdfPageToCanvas(pdfDataUrlOrRaw, canvasEl, pageNum = 1){
  if(!window.pdfjsLib){
    throw new Error('PDF library is loading. Please try again in a few seconds.');
  }
  let pdfDoc;
  if(pdfDataUrlOrRaw && typeof pdfDataUrlOrRaw.getPage === 'function'){
    pdfDoc = pdfDataUrlOrRaw;
  } else {
    let loadingTask;
    if(typeof pdfDataUrlOrRaw === 'string' && pdfDataUrlOrRaw.startsWith('data:application/pdf;base64,')){
      const rawData = atob(pdfDataUrlOrRaw.replace(/^data:application\/pdf;base64,/, ''));
      const uint8Array = new Uint8Array(rawData.length);
      for(let i = 0; i < rawData.length; i++) uint8Array[i] = rawData.charCodeAt(i);
      loadingTask = pdfjsLib.getDocument({ data: uint8Array });
    } else {
      loadingTask = pdfjsLib.getDocument(pdfDataUrlOrRaw);
    }
    pdfDoc = await loadingTask.promise;
  }

  studioState.currentPdfDoc = pdfDoc;
  studioState.pdfCurrentPage = pageNum;
  studioState.pdfTotalPages = pdfDoc.numPages;

  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1.6 });
  canvasEl.width = viewport.width;
  canvasEl.height = viewport.height;
  const ctx = canvasEl.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;

  updatePdfPageNavUI();
  return { numPages: pdfDoc.numPages, width: viewport.width, height: viewport.height };
}

async function switchPdfPage(targetPage){
  if(!studioState.currentPdfDoc || targetPage < 1 || targetPage > studioState.pdfTotalPages) return;
  const markupCanvas = document.getElementById('studioMarkupCanvas');
  const markupCtx = markupCanvas.getContext('2d');
  const baseCanvas = document.getElementById('studioBaseCanvas');

  // Cache drawings on current page
  studioState.pageMarkups[studioState.pdfCurrentPage] = markupCtx.getImageData(0, 0, markupCanvas.width, markupCanvas.height);

  // Render target PDF page
  await renderPdfPageToCanvas(studioState.currentPdfDoc, baseCanvas, targetPage);
  markupCanvas.width = baseCanvas.width;
  markupCanvas.height = baseCanvas.height;

  // Restore drawings for target page
  markupCtx.clearRect(0, 0, markupCanvas.width, markupCanvas.height);
  if(studioState.pageMarkups[targetPage]){
    markupCtx.putImageData(studioState.pageMarkups[targetPage], 0, 0);
  }
  studioState.undoStack = [];
  saveCanvasState(markupCanvas);
}

// Generates an authentic 3-page vector MEP Blueprint PDF
function generateSampleMepPdf(){
  const { jsPDF } = window.jspdf || {};
  if(!jsPDF){
    // Fallback if jsPDF is loading
    return null;
  }

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [1100, 720] });

  function drawCommonBlueprintFrame(sheetNo, sheetTitle, tradeColor, rev){
    // Background CAD canvas
    doc.setFillColor(10, 20, 32);
    doc.rect(0, 0, 1100, 720, 'F');

    // Subtle CAD Grid
    doc.setDrawColor(25, 45, 68);
    doc.setLineWidth(0.5);
    for(let x = 40; x < 1060; x += 40){
      doc.line(x, 40, x, 680);
    }
    for(let y = 40; y < 680; y += 40){
      doc.line(40, y, 1060, y);
    }

    // Outer Blueprint Border
    doc.setDrawColor(79, 168, 224);
    doc.setLineWidth(2);
    doc.rect(30, 30, 1040, 660);
    doc.setLineWidth(0.8);
    doc.rect(35, 35, 1030, 650);

    // Grid Column & Row Coordinate Markers
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(138, 160, 184);
    const cols = ['A', 'B', 'C', 'D', 'E', 'F'];
    cols.forEach((c, idx) => {
      doc.text(c, 100 + idx * 160, 24, { align: 'center' });
      doc.text(c, 100 + idx * 160, 706, { align: 'center' });
    });
    const rows = ['1', '2', '3', '4'];
    rows.forEach((r, idx) => {
      doc.text(r, 18, 140 + idx * 140);
      doc.text(r, 1080, 140 + idx * 140);
    });

    // Engineering Title Block (bottom-right)
    doc.setFillColor(15, 28, 45);
    doc.rect(730, 530, 335, 155, 'F');
    doc.setDrawColor(79, 168, 224);
    doc.setLineWidth(1.5);
    doc.rect(730, 530, 335, 155);

    // Title Block Dividers
    doc.setLineWidth(0.7);
    doc.line(730, 570, 1065, 570);
    doc.line(730, 615, 1065, 615);
    doc.line(730, 650, 1065, 650);
    doc.line(880, 615, 880, 685);

    // Title Block Text
    doc.setTextColor(245, 166, 35);
    doc.setFontSize(13);
    doc.text('METROPOLITAN HOSPITAL EXPANSION', 740, 552);
    doc.setTextColor(138, 160, 184);
    doc.setFontSize(9);
    doc.text('PHASE 2 - BUILDING A SERVICES FITOUT', 740, 565);

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12);
    doc.text(sheetTitle, 740, 592);
    doc.setFontSize(9);
    doc.setTextColor(79, 168, 224);
    doc.text('SCALE: 1:100  |  COORDINATION STAGE', 740, 608);

    doc.setTextColor(138, 160, 184);
    doc.setFontSize(8);
    doc.text('SHEET NUMBER:', 740, 627);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.text(sheetNo, 740, 644);

    doc.setTextColor(138, 160, 184);
    doc.setFontSize(8);
    doc.text('STATUS & REVISION:', 890, 627);
    doc.setTextColor(tradeColor);
    doc.setFontSize(11);
    doc.text(`ISSUED FOR CONST (${rev})`, 890, 642);

    doc.setTextColor(138, 160, 184);
    doc.setFontSize(8);
    doc.text('DATE: ' + new Date().toISOString().slice(0,10) + '  |  LEAD: CHIEF MEP ENG', 740, 668);

    // Compass North Indicator
    doc.setDrawColor(245, 166, 35);
    doc.setLineWidth(1);
    doc.circle(70, 70, 16);
    doc.line(70, 54, 70, 86);
    doc.line(54, 70, 86, 70);
    doc.setFillColor(245, 166, 35);
    doc.triangle(66, 70, 74, 70, 70, 54, 'F');
    doc.setTextColor(245, 166, 35);
    doc.setFontSize(8);
    doc.text('N', 67, 50);

    // Architectural Core Walls
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(1.8);
    doc.rect(60, 60, 650, 440);
    doc.rect(320, 180, 140, 200); // Core Elevator/Riser Shaft
    doc.setFontSize(9);
    doc.setTextColor(180, 200, 220);
    doc.text('CORE RISER & SERVICE LOBBY', 330, 280);
  }

  // --- SHEET 1: MECHANICAL / HVAC PLAN ---
  drawCommonBlueprintFrame('M-201', 'LEVEL 2 - MECHANICAL & HVAC DUCTING', '#06b6d4', 'REV C');

  // AHU Plant Room
  doc.setDrawColor(6, 182, 212);
  doc.setLineWidth(1.5);
  doc.rect(80, 80, 180, 120);
  doc.setTextColor(6, 182, 212);
  doc.setFontSize(11);
  doc.text('AHU-02 PLANT ROOM', 95, 120);
  doc.setFontSize(8);
  doc.setTextColor(160, 220, 240);
  doc.text('4,200 CFM Supply  |  3,800 CFM Return', 95, 138);

  // Supply Air Main Duct (Cyan solid)
  doc.setDrawColor(6, 182, 212);
  doc.setLineWidth(3);
  doc.line(260, 140, 680, 140);
  doc.line(480, 140, 480, 460);
  doc.line(680, 140, 680, 360);

  // Duct Dimensions & VAV Labels
  doc.setFontSize(8);
  doc.setTextColor(6, 182, 212);
  doc.text('SAD 650 x 450 (4200 CFM)', 280, 132);
  doc.text('SAD 450 x 300 (1800 CFM)', 490, 240);

  // VAV Terminal Boxes
  const vavs = [
    { x: 380, y: 130, id: 'VAV-201' },
    { x: 580, y: 130, id: 'VAV-202' },
    { x: 470, y: 320, id: 'VAV-203' },
    { x: 670, y: 260, id: 'VAV-204' }
  ];
  vavs.forEach(v => {
    doc.setFillColor(15, 45, 65);
    doc.rect(v.x - 5, v.y - 12, 50, 24, 'F');
    doc.setDrawColor(245, 166, 35);
    doc.setLineWidth(1);
    doc.rect(v.x - 5, v.y - 12, 50, 24);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.text(v.id, v.x, v.y + 4);
  });

  // Diffusers (4-way swirl)
  const diffs = [
    { x: 340, y: 90 }, { x: 440, y: 90 }, { x: 540, y: 90 }, { x: 640, y: 90 },
    { x: 380, y: 440 }, { x: 580, y: 440 }, { x: 640, y: 400 }
  ];
  diffs.forEach(d => {
    doc.setDrawColor(6, 182, 212);
    doc.setLineWidth(1);
    doc.circle(d.x, d.y, 8);
    doc.line(d.x - 6, d.y - 6, d.x + 6, d.y + 6);
    doc.line(d.x - 6, d.y + 6, d.x + 6, d.y - 6);
  });

  // Return Air Duct (Dashed lines)
  doc.setLineDashPattern([4, 4], 0);
  doc.setDrawColor(59, 130, 246);
  doc.setLineWidth(2);
  doc.line(260, 165, 640, 165);
  doc.setLineDashPattern([], 0);
  doc.setTextColor(59, 130, 246);
  doc.text('RAD 500 x 350 Return', 280, 178);

  // --- SHEET 2: ELECTRICAL PLAN ---
  doc.addPage([1100, 720], 'landscape');
  drawCommonBlueprintFrame('E-201', 'LEVEL 2 - ELECTRICAL POWER & LIGHTING', '#f97316', 'REV B');

  // Main Distribution Board
  doc.setFillColor(35, 20, 10);
  doc.rect(80, 80, 180, 110, 'F');
  doc.setDrawColor(249, 115, 22);
  doc.setLineWidth(2);
  doc.rect(80, 80, 180, 110);
  doc.setTextColor(249, 115, 22);
  doc.setFontSize(11);
  doc.text('MAIN DIST. BOARD MDB-L2', 95, 115);
  doc.setFontSize(8);
  doc.setTextColor(255, 180, 120);
  doc.text('415V 3-Phase 400A Incomer  |  UPS 40kVA', 95, 135);

  // Perforated Cable Tray Trunking (Orange double line)
  doc.setDrawColor(249, 115, 22);
  doc.setLineWidth(2.5);
  doc.line(260, 130, 680, 130);
  doc.line(260, 138, 680, 138);
  doc.line(470, 138, 470, 460);
  doc.line(478, 138, 478, 460);
  doc.setTextColor(249, 115, 22);
  doc.setFontSize(8);
  doc.text('450mm PERFORATED CABLE TRAY', 280, 122);
  doc.text('300mm TRAY DROP TO DB-CLINICAL', 485, 250);

  // 2x2 Modular LED Troffers & Lighting Circuits
  for(let x = 320; x <= 640; x += 80){
    for(let y = 90; y <= 450; y += 90){
      if(x >= 320 && x <= 460 && y >= 180 && y <= 360) continue; // skip core
      doc.setDrawColor(245, 166, 35);
      doc.setLineWidth(1);
      doc.rect(x - 8, y - 8, 16, 16);
      doc.line(x - 8, y - 8, x + 8, y + 8);
      doc.line(x - 8, y + 8, x + 8, y - 8);
    }
  }

  // Emergency Luminaire Markers
  const ems = [{ x: 280, y: 134 }, { x: 474, y: 300 }, { x: 675, y: 134 }];
  ems.forEach(e => {
    doc.setFillColor(239, 68, 68);
    doc.circle(e.x, e.y, 6, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(6);
    doc.text('EM', e.x - 4, e.y + 2);
  });

  // --- SHEET 3: HYDRAULIC & FIRE SPRINKLER PLAN ---
  doc.addPage([1100, 720], 'landscape');
  drawCommonBlueprintFrame('P-201', 'LEVEL 2 - HYDRAULICS & FIRE SPRINKLERS', '#3b82f6', 'REV D');

  // Hydraulic Riser Shaft
  doc.setFillColor(10, 25, 45);
  doc.rect(80, 80, 180, 110, 'F');
  doc.setDrawColor(59, 130, 246);
  doc.setLineWidth(2);
  doc.rect(80, 80, 180, 110);
  doc.setTextColor(59, 130, 246);
  doc.setFontSize(11);
  doc.text('WET SERVICES RISER WR-02', 95, 115);
  doc.setFontSize(8);
  doc.setTextColor(140, 190, 255);
  doc.text('Fire Ring Main 100mm  |  DCW 50mm  |  HWR 32mm', 95, 135);

  // Fire Sprinkler Main (Red)
  doc.setDrawColor(239, 68, 68);
  doc.setLineWidth(2.5);
  doc.line(260, 120, 680, 120);
  doc.line(470, 120, 470, 460);
  doc.setTextColor(239, 68, 68);
  doc.setFontSize(8);
  doc.text('100mm FIRE SPRINKLER RING MAIN', 280, 112);

  // Sprinkler Heads Grid
  for(let x = 300; x <= 660; x += 60){
    for(let y = 120; y <= 460; y += 80){
      if(x >= 320 && x <= 460 && y >= 180 && y <= 360) continue;
      doc.setDrawColor(239, 68, 68);
      doc.setLineWidth(1);
      doc.circle(x, y, 5);
      doc.line(x, y - 5, x, y + 5);
      doc.line(x - 5, y, x + 5, y);
    }
  }

  // Domestic Cold Water (DCW - Blue) & Hot Water (HWR - Magenta)
  doc.setDrawColor(34, 197, 94);
  doc.setLineWidth(2);
  doc.line(260, 145, 660, 145);
  doc.setTextColor(34, 197, 94);
  doc.text('50mm DOMESTIC COLD WATER (DCW)', 280, 155);

  doc.setDrawColor(236, 72, 153);
  doc.setLineWidth(1.8);
  doc.line(260, 160, 660, 160);
  doc.setTextColor(236, 72, 153);
  doc.text('32mm HOT WATER RECIRCULATION (HWR)', 280, 170);

  return doc.output('datauristring');
}

function renderSvgToCanvas(svgString, canvasEl, width = 1000, height = 625){
  return new Promise((resolve, reject)=>{
    canvasEl.width = width;
    canvasEl.height = height;
    const ctx = canvasEl.getContext('2d');
    ctx.fillStyle = '#07121e';
    ctx.fillRect(0, 0, width, height);

    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = ()=>{
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve({ width, height });
    };
    img.onerror = (err)=>{
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

function renderImageToCanvas(dataUrl, canvasEl){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    img.onload = ()=>{
      canvasEl.width = img.width;
      canvasEl.height = img.height;
      const ctx = canvasEl.getContext('2d');
      ctx.drawImage(img, 0, 0);
      resolve({ width: img.width, height: img.height });
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function createSnagFromStudioCanvas(){
  const baseCanvas = document.getElementById('studioBaseCanvas');
  const markupCanvas = document.getElementById('studioMarkupCanvas');
  const compCanvas = document.createElement('canvas');
  compCanvas.width = baseCanvas.width;
  compCanvas.height = baseCanvas.height;
  const compCtx = compCanvas.getContext('2d');
  compCtx.drawImage(baseCanvas, 0, 0);
  compCtx.drawImage(markupCanvas, 0, 0);
  const dataUrl = compCanvas.toDataURL('image/jpeg', 0.88);

  document.getElementById('drawingStudioModal').classList.add('hide');

  openAddModal('punchlist', 'Punch Item', null, {
    item: `Defect on ${studioState.drawingTitle}${studioState.zoneName ? ' - ' + studioState.zoneName : ''}`,
    location: studioState.zoneName || studioState.drawingTitle,
    priority: 'High',
    trade: 'HVAC',
    attachment_data: dataUrl
  });
}

async function openDrawingMarkupStudio(opts = {}){
  const modal = document.getElementById('drawingStudioModal');
  const baseCanvas = document.getElementById('studioBaseCanvas');
  const markupCanvas = document.getElementById('studioMarkupCanvas');
  const labelEl = document.getElementById('studioDrawingLabel');
  const stageEl = document.getElementById('studioStage');
  const markupCtx = markupCanvas.getContext('2d');

  studioState.undoStack = [];
  studioState.pageMarkups = {};
  studioState.currentPdfDoc = null;
  studioState.pdfCurrentPage = 1;
  studioState.pdfTotalPages = 1;
  studioState.zoom = 1.0;
  setStudioZoom(1.0);

  studioState.floorKey = opts.floorKey || currentFloor || 'L2';
  studioState.zoneName = opts.zone || selectedPlanZone || '';
  studioState.openItems = opts.openItems || [];

  const activePlan = FLOOR_PLANS[studioState.floorKey] || FLOOR_PLANS.L2;
  const zoneObj = studioState.zoneName ? activePlan.zones.find(z => z.name === studioState.zoneName) : null;
  studioState.zoneSub = zoneObj ? zoneObj.sub : '';

  modal.classList.remove('hide');

  // Determine drawing source: custom PDF attachment, custom image, or SVG floor plan
  if(opts.docAttachmentData && opts.docAttachmentData.startsWith('data:application/pdf')){
    labelEl.textContent = `${opts.docName || 'PDF Drawing'} (PDF)`;
    studioState.drawingTitle = opts.docName || 'PDF Architectural Drawing';
    try {
      const info = await renderPdfPageToCanvas(opts.docAttachmentData, baseCanvas);
      markupCanvas.width = info.width;
      markupCanvas.height = info.height;
    } catch(e) {
      alert('Could not render PDF: ' + e.message);
    }
  } else if(opts.docAttachmentData && opts.docAttachmentData.startsWith('data:image/')){
    labelEl.textContent = opts.docName || 'Drawing Image';
    studioState.drawingTitle = opts.docName || 'Drawing';
    try {
      const info = await renderImageToCanvas(opts.docAttachmentData, baseCanvas);
      markupCanvas.width = info.width;
      markupCanvas.height = info.height;
    } catch(e) {
      alert('Could not render image: ' + e.message);
    }
  } else if(opts.useSamplePdf) {
    // Generate and load sample 3-sheet MEP PDF
    const samplePdfUri = generateSampleMepPdf();
    if(samplePdfUri){
      labelEl.textContent = 'M-201: Hospital Fitout MEP Coordination (3-Sheet PDF)';
      studioState.drawingTitle = 'Hospital MEP Coordination Plan (PDF)';
      try {
        const info = await renderPdfPageToCanvas(samplePdfUri, baseCanvas, 1);
        markupCanvas.width = info.width;
        markupCanvas.height = info.height;
      } catch(e){
        alert('Could not load sample PDF: ' + e.message);
      }
    }
  } else {
    // Standard Interactive Floor Plan SVG
    labelEl.textContent = `${activePlan.name}${studioState.zoneName ? ' · ' + studioState.zoneName : ''}`;
    studioState.drawingTitle = activePlan.name;
    const allPunch = await apiFetch(`/api/punchlist?project_id=${currentProjectId}`).catch(()=>[]);
    studioState.openItems = allPunch.filter(i => i.location && i.location.includes(studioState.floorKey));
    const svgStr = generateFloorPlanSvg(studioState.floorKey, allPunch, studioState.zoneName);
    await renderSvgToCanvas(svgStr, baseCanvas, 1000, 625);
    markupCanvas.width = 1000;
    markupCanvas.height = 625;
    updatePdfPageNavUI();
  }

  markupCtx.clearRect(0, 0, markupCanvas.width, markupCanvas.height);
  saveCanvasState(markupCanvas);
  updateCanvasCursor(studioState.activeTool);
  updateHandModeToast(studioState.activeTool);
  setTimeout(() => fitStudioZoomToView(), 150);

  // Wire tool buttons
  document.querySelectorAll('[data-tool]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('[data-tool]').forEach(b => {
        b.classList.remove('active');
        if(b.id === 'toolHandPen') b.classList.add('hand-primary');
      });
      btn.classList.add('active');
      studioState.activeTool = btn.dataset.tool;
      updateCanvasCursor(studioState.activeTool);
      updateHandModeToast(studioState.activeTool);
    };
  });

  // Wire color swatches
  document.querySelectorAll('[data-color]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('[data-color]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      studioState.activeColor = btn.dataset.color;
    };
  });

  // Wire stroke size buttons
  document.querySelectorAll('[data-size]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('[data-size]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      studioState.activeStroke = parseInt(btn.dataset.size, 10) || 4;
    };
  });

  // Wire Zoom controls
  document.getElementById('studioZoomInBtn').onclick = () => setStudioZoom(studioState.zoom + 0.2);
  document.getElementById('studioZoomOutBtn').onclick = () => setStudioZoom(studioState.zoom - 0.2);
  document.getElementById('studioZoomFitBtn').onclick = () => fitStudioZoomToView();

  // Wire PDF Page navigation
  document.getElementById('studioPdfPrevPage').onclick = () => {
    if(studioState.pdfCurrentPage > 1){
      switchPdfPage(studioState.pdfCurrentPage - 1);
    }
  };
  document.getElementById('studioPdfNextPage').onclick = () => {
    if(studioState.pdfCurrentPage < studioState.pdfTotalPages){
      switchPdfPage(studioState.pdfCurrentPage + 1);
    }
  };

  // Wire Undo & Clear
  document.getElementById('studioUndoBtn').onclick = () => {
    if(studioState.undoStack.length > 1){
      studioState.undoStack.pop();
      const prevState = studioState.undoStack[studioState.undoStack.length - 1];
      markupCtx.putImageData(prevState, 0, 0);
    } else if(studioState.undoStack.length === 1){
      markupCtx.clearRect(0, 0, markupCanvas.width, markupCanvas.height);
      studioState.undoStack = [];
      saveCanvasState(markupCanvas);
    }
  };

  document.getElementById('studioClearBtn').onclick = () => {
    if(confirm('Clear all hand annotations and markups on this sheet?')){
      markupCtx.clearRect(0, 0, markupCanvas.width, markupCanvas.height);
      studioState.undoStack = [];
      saveCanvasState(markupCanvas);
    }
  };

  // Wire Sample MEP PDF Button
  document.getElementById('studioSamplePdfBtn').onclick = async () => {
    const samplePdfUri = generateSampleMepPdf();
    if(samplePdfUri){
      labelEl.textContent = 'M-201: Hospital Fitout MEP Coordination (3-Sheet PDF)';
      studioState.drawingTitle = 'Hospital MEP Coordination Plan (PDF)';
      try {
        const info = await renderPdfPageToCanvas(samplePdfUri, baseCanvas, 1);
        markupCanvas.width = info.width;
        markupCanvas.height = info.height;
        markupCtx.clearRect(0, 0, markupCanvas.width, markupCanvas.height);
        studioState.undoStack = [];
        studioState.pageMarkups = {};
        saveCanvasState(markupCanvas);
        fitStudioZoomToView();
        updateHandModeToast('hand_pen');
      } catch(e){
        alert('Could not render sample PDF: ' + e.message);
      }
    } else {
      alert('Sample PDF generator is preparing, please try again in a moment.');
    }
  };

  // Wire File Loader (PDF / Image)
  const fileInput = document.getElementById('studioFileInput');
  document.getElementById('studioUploadPdfBtn').onclick = () => fileInput.click();
  fileInput.onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if(!file) return;
    try {
      if(file.type === 'application/pdf' || file.name.endsWith('.pdf')){
        labelEl.textContent = `${file.name} (PDF Blueprint)`;
        studioState.drawingTitle = file.name;
        const reader = new FileReader();
        reader.onload = async () => {
          const info = await renderPdfPageToCanvas(reader.result, baseCanvas, 1);
          markupCanvas.width = info.width;
          markupCanvas.height = info.height;
          markupCtx.clearRect(0, 0, markupCanvas.width, markupCanvas.height);
          studioState.undoStack = [];
          studioState.pageMarkups = {};
          saveCanvasState(markupCanvas);
          fitStudioZoomToView();
        };
        reader.readAsDataURL(file);
      } else {
        labelEl.textContent = file.name;
        studioState.drawingTitle = file.name;
        const reader = new FileReader();
        reader.onload = async () => {
          const info = await renderImageToCanvas(reader.result, baseCanvas);
          markupCanvas.width = info.width;
          markupCanvas.height = info.height;
          markupCtx.clearRect(0, 0, markupCanvas.width, markupCanvas.height);
          studioState.undoStack = [];
          studioState.currentPdfDoc = null;
          studioState.pdfTotalPages = 1;
          updatePdfPageNavUI();
          saveCanvasState(markupCanvas);
          fitStudioZoomToView();
        };
        reader.readAsDataURL(file);
      }
    } catch(err) {
      alert('Error loading drawing: ' + err.message);
    }
  };

  // Wire Download PNG
  document.getElementById('studioDownloadBtn').onclick = () => {
    const compCanvas = document.createElement('canvas');
    compCanvas.width = baseCanvas.width;
    compCanvas.height = baseCanvas.height;
    const compCtx = compCanvas.getContext('2d');
    compCtx.drawImage(baseCanvas, 0, 0);
    compCtx.drawImage(markupCanvas, 0, 0);
    const link = document.createElement('a');
    link.href = compCanvas.toDataURL('image/png');
    link.download = `markup_${(studioState.drawingTitle || 'drawing').replace(/\s+/g,'_')}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  // Wire Save to Documents
  document.getElementById('studioSaveDocBtn').onclick = async () => {
    const saveBtn = document.getElementById('studioSaveDocBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    try {
      const compCanvas = document.createElement('canvas');
      compCanvas.width = baseCanvas.width;
      compCanvas.height = baseCanvas.height;
      const compCtx = compCanvas.getContext('2d');
      compCtx.drawImage(baseCanvas, 0, 0);
      compCtx.drawImage(markupCanvas, 0, 0);
      const dataUrl = compCanvas.toDataURL('image/png');

      const projId = currentProjectId === 'ALL' ? (PROJECTS[0]?.id || '') : currentProjectId;
      await apiFetch('/api/documents', {
        method: 'POST',
        body: JSON.stringify({
          project_id: projId,
          name: `Annotated Drawing - ${studioState.drawingTitle} (Sheet ${studioState.pdfCurrentPage})`,
          category: 'Drawing',
          revision: 'Markup-1',
          date_added: new Date().toISOString().slice(0, 10),
          attachment_name: `markup_${Date.now()}.png`,
          attachment_data: dataUrl
        })
      });
      alert('✓ Annotated drawing successfully saved to Project Documents!');
    } catch(e) {
      alert('Failed to save document: ' + e.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save to Documents';
    }
  };

  // Wire Create Snag from Markup
  document.getElementById('studioCreateSnagBtn').onclick = () => {
    createSnagFromStudioCanvas();
  };

  // Wire Ask AI button in studio
  document.getElementById('studioAskAiBtn').onclick = () => {
    openWorkerAiDrawer({
      drawingTitle: `${studioState.drawingTitle} (Sheet ${studioState.pdfCurrentPage})`,
      zoneName: studioState.zoneName,
      zoneSub: studioState.zoneSub,
      openItems: studioState.openItems,
      floorKey: studioState.floorKey
    });
  };

  // Wire Close Studio
  document.getElementById('closeStudioBtn').onclick = () => {
    modal.classList.add('hide');
  };

  // --- Markup Canvas Interaction Handlers (Touch + Mouse + Gestures) ---
  let previewSnapshot = null;
  let initialPinchDist = null;
  let initialZoom = 1.0;

  function onPointerDown(e){
    // Multi-touch gestures (Pinch to Zoom & Two-Finger Panning)
    if(e.touches && e.touches.length === 2){
      studioState.isDrawing = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      initialPinchDist = Math.sqrt(dx * dx + dy * dy);
      initialZoom = studioState.zoom;
      return;
    }

    if(studioState.activeTool === 'pan'){
      studioState.isPanning = true;
      const clientX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
      const clientY = (e.touches && e.touches.length > 0) ? e.touches[0].clientY : e.clientY;
      studioState.panStartX = clientX;
      studioState.panStartY = clientY;
      studioState.scrollStartX = stageEl.scrollLeft;
      studioState.scrollStartY = stageEl.scrollTop;
      return;
    }

    e.preventDefault();
    studioState.isDrawing = true;
    const pos = getCanvasCoordinates(e, markupCanvas);
    studioState.startX = pos.x;
    studioState.startY = pos.y;
    saveCanvasState(markupCanvas);
    previewSnapshot = markupCtx.getImageData(0, 0, markupCanvas.width, markupCanvas.height);

    if(studioState.activeTool === 'hand_pen' || studioState.activeTool === 'highlighter' || studioState.activeTool === 'eraser'){
      handStrokePoints = [pos];
      // Draw initial dot for responsiveness
      drawSmoothStroke(markupCtx, [pos, { x: pos.x + 0.1, y: pos.y + 0.1 }], studioState.activeColor, studioState.activeStroke, studioState.activeTool);
    } else if(studioState.activeTool === 'cloud'){
      handStrokePoints = [pos];
    }
  }

  function onPointerMove(e){
    // Handle 2-finger pinch-to-zoom
    if(e.touches && e.touches.length === 2 && initialPinchDist){
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const newDist = Math.sqrt(dx * dx + dy * dy);
      const ratio = newDist / initialPinchDist;
      setStudioZoom(initialZoom * ratio);
      return;
    }

    // Handle Pan tool dragging
    if(studioState.isPanning){
      e.preventDefault();
      const clientX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
      const clientY = (e.touches && e.touches.length > 0) ? e.touches[0].clientY : e.clientY;
      stageEl.scrollLeft = studioState.scrollStartX - (clientX - studioState.panStartX);
      stageEl.scrollTop = studioState.scrollStartY - (clientY - studioState.panStartY);
      return;
    }

    if(!studioState.isDrawing) return;
    e.preventDefault();
    const pos = getCanvasCoordinates(e, markupCanvas);

    if(studioState.activeTool === 'hand_pen' || studioState.activeTool === 'highlighter' || studioState.activeTool === 'eraser'){
      handStrokePoints.push(pos);
      if(previewSnapshot) markupCtx.putImageData(previewSnapshot, 0, 0);
      drawSmoothStroke(markupCtx, handStrokePoints, studioState.activeColor, studioState.activeStroke, studioState.activeTool);
    } else if(studioState.activeTool === 'cloud'){
      handStrokePoints.push(pos);
      if(previewSnapshot) markupCtx.putImageData(previewSnapshot, 0, 0);
      drawHandRevisionCloud(markupCtx, handStrokePoints, studioState.activeColor, studioState.activeStroke);
    } else if(studioState.activeTool === 'arrow'){
      if(previewSnapshot) markupCtx.putImageData(previewSnapshot, 0, 0);
      drawArrowShape(markupCtx, studioState.startX, studioState.startY, pos.x, pos.y, studioState.activeColor, studioState.activeStroke);
    } else if(studioState.activeTool === 'rect'){
      if(previewSnapshot) markupCtx.putImageData(previewSnapshot, 0, 0);
      drawRectShape(markupCtx, studioState.startX, studioState.startY, pos.x, pos.y, studioState.activeColor, studioState.activeStroke);
    }
  }

  function onPointerUp(e){
    if(studioState.isPanning){
      studioState.isPanning = false;
      return;
    }
    initialPinchDist = null;

    if(!studioState.isDrawing) return;
    e.preventDefault();
    studioState.isDrawing = false;
    markupCtx.globalAlpha = 1.0;
    markupCtx.globalCompositeOperation = 'source-over';
    const pos = getCanvasCoordinates(e, markupCanvas);

    if(studioState.activeTool === 'hand_pen' || studioState.activeTool === 'highlighter' || studioState.activeTool === 'eraser'){
      handStrokePoints.push(pos);
      if(previewSnapshot) markupCtx.putImageData(previewSnapshot, 0, 0);
      drawSmoothStroke(markupCtx, handStrokePoints, studioState.activeColor, studioState.activeStroke, studioState.activeTool);
      handStrokePoints = [];
    } else if(studioState.activeTool === 'cloud'){
      handStrokePoints.push(pos);
      if(previewSnapshot) markupCtx.putImageData(previewSnapshot, 0, 0);
      drawHandRevisionCloud(markupCtx, handStrokePoints, studioState.activeColor, studioState.activeStroke);
      handStrokePoints = [];
    } else if(studioState.activeTool === 'text'){
      const text = prompt('Enter annotation text note for drawing:', 'Check clearance / Coordination defect');
      if(text && text.trim()){
        const fontSize = Math.max(14, studioState.activeStroke * 3.5);
        markupCtx.font = `bold ${fontSize}px sans-serif`;
        const textWidth = markupCtx.measureText(text.trim()).width;
        markupCtx.fillStyle = 'rgba(7, 16, 26, 0.88)';
        markupCtx.fillRect(pos.x - 4, pos.y - fontSize - 2, textWidth + 14, fontSize + 8);
        markupCtx.strokeStyle = studioState.activeColor;
        markupCtx.lineWidth = 1.5;
        markupCtx.strokeRect(pos.x - 4, pos.y - fontSize - 2, textWidth + 14, fontSize + 8);
        markupCtx.fillStyle = studioState.activeColor;
        markupCtx.fillText(text.trim(), pos.x + 3, pos.y - 2);
      }
    } else if(studioState.activeTool === 'pin'){
      markupCtx.save();
      markupCtx.fillStyle = studioState.activeColor;
      markupCtx.beginPath();
      markupCtx.arc(pos.x, pos.y, 14, 0, Math.PI * 2);
      markupCtx.fill();
      markupCtx.strokeStyle = '#ffffff';
      markupCtx.lineWidth = 2.5;
      markupCtx.stroke();
      markupCtx.fillStyle = '#ffffff';
      markupCtx.font = 'bold 12px sans-serif';
      markupCtx.textAlign = 'center';
      markupCtx.textBaseline = 'middle';
      markupCtx.fillText('!', pos.x, pos.y);
      markupCtx.restore();

      const wantSnag = confirm(`Defect pin stamped at coordinates (${Math.round(pos.x)}, ${Math.round(pos.y)})!\n\nWould you like to open the Punch List form now to create a ticket with this marked-up drawing attached?`);
      if(wantSnag){
        createSnagFromStudioCanvas();
      }
    }
  }

  markupCanvas.onmousedown = onPointerDown;
  markupCanvas.onmousemove = onPointerMove;
  markupCanvas.onmouseup = onPointerUp;
  markupCanvas.ontouchstart = onPointerDown;
  markupCanvas.ontouchmove = onPointerMove;
  markupCanvas.ontouchend = onPointerUp;
}

/* =========================================================================
   WORKER AI ASSISTANT DRAWER (Natural language Q&A for drawing specifications)
   ========================================================================= */

async function openWorkerAiDrawer(ctx = {}){
  const drawer = document.getElementById('workerAiDrawer');
  const titleEl = document.getElementById('aiContextDrawingTitle');
  const zoneEl = document.getElementById('aiContextZone');
  const badgeEl = document.getElementById('aiContextSnagBadge');
  const answerCard = document.getElementById('aiAnswerCard');
  const respContainer = document.getElementById('aiResponseContainer');
  const loadingIndicator = document.getElementById('aiLoadingIndicator');
  const input = document.getElementById('aiQuestionInput');

  const drawingTitle = ctx.drawingTitle || (FLOOR_PLANS[currentFloor]?.name || 'Level 2 - Fitout & Services');
  const zoneName = ctx.zoneName || selectedPlanZone || 'All Floor Zones';
  const zoneSub = ctx.zoneSub || '';
  const openItems = ctx.openItems || [];

  titleEl.textContent = drawingTitle;
  zoneEl.textContent = zoneName;

  if(openItems.length > 0){
    badgeEl.textContent = `${openItems.length} Open Snags`;
    badgeEl.style.display = 'inline-block';
  } else {
    badgeEl.style.display = 'none';
  }

  drawer.classList.remove('hide');
  input.value = '';
  input.focus();

  // Snapshot canvas if open in studio
  let snapshotDataUrl = null;
  const baseCanvas = document.getElementById('studioBaseCanvas');
  const markupCanvas = document.getElementById('studioMarkupCanvas');
  if(baseCanvas && baseCanvas.width > 0){
    try {
      const c = document.createElement('canvas');
      c.width = Math.min(baseCanvas.width, 1000);
      c.height = Math.round((baseCanvas.height * c.width) / baseCanvas.width);
      const cx = c.getContext('2d');
      cx.drawImage(baseCanvas, 0, 0, c.width, c.height);
      if(markupCanvas) cx.drawImage(markupCanvas, 0, 0, c.width, c.height);
      snapshotDataUrl = c.toDataURL('image/jpeg', 0.82);
    } catch(e){}
  }

  async function queryDrawingAi(questionText){
    if(!questionText || !questionText.trim()) return;
    respContainer.style.display = 'none';
    loadingIndicator.style.display = 'block';

    try {
      const result = await apiFetch('/api/drawing/ask-ai', {
        method: 'POST',
        body: JSON.stringify({
          project_id: currentProjectId,
          drawing_title: drawingTitle,
          zone_name: zoneName,
          zone_sub: zoneSub,
          question: questionText,
          image_data: snapshotDataUrl,
          open_items: openItems
        })
      });

      loadingIndicator.style.display = 'none';
      respContainer.style.display = 'block';
      answerCard.innerHTML = renderSimpleMarkdown(result.answer || 'No guidance returned.');
      answerCard.dataset.raw = result.answer || '';
    } catch(err) {
      loadingIndicator.style.display = 'none';
      respContainer.style.display = 'block';
      answerCard.innerHTML = `<div style="color:var(--danger);padding:8px;">Failed to get AI response: ${escHtml(err.message || 'Unknown error')}</div>`;
    }
  }

  document.querySelectorAll('.ai-quick-btn').forEach(btn => {
    btn.onclick = () => {
      const q = btn.dataset.q;
      input.value = q;
      queryDrawingAi(q);
    };
  });

  const sendBtn = document.getElementById('aiSubmitQuestionBtn');
  sendBtn.onclick = () => {
    const q = input.value.trim();
    if(q) queryDrawingAi(q);
  };

  input.onkeydown = (e) => {
    if(e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      const q = input.value.trim();
      if(q) queryDrawingAi(q);
    }
  };

  document.getElementById('aiCopyAnswerBtn').onclick = () => {
    const raw = answerCard.dataset.raw || answerCard.innerText;
    navigator.clipboard.writeText(raw).then(() => {
      const copyBtn = document.getElementById('aiCopyAnswerBtn');
      copyBtn.textContent = '✓ Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
    });
  };

  document.getElementById('closeAiDrawerBtn').onclick = () => {
    drawer.classList.add('hide');
  };
}
