import { inArray, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { StageScope } from "@/auth/rbac";

/** يحوّل نطاق المراحل إلى شرط SQL على عمود المرحلة؛ النطاق الفارغ لا يُرجع شيئًا */
export function stageFilter(scope: StageScope, stageColumn: PgColumn): SQL {
  if (scope.kind === "all") return sql`true`;
  if (scope.kind === "none" || scope.stageIds.length === 0) return sql`false`;
  return inArray(stageColumn, scope.stageIds);
}
