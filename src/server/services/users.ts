/**
 * إدارة الحسابات والصلاحيات — للمديرة فقط (صلاحية users.manage، ولا يملكها دور نظامي آخر).
 * - لا تُنشأ حسابات تلقائيًا للموظفات؛ الحساب يُنشأ صراحة ويُربط اختياريًا بسجل موظفة.
 * - كلمة المرور المؤقتة تُولَّد على الخادم وتُعرض مرة واحدة ولا تُكتب في السجلات، ويُفرض تغييرها عند أول دخول.
 * - حماية من إقفال النظام: لا يمكن للمديرة تعطيل حسابها أو سحب صلاحية إدارة الحسابات من نفسها،
 *   ولا يمكن أن يبقى النظام بلا حساب نشط يملك users.manage.
 */
import { randomBytes, randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import * as s from "@/db/schema";
import { requirePermission, type AuthContext } from "@/auth/rbac";
import { hashPassword, hashToken, revokeAllSessions, validatePasswordStrength } from "@/auth/session";
import { writeAudit } from "../audit";
import { updateVersioned } from "../versioned";
import { checkbox, optUuid, reqText, ValidationError, versionField } from "../forms";

export const usernameField = z
  .string({ error: "اسم المستخدم مطلوب" })
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, { error: "اسم المستخدم 3–32 حرفًا لاتينيًا صغيرًا أو أرقامًا أو . _ -" });

/** يقرأ الأدوار من النموذج: role_<CODE>=on و stage_<CODE>=<stageId|""> */
function rolesFromRaw(raw: Record<string, unknown>): Array<{ code: string; stageId: string | null }> {
  const out: Array<{ code: string; stageId: string | null }> = [];
  for (const [k, v] of Object.entries(raw)) {
    const m = /^role_([A-Z_]+)$/.exec(k);
    if (!m || (v !== "on" && v !== "true")) continue;
    const st = raw[`stage_${m[1]}`];
    out.push({ code: m[1], stageId: typeof st === "string" && st ? st : null });
  }
  return out;
}
const roleList = z.array(z.object({ code: z.string().max(40), stageId: z.uuid({ error: "مرحلة غير صالحة" }).nullable() }));

export const userCreateSchema = z.object({
  username: usernameField,
  displayName: reqText("الاسم الظاهر", 100),
  employeeId: optUuid(),
});
export const userUpdateSchema = z.object({
  version: versionField,
  displayName: reqText("الاسم الظاهر", 100),
  employeeId: optUuid(),
  isActive: checkbox,
});
export const passwordChangeSchema = z
  .object({
    currentPassword: z.string({ error: "أدخلي كلمة المرور الحالية" }).min(1, { error: "أدخلي كلمة المرور الحالية" }).max(200),
    newPassword: z.string({ error: "أدخلي كلمة المرور الجديدة" }).min(1, { error: "أدخلي كلمة المرور الجديدة" }).max(200),
    confirmPassword: z.string().max(200),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { error: "تأكيد كلمة المرور غير مطابق", path: ["confirmPassword"] })
  .refine((v) => v.newPassword !== v.currentPassword, { error: "كلمة المرور الجديدة يجب أن تختلف عن الحالية", path: ["newPassword"] });

/** كلمة مرور مؤقتة عشوائية تحقق سياسة القوة (حروف + أرقام، 16 حرفًا) */
export function generateTempPassword(): string {
  const p = `Tmp${randomInt(1000, 9999)}-${randomBytes(6).toString("base64url").replace(/[-_]/g, "x")}`;
  validatePasswordStrength(p);
  return p;
}

async function resolveRoles(db: Pick<DB, "select">, roles: Array<{ code: string; stageId: string | null }>) {
  const parsed = roleList.parse(roles);
  if (parsed.length === 0) return [];
  const rows = await db.select().from(s.roles).where(inArray(s.roles.code, parsed.map((r) => r.code)));
  const stageIds = parsed.map((r) => r.stageId).filter((x): x is string => !!x);
  const stages = stageIds.length ? await db.select({ id: s.stages.id }).from(s.stages).where(inArray(s.stages.id, stageIds)) : [];
  return parsed.map((r) => {
    const role = rows.find((x) => x.code === r.code);
    if (!role) throw new ValidationError(`الدور ${r.code} غير موجود`);
    if (r.stageId && !stages.some((st) => st.id === r.stageId)) throw new ValidationError("المرحلة المختارة للدور غير موجودة");
    return { roleId: role.id, code: role.code, stageId: r.stageId };
  });
}

/** عدد الحسابات النشطة التي تملك users.manage (اختياريًا باستثناء حساب) */
async function activeManagers(db: Pick<DB, "selectDistinct">, exceptUserId?: string) {
  const rows = await db
    .selectDistinct({ id: s.users.id })
    .from(s.users)
    .innerJoin(s.userRoles, eq(s.userRoles.userId, s.users.id))
    .innerJoin(s.rolePermissions, eq(s.rolePermissions.roleId, s.userRoles.roleId))
    .innerJoin(s.permissions, eq(s.permissions.id, s.rolePermissions.permissionId))
    .where(and(eq(s.users.isActive, true), eq(s.permissions.code, "users.manage"), exceptUserId ? ne(s.users.id, exceptUserId) : sql`true`));
  return rows.length;
}

async function rolesGrantManage(db: Pick<DB, "select">, roleIds: string[]) {
  if (roleIds.length === 0) return false;
  const rows = await db
    .select({ id: s.rolePermissions.roleId })
    .from(s.rolePermissions)
    .innerJoin(s.permissions, eq(s.permissions.id, s.rolePermissions.permissionId))
    .where(and(inArray(s.rolePermissions.roleId, roleIds), eq(s.permissions.code, "users.manage")));
  return rows.length > 0;
}

export async function listUsers(db: DB, ctx: AuthContext) {
  requirePermission(ctx, "users.manage");
  const users = await db
    .select({ id: s.users.id, username: s.users.username, displayName: s.users.displayName, isActive: s.users.isActive, mustChangePassword: s.users.mustChangePassword, lastLoginAt: s.users.lastLoginAt, lockedUntil: s.users.lockedUntil, employeeName: s.employees.fullName })
    .from(s.users)
    .leftJoin(s.employees, eq(s.employees.id, s.users.employeeId))
    .orderBy(asc(s.users.username));
  const roles = await db
    .select({ userId: s.userRoles.userId, roleName: s.roles.nameAr, stageName: s.stages.nameAr })
    .from(s.userRoles)
    .innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId))
    .leftJoin(s.stages, eq(s.stages.id, s.userRoles.stageId));
  return users.map((u) => ({ ...u, roles: roles.filter((r) => r.userId === u.id).map((r) => (r.stageName ? `${r.roleName} — ${r.stageName} فقط` : r.roleName)) }));
}

export async function getUserForEdit(db: DB, ctx: AuthContext, id: string) {
  requirePermission(ctx, "users.manage");
  const [u] = await db
    .select({ id: s.users.id, username: s.users.username, displayName: s.users.displayName, employeeId: s.users.employeeId, isActive: s.users.isActive, mustChangePassword: s.users.mustChangePassword, version: s.users.version, lockedUntil: s.users.lockedUntil, lastLoginAt: s.users.lastLoginAt })
    .from(s.users)
    .where(eq(s.users.id, id));
  if (!u) return null;
  const roles = await db.select({ code: s.roles.code, stageId: s.userRoles.stageId }).from(s.userRoles).innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId)).where(eq(s.userRoles.userId, id));
  return { ...u, roles };
}

/** الأدوار وصلاحياتها (للعرض في مصفوفة الصلاحيات) */
export async function rolesWithPermissions(db: DB, ctx: AuthContext) {
  requirePermission(ctx, "users.manage");
  const roles = await db.select().from(s.roles).orderBy(asc(s.roles.nameAr));
  const rp = await db.select({ roleId: s.rolePermissions.roleId, code: s.permissions.code }).from(s.rolePermissions).innerJoin(s.permissions, eq(s.permissions.id, s.rolePermissions.permissionId));
  return roles.map((r) => ({ ...r, permissions: rp.filter((x) => x.roleId === r.id).map((x) => x.code) }));
}

export async function createUser(db: DB, ctx: AuthContext, raw: Record<string, unknown>) {
  requirePermission(ctx, "users.manage");
  const d = userCreateSchema.parse(raw);
  const roles = await resolveRoles(db, rolesFromRaw(raw));
  if (roles.length === 0) throw new ValidationError("اختاري دورًا واحدًا على الأقل للحساب", "roles");
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  const user = await db.transaction(async (tx) => {
    const [u] = await tx
      .insert(s.users)
      .values({ username: d.username, displayName: d.displayName, employeeId: d.employeeId, passwordHash, mustChangePassword: true })
      .returning();
    await tx.insert(s.userRoles).values(roles.map((r) => ({ userId: u.id, roleId: r.roleId, stageId: r.stageId })));
    await writeAudit(tx, { actorId: ctx.userId, action: "create", entityType: "user", entityId: u.id, after: { ...u, roles: roles.map((r) => ({ code: r.code, stageId: r.stageId })) } });
    return u;
  });
  return { user, tempPassword };
}

export async function updateUser(db: DB, ctx: AuthContext, id: string, raw: Record<string, unknown>) {
  requirePermission(ctx, "users.manage");
  const d = userUpdateSchema.parse(raw);
  const roles = await resolveRoles(db, rolesFromRaw(raw));
  const self = id === ctx.userId;
  if (self && !d.isActive) throw new ValidationError("لا يمكنك تعطيل حسابك الحالي", "isActive");
  const keepsManage = await rolesGrantManage(db, roles.map((r) => r.roleId));
  if (self && !keepsManage) throw new ValidationError("لا يمكنك سحب صلاحية إدارة الحسابات من حسابك الحالي", "roles");
  if ((!d.isActive || !keepsManage) && (await activeManagers(db, id)) === 0) {
    throw new ValidationError("يجب أن يبقى حساب نشط واحد على الأقل يملك صلاحية إدارة الحسابات", "roles");
  }
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(s.users).where(eq(s.users.id, id));
    if (!before) throw new ValidationError("الحساب غير موجود");
    const beforeRoles = await tx.select({ roleId: s.userRoles.roleId, stageId: s.userRoles.stageId }).from(s.userRoles).where(eq(s.userRoles.userId, id));
    const after = await updateVersioned(tx, s.users, id, d.version, { displayName: d.displayName, employeeId: d.employeeId, isActive: d.isActive });
    await tx.delete(s.userRoles).where(eq(s.userRoles.userId, id));
    if (roles.length) await tx.insert(s.userRoles).values(roles.map((r) => ({ userId: id, roleId: r.roleId, stageId: r.stageId })));
    // تعطيل الحساب أو تغيير صلاحياته يُنهي جلساته فورًا ليُعاد تحميل الصلاحيات (إلا جلسة المستخدمة نفسها)
    if (!d.isActive) await revokeAllSessions(tx as unknown as DB, id);
    await writeAudit(tx, { actorId: ctx.userId, action: "update", entityType: "user", entityId: id, before: { ...before, roles: beforeRoles }, after: { ...after, roles } });
    return after;
  });
}

export async function resetUserPassword(db: DB, ctx: AuthContext, id: string, raw: unknown) {
  requirePermission(ctx, "users.manage");
  const { version } = z.object({ version: versionField }).parse(raw);
  if (id === ctx.userId) throw new ValidationError("لتغيير كلمة مرورك استخدمي شاشة «تغيير كلمة المرور»");
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  await db.transaction(async (tx) => {
    await updateVersioned(tx, s.users, id, version, { passwordHash, mustChangePassword: true, failedLogins: 0, lockedUntil: null });
    await revokeAllSessions(tx as unknown as DB, id);
    await writeAudit(tx, { actorId: ctx.userId, action: "password_reset", entityType: "user", entityId: id });
  });
  return { tempPassword };
}

/**
 * تغيير المستخدمة لكلمة مرورها (إجباري عند أول دخول أو بعد إعادة التعيين).
 * يُبقي الجلسة الحالية ويُلغي بقية جلساتها على الأجهزة الأخرى.
 */
export async function changeOwnPassword(db: DB, userId: string, currentToken: string | undefined, raw: unknown) {
  const d = passwordChangeSchema.parse(raw);
  const [u] = await db.select().from(s.users).where(eq(s.users.id, userId));
  if (!u || !u.isActive) throw new ValidationError("الحساب غير متاح");
  if (!(await bcrypt.compare(d.currentPassword, u.passwordHash))) {
    await writeAudit(db, { actorId: userId, action: "password_change_failed", entityType: "user", entityId: userId });
    throw new ValidationError("كلمة المرور الحالية غير صحيحة", "currentPassword");
  }
  try {
    validatePasswordStrength(d.newPassword);
  } catch (e) {
    throw new ValidationError((e as Error).message, "newPassword");
  }
  const passwordHash = await hashPassword(d.newPassword);
  await db.transaction(async (tx) => {
    await tx
      .update(s.users)
      .set({ passwordHash, mustChangePassword: false, version: sql`${s.users.version} + 1` })
      .where(eq(s.users.id, userId));
    await tx
      .update(s.sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(s.sessions.userId, userId), isNull(s.sessions.revokedAt), currentToken ? ne(s.sessions.tokenHash, hashToken(currentToken)) : sql`true`));
    await writeAudit(tx, { actorId: userId, action: "password_change", entityType: "user", entityId: userId });
  });
}

export async function userFormOptions(db: DB) {
  const roles = await db.select().from(s.roles).orderBy(asc(s.roles.nameAr));
  const stages = await db.select().from(s.stages).orderBy(asc(s.stages.order));
  return { roles, stages };
}
