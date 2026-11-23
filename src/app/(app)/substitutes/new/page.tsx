import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requireUser } from "@/server/current-user";
import { availableSubstitutes } from "@/server/services/substitutes";
import { stageFilter } from "@/server/scope-sql";
import { getActiveYear } from "@/server/school";
import { can, stageScope } from "@/auth/rbac";
import { errorToState } from "@/server/forms";
import { minutesToHHMM, riyadhNow } from "@/domain/time";
import { ActionForm, Field } from "@/components/form";
import { BackLink, Card, Denied, inputCls, PageHeader } from "@/components/ui";
import { createSubstituteAction } from "../actions";

export default async function NewSubstitutePage({ searchParams }: { searchParams: Promise<{ date?: string; section?: string; period?: string }> }) {
  const ctx = await requireUser();
  if (!can(ctx, "substitutes.write")) return <Denied message="لا تملكين صلاحية إدارة حصص الانتظار." />;
  const db = getDb();
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : riyadhNow().date;
  const year = await getActiveYear(db);
  const sections = year
    ? await db.select({ id: s.classSections.id, name: s.classSections.name, grade: s.grades.nameAr, stage: s.stages.nameAr }).from(s.classSections).innerJoin(s.grades, eq(s.grades.id, s.classSections.gradeId)).innerJoin(s.stages, eq(s.stages.id, s.grades.stageId)).where(and(eq(s.classSections.yearId, year.id), eq(s.classSections.isActive, true), stageFilter(stageScope(ctx, "substitutes.write"), s.stages.id))).orderBy(asc(s.stages.order), asc(s.grades.order), asc(s.classSections.name))
    : [];
  const section = sections.find((x) => x.id === sp.section);
  const period = Number(sp.period);
  let avail: Awaited<ReturnType<typeof availableSubstitutes>> | null = null;
  let slotError: string | undefined;
  if (section && period > 0) {
    try {
      avail = await availableSubstitutes(db, ctx, date, section.id, period);
    } catch (e) {
      slotError = errorToState(e).error;
    }
  }
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackLink href={`/substitutes?date=${date}`} label="حصص الانتظار" />
      <PageHeader title="إضافة حصة انتظار" subtitle="١) اختاري التاريخ والفصل والحصة ٢) اختاري البديلة من المتاحات (المشغولات يظهر سبب انشغالهن)." />
      <Card title="الخانة">
        <form className="grid gap-3 md:grid-cols-4" aria-label="اختيار الخانة">
          <div><label htmlFor="date" className="mb-1 block text-sm font-medium">التاريخ</label><input id="date" type="date" name="date" defaultValue={date} className={inputCls} /></div>
          <div><label htmlFor="section" className="mb-1 block text-sm font-medium">الفصل</label>
            <select id="section" name="section" defaultValue={section?.id ?? ""} className={inputCls}>
              <option value="">— اختاري —</option>
              {sections.map((x) => <option key={x.id} value={x.id}>{x.stage} · {x.grade} / {x.name}</option>)}
            </select>
          </div>
          <div><label htmlFor="period" className="mb-1 block text-sm font-medium">رقم الحصة</label><input id="period" type="number" min={1} name="period" defaultValue={period > 0 ? period : ""} className={inputCls} /></div>
          <div className="flex items-end"><button className="w-full rounded-lg border border-brand-300 bg-white px-4 py-2 font-semibold text-brand-800">عرض المتاحات</button></div>
        </form>
        {slotError && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{slotError}</p>}
      </Card>
      {avail && section && (
        <Card title="التكليف">
          <p className="mb-3 text-sm">
            {section.grade} / {section.name} · الحصة {period} <span dir="ltr">({minutesToHHMM(avail.slot.slot.startMinute)}–{minutesToHHMM(avail.slot.slot.endMinute)})</span>
            {avail.slot.entry ? <> · المادة: {avail.slot.entry.subject ?? "—"} · المعلمة الأساسية: <strong>{avail.slot.entry.teacher}</strong></> : <span className="text-red-800"> · لا توجد حصة في الجدول المعتمد لهذه الخانة</span>}
          </p>
          <ActionForm action={createSubstituteAction} submitLabel="حفظ حصة الانتظار" ariaLabel="تكليف البديلة">
            <input type="hidden" name="date" value={date} />
            <input type="hidden" name="sectionId" value={section.id} />
            <input type="hidden" name="periodNumber" value={period} />
            <div className="grid gap-3 md:grid-cols-2">
              <Field name="substituteTeacherId" label="المعلمة البديلة">
                <select id="substituteTeacherId" name="substituteTeacherId" defaultValue="" className={inputCls}>
                  <option value="">— اختاري —</option>
                  {avail.teachers.map((t) => <option key={t.id} value={t.id} disabled={!t.free}>{t.fullName}{t.free ? " — متاحة" : ` — مشغولة: ${t.reason}`}</option>)}
                </select>
              </Field>
              <Field name="status" label="حالة التكليف">
                <select id="status" name="status" className={inputCls}><option value="PLANNED">مخطط</option><option value="CONFIRMED">مؤكد</option></select>
              </Field>
              <Field name="notes" label="ملاحظات" className="md:col-span-2"><input id="notes" name="notes" className={inputCls} /></Field>
            </div>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
