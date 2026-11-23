import { and, eq, sql } from "drizzle-orm";
import type { PgTable, PgColumn } from "drizzle-orm/pg-core";
import type { DB } from "@/db/client";
import { StaleRecordError } from "@/domain/conflicts";

type VersionedTable = PgTable & { id: PgColumn; version: PgColumn };

/**
 * تحديث بقفل تفاؤلي: يُنفَّذ فقط إذا كان version في القاعدة مطابقًا لما قرأته المستخدمة.
 * عند التعارض يرمي StaleRecordError ولا يُكتب شيء (لا ضياع لتعديل مستخدمة أخرى).
 */
export async function updateVersioned<T extends VersionedTable>(
  db: Pick<DB, "update">,
  table: T,
  id: string,
  expectedVersion: number,
  values: Partial<T["$inferInsert"]>,
): Promise<T["$inferSelect"]> {
  const rows = await db
    .update(table)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- جدول عام
    .set({ ...values, version: sql`${table.version} + 1` } as any)
    .where(and(eq(table.id, id), eq(table.version, expectedVersion)))
    .returning();
  if ((rows as unknown[]).length === 0) throw new StaleRecordError();
  return (rows as T["$inferSelect"][])[0];
}
