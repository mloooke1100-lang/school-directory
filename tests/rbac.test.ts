import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, freshSeed, closeDb } from "./helpers";
import { can, loadAuthContext, requirePermission, stageScope, ForbiddenError, AuthError } from "@/auth/rbac";
import type { SeedResult } from "@/db/seed";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

let seed: SeedResult;
beforeAll(async () => {
  seed = await freshSeed();
});
afterAll(closeDb);

describe("RBAC — الصلاحيات والأدوار", () => {
  it("المديرة تملك كل الصلاحيات في كل المراحل", async () => {
    const ctx = await loadAuthContext(db, seed.userIds.principal);
    expect(can(ctx, "users.manage")).toBe(true);
    expect(can(ctx, "students.write", seed.stageIds.KINDERGARTEN)).toBe(true);
    expect(stageScope(ctx, "students.read")).toEqual({ kind: "all" });
  });

  it("وكيلة الشؤون التعليمية تدير الجداول ولا تعتمد الغياب ولا تدير الحسابات", async () => {
    const ctx = await loadAuthContext(db, seed.userIds.vp_academic);
    expect(can(ctx, "timetable.write", seed.stageIds.PRIMARY)).toBe(true);
    expect(can(ctx, "substitutes.write", seed.stageIds.INTERMEDIATE)).toBe(true);
    expect(can(ctx, "attendance.approve", seed.stageIds.PRIMARY)).toBe(false);
    expect(can(ctx, "users.manage")).toBe(false);
  });

  it("وكيلة شؤون الطالبات تعتمد الغياب والنقل ولا تعدّل الجداول", async () => {
    const ctx = await loadAuthContext(db, seed.userIds.vp_students);
    expect(can(ctx, "attendance.approve", seed.stageIds.PRIMARY)).toBe(true);
    expect(can(ctx, "status_changes.approve", seed.stageIds.INTERMEDIATE)).toBe(true);
    expect(can(ctx, "timetable.write", seed.stageIds.PRIMARY)).toBe(false);
  });

  it("مسؤولة الدليل تستورد وتعدّل الدليل لكن لا تعتمد ولا تدير الحسابات ولا تقرأ سجل التدقيق", async () => {
    const ctx = await loadAuthContext(db, seed.userIds.directory);
    expect(can(ctx, "imports.manage")).toBe(true);
    expect(can(ctx, "employees.write")).toBe(true);
    expect(can(ctx, "attendance.approve", seed.stageIds.PRIMARY)).toBe(false);
    expect(can(ctx, "users.manage")).toBe(false);
    expect(can(ctx, "audit.read")).toBe(false);
  });

  it("الحساب المقيّد بالابتدائية لا يصل لبيانات المتوسطة أو الروضة", async () => {
    const ctx = await loadAuthContext(db, seed.userIds.primary_only);
    expect(can(ctx, "students.read", seed.stageIds.PRIMARY)).toBe(true);
    expect(can(ctx, "students.read", seed.stageIds.INTERMEDIATE)).toBe(false);
    expect(can(ctx, "attendance.write", seed.stageIds.KINDERGARTEN)).toBe(false);
    expect(stageScope(ctx, "students.read")).toEqual({ kind: "stages", stageIds: [seed.stageIds.PRIMARY] });
    expect(() => requirePermission(ctx, "students.read", seed.stageIds.INTERMEDIATE)).toThrow(ForbiddenError);
  });

  it("صلاحية غير ممنوحة تعطي نطاقًا فارغًا", async () => {
    const ctx = await loadAuthContext(db, seed.userIds.primary_only);
    expect(stageScope(ctx, "users.manage")).toEqual({ kind: "none" });
  });

  it("الحساب المعطّل لا يُحمَّل له سياق صلاحيات", async () => {
    await db.update(users).set({ isActive: false }).where(eq(users.id, seed.userIds.directory));
    await expect(loadAuthContext(db, seed.userIds.directory)).rejects.toThrow(AuthError);
    await db.update(users).set({ isActive: true }).where(eq(users.id, seed.userIds.directory));
  });
});
