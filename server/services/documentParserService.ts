import { PDFParse } from "pdf-parse";
import * as mammoth from "mammoth";

export function normaliseHeader(val: any): string {
  return String(val || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Extracts plain text (or, for images, a data-URL suitable for a multimodal
// Gemini call) from a document's stored attachment_data (a data: URL, as
// produced by the frontend's FileReader.readAsDataURL). Used by the
// document -> Planner ingestion pipeline.
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
    if (mimeType === "application/pdf" || nameLower.endsWith(".pdf")) {
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      return { kind: "text", text: result.text || "" };
    }
    if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      nameLower.endsWith(".docx")
    ) {
      const result = await mammoth.extractRawText({ buffer });
      return { kind: "text", text: result.value || "" };
    }
    if (mimeType.startsWith("text/") || nameLower.endsWith(".csv") || nameLower.endsWith(".txt") || nameLower.endsWith(".tsv")) {
      return { kind: "text", text: buffer.toString("utf8") };
    }
    // Best-effort: try utf8 text; reject if it looks binary (many replacement/control chars).
    const asText = buffer.toString("utf8");
    const controlCharRatio = (asText.match(/[\x00-\x08\x0E-\x1F\uFFFD]/g) || []).length / Math.max(asText.length, 1);
    if (controlCharRatio < 0.01 && asText.trim().length > 0) {
      return { kind: "text", text: asText };
    }
    return { kind: "unsupported", reason: `Unsupported file type for analysis: ${mimeType || "unknown"}. Supported: PDF, DOCX, CSV, TXT, and images.` };
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
      let m = line.match(/^(?:project\s+(?:name|title)|project)\s*[:\-]\s*(.+)$/i);
      if (m) add("name", m[1].trim(), source, line, "High");

      m = line.match(/^(?:client|employer|owner)(?:\s+name)?\s*[:\-]\s*(.+)$/i);
      if (m) add("client", m[1].trim(), source, line, "High");

      m = line.match(/^(?:commencement|start)(?:\s+date)?\s*[:\-]\s*(.+)$/i);
      if (m) add("start_date", normaliseProjectDateCandidate(m[1]), source, line, "High");

      m = line.match(/^(?:practical\s+completion|completion|end)(?:\s+date)?\s*[:\-]\s*(.+)$/i);
      if (m) add("end_date", normaliseProjectDateCandidate(m[1]), source, line, "High");

      m = line.match(/^(?:contract\s+(?:value|sum)|tender\s+(?:sum|value)|budget)\s*[:\-]?\s*(?:EUR|€|GBP|£|USD|\$)?\s*([0-9][0-9,.\s]*)/i);
      if (m) {
        const amount = parseImportNumber(m[1].replace(/\s/g, ""));
        if (amount > 0) add("budget", amount, source, line, "High");
      }
    }
  }
  return Array.from(found.values());
}

