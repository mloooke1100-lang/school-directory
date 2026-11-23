// يكتب/يقرأ سجل علامة لاختبار الاستمرارية: tsx persist-check.ts write|read <marker>
import { eq } from "drizzle-orm";
import { getDb, closeDb } from "../src/db/client";
import { students } from "../src/db/schema";
import { normalizeArabic } from "../src/domain/arabic";

async function main() {
  const [mode, marker] = process.argv.slice(2);
  const db = getDb();
  const name = `طالبة اختبار الاستمرارية ${marker}`;
  if (mode === "write") {
    await db.insert(students).values({ fullName: name, nameNormalized: normalizeArabic(name) });
    console.log("written");
  } else {
    const rows = await db.select().from(students).where(eq(students.fullName, name));
    if (rows.length !== 1) throw new Error(`لم يُعثر على السجل بعد إعادة التشغيل (${rows.length})`);
    console.log("found", rows[0].id);
  }
  await closeDb();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
