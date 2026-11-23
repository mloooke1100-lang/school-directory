/**
 * مراقبة الأدوار: تنظيم تكليفات مراقبة الأدوار والممرات والمناطق — وليس تتبعًا إلكترونيًا لمواقع الأشخاص.
 * - التكليف صريح من مستخدمة مخولة (supervision.write)؛ لا تكليف تلقائي لأي معلمة.
 * - تكليف أسبوعي (يوم) أو ليوم محدد (تاريخ) — أحدهما فقط (قيد في قاعدة البيانات).
 * - يُرفض التكليف المتعارض مع الحصص أو الانتظار أو النشاط أو مراقبة أخرى.
 */
import { and, asc, eq, isNotNull, ne, or } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import * as s from "@/db/schema";
import { requirePermission, type AuthContext } from "@/auth/rbac";
import { ConflictError, StaleRecordError } from "@/domain/conflicts";
import { dayOfWeekOf, describeCommitments, overlapping } from "@/domain/schedule";
import { hhmmToMinutes, riyadhNow } from "@/domain/time";
import { writeAudit } from "../audit";
import { updateVersioned } from "../versioned";
import { checkbox, isoDate, optText, reqText, reqUuid, ValidationError, versionField } from "../forms";
import { getTermForDate } from "../school";
import { commitmentsOnDate, weeklyCommitments } from "./schedule";

const time = (label: string) =>
  z.string({ error: `${label} مطلوب` }).regex(/^\d{1,2}:\d{2}$/, { error: `${label} بصيغة ساعة:دقيقة` }).transform((v, c) => {
    try {
      return hhmmToMinutes(v);
    } catch {
      c.addIssue({ code: "custom", message: `${label} غير صالح` });
      return z.NEVER;
    }
  });

export const floorSchema = z.object({ building: reqText("المبنى", 80), name: reqText("الدور", 80), order: z.coerce.number().int().min(-5).max(50).default(0) });
export const areaSchema = z.object({ floorId: reqUuid("الدور"), name: reqText("اسم المنطقة", 80) });
export const areaUpdateSchema = z.object({ version: versionField, name: reqText("اسم المنطقة", 80), isActive: checkbox });
export const assignmentSchema = z
  .object({
    areaId: reqUuid("المنطقة"),
    employeeId: reqUuid("الموظفة المسؤولة"),
    mode: z.enum(["WEEKLY", "DATE"], { error: "اختاري نوع التكليف" }),
    dayOfWeek: z.union([z.literal(""), z.coerce.number().int().min(0).max(4)]).optional(),
    date: z.union([z.literal(""), isoDate("التاريخ")]).optional(),
    periodType: z.enum(s.supervisionPeriod.enumValues, { error: "نوع الفترة غير صالح" }),
    start: time("وقت البداية"),
    end: time("وقت النهاية"),
    status: z.enum(["PLANNED", "CONFIRMED"]).default("PLANNED"),
    notes: optText(500),
  })
  .superRefine((v, c) => {
    if (v.mode === "WEEKLY" && (v.dayOfWeek === "" || v.dayOfWeek === undefined)) c.addIssue({ code: "custom", path: ["dayOfWeek"], message: "اختاري اليوم للتكليف الأسبوعي" });
    if (v.mode === "DATE" && !v.date) c.addIssue({ code: "custom", path: ["date"], message: "اختاري التاريخ للتكليف ليوم محدد" });
    if (v.end <= v.start) c.addIssue({ code: "custom", path: ["end"], message: "وقت النهاية يجب أن يكون بعد البداية" });
  });
export const assignmentUpdateSchema = z.object({ version: versionField, status: z.enum(s.assignmentStatus.enumValues, { error: "الحالة غير صالحة" }), notes: optText(500) });

export async function listAreas(db: DB, ctx: AuthContext) {
  requirePermission(ctx, "supervision.read");
  const floors = await db.select().from(s.floors).orderBy(asc(s.floors.building), asc(s.floors.order));
  const areas = await db.select().from(s.supervisionAreas).orderBy(asc(s.supervisionAreas.name));
  return floors.map((f) => ({ ...f, areas: areas.filter((a) => a.floorId === f.id) }));
}

export async function createFloor(db: DB, ctx: AuthContext, raw: unknown) {
  requirePermission(ctx, "supervision.write");
  const d = floorSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(s.floors).values(d).returning();
    await writeAudit(tx, { actorId: ctx.userId, action: "create", entityType: "floor", entityId: row.id, after: row });
    return row;
  });
}

export async function createArea(db: DB, ctx: AuthContext, raw: unknown) {
  requirePermission(ctx, "supervision.write");
  const d = areaSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(s.supervisionAreas).values(d).returning();
    await writeAudit(tx, { actorId: ctx.userId, action: "create", entityType: "area", entityId: row.id, after: row });
    return row;
  });
}

export async function updateArea(db: DB, ctx: AuthContext, id: string, raw: unknown) {
  requirePermission(ctx, "supervision.write");
  const d = areaUpdateSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(s.supervisionAreas).where(eq(s.supervisionAreas.id, id));
    if (!before) throw new ValidationError("المنطقة غير موجودة");
    const after = await updateVersioned(tx, s.supervisionAreas, id, d.version, { name: d.name, isActive: d.isActive });
    await writeAudit(tx, { actorId: ctx.userId, action: "update", entityType: "area", entityId: id, before, after });
    return after;
  });
}

export async function createAssignment(db: DB, ctx: AuthContext, raw: unknown) {
  requirePermission(ctx, "supervision.write");
  const d = assignmentSchema.parse(raw);
  const weekly = d.mode === "WEEKLY";
  const day = weekly ? Number(d.dayOfWeek) : dayOfWeekOf(d.date as string);
  if (!weekly && day > 4) throw new ValidationError("التاريخ ليس يوم دراسة", "date");
  const term = await getTermForDate(db, weekly ? riyadhNow().date : (d.date as string));
  if (!term) throw new ValidationError(weekly ? "لا يوجد فصل دراسي حالي للتكليف الأسبوعي" : "التاريخ خارج الفصول الدراسية", weekly ? "dayOfWeek" : "date");
  const [area] = await db.select().from(s.supervisionAreas).where(eq(s.supervisionAreas.id, d.areaId));
  if (!area || !area.isActive) throw new ValidationError("المنطقة غير موجودة أو غير نشطة", "areaId");
  const [emp] = await db.select().from(s.employees).where(eq(s.employees.id, d.employeeId));
  if (!emp || emp.status !== "ACTIVE") throw new ValidationError("الموظفة غير موجودة أو ليست على رأس العمل", "employeeId");
  const range = { startMinute: d.start, endMinute: d.end };
  const busy = overlapping(weekly ? await weeklyCommitments(db, term.id, d.employeeId, day) : await commitmentsOnDate(db, term.id, d.employeeId, d.date as string, day), range);
  if (busy.length) throw new ConflictError(`تعارض: الموظفة مكلفة في الوقت نفسه — ${describeCommitments(busy).join("؛ ")}`);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(s.supervisionAssignments)
      .values({ termId: term.id, areaId: d.areaId, employeeId: d.employeeId, dayOfWeek: weekly ? day : null, date: weekly ? null : (d.date as string), periodType: d.periodType, startMinute: d.start, endMinute: d.end, status: d.status, notes: d.notes, assignedById: ctx.userId })
      .returning();
    await writeAudit(tx, { actorId: ctx.userId, action: "create", entityType: "supervision", entityId: row.id, after: row });
    return row;
  });
}

export async function updateAssignment(db: DB, ctx: AuthContext, id: string, raw: unknown) {
  requirePermission(ctx, "supervision.write");
  const d = assignmentUpdateSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(s.supervisionAssignments).where(eq(s.supervisionAssignments.id, id));
    if (!before) throw new ValidationError("التكليف غير موجود");
    if (before.version !== d.version) throw new StaleRecordError();
    if (before.status === "CANCELLED" && d.status !== "CANCELLED") throw new ValidationError("التكليف الملغى لا يُعاد تفعيله؛ أنشئي تكليفًا جديدًا", "status");
    const after = await updateVersioned(tx, s.supervisionAssignments, id, d.version, { status: d.status, notes: d.notes });
    await writeAudit(tx, { actorId: ctx.userId, action: "update", entityType: "supervision", entityId: id, before, after });
    return after;
  });
}

const assignmentCols = {
  a: s.supervisionAssignments,
  area: s.supervisionAreas.name,
  floor: s.floors.name,
  building: s.floors.building,
  employee: s.employees.fullName,
  jobTitle: s.employees.jobTitle,
};

/** الجدول الأسبوعي للمراقبة (التكليفات المتكررة) في الفصل الدراسي الحالي */
export async function weeklySupervision(db: DB, ctx: AuthContext, date: string) {
  requirePermission(ctx, "supervision.read");
  const term = await getTermForDate(db, date);
  if (!term) return null;
  const rows = await db
    .select(assignmentCols)
    .from(s.supervisionAssignments)
    .innerJoin(s.supervisionAreas, eq(s.supervisionAreas.id, s.supervisionAssignments.areaId))
    .innerJoin(s.floors, eq(s.floors.id, s.supervisionAreas.floorId))
    .innerJoin(s.employees, eq(s.employees.id, s.supervisionAssignments.employeeId))
    .where(and(eq(s.supervisionAssignments.termId, term.id), ne(s.supervisionAssignments.status, "CANCELLED"), isNotNull(s.supervisionAssignments.dayOfWeek)))
    .orderBy(asc(s.supervisionAssignments.dayOfWeek), asc(s.supervisionAssignments.startMinute));
  return { termName: term.name, rows };
}

/** جدول مراقبة يوم محدد: الأسبوعية لذلك اليوم + الخاصة بالتاريخ (بما فيها الملغاة للأثر) */
export async function dailySupervision(db: DB, ctx: AuthContext, date: string) {
  requirePermission(ctx, "supervision.read");
  const term = await getTermForDate(db, date);
  if (!term) return null;
  const day = dayOfWeekOf(date);
  const rows = await db
    .select(assignmentCols)
    .from(s.supervisionAssignments)
    .innerJoin(s.supervisionAreas, eq(s.supervisionAreas.id, s.supervisionAssignments.areaId))
    .innerJoin(s.floors, eq(s.floors.id, s.supervisionAreas.floorId))
    .innerJoin(s.employees, eq(s.employees.id, s.supervisionAssignments.employeeId))
    .where(and(eq(s.supervisionAssignments.termId, term.id), or(eq(s.supervisionAssignments.dayOfWeek, day), eq(s.supervisionAssignments.date, date))))
    .orderBy(asc(s.supervisionAssignments.startMinute), asc(s.supervisionAreas.name));
  return { termName: term.name, day, rows };
}
