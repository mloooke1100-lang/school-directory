import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { sectionFormOptions } from "@/server/services/sections";
import { activeTeachers } from "@/server/services/employees";
import { can } from "@/auth/rbac";
import { ActionForm, Field } from "@/components/form";
import { BackLink, Card, Denied, inputCls, PageHeader } from "@/components/ui";
import { createSectionAction } from "../actions";

export default async function NewSectionPage() {
  const ctx = await requireUser();
  if (!can(ctx, "sections.write")) return <Denied message="لا تملكين صلاحية إدارة الفصول." />;
  const db = getDb();
  const [opts, teachers] = await Promise.all([sectionFormOptions(db, ctx), activeTeachers(db)]);
  const active = opts.years.find((y) => y.status === "ACTIVE");
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <BackLink href="/sections" label="الفصول والشعب" />
      <PageHeader title="إضافة شعبة" />
      <Card>
        <ActionForm action={createSectionAction} submitLabel="إضافة الشعبة" ariaLabel="نموذج إضافة شعبة">
          <div className="grid gap-4 md:grid-cols-2">
            <Field name="yearId" label="السنة الدراسية">
              <select id="yearId" name="yearId" defaultValue={active?.id} className={inputCls}>
                {opts.years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
              </select>
            </Field>
            <Field name="gradeId" label="الصف">
              <select id="gradeId" name="gradeId" defaultValue="" className={inputCls}>
                <option value="">— اختاري —</option>
                {opts.grades.map((g) => <option key={g.id} value={g.id}>{g.stageName} · {g.nameAr}</option>)}
              </select>
            </Field>
            <Field name="name" label="اسم/رقم الشعبة">
              <input id="name" name="name" maxLength={30} className={inputCls} />
            </Field>
            <Field name="homeroomTeacherId" label="رائدة الفصل (اختياري)">
              <select id="homeroomTeacherId" name="homeroomTeacherId" defaultValue="" className={inputCls}>
                <option value="">—</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}
              </select>
            </Field>
            <Field name="roomId" label="القاعة (اختياري)">
              <select id="roomId" name="roomId" defaultValue="" className={inputCls}>
                <option value="">—</option>
                {opts.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
