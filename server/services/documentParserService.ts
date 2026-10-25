import { PDFParse } from "pdf-parse";
import * as mammoth from "mammoth";
import zlib from "zlib";

export function normaliseHeader(val: any): string {
  return String(val || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function colLettersToIndex(cellRef: string): number {
  const m = cellRef.match(/^([A-Z]+)/i);
  if (!m) return -1;
  const letters = m[1].toUpperCase();
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return idx - 1;
}

/**
 * Zero-dependency native Excel (.xlsx) OpenXML parser using Node built-in zlib.
 * Reads xl/sharedStrings.xml and xl/worksheets/sheet*.xml from the ZIP container
 * and converts all worksheet rows into clean tab-delimited text for BOQ & setup extraction.
 */
export function extractXlsxTextFromBuffer(buffer: Buffer): string {
  const entries = new Map<string, string>();

  // First try scanning Central Directory (0x02014b50) for reliable sizes even with data descriptors
  let pos = 0;
  while (pos + 46 <= buffer.length) {
    const sig = buffer.readUInt32LE(pos);
    if (sig === 0x02014b50) {
      const method = buffer.readUInt16LE(pos + 10);
      const compSize = buffer.readUInt32LE(pos + 20);
      const nameLen = buffer.readUInt16LE(pos + 28);
      const extraLen = buffer.readUInt16LE(pos + 30);
      const commentLen = buffer.readUInt16LE(pos + 32);
      const localOffset = buffer.readUInt32LE(pos + 42);
      const name = buffer.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");

      if (
        (name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)) &&
        localOffset + 30 <= buffer.length
      ) {
        const lNameLen = buffer.readUInt16LE(localOffset + 26);
        const lExtraLen = buffer.readUInt16LE(localOffset + 28);
        const dataStart = localOffset + 30 + lNameLen + lExtraLen;
        const compBuf = buffer.subarray(dataStart, dataStart + compSize);
        try {
          if (method === 0) {
            entries.set(name, compBuf.toString("utf8"));
          } else if (method === 8) {
            entries.set(name, zlib.inflateRawSync(compBuf).toString("utf8"));
          }
        } catch {}
      }
      pos += 46 + nameLen + extraLen + commentLen;
    } else {
      pos++;
    }
  }

  // Fallback: scan Local File Headers (0x04034b50) directly
  if (entries.size === 0) {
    let i = 0;
    while (i + 30 <= buffer.length) {
      if (buffer.readUInt32LE(i) === 0x04034b50) {
        const method = buffer.readUInt16LE(i + 8);
        const compSize = buffer.readUInt32LE(i + 18);
        const nameLen = buffer.readUInt16LE(i + 26);
        const extraLen = buffer.readUInt16LE(i + 28);
        const name = buffer.subarray(i + 30, i + 30 + nameLen).toString("utf8");
        const dataStart = i + 30 + nameLen + extraLen;
        if (compSize > 0 && dataStart + compSize <= buffer.length) {
          const compBuf = buffer.subarray(dataStart, dataStart + compSize);
          try {
            if (method === 0) entries.set(name, compBuf.toString("utf8"));
            else if (method === 8) entries.set(name, zlib.inflateRawSync(compBuf).toString("utf8"));
          } catch {}
          i = dataStart + compSize;
          continue;
        }
      }
      i++;
    }
  }

  const sharedStrings: string[] = [];
  const sstXml = entries.get("xl/sharedStrings.xml") || "";
  if (sstXml) {
    const siMatches = sstXml.match(/<si\b[^>]*>[\s\S]*?<\/si>/gi) || [];
    for (const si of siMatches) {
      const tMatches = si.match(/<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/gi) || [];
      const combined = tMatches
        .map(t => decodeXmlEntities(t.replace(/^<t(?:\s+[^>]*)?>/i, "").replace(/<\/t>$/i, "")))
        .join("");
      sharedStrings.push(combined);
    }
  }

  const outLines: string[] = [];
  const sheetNames = Array.from(entries.keys())
    .filter(k => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k))
    .sort();

  for (const sheetName of sheetNames) {
    const xml = entries.get(sheetName) || "";
    const rowMatches = xml.match(/<row\b[^>]*>[\s\S]*?<\/row>/gi) || [];
    for (const rowXml of rowMatches) {
      const cellMatches = rowXml.match(/<c\b[^/>]*(?:\/>|>[\s\S]*?<\/c>)/gi) || [];
      const rowCells: string[] = [];
      let nextColIdx = 0;

      for (const cellXml of cellMatches) {
        const refMatch = cellXml.match(/\br="([A-Z]+\d+)"/i);
        const colIdx = refMatch ? colLettersToIndex(refMatch[1]) : nextColIdx;
        while (rowCells.length < colIdx) rowCells.push("");

        const typeMatch = cellXml.match(/\bt="([^"]+)"/i);
        const cellType = typeMatch ? typeMatch[1] : "n";
        let val = "";

        if (cellType === "inlineStr") {
          const tMatch = cellXml.match(/<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/i);
          if (tMatch) val = decodeXmlEntities(tMatch[1]);
        } else {
          const vMatch = cellXml.match(/<v(?:\s+[^>]*)?>([\s\S]*?)<\/v>/i);
          if (vMatch) {
            const rawV = decodeXmlEntities(vMatch[1].trim());
            if (cellType === "s") {
              const sIdx = parseInt(rawV, 10);
              val = !isNaN(sIdx) && sharedStrings[sIdx] !== undefined ? sharedStrings[sIdx] : rawV;
            } else {
              val = rawV;
            }
          }
        }
        rowCells[colIdx] = val.replace(/\r?\n/g, " ").trim();
        nextColIdx = colIdx + 1;
      }

      if (rowCells.some(c => c !== "")) {
        outLines.push(rowCells.join("\t"));
      }
    }
  }

  return outLines.join("\n");
}

// Extracts plain text (or, for images, a data-URL suitable for a multimodal
// Gemini call) from a document's stored attachment_data (a data: URL, as
// produced by the frontend's FileReader.readAsDataURL). Used by the
// document -> Planner and BOQ/Contract ingestion pipeline.
export async function extractDocumentText(attachmentData: string, attachmentName: string): Promise<
  | { kind: "text"; text: string }
  | { kind: "image"; mimeType: string; base64: string }
  | { kind: "unsupported"; reason: string }
> {
  const match = String(attachmentData || "").match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) {
    return { kind: "unsupported", reason: "No readable file content on this document." };
  }
  const mimeType = match[1];
  const base64 = match[2];
  const buffer = Buffer.from(base64, "base64");
  const nameLower = String(attachmentName || "").toLowerCase();

  try {
    if (mimeType.startsWith("image/")) {
      return { kind: "image", mimeType, base64 };
    }
    // 1. Excel (.xlsx / .xls) extraction
    if (
      nameLower.endsWith(".xlsx") ||
      nameLower.endsWith(".xls") ||
      mimeType.includes("spreadsheetml") ||
      mimeType.includes("ms-excel")
    ) {
      // Check if it is a ZIP-based .xlsx container (PK\x03\x04)
      if (buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50) {
        const xlsxText = extractXlsxTextFromBuffer(buffer);
        if (xlsxText.trim().length > 0) {
          return { kind: "text", text: xlsxText };
        }
      }
      // Also support XML SpreadsheetML or CSV/TSV saved with .xls/.xlsx extension
      const rawUtf8 = buffer.toString("utf8");
      if (rawUtf8.includes("<Row") || rawUtf8.includes("<Cell") || rawUtf8.includes("<Data")) {
        const xmlRows = rawUtf8.match(/<Row\b[^>]*>[\s\S]*?<\/Row>/gi) || [];
        const lines = xmlRows.map(r => {
          const cells = r.match(/<Data\b[^>]*>([\s\S]*?)<\/Data>/gi) || [];
          return cells.map(c => decodeXmlEntities(c.replace(/<[^>]+>/g, "").trim())).join("\t");
        }).filter(Boolean);
        if (lines.length > 0) {
          return { kind: "text", text: lines.join("\n") };
        }
      }
      if (rawUtf8.trim().length > 0) {
        return { kind: "text", text: rawUtf8 };
      }
    }
    // 2. PDF (.pdf) extraction
    if (mimeType === "application/pdf" || nameLower.endsWith(".pdf")) {
      try {
        const parser = new PDFParse({ data: buffer });
        const result = await parser.getText();
        if (result.text && result.text.trim().length > 0) {
          return { kind: "text", text: result.text };
        }
      } catch {}
      // Fallback for lightweight or text-stream PDFs where raw text operators (Tj / TJ) are present
      const rawPdfStr = buffer.toString("latin1");
      const tjMatches = rawPdfStr.match(/\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*Tj/g) || [];
      if (tjMatches.length > 0) {
        const extractedLines = tjMatches
          .map(m => m.replace(/^\(/, "").replace(/\)\s*Tj$/, "").replace(/\\([()\\])/g, "$1"))
          .join("\n");
        if (extractedLines.trim().length > 0) {
          return { kind: "text", text: extractedLines };
        }
      }
      const utf8Fallback = buffer.toString("utf8");
      if (utf8Fallback.trim().length > 0) {
        return { kind: "text", text: utf8Fallback };
      }
    }
    // 3. Word (.docx) extraction
    if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      nameLower.endsWith(".docx")
    ) {
      const result = await mammoth.extractRawText({ buffer });
      return { kind: "text", text: result.value || "" };
    }
    // 4. Plain text / CSV / TSV
    if (mimeType.startsWith("text/") || nameLower.endsWith(".csv") || nameLower.endsWith(".txt") || nameLower.endsWith(".tsv")) {
      return { kind: "text", text: buffer.toString("utf8") };
    }
    // Best-effort: try utf8 text; reject if it looks binary (many replacement/control chars).
    const asText = buffer.toString("utf8");
    const controlCharRatio = (asText.match(/[\x00-\x08\x0E-\x1F\uFFFD]/g) || []).length / Math.max(asText.length, 1);
    if (controlCharRatio < 0.01 && asText.trim().length > 0) {
      return { kind: "text", text: asText };
    }
    return { kind: "unsupported", reason: `Unsupported file type for analysis: ${mimeType || "unknown"}. Supported: PDF, XLSX, DOCX, CSV, TXT, and images.` };
  } catch (e: any) {
    return { kind: "unsupported", reason: `Could not read file content: ${e?.message || "unknown error"}` };
  }
}

export function parseImportNumber(val: any): number {
  if (val === null || val === undefined || val === "") return 0.0;
  const num = parseFloat(String(val).replace(/[,€$£]/g, "").trim());
  return isNaN(num) ? 0.0 : num;
}

export function normaliseProjectDateCandidate(value: any): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const iso = raw.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return iso[1] + "-" + iso[2].padStart(2, "0") + "-" + iso[3].padStart(2, "0");
  const european = raw.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2})\b/);
  if (european) return european[3] + "-" + european[2].padStart(2, "0") + "-" + european[1].padStart(2, "0");
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

export type ProjectSetupSource = {
  id: string;
  name: string;
  text: string;
};

export type ProjectSetupSuggestion = {
  field: "name" | "client" | "start_date" | "end_date" | "budget";
  value: string | number;
  confidence: "High" | "Medium" | "Low";
  source_document_id: string;
  source_document_name: string;
  source_excerpt: string;
};

export function fallbackProjectSetupSuggestions(sources: ProjectSetupSource[]): ProjectSetupSuggestion[] {
  const found = new Map<string, ProjectSetupSuggestion>();
  const add = (field: ProjectSetupSuggestion["field"], value: string | number | null, source: ProjectSetupSource, excerpt: string, confidence: ProjectSetupSuggestion["confidence"] = "Medium") => {
    if (value === null || value === "" || found.has(field)) return;
    found.set(field, {
      field,
      value,
      confidence,
      source_document_id: source.id,
      source_document_name: source.name,
      source_excerpt: excerpt.slice(0, 500),
    });
  };

  for (const source of sources) {
    const lines = source.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      let m = line.match(/^(?:project\s+(?:name|title)|project)\s*[:\-\t]\s*(.+)$/i);
      if (m) add("name", m[1].trim(), source, line, "High");

      m = line.match(/^(?:client|employer|owner)(?:\s+name)?\s*[:\-\t]\s*(.+)$/i);
      if (m) add("client", m[1].trim(), source, line, "High");

      m = line.match(/^(?:commencement|start)(?:\s+date)?\s*[:\-\t]\s*(.+)$/i);
      if (m) add("start_date", normaliseProjectDateCandidate(m[1]), source, line, "High");

      m = line.match(/^(?:practical\s+completion|completion|end)(?:\s+date)?\s*[:\-\t]\s*(.+)$/i);
      if (m) add("end_date", normaliseProjectDateCandidate(m[1]), source, line, "High");

      m = line.match(/^(?:contract\s+(?:value|sum)|tender\s+(?:sum|value)|budget)\s*[:\-\t]?\s*(?:EUR|€|GBP|£|USD|\$)?\s*([0-9][0-9,.\s]*)/i);
      if (m) {
        const amount = parseImportNumber(m[1].replace(/\s/g, ""));
        if (amount > 0) add("budget", amount, source, line, "High");
      }
    }
  }
  return Array.from(found.values());
}
