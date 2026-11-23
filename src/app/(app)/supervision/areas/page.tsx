import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { listAreas } from "@/server/services/supervision";
import { can, ForbiddenError } from "@/auth/rbac";
import { ActionForm, Field } from "@/components/form";
import { BackLink, Card, Denied, inputCls, PageHeader } from "@/components/ui";
import { createAreaAction, createFloorAction, updateAreaAction } from "../actions";

export default async function AreasPage() {
  const ctx = await requireUser();
  let floors;
  try {
    floors = await listAreas(getDb(), ctx);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Denied />;
    throw e;
  }
  const canWrite = can(ctx, "supervision.write");
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <BackLink href="/supervision" label="مراقبة الأدوار" />
      <PageHeader title="المباني والأدوار والمناطق" />
      {floors.map((f) => (
        <Card key={f.id} title={`${f.building} — ${f.name}`}>
          <ul className="space-y-2">
            {f.areas.map((a) => (
              <li key={a.id}>
                {canWrite ? (
                  <ActionForm action={updateAreaAction.bind(null, a.id)} ariaLabel={`منطقة ${a.name}`} className="flex flex-wrap items-center gap-3">
                    <div key={a.version} className="flex flex-wrap items-center gap-3">
                      <input type="hidden" name="version" value={a.version} />
                      <input name="name" defaultValue={a.name} aria-label="اسم المنطقة" className="rounded border border-gray-300 px-2 py-1" />
                      <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="isActive" defaultChecked={a.isActive} /> نشطة</label>
                    </div>
                  </ActionForm>
                ) : <span>{a.name}{!a.isActive && " (غير نشطة)"}</span>}
              </li>
            ))}
            {f.areas.length === 0 && <li className="text-sm text-gray-600">لا توجد مناطق.</li>}
          </ul>
          {canWrite && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              <ActionForm action={createAreaAction} submitLabel="إضافة منطقة" ariaLabel={`إضافة منطقة إلى ${f.name}`}>
                <input type="hidden" name="floorId" value={f.id} />
                <div key={f.areas.length}><Field name="name" id={`area-${f.id}`} label="اسم المنطقة الجديدة"><input id={`area-${f.id}`} name="name" className={inputCls} /></Field></div>
              </ActionForm>
            </div>
          )}
        </Card>
      ))}
      {canWrite && (
        <Card title="إضافة دور">
          <ActionForm action={createFloorAction} submitLabel="إضافة الدور" ariaLabel="إضافة دور">
            <div key={floors.length} className="grid gap-3 md:grid-cols-3">
              <Field name="building" id="fl-building" label="المبنى"><input id="fl-building" name="building" className={inputCls} /></Field>
              <Field name="name" id="fl-name" label="الدور"><input id="fl-name" name="name" className={inputCls} /></Field>
              <Field name="order" id="fl-order" label="الترتيب"><input id="fl-order" type="number" name="order" defaultValue={0} className={inputCls} /></Field>
            </div>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
