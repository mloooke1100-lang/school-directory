import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { permissions, rolePermissions, roles, userRoles, users } from "@/db/schema";
import { STAGE_SCOPED, type Permission } from "./permissions";

export class AuthError extends Error {
  status = 401;
  constructor(message = "يلزم تسجيل الدخول") {
    super(message);
  }
}

export class ForbiddenError extends Error {
  status = 403;
  constructor(message = "لا تملكين صلاحية تنفيذ هذا الإجراء") {
    super(message);
  }
}

export interface Grant {
  roleCode: string;
  stageId: string | null; // null = كل المراحل
  permissions: Set<string>;
}

export interface AuthContext {
  userId: string;
  displayName: string;
  grants: Grant[];
}

/** يُحمّل صلاحيات المستخدمة من قاعدة البيانات في كل طلب (لا ثقة في بيانات العميل) */
export async function loadAuthContext(db: DB, userId: string): Promise<AuthContext> {
  const [u] = await db
    .select({ id: users.id, displayName: users.displayName, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, userId));
  if (!u || !u.isActive) throw new AuthError();

  const rows = await db
    .select({
      userRoleId: userRoles.id,
      roleCode: roles.code,
      stageId: userRoles.stageId,
      perm: permissions.code,
    })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(userRoles.userId, userId));

  const byUserRole = new Map<string, Grant>();
  for (const r of rows) {
    let g = byUserRole.get(r.userRoleId);
    if (!g) {
      g = { roleCode: r.roleCode, stageId: r.stageId, permissions: new Set() };
      byUserRole.set(r.userRoleId, g);
    }
    if (r.perm) g.permissions.add(r.perm);
  }
  return { userId: u.id, displayName: u.displayName, grants: [...byUserRole.values()] };
}

/**
 * هل تملك المستخدمة الصلاحية؟
 * - stageId غير محدد: هل تملكها في أي نطاق (للقوائم والواجهة فقط، لا للبيانات).
 * - stageId محدد: هل تملكها لهذه المرحلة تحديدًا.
 */
export function can(ctx: AuthContext, perm: Permission, stageId?: string | null): boolean {
  return ctx.grants.some((g) => {
    if (!g.permissions.has(perm)) return false;
    if (stageId === undefined) return true;
    if (!STAGE_SCOPED.has(perm)) return true;
    return g.stageId === null || g.stageId === stageId;
  });
}

export function requirePermission(ctx: AuthContext, perm: Permission, stageId?: string | null): void {
  if (!can(ctx, perm, stageId)) throw new ForbiddenError();
}

export type StageScope = { kind: "all" } | { kind: "stages"; stageIds: string[] } | { kind: "none" };

/** نطاق المراحل المسموح بها لصلاحية ما — يُستخدم لتصفية الاستعلامات على الخادم */
export function stageScope(ctx: AuthContext, perm: Permission): StageScope {
  const relevant = ctx.grants.filter((g) => g.permissions.has(perm));
  if (relevant.length === 0) return { kind: "none" };
  if (!STAGE_SCOPED.has(perm) || relevant.some((g) => g.stageId === null)) return { kind: "all" };
  return { kind: "stages", stageIds: [...new Set(relevant.map((g) => g.stageId!))] };
}
