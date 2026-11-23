import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, freshSeed, closeDb } from "./helpers";
import { DEV_PASSWORD, type SeedResult } from "@/db/seed";
import { login, logout, validateSession, hashToken, validatePasswordStrength, MAX_FAILED_LOGINS } from "@/auth/session";
import { auditLogs, sessions, users } from "@/db/schema";
import { writeAudit } from "@/server/audit";

let seed: SeedResult;
beforeAll(async () => {
  seed = await freshSeed();
});
afterAll(closeDb);

describe("المصادقة والجلسات", () => {
  it("دخول صحيح ينشئ جلسة ويخزن تجزئة الرمز فقط ويسجّل في التدقيق", async () => {
    const r = await login(db, "Principal ", DEV_PASSWORD, { ip: "127.0.0.1" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mustChangePassword).toBe(true);
    const rows = await db.select().from(sessions).where(eq(sessions.userId, r.userId));
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(r.token));
    expect(rows[0].tokenHash).not.toBe(r.token);
    expect(await validateSession(db, r.token)).toBe(seed.userIds.principal);
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.action, "login"));
    expect(audits.length).toBeGreaterThan(0);
  });

  it("كلمة مرور خاطئة ومستخدمة غير موجودة يرجعان نفس السبب", async () => {
    expect(await login(db, "principal", "wrong-pass-1")).toEqual({ ok: false, reason: "invalid" });
    expect(await login(db, "nobody", "wrong-pass-1")).toEqual({ ok: false, reason: "invalid" });
  });

  it(`القفل بعد ${MAX_FAILED_LOGINS} محاولات فاشلة، حتى مع كلمة المرور الصحيحة`, async () => {
    for (let i = 0; i < MAX_FAILED_LOGINS - 1; i++) await login(db, "vp.academic", "bad-password-9");
    const last = await login(db, "vp.academic", "bad-password-9");
    expect(last).toEqual({ ok: false, reason: "locked" });
    expect(await login(db, "vp.academic", DEV_PASSWORD)).toEqual({ ok: false, reason: "locked" });
    await db.update(users).set({ lockedUntil: null }).where(eq(users.id, seed.userIds.vp_academic));
    expect((await login(db, "vp.academic", DEV_PASSWORD)).ok).toBe(true);
  });

  it("تسجيل الخروج يلغي الجلسة", async () => {
    const r = await login(db, "directory", DEV_PASSWORD);
    if (!r.ok) throw new Error("login failed");
    await logout(db, r.token);
    expect(await validateSession(db, r.token)).toBeNull();
  });

  it("الجلسة المنتهية والرمز المزوّر مرفوضان", async () => {
    const r = await login(db, "vp.students", DEV_PASSWORD);
    if (!r.ok) throw new Error("login failed");
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.tokenHash, hashToken(r.token)));
    expect(await validateSession(db, r.token)).toBeNull();
    expect(await validateSession(db, "forged-token")).toBeNull();
    expect(await validateSession(db, "")).toBeNull();
  });

  it("تعطيل الحساب يبطل جلساته القائمة فورًا", async () => {
    const r = await login(db, "test.primary", DEV_PASSWORD);
    if (!r.ok) throw new Error("login failed");
    await db.update(users).set({ isActive: false }).where(eq(users.id, seed.userIds.primary_only));
    expect(await validateSession(db, r.token)).toBeNull();
    expect(await login(db, "test.primary", DEV_PASSWORD)).toEqual({ ok: false, reason: "inactive" });
  });

  it("سياسة قوة كلمة المرور", () => {
    expect(() => validatePasswordStrength("short1")).toThrow();
    expect(() => validatePasswordStrength("onlyletterslong")).toThrow();
    expect(() => validatePasswordStrength("Good-Password-42")).not.toThrow();
  });

  it("سجل التدقيق يحجب كلمات المرور والرموز", async () => {
    await writeAudit(db, { actorId: null, action: "test", entityType: "user", after: { username: "x", passwordHash: "secret", nested: { token: "t" } } });
    const [row] = await db.select().from(auditLogs).where(eq(auditLogs.action, "test"));
    expect(JSON.stringify(row.after)).not.toContain("secret");
    expect((row.after as any).passwordHash).toBe("[محجوب]");
    expect((row.after as any).nested.token).toBe("[محجوب]");
  });
});
