import Link from "next/link";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { getSettings } from "@/server/services/settings";
import { ForbiddenError } from "@/auth/rbac";
import { POSITION_AR, YEAR_STATUS_AR } from "@/domain/labels";
import { formatHijri } from "@/domain/time";
import { ActionForm, Field } from "@/components/form";
import { Card, Denied, inputCls, PageHeader, Table } from "@/components/ui";
import { updateLeadershipAction, updateSchoolAction } from "./actions";

export default async function SettingsPage() {
  const ctx = await requireUser();
  let st;
  try {
    st = await getSettings(getDb(), ctx);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Denied />;
    throw e;
  }
  if (!st) return <p>لا توجد مدرسة مُعرّفة.</p>;
  const sc = st.school;
  const ro = !st.canWrite;
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader title="إعدادات المدرسة والقيادة" subtitle={ro ? "عرض فقط — التعديل يتطلب صلاحية تعديل الإعدادات." : "بيانات المدرسة والمناصب قابلة للتعديل هنا وليست ثابتة في البرنامج."} />
      <Card title="هوية المدرسة والنظام">
        {ro ? (
          <dl className="grid gap-3 text-sm md:grid-cols-2">
            <div><dt className="text-gray-600">اسم المدرسة</dt><dd>{sc.nameAr}</dd></div>
            <div><dt className="text-gray-600">الجهة التعليمية</dt><dd>{sc.educationOffice}</dd></div>
            <div><dt className="text-gray-600">اسم النظام</dt><dd>{sc.systemName}</dd></div>
            <div><dt className="text-gray-600">الشعار التعريفي</dt><dd>{sc.tagline ?? "—"}</dd></div>
            <div><dt className="text-gray-600">سطر الإنشاء والتطوير</dt><dd>{sc.creditLine}</dd></div>
            <div><dt className="text-gray-600">الاعتماد الرسمي</dt><dd>{sc.officialApproved ? "معتمد" : "غير معتمد رسميًا"}</dd></div>
          </dl>
        ) : (
          <ActionForm action={updateSchoolAction} ariaLabel="هوية المدرسة">
            <div key={sc.version} className="grid gap-4 md:grid-cols-2">
              <input type="hidden" name="version" value={sc.version} />
              <Field name="nameAr" label="اسم المدرسة" className="md:col-span-2"><input id="nameAr" name="nameAr" defaultValue={sc.nameAr} className={inputCls} /></Field>
              <Field name="educationOffice" label="الجهة التعليمية" className="md:col-span-2"><input id="educationOffice" name="educationOffice" defaultValue={sc.educationOffice} className={inputCls} /></Field>
              <Field name="systemName" label="اسم النظام"><input id="systemName" name="systemName" defaultValue={sc.systemName} className={inputCls} /></Field>
              <Field name="tagline" label="الشعار التعريفي"><input id="tagline" name="tagline" defaultValue={sc.tagline ?? ""} className={inputCls} /></Field>
              <Field name="creditLine" label="سطر الإنشاء والتطوير (التذييل وصفحة عن النظام)" className="md:col-span-2"><input id="creditLine" name="creditLine" defaultValue={sc.creditLine} className={inputCls} /></Field>
              <Field name="principalNameStatus" label="التحقق من كتابة اسم المديرة" hint="الاسم مبدئي حتى مراجعة السجل الرسمي؛ صحّحيه من ملف المديرة في دليل الهيئة الإدارية.">
                <select id="principalNameStatus" name="principalNameStatus" defaultValue={st.principalNameStatus} className={inputCls}>
                  <option value="PENDING_VERIFICATION">بانتظار التحقق</option>
                  <option value="COMPLETE">تم التحقق من السجل الرسمي</option>
                </select>
              </Field>
              <Field name="officialApproved" label="الاعتماد الرسمي">
                <label className="flex items-start gap-2 py-2 text-sm"><input id="officialApproved" type="checkbox" name="officialApproved" defaultChecked={sc.officialApproved} className="mt-1" /> النظام معتمد رسميًا (لا تفعّليه إلا بعد الحصول على الموافقات الرسمية اللازمة)</label>
              </Field>
            </div>
          </ActionForm>
        )}
      </Card>

      <section aria-labelledby="lead" className="space-y-3">
        <h2 id="lead" className="font-semibold text-gray-900">القيادة المدرسية</h2>
        <p className="text-sm text-gray-700">تغيير شاغلة المنصب يُنهي التكليف السابق ويحفظ أثره ولا يحذفه. منح حساب دخول يتم من شاشة الحسابات بشكل منفصل.</p>
        {st.leadership.map((l) => (
          <Card key={l.position} title={POSITION_AR[l.position]}>
            {ro ? (
              <p className="text-sm">{l.current ? <Link href={`/employees/${l.current.employeeId}`} className="text-brand-700 hover:underline">{l.current.employeeName}</Link> : "غير محدد"}{l.current?.duties && ` · ${l.current.duties}`}</p>
            ) : (
              <ActionForm action={updateLeadershipAction} ariaLabel={`منصب ${POSITION_AR[l.position]}`}>
                <div key={l.current?.id ?? "none"} className="grid gap-3 md:grid-cols-3">
                  <input type="hidden" name="position" value={l.position} />
                  <input type="hidden" name="currentAssignmentId" value={l.current?.id ?? ""} />
                  <Field name="employeeId" id={`${l.position}-employeeId`} label="شاغلة المنصب">
                    <select id={`${l.position}-employeeId`} name="employeeId" defaultValue={l.current?.employeeId ?? ""} className={inputCls}>
                      <option value="">— غير محدد —</option>
                      {st.candidates.map((c) => <option key={c.id} value={c.id}>{c.fullName} ({c.jobTitle})</option>)}
                    </select>
                  </Field>
                  <Field name="titleAr" id={`${l.position}-titleAr`} label="مسمى المنصب">
                    <input id={`${l.position}-titleAr`} name="titleAr" defaultValue={l.current?.titleAr ?? POSITION_AR[l.position]} className={inputCls} />
                  </Field>
                  <Field name="duties" id={`${l.position}-duties`} label="المسؤوليات">
                    <input id={`${l.position}-duties`} name="duties" defaultValue={l.current?.duties ?? ""} className={inputCls} />
                  </Field>
                </div>
                {l.current && <p className="text-xs text-gray-600">منذ {l.current.startDate ?? "—"} · <Link href={`/employees/${l.current.employeeId}/edit`} className="underline">تصحيح الاسم أو البيانات</Link></p>}
              </ActionForm>
            )}
          </Card>
        ))}
      </section>

      <Card title="السنوات الدراسية">
        <Table head={["السنة", "البداية", "النهاية", "الحالة"]}>
          {st.years.map((y) => (
            <tr key={y.id}>
              <td className="p-3">{y.name}</td>
              <td className="p-3">{formatHijri(y.startDate)}</td>
              <td className="p-3">{formatHijri(y.endDate)}</td>
              <td className="p-3">{YEAR_STATUS_AR[y.status]}</td>
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-xs text-gray-600">إدارة السنوات والترحيل والأرشفة ضمن المرحلة 7. تواريخ 1448هـ الحالية عناصر نائبة حتى اعتماد التقويم الرسمي.</p>
      </Card>
    </div>
  );
}
