import type { DB } from "@/db/client";
import { auditLogs } from "@/db/schema";

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/** حقول لا تُكتب أبدًا في سجل التدقيق */
const REDACT = new Set(["passwordHash", "password", "mfaSecret", "tokenHash", "token"]);

function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT.has(k) ? "[محجوب]" : redact(v);
    }
    return out;
  }
  return value;
}

// يقبل db أو معاملة (transaction) — كلاهما يملك insert
type Writer = Pick<DB, "insert">;

export async function writeAudit(db: Writer, e: AuditEntry) {
  await db.insert(auditLogs).values({
    actorId: e.actorId,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    before: redact(e.before) as object | null,
    after: redact(e.after) as object | null,
    ip: e.ip ?? null,
  });
}
