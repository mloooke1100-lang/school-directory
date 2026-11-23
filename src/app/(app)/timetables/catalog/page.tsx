import { asc } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requireUser } from "@/server/current-user";
import { listCatalog } from "@/server/services/catalog";
import { can, ForbiddenError } from "@/auth/rbac";
import { ActionForm, Field } from "@/components/form";
import { BackLink, Card, Denied, inputCls, PageHeader } from "@/components/ui";
import { createRoomAction, createSubjectAction } from "../actions";

export default async function CatalogPage() {
  const ctx = await requireUser();
  const db = getDb();
  let data;
  try {
    data = await listCatalog(db, ctx);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Denied />;
    throw e;
  }
  const stages = (await db.select().from(s.stages).orderBy(asc(s.stages.order))).filter((st) => can(ctx, "timetable.write", st.id));
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <BackLink href="/timetables" label="الجداول الدراسية" />
      <PageHeader title="المواد الدراسية والقاعات" />
      <div className="grid gap-5 md:grid-cols-2">
        <Card title={`المواد (${data.subjects.length})`}>
          <ul className="mb-4 max-h-72 divide-y divide-gray-100 overflow-y-auto text-sm">
            {data.subjects.map((x) => <li key={x.id} className="py-1.5">{x.nameAr} <span className="text-gray-600">· {x.stageName ?? "كل المراحل"}</span></li>)}
          </ul>
          {stages.length > 0 && (
            <ActionForm action={createSubjectAction} submitLabel="إضافة المادة" ariaLabel="إضافة مادة">
              <div key={data.subjects.length} className="grid gap-3">
                <Field name="nameAr" id="subject-name" label="اسم المادة"><input id="subject-name" name="nameAr" className={inputCls} /></Field>
                <Field name="stageId" id="subject-stage" label="المرحلة">
                  <select id="subject-stage" name="stageId" className={inputCls}>
                    {stages.map((st) => <option key={st.id} value={st.id}>{st.nameAr}</option>)}
                    {can(ctx, "timetable.write", null) && <option value="">كل المراحل</option>}
                  </select>
                </Field>
              </div>
            </ActionForm>
          )}
        </Card>
        <Card title={`القاعات (${data.rooms.length})`}>
          <ul className="mb-4 max-h-72 divide-y divide-gray-100 overflow-y-auto text-sm">
            {data.rooms.map((x) => <li key={x.id} className="py-1.5">{x.name}{x.capacity && <span className="text-gray-600"> · سعة {x.capacity}</span>}</li>)}
          </ul>
          {can(ctx, "timetable.write") && (
            <ActionForm action={createRoomAction} submitLabel="إضافة القاعة" ariaLabel="إضافة قاعة">
              <div key={data.rooms.length} className="grid gap-3">
                <Field name="name" id="room-name" label="اسم القاعة"><input id="room-name" name="name" className={inputCls} /></Field>
                <Field name="capacity" id="room-cap" label="السعة (اختياري)"><input id="room-cap" name="capacity" type="number" min={1} className={inputCls} /></Field>
              </div>
            </ActionForm>
          )}
        </Card>
      </div>
    </div>
  );
}
