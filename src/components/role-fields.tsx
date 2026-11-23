import { inputCls } from "./ui";

/** اختيار الأدوار مع تقييد اختياري بمرحلة لكل دور */
export function RoleFields({ roles, stages, current = [] }: { roles: Array<{ code: string; nameAr: string }>; stages: Array<{ id: string; nameAr: string }>; current?: Array<{ code: string; stageId: string | null }> }) {
  return (
    <fieldset className="rounded-lg border border-gray-200 p-4">
      <legend className="px-1 text-sm font-semibold text-brand-900">الأدوار والصلاحيات</legend>
      <div className="space-y-3">
        {roles.map((r) => {
          const cur = current.find((c) => c.code === r.code);
          return (
            <div key={r.code} className="grid items-center gap-2 md:grid-cols-[1fr_16rem]">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={`role_${r.code}`} defaultChecked={!!cur} /> {r.nameAr}
              </label>
              <select name={`stage_${r.code}`} defaultValue={cur?.stageId ?? ""} aria-label={`نطاق دور ${r.nameAr}`} className={inputCls}>
                <option value="">كل المراحل</option>
                {stages.map((st) => <option key={st.id} value={st.id}>{st.nameAr} فقط</option>)}
              </select>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-gray-600">تقييد المرحلة يسري على بيانات الطالبات والجداول وشؤون الطالبات، ويُطبَّق على الخادم.</p>
    </fieldset>
  );
}
