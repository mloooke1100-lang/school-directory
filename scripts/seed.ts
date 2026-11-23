import { getDb, closeDb } from "../src/db/client";
import { resetDatabase, seedDev, DEV_PASSWORD, loadIdentity } from "../src/db/seed";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("seed للتطوير فقط");
  const db = getDb();
  await resetDatabase(db);
  const r = await seedDev(db);
  console.log("✓ بيانات وهمية جاهزة. مصدر الهوية:", loadIdentity().source);
  console.log("الحسابات (تطوير فقط):", Object.keys(r.userIds).length, "— كلمة المرور:", DEV_PASSWORD);
  await closeDb();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
