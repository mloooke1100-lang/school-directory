/** المواد الدراسية والقاعات: إضافة بصلاحية تعديل الجداول (المادة مقيّدة بمرحلتها) */
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import * as s from "@/db/schema";
import { requirePermission, type AuthContext } from "@/auth/rbac";
import { writeAudit } from "../audit";
import { optUuid, reqText, ValidationError } from "../forms";

export const subjectSchema = z.object({ nameAr: reqText("اسم المادة", 80), stageId: optUuid() });
export const roomSchema = z.object({ name: reqText("اسم القاعة", 60), capacity: z.union([z.literal(""), z.coerce.number().int().min(1).max(500)]).optional().transform((v) => (v === "" || v === undefined ? null : v)) });

export async function createSubject(db: DB, ctx: AuthContext, raw: unknown) {
  const d = subjectSchema.parse(raw);
  requirePermission(ctx, "timetable.write", d.stageId);
  if (d.stageId) {
    const [st] = await db.select().from(s.stages).where(eq(s.stages.id, d.stageId));
    if (!st) throw new ValidationError("المرحلة غير موجودة", "stageId");
  }
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(s.subjects).values(d).returning();
    await writeAudit(tx, { actorId: ctx.userId, action: "create", entityType: "subject", entityId: row.id, after: row });
    return row;
  });
}

export async function createRoom(db: DB, ctx: AuthContext, raw: unknown) {
  const d = roomSchema.parse(raw);
  requirePermission(ctx, "timetable.write"); // القاعات مشتركة بين المراحل
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(s.rooms).values(d).returning();
    await writeAudit(tx, { actorId: ctx.userId, action: "create", entityType: "room", entityId: row.id, after: row });
    return row;
  });
}

export async function listCatalog(db: DB, ctx: AuthContext) {
  requirePermission(ctx, "timetable.read");
  const [subjects, rooms] = await Promise.all([
    db.select({ id: s.subjects.id, nameAr: s.subjects.nameAr, stageName: s.stages.nameAr }).from(s.subjects).leftJoin(s.stages, eq(s.stages.id, s.subjects.stageId)).orderBy(asc(s.stages.order), asc(s.subjects.nameAr)),
    db.select().from(s.rooms).orderBy(asc(s.rooms.name)),
  ]);
  return { subjects, rooms };
}
