import { test, expect, type Page, type Browser, type TestInfo } from "@playwright/test";

/**
 * المرحلة 4 — الاختبارات تعمل على 3 مقاسات (كمبيوتر/آيباد/جوال) على قاعدة school_test نفسها دون إعادة تعبئة بينها،
 * لذلك كل سجل يُنشأ يحمل اسم المشروع ليكون فريدًا.
 */
const PASSWORD = "Dev-Only-2026";

async function loginAs(page: Page, username: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("اسم المستخدم").fill(username);
  await page.getByLabel("كلمة المرور").fill(password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
}
async function loginToDashboard(page: Page, username: string) {
  await loginAs(page, username);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("الروضة الثانية والابتدائية الرابعة والمتوسطة الثانية بالمهد");
}
const saved = (page: Page) => page.locator("p[role=status]").filter({ hasText: "تم الحفظ" });
const alertBox = (page: Page) => page.locator("p[role=alert]");
/** سياق متصفح مستقل بمقاس المشروع نفسه (لمحاكاة مستخدمة ثانية على جهاز آخر) */
async function newUserPage(browser: Browser, info: TestInfo) {
  const u = info.project.use;
  const ctx = await browser.newContext({ baseURL: u.baseURL, viewport: u.viewport, userAgent: u.userAgent, isMobile: u.isMobile, hasTouch: u.hasTouch, deviceScaleFactor: u.deviceScaleFactor, locale: u.locale, timezoneId: u.timezoneId });
  return ctx.newPage();
}

test("دليل الطالبات: إضافة طالبة بقيدها ثم تعديلها، والبيانات تبقى بعد إعادة التحميل", async ({ page }, info) => {
  const name = `طالبة تجريبية - إضافة ${info.project.name}`;
  await loginToDashboard(page, "principal");
  await page.goto("/students/new");
  await page.getByLabel("الاسم الكامل").fill(name);
  await page.getByLabel("الصف والشعبة").selectOption({ label: "الابتدائية الرابعة · الثاني / 1" });
  // تحقق Zod على الخادم: تاريخ قيد فارغ يُرفض بلا «تم الحفظ»
  await page.getByLabel("تاريخ القيد (ميلادي)").fill("");
  await page.getByRole("button", { name: "إضافة الطالبة" }).click();
  await expect(alertBox(page)).toContainText("تاريخ القيد");
  await expect(saved(page)).toHaveCount(0);
  await page.getByLabel("تاريخ القيد (ميلادي)").fill("2026-09-06");
  await page.getByRole("button", { name: "إضافة الطالبة" }).click();
  await expect(page).toHaveURL(/\/students\/[0-9a-f-]+\?saved=1$/);
  await expect(saved(page)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await expect(page.getByText("سجل القيود عبر السنوات")).toBeVisible();
  await expect(page.locator("table")).toContainText("2026-09-06");

  await page.getByRole("link", { name: "تعديل البيانات والقيد" }).click();
  await page.getByLabel("الاسم الكامل").fill(`${name} (معدّل)`);
  await page.getByLabel("ملاحظات إدارية محدودة").fill("ملاحظة تجريبية");
  await page.getByRole("form", { name: "البيانات الأساسية" }).getByRole("button", { name: "حفظ" }).click();
  await expect(page.getByRole("form", { name: "البيانات الأساسية" }).getByRole("status")).toHaveText("تم الحفظ");
  await page.reload();
  await expect(page.getByLabel("الاسم الكامل")).toHaveValue(`${name} (معدّل)`);
  await page.screenshot({ path: `docs/screenshots/student-edit-${info.project.name}.png`, fullPage: true });

  await page.goto("/students?q=" + encodeURIComponent("إضافة " + info.project.name));
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText("الثاني / 1");
});

test("التعديل المتزامن: المستخدمة الثانية لا تكتب فوق تعديل الأولى ولا ترى «تم الحفظ»", async ({ browser }, info) => {
  const a = await newUserPage(browser, info);
  const b = await newUserPage(browser, info);
  await loginToDashboard(a, "principal");
  await loginToDashboard(b, "directory");
  await a.goto("/students?q=" + encodeURIComponent("جود"));
  const href = (await a.locator("tbody a").first().getAttribute("href"))!;
  await a.goto(`${href}/edit`);
  await b.goto(`${href}/edit`);
  await a.getByLabel("ملاحظات إدارية محدودة").fill(`من الأولى ${info.project.name}`);
  await a.getByRole("form", { name: "البيانات الأساسية" }).getByRole("button", { name: "حفظ" }).click();
  await expect(a.getByRole("form", { name: "البيانات الأساسية" }).getByRole("status")).toHaveText("تم الحفظ");
  await b.getByLabel("ملاحظات إدارية محدودة").fill("من الثانية");
  await b.getByRole("form", { name: "البيانات الأساسية" }).getByRole("button", { name: "حفظ" }).click();
  await expect(b.locator("p[role=alert]")).toContainText("مستخدمة أخرى");
  await expect(b.getByRole("form", { name: "البيانات الأساسية" }).getByRole("status")).toHaveCount(0);
  await b.reload();
  await expect(b.getByLabel("ملاحظات إدارية محدودة")).toHaveValue(`من الأولى ${info.project.name}`);
  await a.context().close();
  await b.context().close();
});

test("تقييد المرحلة: حساب الابتدائية لا يرى فصول المتوسطة في الإضافة ولا يعدّل طالباتها", async ({ page }) => {
  await loginToDashboard(page, "principal");
  await page.goto("/students?q=" + encodeURIComponent("أمل ناصر"));
  const href = await page.locator("tbody tr").filter({ hasText: "المتوسطة الثانية" }).getByRole("link").first().getAttribute("href");
  await page.context().clearCookies();
  await loginToDashboard(page, "test.primary");
  await page.goto("/students/new");
  const options = await page.getByLabel("الصف والشعبة").locator("option").allTextContents();
  expect(options.some((o) => o.includes("الابتدائية الرابعة"))).toBe(true);
  expect(options.some((o) => o.includes("المتوسطة الثانية") || o.includes("الروضة"))).toBe(false);
  await page.goto(`${href}/edit`);
  await expect(alertBox(page)).toContainText("لا تملكين صلاحية");
  // ولا تظهر روابط الإعدادات والحسابات في قائمتها
  await expect(page.getByRole("link", { name: "الحسابات والصلاحيات" })).toHaveCount(0);
});

test("دليل الهيئة الإدارية: إضافة إدارية بتاريخي مباشرة منفصلين (هجري وميلادي) ورفض التاريخ غير المقروء", async ({ page }, info) => {
  const name = `إدارية تجريبية - ${info.project.name}`;
  await loginToDashboard(page, "vp.academic");
  await page.goto("/staff/admin");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("دليل الهيئة الإدارية");
  await expect(page.locator("thead")).toContainText("المباشرة بالوزارة");
  await expect(page.locator("thead")).toContainText("المباشرة بالمدرسة");
  await expect(page.locator("thead")).toContainText("صلاحيات النظام");
  await page.getByRole("link", { name: "إضافة إدارية" }).click();
  await page.getByLabel("الاسم الكامل").fill(name);
  await page.getByLabel("الفئة").selectOption({ label: "إدارية" });
  await page.getByLabel("المسمى الوظيفي").fill("مساعدة إدارية");
  await page.getByLabel("المهام والمسؤوليات").fill("الأرشيف والمراسلات");
  await page.locator("#ministryCalendar").selectOption("HIJRI");
  await page.locator("#ministryDate").fill("12 رجب");
  await page.getByRole("button", { name: "إضافة", exact: true }).click();
  await expect(alertBox(page)).toContainText("غير مقروءة");
  await expect(saved(page)).toHaveCount(0);
  await page.locator("#ministryDate").fill("1440/05/12");
  await page.locator("#ministryVerification").selectOption("COMPLETE");
  await page.locator("#schoolCalendar").selectOption("GREGORIAN");
  await page.locator("#schoolDate").fill("2023-09-03");
  await page.getByRole("button", { name: "إضافة", exact: true }).click();
  await expect(page).toHaveURL(/\/employees\/[0-9a-f-]+\?saved=1$/);
  await expect(saved(page)).toBeVisible();
  const dates = page.locator("section").filter({ hasText: "تاريخ المباشرة بوزارة التعليم" });
  await expect(dates.first()).toContainText("جمادى الأولى");
  await expect(dates.first()).toContainText("1440/05/12");
  await expect(dates.first()).toContainText("2023-09-03");
  await expect(dates.first()).toContainText("سبتمبر");
  await page.screenshot({ path: `docs/screenshots/employee-${info.project.name}.png`, fullPage: true });

  await page.goto("/staff/admin?q=" + encodeURIComponent(info.project.name));
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText("لا يوجد حساب");
  await page.goto("/staff/service?q=" + encodeURIComponent(info.project.name));
  await expect(page.getByText("لا توجد سجلات.")).toBeVisible();
});

test("دليل المستخدمات والحراس قسم مستقل بمعرّف داخلي، وتعديل الموظفة يحفظ بعد النجاح فقط", async ({ page }, info) => {
  const name = `حارس تجريبي - ${info.project.name}`;
  await loginToDashboard(page, "directory");
  await page.goto("/employees/new?group=service");
  await page.getByLabel("الاسم الكامل").fill(name);
  await page.getByLabel("الفئة").selectOption({ label: "حارس" });
  await page.getByLabel("المسمى الوظيفي").fill("حارس");
  await page.getByLabel("الموقع المرتبط بالعمل (إن وجد)").fill("البوابة الشمالية");
  await page.getByRole("button", { name: "إضافة", exact: true }).click();
  await expect(saved(page)).toBeVisible();
  await page.getByRole("link", { name: "تعديل", exact: true }).click();
  await page.getByLabel("المهام والمسؤوليات").fill("فتح البوابة وإغلاقها");
  await page.getByRole("button", { name: "حفظ" }).click();
  await expect(saved(page)).toBeVisible();
  await page.goto("/staff/service");
  await expect(page.locator("thead")).toContainText("المعرّف الداخلي");
  const row = page.locator("tbody tr").filter({ hasText: name });
  await expect(row).toContainText("فتح البوابة وإغلاقها");
  await expect(row).toContainText("البوابة الشمالية");
  await page.goto("/staff/admin");
  await expect(page.locator("tbody")).not.toContainText(name);
});

test("الفصول والشعب: إضافة شعبة وتعديل رائدتها", async ({ page }, info) => {
  const sec = `ت${info.project.name.slice(0, 3)}`;
  await loginToDashboard(page, "principal");
  await page.goto("/sections");
  await page.getByRole("link", { name: "إضافة شعبة" }).click();
  await page.getByLabel("الصف", { exact: true }).selectOption({ label: "الابتدائية الرابعة · الثالث" });
  await page.getByLabel("اسم/رقم الشعبة").fill(sec);
  await page.getByRole("button", { name: "إضافة الشعبة" }).click();
  await expect(saved(page)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(`الثالث / ${sec}`);
  await page.getByLabel("رائدة الفصل", { exact: true }).selectOption({ label: "معلمة تجريبية - هيا محمد" });
  await page.getByRole("button", { name: "حفظ" }).click();
  await expect(saved(page)).toBeVisible();
  await page.reload();
  await expect(page.getByText("رائدة الفصل: معلمة تجريبية - هيا محمد")).toBeVisible();
  // إضافة الشعبة نفسها مرة ثانية تُرفض برسالة واضحة
  await page.goto("/sections/new");
  await page.getByLabel("الصف", { exact: true }).selectOption({ label: "الابتدائية الرابعة · الثالث" });
  await page.getByLabel("اسم/رقم الشعبة").fill(sec);
  await page.getByRole("button", { name: "إضافة الشعبة" }).click();
  await expect(alertBox(page)).toContainText("شعبة بالاسم نفسه");
});

test("إعدادات المدرسة: المديرة تعدّل وتظهر التغييرات، والوكيلة ترى للعرض فقط", async ({ page }, info) => {
  const tagline = `إدارة مدرسية أكثر تنظيمًا ودقة (${info.project.name})`;
  await loginToDashboard(page, "principal");
  await page.goto("/settings");
  await page.getByLabel("الشعار التعريفي").fill(tagline);
  await page.getByRole("form", { name: "هوية المدرسة" }).getByRole("button", { name: "حفظ" }).click();
  await expect(page.getByRole("form", { name: "هوية المدرسة" }).getByRole("status")).toHaveText("تم الحفظ");
  await page.reload();
  await expect(page.getByLabel("الشعار التعريفي")).toHaveValue(tagline);
  await expect(page.getByRole("heading", { name: "المرشدة الطلابية" })).toBeVisible();
  await page.screenshot({ path: `docs/screenshots/settings-${info.project.name}.png`, fullPage: true });
  await page.context().clearCookies();

  await loginToDashboard(page, "vp.academic");
  await page.goto("/settings");
  await expect(page.getByText("عرض فقط")).toBeVisible();
  await expect(page.getByRole("button", { name: "حفظ" })).toHaveCount(0);
});

test("الحسابات: المديرة تنشئ حسابًا، وصاحبته تُجبر على تغيير كلمة المرور عند أول دخول", async ({ page }, info) => {
  const username = `e2e.${info.project.name}`;
  await loginToDashboard(page, "principal");
  await page.goto("/users/new");
  await page.getByLabel("اسم المستخدم (لاتيني)").fill(username);
  await page.getByLabel("الاسم الظاهر").fill(`حساب تجريبي ${info.project.name}`);
  await page.getByLabel("وكيلة شؤون الطالبات", { exact: true }).check();
  await page.getByLabel("نطاق دور وكيلة شؤون الطالبات").selectOption({ label: "الابتدائية الرابعة فقط" });
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();
  await expect(page.locator("p[role=status]")).toContainText("تم إنشاء الحساب");
  const temp = (await page.getByTestId("temp-password").textContent())!.trim();
  expect(temp.length).toBeGreaterThanOrEqual(10);
  await page.goto("/users");
  await expect(page.locator("tbody tr").filter({ hasText: username })).toContainText("يلزم تغيير كلمة المرور");
  await page.context().clearCookies();

  await loginAs(page, username, temp);
  await expect(page).toHaveURL(/\/change-password$/);
  // لا يمكن تجاوز الشاشة بفتح صفحة أخرى مباشرة
  await page.goto("/students");
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByLabel("كلمة المرور الحالية").fill(temp);
  await page.getByLabel("كلمة المرور الجديدة", { exact: true }).fill("short1");
  await page.getByLabel("تأكيد كلمة المرور الجديدة").fill("short1");
  await page.getByRole("button", { name: "حفظ كلمة المرور" }).click();
  await expect(alertBox(page)).toContainText("10 أحرف");
  await page.getByLabel("كلمة المرور الجديدة", { exact: true }).fill("New-Pass-2026x");
  await page.getByLabel("تأكيد كلمة المرور الجديدة").fill("New-Pass-2026x");
  await page.getByRole("button", { name: "حفظ كلمة المرور" }).click();
  await expect(page.getByText("تم تغيير كلمة المرور بنجاح")).toBeVisible();
  await page.goto("/students");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("دليل الطالبات");
  await expect(page.locator("tbody")).not.toContainText("المتوسطة الثانية");
  // الحساب الجديد ليس مديرة: لا يصل لإدارة الحسابات
  await page.goto("/users");
  await expect(alertBox(page)).toContainText("للمديرة فقط");
});

test("إدارة الحسابات للمديرة فقط: الوكيلات ومسؤولة الدليل يُمنعن على الخادم", async ({ page }) => {
  for (const u of ["vp.academic", "vp.students", "directory"]) {
    await page.context().clearCookies();
    await loginToDashboard(page, u);
    await expect(page.getByRole("link", { name: "الحسابات والصلاحيات" })).toHaveCount(0);
    await page.goto("/users");
    await expect(alertBox(page)).toContainText("للمديرة فقط");
    await page.goto("/users/new");
    await expect(alertBox(page)).toContainText("للمديرة فقط");
  }
});

