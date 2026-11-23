import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, closeDb } from "../src/db/client";

async function main() {
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  console.log("✓ تم تطبيق الترحيلات");
  await closeDb();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
