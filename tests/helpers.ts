import { getDb, closeDb } from "@/db/client";
import { resetDatabase, seedDev, type SeedResult } from "@/db/seed";

export const db = getDb();

export async function freshSeed(): Promise<SeedResult> {
  if (!process.env.DATABASE_URL?.includes("school_test")) throw new Error("الاختبارات تعمل على قاعدة school_test فقط");
  await resetDatabase(db);
  return seedDev(db, { fastHash: true });
}

export { closeDb };

/** يتوقع أن يفشل الاستعلام بسبب قيد في قاعدة البيانات ويعيد اسم القيد */
export async function expectDbViolation(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e: any) {
    const c = e?.cause ?? e;
    if (c?.code === "23505" || c?.code === "23514" || c?.code === "23503") return c.constraint ?? c.code;
    throw e;
  }
  throw new Error("كان متوقعًا رفض قاعدة البيانات لهذه العملية");
}
