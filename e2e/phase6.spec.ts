import { test, expect, type Page, type TestInfo } from "@playwright/test";

/**
 * المرحلة 6 — الغياب والتأخر والاستئذان والانقطاع والنقل ومراقبة الأدوار.
 * لكل مشروع تاريخ ماضٍ ويوم مختلفان حتى لا تتصادم سجلاته مع المشروعين الآخرين على القاعدة نفسها.
 */
const PASSWORD = "Dev-Only-2026";
const P: Record<string, { date: string; day: string; dayName: string }> = {
  // 2026-11-16 يوم اثنين
  desktop: { date: "2026-11-16", day: "1", dayName: "الاثنين" },
  ipad: { date: "2026-11-17", day: "2", dayName: "الثلاثاء" },
  mobile: { date: "2026-11-18", day: "3", dayName: "الأربعاء" },
};
const cfg = (info: TestInfo) => P[info.project.name];
const F = "طالبة تجريبية - فاطمة علي";

async function login(page: Page, username: string) {
  await page.goto("/login");
  await page.getByLabel("اسم المستخدم").fill(username);
  await page.getByLabel("كلمة المرور").fill(PASSWORD);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("الروضة الثانية");
}
const alertBox = (page: Page) => page.locator("p[role=alert]");
async function openSection(page: Page, date: string) {
  await page.goto(`/attendance?date=${date}`);
  await page.getByLabel("الفصل", { exact: true }).selectOption({ label: "الابتدائية الرابعة · الأول / 1" });
  await page.getByRole("button", { name: "عرض", exact: true }).click();
  await expect(page.getByRole("form", { name: "تسجيل الغياب" })).toBeVisible();
}

test("الغياب والتأخر: تسجيل جماعي، حساب التأخر تلقائيًا، التصحيح بسجل جديد، والاعتماد", async ({ page }, info) => {
  const c = cfg(info);
  await login(page, "vp.students");
  await openSection(page, c.date);
  const abs = page.getByRole("form", { name: "تسجيل الغياب" });
  await abs.getByLabel(F, { exact: true }).check();
  await abs.getByLabel("نوع الغياب").selectOption({ label: "بدون عذر" });
  await abs.getByRole("button", { name: "حفظ الغياب" }).click();
  await expect(abs.getByRole("status")).toContainText("تم الحفظ: 1 غياب جديد");
  // بعد الحفظ يصبح اسم الخيار «… غائبة» ويُعطَّل (لا يُسجَّل مرتين)
  await expect(abs.getByRole("checkbox", { name: `${F} غائبة` })).toBeDisabled();

  const late = page.getByRole("form", { name: "تسجيل التأخر" });
  await late.getByLabel("الطالبة").selectOption({ label: "طالبة تجريبية - جود عبدالله" });
  await expect(late.getByLabel("وقت بداية الدوام")).toHaveValue("07:00");
  await late.getByLabel("وقت الوصول").fill("07:25");
  await late.getByRole("button", { name: "حفظ التأخر" }).click();
  await expect(late.getByRole("status")).toHaveText("تم الحفظ");
  await expect(page.getByText("تأخر 25 دقيقة (وصول 07:25)")).toBeVisible();

  // التصحيح: نوع الغياب يصبح «بعذر» بسجل جديد يشير للقديم
  const fix = page.getByRole("form", { name: `تصحيح ${F} غياب` });
  await fix.getByLabel("نوع الغياب").selectOption({ label: "بعذر" });
  await fix.getByRole("button", { name: "تصحيح" }).click();
  await expect(page.locator("p[role=status]").first()).toHaveText("تم حفظ التصحيح");
  await expect(page.locator("li").filter({ hasText: F }).filter({ hasText: "غياب بعذر" })).toContainText("تصحيح لسجل سابق");

  await page.getByRole("form", { name: "اعتماد طالبة تجريبية - جود عبدالله تأخر" }).getByRole("button", { name: "اعتماد" }).click();
  await expect(page.locator("p[role=status]").first()).toHaveText("تم الاعتماد");
  await expect(page.locator("li").filter({ hasText: "تأخر 25 دقيقة" })).toContainText("معتمد");
  await page.screenshot({ path: `docs/screenshots/attendance-${info.project.name}.png`, fullPage: true });

  // تاريخ مستقبلي يُرفض
  await openSection(page, "2027-01-03");
  const abs2 = page.getByRole("form", { name: "تسجيل الغياب" });
  await abs2.getByLabel(F, { exact: true }).check();
  await abs2.getByRole("button", { name: "حفظ الغياب" }).click();
  await expect(abs2.locator("p[role=alert]")).toContainText("المستقبل");
});

test("سجل الطالبة يحفظ الأثر: يظهر السجل المصحَّح والجديد معًا", async ({ page }) => {
  await login(page, "principal");
  await page.goto("/search?q=" + encodeURIComponent("فاطمة علي"));
  await page.goto((await page.getByRole("link", { name: F, exact: true }).getAttribute("href"))!);
  const card = page.locator("section").filter({ hasText: "سجل شؤون الطالبة" });
  await expect(card).toContainText("مصحَّح (سجل سابق)");
  await expect(card).toContainText("غياب بعذر");
  await expect(card).toContainText("لا تتغير آليًا بسبب الغياب");
});

test("الاستئذان: طلب ثم اعتماد ثم تسجيل الخروج", async ({ page }, info) => {
  const c = cfg(info);
  await login(page, "vp.students");
  await page.goto(`/leaves?date=${c.date}`);
  await page.getByLabel("الفصل", { exact: true }).selectOption({ label: "الابتدائية الرابعة · الأول / 1" });
  await page.getByRole("button", { name: "عرض الطالبات" }).click();
  const form = page.getByRole("form", { name: "طلب استئذان" });
  await form.getByLabel("الطالبة").selectOption({ label: "طالبة تجريبية - فاطمه علي" });
  await form.getByLabel("وقت الاستئذان").fill("10:00");
  await form.getByLabel("السبب").fill("موعد طبي تجريبي");
  await form.getByRole("button", { name: "حفظ الطلب" }).click();
  await expect(form.getByRole("status")).toHaveText("تم الحفظ");
  const row = page.locator("tbody tr").filter({ hasText: "فاطمه علي" });
  await expect(row).toContainText("قيد الاعتماد");
  await row.getByRole("button", { name: "حفظ القرار" }).click();
  await expect(page.locator("p[role=status]").first()).toHaveText("تم الاعتماد");
  await row.getByLabel("وقت الخروج").fill("10:20");
  await row.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page.locator("p[role=status]").first()).toHaveText("تم تسجيل الخروج");
  await expect(row).toContainText("مكتمل");
  await expect(row).toContainText("10:20");
});

test("النقل وإعادة القيد: لا تتغير حالة القيد إلا بالاعتماد، والانقطاع يتطلب مرجعًا", async ({ page }) => {
  await login(page, "principal");
  await page.goto("/search?q=" + encodeURIComponent("مها ماجد"));
  const studentHref = (await page.getByRole("link", { name: /مها ماجد/ }).first().getAttribute("href"))!;
  await page.goto(studentHref);
  await page.getByRole("link", { name: "تسجيل طلب انقطاع أو نقل" }).click();
  await page.getByLabel("الإجراء").selectOption({ label: "انقطاع" });
  await page.getByRole("button", { name: "حفظ الطلب" }).click();
  await expect(alertBox(page)).toContainText("المرجع الإداري");
  await page.getByLabel("الإجراء").selectOption({ label: "نقل إلى مدرسة أخرى" });
  await page.getByLabel("المدرسة المنقول إليها (للنقل)").fill("مدرسة تجريبية أخرى");
  await page.getByRole("button", { name: "حفظ الطلب" }).click();
  await expect(page).toHaveURL(/\/status-changes\?saved=1$/);
  const row = page.locator("tbody tr").filter({ hasText: "مها ماجد" }).filter({ hasText: "قيد الاعتماد" }).first();
  await expect(row).toBeVisible();
  // قبل الاعتماد: القيد ما زال «منتظمة»
  await page.goto(studentHref);
  await expect(page.locator("section").filter({ hasText: "سجل القيود عبر السنوات" })).toContainText("منتظمة");
  await page.goto("/status-changes?pending=1");
  page.once("dialog", (d) => d.accept());
  await page.locator("tbody tr").filter({ hasText: "مها ماجد" }).getByRole("button", { name: "حفظ القرار" }).click();
  await expect(page.locator("p[role=status]").first()).toHaveText("تم الاعتماد");
  await page.goto(studentHref);
  await expect(page.locator("section").filter({ hasText: "سجل القيود عبر السنوات" })).toContainText("منقولة");
  // إعادة القيد تعيدها منتظمة (والسجل محفوظ لم يُحذف)
  await page.getByRole("link", { name: "تسجيل طلب انقطاع أو نقل" }).click();
  await expect(page.getByLabel("الإجراء")).toHaveValue("REINSTATEMENT");
  await page.getByLabel("المرجع الإداري (مطلوب للانقطاع)").fill("خطاب تجريبي");
  await page.getByRole("button", { name: "حفظ الطلب" }).click();
  await page.goto("/status-changes?pending=1");
  page.once("dialog", (d) => d.accept());
  await page.locator("tbody tr").filter({ hasText: "مها ماجد" }).getByRole("button", { name: "حفظ القرار" }).click();
  await expect(page.locator("p[role=status]").first()).toHaveText("تم الاعتماد");
  await page.goto(studentHref);
  await expect(page.locator("section").filter({ hasText: "سجل القيود عبر السنوات" })).toContainText("منتظمة");
});

test("مراقبة الأدوار: منطقة جديدة، رفض تكليف متعارض مع حصة، تكليف أسبوعي يظهر في الجدولين", async ({ page }, info) => {
  const c = cfg(info);
  const area = `منطقة تجريبية ${info.project.name}`;
  await login(page, "vp.academic");
  await page.goto("/supervision/areas");
  const addArea = page.getByRole("form", { name: "إضافة منطقة إلى الدور الأرضي" });
  await addArea.getByLabel("اسم المنطقة الجديدة").fill(area);
  await addArea.getByRole("button", { name: "إضافة منطقة" }).click();
  await expect(addArea.getByRole("status")).toHaveText("تم الحفظ");

  await page.goto(`/supervision?date=${c.date}`);
  const form = page.getByRole("form", { name: "تكليف مراقبة" });
  await form.getByLabel("المنطقة").selectOption({ label: `المبنى الرئيسي · الدور الأرضي · ${area}` });
  await form.getByLabel("الموظفة المسؤولة").selectOption({ label: "معلمة تجريبية - سارة أحمد (معلمة)" });
  await form.getByLabel("نوع الفترة").selectOption({ label: "قبل الدوام" });
  await form.getByLabel("اليوم (للأسبوعي)").selectOption(c.day);
  await form.getByLabel("وقت البداية").fill("07:10");
  await form.getByLabel("وقت النهاية").fill("07:30");
  await form.getByRole("button", { name: "حفظ التكليف" }).click();
  await expect(form.locator("p[role=alert]")).toContainText("حصة أساسية");

  await form.getByLabel("الموظفة المسؤولة").selectOption({ label: "إدارية تجريبية - منيرة صالح (مساعدة إدارية)" });
  await form.getByLabel("نوع الفترة").selectOption({ label: "الفسحة" });
  await form.getByLabel("وقت البداية").fill("09:15");
  await form.getByLabel("وقت النهاية").fill("09:40");
  await form.getByRole("button", { name: "حفظ التكليف" }).click();
  await expect(form.getByRole("status")).toHaveText("تم الحفظ");
  await page.reload();
  await expect(page.locator("section").filter({ hasText: "جدول المراقبة الأسبوعي" }).locator("div").filter({ hasText: c.dayName }).filter({ hasText: area }).first()).toContainText("منيرة صالح");
  // تاريخ اليوم المختار من اليوم نفسه → يظهر في الجدول اليومي
  await expect(page.locator("section").filter({ hasText: "جدول المراقبة اليومي" }).locator("tbody")).toContainText(area);
  await expect(page.getByRole("button", { name: "طباعة جدول المراقبة" })).toBeVisible();
  await page.screenshot({ path: `docs/screenshots/supervision-${info.project.name}.png`, fullPage: true });
});

test("الصلاحيات: مسؤولة الدليل ترى الغياب ولا تسجله، ووكيلة شؤون الطالبات لا تكلّف بالمراقبة", async ({ page }) => {
  await login(page, "directory");
  await page.goto("/attendance?date=2026-11-16");
  await page.getByLabel("الفصل", { exact: true }).selectOption({ label: "الابتدائية الرابعة · الأول / 1" });
  await page.getByRole("button", { name: "عرض", exact: true }).click();
  await expect(page.getByRole("heading", { name: "سجلات اليوم في الفصل" })).toBeVisible();
  await expect(page.getByRole("form", { name: "تسجيل الغياب" })).toHaveCount(0);
  await page.context().clearCookies();
  await login(page, "vp.students");
  await page.goto("/supervision");
  await expect(page.getByRole("heading", { name: /جدول المراقبة اليومي/ })).toBeVisible();
  await expect(page.getByRole("form", { name: "تكليف مراقبة" })).toHaveCount(0);
});
