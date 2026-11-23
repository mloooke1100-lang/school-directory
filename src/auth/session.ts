import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { DB } from "@/db/client";
import { sessions, users } from "@/db/schema";
import { writeAudit } from "@/server/audit";

export const SESSION_COOKIE = "sd_session";
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
const BCRYPT_ROUNDS = 12;

export function sessionTtlMs(): number {
  const h = Number(process.env.SESSION_TTL_HOURS ?? 12);
  return (Number.isFinite(h) && h > 0 ? h : 12) * 3600_000;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(plain: string): Promise<string> {
  validatePasswordStrength(plain);
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

/** سياسة كلمة المرور: 10 أحرف على الأقل، تشمل حرفًا ورقمًا */
export function validatePasswordStrength(plain: string): void {
  if (plain.length < 10 || !/[A-Za-z؀-ۿ]/.test(plain) || !/\d/.test(plain)) {
    throw new Error("كلمة المرور يجب أن تكون 10 أحرف على الأقل وتحتوي على حروف وأرقام");
  }
}

export type LoginResult =
  | { ok: true; token: string; userId: string; expiresAt: Date; mustChangePassword: boolean }
  | { ok: false; reason: "invalid" | "locked" | "inactive" };

// تجزئة وهمية ثابتة لمساواة زمن الاستجابة عند عدم وجود المستخدمة (تقليل كشف أسماء المستخدمات)
let dummyHash: string | null = null;
const getDummyHash = () => (dummyHash ??= bcrypt.hashSync("dummy-password-0", BCRYPT_ROUNDS));

export async function login(
  db: DB,
  username: string,
  password: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<LoginResult> {
  const uname = username.trim().toLowerCase();
  const [u] = await db.select().from(users).where(eq(users.username, uname));

  if (!u) {
    await bcrypt.compare(password, getDummyHash());
    await writeAudit(db, { actorId: null, action: "login_failed", entityType: "user", ip: meta.ip });
    return { ok: false, reason: "invalid" };
  }
  if (!u.isActive) return { ok: false, reason: "inactive" };
  if (u.lockedUntil && u.lockedUntil > new Date()) {
    await writeAudit(db, { actorId: u.id, action: "login_locked", entityType: "user", entityId: u.id, ip: meta.ip });
    return { ok: false, reason: "locked" };
  }

  const valid = await bcrypt.compare(password, u.passwordHash);
  if (!valid) {
    const failed = u.failedLogins + 1;
    const lock = failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null;
    await db
      .update(users)
      .set({ failedLogins: lock ? 0 : failed, lockedUntil: lock })
      .where(eq(users.id, u.id));
    await writeAudit(db, { actorId: u.id, action: "login_failed", entityType: "user", entityId: u.id, ip: meta.ip });
    return { ok: false, reason: lock ? "locked" : "invalid" };
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionTtlMs());
  await db.transaction(async (tx) => {
    await tx.insert(sessions).values({
      tokenHash: hashToken(token),
      userId: u.id,
      expiresAt,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    });
    await tx.update(users).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, u.id));
    await writeAudit(tx, { actorId: u.id, action: "login", entityType: "user", entityId: u.id, ip: meta.ip });
  });
  return { ok: true, token, userId: u.id, expiresAt, mustChangePassword: u.mustChangePassword };
}

/** يعيد معرّف المستخدمة إن كانت الجلسة صالحة وغير ملغاة وغير منتهية والحساب نشط */
export async function validateSession(db: DB, token: string | undefined | null): Promise<string | null> {
  if (!token || token.length > 200) return null;
  const [row] = await db
    .select({ userId: sessions.userId, isActive: users.isActive })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())));
  if (!row || !row.isActive) return null;
  return row.userId;
}

export async function logout(db: DB, token: string | undefined | null): Promise<void> {
  if (!token) return;
  const [s] = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)))
    .returning({ userId: sessions.userId });
  if (s) await writeAudit(db, { actorId: s.userId, action: "logout", entityType: "user", entityId: s.userId });
}

/** إلغاء كل جلسات مستخدمة (مثلًا عند تغيير كلمة المرور أو تعطيل الحساب) */
export async function revokeAllSessions(db: DB, userId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}
