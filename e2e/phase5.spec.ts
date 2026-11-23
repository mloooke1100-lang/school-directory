import { test, expect, type Page, type TestInfo } from "@playwright/test";

/**
 * المرحلة 5 — أوقات الحصص، الجدول الأسبوعي، الانتظار، النشاط، ومنع التعارضات.
 * المشاريع الثلاثة تعمل على القاعدة نفسها بالتتابع؛ لكل مشروع رقم حصة وتاريخ وأسماء خاصة به.
 */
const PASSWORD = "Dev-Only-2026";
const P: Record<string, { idx: number; start: string; end: string; busyTeacher: string; date: string }> = {
  // أوقات المتوسطة تتداخل عمدًا مع حصص الابتدائية لاختبار التعارض بين المراحل
  desktop: { idx: 1, start: "07:00", end: "07:45", busyTeacher: "معلمة تجريبية - سارة أحمد", date: "2026-12-01" },
  ipad: { idx: 2, start: "07:45", end: "08:30", busyTeacher: "معلمة تجريبية - هيا محمد", date: "2026-12-02" },
  mobile: { idx: 3, start: "08:30", end: "09:15", busyTeacher: "معلمة تجريبية - نورة سالم", date: "2026-12-03" },
};
const cfg = (info: TestInfo) => P[info.project.name];

async function login(page: Page, username: string) {
  await page.goto("/login");
  await page.getByLabel("اسم المستخدم").fill(username);
  await page.getByLabel("كلمة المرور").fill(PASSWORD);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("الروضة الثانية");
}
const alertBox = (page: Page) => page.locator("p[role=alert]");

test("أوقات الحصص للمتوسطة: إضافة فترة ورفض التداخل", async ({ page }, info) => {
  const c = cfg(info);
  await login(page, "vp.academic");
  await page.goto("/timetables/periods");
  await page.getByRole("link", { name: "المتوسطة الثانية" }).click();
  // نموذج «إضافة فترة» موجود في صفحة كل مرحلة: ننتظر اكتمال الانتقال قبل التعبئة
  await expect(page.getByRole("link", { name: "المتوسطة الثانية" })).toHaveAttribute("aria-current", "page");
  const form = page.getByRole("form", { name: "إضافة فترة" });
  await form.getByLabel("الرقم").fill(String(c.idx));
  await form.getByLabel("البداية").fill(c.start);
  await form.getByLabel("النهاية").fill(c.end);
  await form.getByRole("button", { name: "إضافة الفترة" }).click();
  await expect(form.getByRole("status")).toHaveText("تم الحفظ");
  await expect(page.getByText(`حصة ${c.idx} (${c.start}–${c.end})`)).toBeVisible();
  // فترة متداخلة مع السابقة تُرفض
  await form.getByLabel("الرقم").fill(String(50 + c.idx));
  await form.getByLabel("البداية").fill(c.start);
  await form.getByLabel("النهاية").fill(c.end);
  await form.getByRole("button", { name: "إضافة الفترة" }).click();
  await expect(form.locator("p[role=alert]")).toContainText("تعارض في أوقات الحصص");
  await expect(form.getByRole("status")).toHaveCount(0);
});

test("الجدول الأسبوعي: مسودة، رفض تعارض معلمة بين المراحل، ثم الاعتماد", async ({ page }, info) => {
  const c = cfg(info);
  await login(page, "vp.academic");
  await page.goto("/timetables");
  const create = page.getByRole("form", { name: "إنشاء مسودة جدول" });
  await create.getByLabel("المرحلة").selectOption({ label: "المتوسطة الثانية" });
  await create.getByLabel("اسم الجدول").fill(`جدول المتوسطة التجريبي ${info.project.name}`);
  await create.getByRole("button", { name: "إنشاء المسودة" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`جدول المتوسطة التجريبي ${info.project.name}`);
  await expect(page.getByText("الحالة: مسودة")).toBeVisible();

  const form = page.getByRole("form", { name: "إضافة خانة" });
  await form.getByLabel("اليوم", { exact: true }).selectOption("0");
  await form.getByLabel("الحصة", { exact: true }).selectOption(String(c.idx));
  await form.getByLabel("الفصل", { exact: true }).selectOption({ label: "الأول المتوسط / 1" });
  await form.getByLabel("المادة", { exact: true }).selectOption({ label: "لغة إنجليزية" });
  await form.getByLabel("المعلمة", { exact: true }).selectOption({ label: c.busyTeacher });
  await form.getByRole("button", { name: "إضافة الخانة" }).click();
  await expect(form.locator("p[role=alert]")).toContainText("المعلمة مكلفة في الوقت نفسه");
  await expect(form.locator("p[role=alert]")).toContainText("الابتدائية الرابعة");

  await form.getByLabel("المعلمة", { exact: true }).selectOption({ label: "معلمة تجريبية - ريم خالد" });
  await form.getByRole("button", { name: "إضافة الخانة" }).click();
  await expect(form.getByRole("status")).toHaveText("تم الحفظ");
  await expect(page.locator("table").first()).toContainText("لغة إنجليزية");

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "اعتماد الجدول" }).click();
  await expect(page.locator("p[role=status]")).toHaveText("تم اعتماد الجدول");
  await page.reload();
  await expect(page.getByText("الحالة: معتمد")).toBeVisible();
  await expect(page.getByRole("button", { name: "نسخ إلى مسودة للتعديل" })).toBeVisible();
  await expect(page.getByRole("form", { name: "إضافة خانة" })).toHaveCount(0);
  await page.screenshot({ path: `docs/screenshots/timetable-${info.project.name}.png`, fullPage: true });
});

test("حصة انتظار: اقتراح المتاحات، الحفظ، الظهور في جدول اليوم فقط، ومنع التكرار", async ({ page }, info) => {
  const c = cfg(info);
  await login(page, "vp.academic");
  await page.goto(`/substitutes/new?date=${c.date}`);
  await page.getByLabel("الفصل", { exact: true }).selectOption({ label: "الابتدائية الرابعة · الأول / 1" });
  await page.getByLabel("رقم الحصة").fill("1");
  await page.getByRole("button", { name: "عرض المتاحات" }).click();
  await expect(page.getByText("المعلمة الأساسية: معلمة تجريبية - سارة أحمد")).toBeVisible();
  const select = page.getByLabel("المعلمة البديلة");
  // هيا تدرّس الثاني/1 في الحصة نفسها → مشغولة وغير قابلة للاختيار
  await expect(select.locator("option", { hasText: "هيا محمد" })).toBeDisabled();
  await select.selectOption({ label: "معلمة تجريبية - لمى فهد — متاحة" });
  await page.getByRole("button", { name: "حفظ حصة الانتظار" }).click();
  await expect(page).toHaveURL(new RegExp(`/substitutes\\?date=${c.date}&saved=1$`));
  await expect(page.locator("p[role=status]")).toHaveText("تم الحفظ");
  const row = page.locator("tbody tr").filter({ hasText: "لمى فهد" });
  await expect(row).toContainText("سارة أحمد");
  await expect(row).toContainText("07:00–07:45");

  // يظهر في جدول ذلك اليوم للفصل، ولا يظهر في الأسبوع التالي (الأسبوعي لم يتغير)
  await page.goto("/sections");
  const href = (await page.getByRole("link", { name: "الأول / 1", exact: true }).first().getAttribute("href"))!;
  await page.goto(`${href}?date=${c.date}`);
  await expect(page.getByText("انتظار بدل معلمة تجريبية - سارة أحمد")).toBeVisible();
  const next = new Date(new Date(`${c.date}T12:00:00Z`).getTime() + 7 * 86400_000).toISOString().slice(0, 10);
  await page.goto(`${href}?date=${next}`);
  await expect(page.getByText("انتظار بدل")).toHaveCount(0);
  await expect(page.locator("section").filter({ hasText: "الجدول الأسبوعي المعتمد" }).first()).toContainText("لغة عربية");

  // التكرار لنفس الفصل والحصة يُرفض
  await page.goto(`/substitutes/new?date=${c.date}&section=${href.split("/").pop()}&period=1`);
  await page.getByLabel("المعلمة البديلة").selectOption({ label: "معلمة تجريبية - ريم خالد — متاحة" });
  await page.getByRole("button", { name: "حفظ حصة الانتظار" }).click();
  await expect(alertBox(page)).toContainText("توجد حصة انتظار مسجلة");

  // تغيير الحالة إلى «ملغى» (لا حذف)
  await page.goto(`/substitutes?date=${c.date}`);
  const form = page.locator("tbody tr").filter({ hasText: "لمى فهد" }).getByRole("form");
  await form.getByLabel("الحالة").selectOption("CANCELLED");
  await form.getByRole("button", { name: "حفظ" }).click();
  await expect(form.getByRole("status")).toHaveText("تم الحفظ");
  await page.reload();
  await expect(page.locator("tbody tr").filter({ hasText: "لمى فهد" }).getByLabel("الحالة")).toHaveValue("CANCELLED");
});

test("حصة نشاط: رفض انشغال المشرفة، ثم الحفظ والظهور في جدول يوم الفصل", async ({ page }, info) => {
  const c = cfg(info);
  const name = `نشاط تجريبي - ${info.project.name}`;
  await login(page, "vp.academic");
  await page.goto("/activities");
  const add = page.getByRole("form", { name: "إضافة نشاط" });
  await add.getByLabel("اسم النشاط").fill(name);
  await add.getByLabel("المرحلة").selectOption({ label: "الابتدائية الرابعة" });
  await add.getByRole("button", { name: "إضافة النشاط" }).click();
  await expect(add.getByRole("status")).toHaveText("تم الحفظ");

  await page.goto("/activities/sessions/new");
  await page.getByLabel("النشاط").selectOption({ label: `${name} (الابتدائية الرابعة)` });
  await page.getByLabel("التاريخ").fill(c.date);
  await page.getByLabel("وقت البداية").fill("07:10");
  await page.getByLabel("وقت النهاية").fill("07:30");
  await page.getByLabel("الفصل", { exact: true }).selectOption({ label: "الابتدائية الرابعة · الثالث / 1" });
  await page.getByLabel("المشرفة").selectOption({ label: "معلمة تجريبية - هيا محمد (معلمة)" });
  await page.getByRole("button", { name: "حفظ الجلسة" }).click();
  await expect(alertBox(page)).toContainText("المشرفة مكلفة في الوقت نفسه");
  await page.getByLabel("المشرفة").selectOption({ label: "إدارية تجريبية - منيرة صالح (مساعدة إدارية)" });
  await page.getByLabel("الموقع (إن لم يكن قاعة)").fill("الساحة");
  await page.getByRole("button", { name: "حفظ الجلسة" }).click();
  await expect(page).toHaveURL(/\/activities\?from=.*saved=1$/);
  await expect(page.locator("tbody tr").filter({ hasText: name })).toContainText("الثالث / 1");

  await page.goto("/sections");
  const href = (await page.getByRole("link", { name: "الثالث / 1", exact: true }).first().getAttribute("href"))!;
  await page.goto(`${href}?date=${c.date}`);
  await expect(page.getByText(`نشاط: ${name}`)).toBeVisible();
});

test("الصلاحيات: وكيلة شؤون الطالبات ترى الجداول للعرض فقط ولا تدير الانتظار", async ({ page }) => {
  await login(page, "vp.students");
  await page.goto("/timetables");
  await expect(page.getByRole("form", { name: "إنشاء مسودة جدول" })).toHaveCount(0);
  await page.getByRole("link", { name: /الابتدائية \(تجريبي\)/ }).click();
  await expect(page.getByRole("form", { name: "إضافة خانة" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "نسخ إلى مسودة للتعديل" })).toHaveCount(0);
  await page.goto("/substitutes/new");
  await expect(alertBox(page)).toContainText("لا تملكين صلاحية");
  await expect(page.getByRole("link", { name: "إضافة حصة انتظار" })).toHaveCount(0);
});

test("ملف الطالبة يعرض جدول فصلها الأسبوعي المعتمد", async ({ page }) => {
  await login(page, "principal");
  await page.goto("/search?q=" + encodeURIComponent("جود"));
  await page.goto((await page.getByRole("link", { name: /جود/ }).first().getAttribute("href"))!);
  const week = page.locator("section").filter({ hasText: "الجدول الأسبوعي المعتمد" }).first();
  await expect(week).toContainText("الحصة 1");
  await expect(week).toContainText("رياضيات");
});

test("المواد والقاعات: إضافة مادة جديدة تظهر في القائمة", async ({ page }, info) => {
  await login(page, "vp.academic");
  await page.goto("/timetables/catalog");
  const form = page.getByRole("form", { name: "إضافة مادة" });
  await form.getByLabel("اسم المادة").fill(`مادة تجريبية ${info.project.name}`);
  await form.getByLabel("المرحلة").selectOption({ label: "الروضة الثانية" });
  await form.getByRole("button", { name: "إضافة المادة" }).click();
  await expect(form.getByRole("status")).toHaveText("تم الحفظ");
  await expect(page.getByText(`مادة تجريبية ${info.project.name}`)).toBeVisible();
});
