import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "Dev-Only-2026";

async function loginAs(page: Page, username: string) {
  await page.goto("/login");
  await page.getByLabel("اسم المستخدم").fill(username);
  await page.getByLabel("كلمة المرور").fill(PASSWORD);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("الروضة الثانية والابتدائية الرابعة والمتوسطة الثانية بالمهد");
}

test("الصفحات المحمية تحوّل إلى الدخول بدون جلسة", async ({ page }) => {
  await page.goto("/search?q=test");
  await expect(page).toHaveURL(/\/login$/);
});

test("بيانات دخول خاطئة تُظهر رسالة دون كشف السبب", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("اسم المستخدم").fill("principal");
  await page.getByLabel("كلمة المرور").fill("wrong-password-1");
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await expect(page.locator("p[role=alert]")).toHaveText("اسم المستخدم أو كلمة المرور غير صحيحة");
});

test("المديرة: لوحة التحكم → البحث → ملف طالبة → الخروج", async ({ page }, info) => {
  await loginAs(page, "principal");
  await expect(page.getByText("تنبيهات البيانات")).toBeVisible();
  await expect(page.getByText("أوقات الحصص غير مكتملة — الروضة الثانية")).toBeVisible();
  await expect(page.locator("footer")).toContainText("إنشاء وتطوير الأستاذة وضحى زايد المطيري");
  await page.screenshot({ path: `docs/screenshots/dashboard-${info.project.name}.png`, fullPage: true });

  await page.goto("/search?q=" + encodeURIComponent("فاطمه"));
  const links = page.getByRole("link", { name: /فاطم/ });
  await expect(links).toHaveCount(2);
  await page.screenshot({ path: `docs/screenshots/search-${info.project.name}.png`, fullPage: true });
  await expect(links.first()).toBeVisible();
  // التنقل عبر الرابط نفسه (لقطة fullPage على أجهزة اللمس تعيد تخطيط الصفحة مؤقتًا)
  await page.goto((await links.first().getAttribute("href"))!);
  await expect(page.getByText("الموقع المتوقع الآن حسب الجدول")).toBeVisible();
  await expect(page.getByText("وليس تتبعًا فعليًا")).toBeVisible();

  // الخروج يلغي الجلسة على الخادم
  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name === "sd_session");
  expect(session?.httpOnly).toBe(true);
  await page.goto("/");
  const btn = page.getByRole("button", { name: /خروج/ }).filter({ visible: true }).first();
  await btn.click();
  await expect(page).toHaveURL(/\/login$/);
  // إعادة استخدام الكوكي القديم بعد الخروج يجب أن تفشل
  await page.context().addCookies([session!]);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("الحساب المقيّد بالابتدائية لا يرى طالبات المتوسطة ولا يفتح ملفاتهن", async ({ page }) => {
  // نجلب معرّف طالبة متوسطة عبر حساب المديرة أولًا
  await loginAs(page, "principal");
  await page.goto("/search?q=" + encodeURIComponent("أمل ناصر"));
  const rows = page.locator("tbody tr");
  const intermediateRow = rows.filter({ hasText: "المتوسطة الثانية" });
  const href = await intermediateRow.getByRole("link").first().getAttribute("href");
  expect(href).toMatch(/^\/students\//);
  await page.context().clearCookies();

  await loginAs(page, "test.primary");
  await page.goto("/search?q=" + encodeURIComponent("طالبة تجريبية"));
  await expect(page.locator("tbody")).not.toContainText("المتوسطة الثانية");
  await page.goto(href!);
  await expect(page.locator("p[role=alert]")).toContainText("لا تملكين صلاحية");
});
