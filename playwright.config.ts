import { defineConfig, devices } from "@playwright/test";

// الاختبارات الطرفية تعمل على قاعدة school_test (بيانات وهمية) وخادم إنتاجي محلي
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"], ["html", { open: "never", outputFolder: "docs/e2e-report" }]],
  use: { baseURL: "http://localhost:3100", locale: "ar-SA", timezoneId: "Asia/Riyadh" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "ipad", use: { ...devices["iPad (gen 7)"], browserName: "chromium", channel: "chrome" } },
    { name: "mobile", use: { ...devices["Pixel 7"], channel: "chrome" } },
  ],
  webServer: {
    command: "SEED_PASSWORDS_CHANGED=1 npx dotenv -e .env.test -- npx tsx scripts/seed.ts && npx dotenv -e .env.test -- npx next start -p 3100",
    url: "http://localhost:3100/login",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
