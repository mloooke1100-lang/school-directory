import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { getSection, sectionFormOptions } from "@/server/services/sections";
import { activeTeachers } from "@/server/services/employees";
import { ForbiddenError } from "@/auth/rbac";
import { ENROLLMENT_STATUS_AR } from "@/domain/labels";
import { ActionForm, Field } from "@/components/form";
import { BackLink, Card, Denied, inputCls, SavedNotice, Table } from "@/components/ui";
import { updateSectionAction } from "../actions";

export default async function SectionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const ctx = await requireUser();
  const { id } = await params;
  const { saved } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  let sec;
  try {
    sec = await getSection(db, ctx, id);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Denied />;
    throw e;
  }
  if (!sec) notFound();
  const [opts, teachers] = sec.canWrite ? await Promise.all([sectionFormOptions(db, ctx), activeTeachers(db)]) : [null, []];
  const v = sec.section;
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <BackLink href="/sections" label="الفصول والشعب" />
      <SavedNotice show={saved === "1"} />
      <h1 className="text-2xl font-bold text-brand-900">{sec.stageName} · {sec.gradeName} / {v.name}</h1>
      <p className="text-sm text-gray-700">السنة: {sec.yearName} · رائدة الفصل: {sec.homeroom ?? "—"} · القاعة: {sec.room ?? "—"} · {v.isActive ? "نشطة" : "معطّلة"}</p>
      {sec.canWrite && opts && (
        <Card title="تعديل الشعبة">
          <ActionForm action={updateSectionAction.bind(null, id)} ariaLabel="تعديل الشعبة">
            <div key={v.version} className="grid gap-4 md:grid-cols-2">
              <input type="hidden" name="version" value={v.version} />
              <Field name="name" label="اسم/رقم الشعبة">
                <input id="name" name="name" defaultValue={v.name} maxLength={30} className={inputCls} />
              </Field>
              <Field name="homeroomTeacherId" label="رائدة الفصل">
                <select id="homeroomTeacherId" name="homeroomTeacherId" defaultValue={v.homeroomTeacherId ?? ""} className={inputCls}>
                  <option value="">—</option>
                  {teachers.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}
                </select>
              </Field>
              <Field name="roomId" label="القاعة">
                <select id="roomId" name="roomId" defaultValue={v.roomId ?? ""} className={inputCls}>
                  <option value="">—</option>
                  {opts.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </Field>
              <Field name="isActive" label="الحالة">
                <label className="flex items-center gap-2 py-2 text-sm"><input id="isActive" type="checkbox" name="isActive" defaultChecked={v.isActive} /> شعبة نشطة</label>
              </Field>
            </div>
          </ActionForm>
        </Card>
      )}
      <section aria-labelledby="sts">
        <h2 id="sts" className="mb-2 font-semibold">طالبات الشعبة ({sec.students.length})</h2>
        {sec.students.length === 0 ? <p className="text-sm text-gray-600">لا توجد طالبات.</p> : (
          <Table head={["الاسم", "الرقم المدرسي", "حالة القيد"]}>
            {sec.students.map((x) => (
              <tr key={x.id}>
                <td className="p-3"><Link href={`/students/${x.id}`} className="text-brand-700 hover:underline">{x.fullName}</Link></td>
                <td className="p-3" dir="ltr">{x.schoolNumber ?? "—"}</td>
                <td className="p-3">{ENROLLMENT_STATUS_AR[x.status]}</td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </div>
  );
}
