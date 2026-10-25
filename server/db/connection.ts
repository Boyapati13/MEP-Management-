import path from "path";
import { DatabaseSync } from "node:sqlite";

export const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
export const DB_PATH = process.env.MEP_DB_PATH || path.join(process.cwd(), "mep_pm.db");
export const db = new DatabaseSync(DB_PATH);

export function rowToDict(row: any): Record<string, any> | null {
  if (!row) return null;
  return { ...row };
}
