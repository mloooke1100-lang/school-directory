import { notFound } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { entryFormOptions, getTimetable } from "@/server/services/timetables";
import { ForbiddenError } from "@/auth/rbac";
import { ENTRY_KIND_AR, TIMETABLE_STATUS_AR } from "@/domain/labels";
import { DAY_NAMES_AR } from "@/domain/time";
import { ActionForm, Field } from "@/components/form";
import { WeekGrid } from "@/components/week-grid";
import { BackLink, Card, Denied, inputCls, PageHeader, Table } from "@/components/ui";
import { addEntryAction, approveTimetableAction, copyTimetableAction, deleteEntryAction } from "../actions";

export default async function TimetablePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ section?: string; teacher?: string; approved?: string }> }) {
  const ctx = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const sp = await searchParams;
  const db = getDb();
  let t;
  try {
    t = await getTimetable(db, ctx, id);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Denied />;
    throw e;
  }
  if (!t) notFound();
  const opts = await entryFormOptions(db, t.stageId, t.yearId);
  const teacherMode = !!sp.teacher && opts.teachers.some((x) => x.id === sp.teacher);
  const sectionId = opts.sections.find((x) => x.id === sp.section)?.id ?? t.entries.find((e) => e.e.sectionId)?.e.sectionId ?? opts.sections[0]?.id;
  const shown = t.entries.filter((e) => (teacherMode ? e.e.teacherId === sp.teacher : e.e.sectionId === sectionId));
  const lessonNumbers = [...new Set(t.defs.filter((d) => d.kind === "LESSON").map((d) => d.number))].sort((a, b) => a - b);
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <BackLink href="/timetables" label="الجداول الدراسية" />
      <PageHeader title={t.name} subtitle={`${t.stageName} · ${t.termName} · الحالة: ${TIMETABLE_STATUS_AR[t.status]}${t.effectiveFrom ? ` · ساري من ${t.effectiveFrom}` : ""}`} />
      {sp.approved === "1" && t.status === "APPROVED" && <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-800">تم اعتماد الجدول</p>}
      {t.status === "SUPERSEDED" && <p className="rounded-lg bg-gray-100 p-3 text-sm">هذا جدول مستبدل محفوظ للأثر فقط.</p>}
      {(t.canApprove || t.canCopy) && (
        <div className="no-print flex flex-wrap gap-4">
          {t.canApprove && (
            <ActionForm action={approveTimetableAction.bind(null, id)} submitLabel="اعتماد الجدول" confirmMessage="اعتماد هذه المسودة؟ سيصبح الجدول المعتمد الحالي لهذه المرحلة «مستبدلًا» (يبقى محفوظًا)." ariaLabel="اعتماد الجدول" className="space-y-2">
              <input type="hidden" name="version" value={t.version} key={t.version} />
            </ActionForm>
          )}
          {t.canCopy && (
            <ActionForm action={copyTimetableAction.bind(null, id)} submitLabel="نسخ إلى مسودة للتعديل" ariaLabel="نسخ إلى مسودة" className="space-y-2">
              <span />
            </ActionForm>
          )}
        </div>
      )}

      <form className="no-print flex flex-wrap gap-2" aria-label="عرض الجدول">
        <select name="section" defaultValue={teacherMode ? "" : sectionId} aria-label="عرض حسب الفصل" className={`${inputCls} md:w-56`}>
          {opts.sections.map((x) => <option key={x.id} value={x.id}>{x.grade} / {x.name}</option>)}
        </select>
        <button className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white">عرض الفصل</button>
      </form>
      <form className="no-print flex flex-wrap gap-2" aria-label="عرض حسب المعلمة">
        <select name="teacher" defaultValue={teacherMode ? sp.teacher : ""} aria-label="عرض حسب المعلمة" className={`${inputCls} md:w-56`}>
          <option value="">— اختاري معلمة —</option>
          {opts.teachers.map((x) => <option key={x.id} value={x.id}>{x.fullName}</option>)}
        </select>
        <button className="rounded-lg border border-brand-300 bg-white px-4 py-2 text-sm font-semibold text-brand-800">عرض المعلمة</button>
      </form>

      <WeekGrid
        defs={t.defs}
        caption={teacherMode ? `جدول ${opts.teachers.find((x) => x.id === sp.teacher)?.fullName}` : `جدول ${opts.sections.find((x) => x.id === sectionId)?.grade ?? ""} / ${opts.sections.find((x) => x.id === sectionId)?.name ?? ""}`}
        cell={(d, n) =>
          shown
            .filter((e) => e.e.dayOfWeek === d && e.e.periodNumber === n)
            .map((e) => (
              <div key={e.e.id} className={`rounded p-1 ${e.e.kind === "LESSON" ? "bg-brand-50" : "bg-gray-100"}`}>
                <p className="font-semibold">{e.e.kind === "LESSON" ? e.subject : ENTRY_KIND_AR[e.e.kind]}</p>
                <p className="text-gray-700">{teacherMode ? (e.grade ? `${e.grade} / ${e.section}` : "—") : e.teacher}</p>
                {e.room && <p className="text-gray-600">{e.room}</p>}
              </div>
            ))
        }
      />

      {t.canWrite && (
        <Card title="إضافة خانة">
          <ActionForm action={addEntryAction.bind(null, id)} submitLabel="إضافة الخانة" ariaLabel="إضافة خانة">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Field name="dayOfWeek" label="اليوم">
                <select id="dayOfWeek" name="dayOfWeek" className={inputCls}>{[0, 1, 2, 3, 4].map((d) => <option key={d} value={d}>{DAY_NAMES_AR[d]}</option>)}</select>
              </Field>
              <Field name="periodNumber" label="الحصة">
                <select id="periodNumber" name="periodNumber" className={inputCls}>{lessonNumbers.map((n) => <option key={n} value={n}>{n}</option>)}</select>
              </Field>
              <Field name="kind" label="النوع">
                <select id="kind" name="kind" className={inputCls}>{Object.entries(ENTRY_KIND_AR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              </Field>
              <Field name="sectionId" label="الفصل">
                <select id="sectionId" name="sectionId" defaultValue={teacherMode ? "" : sectionId} className={inputCls}>
                  <option value="">—</option>
                  {opts.sections.map((x) => <option key={x.id} value={x.id}>{x.grade} / {x.name}</option>)}
                </select>
              </Field>
              <Field name="subjectId" label="المادة">
                <select id="subjectId" name="subjectId" className={inputCls}>
                  <option value="">—</option>
                  {opts.subjects.map((x) => <option key={x.id} value={x.id}>{x.nameAr}</option>)}
                </select>
              </Field>
              <Field name="teacherId" label="المعلمة">
                <select id="teacherId" name="teacherId" defaultValue={teacherMode ? sp.teacher : ""} className={inputCls}>
                  <option value="">—</option>
                  {opts.teachers.map((x) => <option key={x.id} value={x.id}>{x.fullName}</option>)}
                </select>
              </Field>
              <Field name="roomId" label="القاعة">
                <select id="roomId" name="roomId" className={inputCls}>
                  <option value="">—</option>
                  {opts.rooms.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </Field>
              <Field name="notes" label="ملاحظات"><input id="notes" name="notes" className={inputCls} /></Field>
            </div>
            {lessonNumbers.length === 0 && <p className="text-sm text-amber-900">أوقات الحصص غير مكتملة لهذه المرحلة؛ أعدّيها أولًا.</p>}
          </ActionForm>
        </Card>
      )}

      <section aria-labelledby="all">
        <h2 id="all" className="mb-2 font-semibold">كل خانات الجدول ({t.entries.length})</h2>
        <Table head={["اليوم", "الحصة", "النوع", "الفصل", "المادة", "المعلمة", "القاعة", ...(t.canWrite ? [""] : [])]}>
          {t.entries.map((e) => (
            <tr key={e.e.id}>
              <td className="p-2">{DAY_NAMES_AR[e.e.dayOfWeek]}</td>
              <td className="p-2">{e.e.periodNumber}</td>
              <td className="p-2">{ENTRY_KIND_AR[e.e.kind]}</td>
              <td className="p-2">{e.grade ? `${e.grade} / ${e.section}` : "—"}</td>
              <td className="p-2">{e.subject ?? "—"}</td>
              <td className="p-2">{e.teacher}</td>
              <td className="p-2">{e.room ?? "—"}</td>
              {t.canWrite && (
                <td className="p-2">
                  <ActionForm action={deleteEntryAction.bind(null, id, e.e.id)} submitLabel="حذف" confirmMessage="حذف هذه الخانة من المسودة؟" ariaLabel="حذف خانة" className="space-y-1">
                    <span />
                  </ActionForm>
                </td>
              )}
            </tr>
          ))}
        </Table>
      </section>
    </div>
  );
}
