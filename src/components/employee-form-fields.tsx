import { Field } from "./form";
import { inputCls } from "./ui";
import { CATEGORY_AR, EMPLOYMENT_STATUS_AR } from "@/domain/labels";
import { VERIFICATION_AR } from "@/domain/service-dates";

type ServiceDate = { originalCalendar: string | null; originalText: string | null; verification: string } | null;
export interface EmployeeFormValues {
  fullName: string;
  category: string;
  jobTitle: string;
  specialization: string | null;
  status: string;
  dataStatus: string;
  duties: string | null;
  workLocation: string | null;
  notes: string | null;
}

function DateFields({ prefix, title, v }: { prefix: "ministry" | "school"; title: string; v: ServiceDate }) {
  return (
    <fieldset className="grid gap-3 rounded-lg border border-gray-200 p-4 md:grid-cols-3">
      <legend className="px-1 text-sm font-semibold text-brand-900">{title}</legend>
      <Field name={`${prefix}Calendar`} label="نوع التقويم الأصلي">
        <select id={`${prefix}Calendar`} name={`${prefix}Calendar`} defaultValue={v?.originalCalendar ?? "HIJRI"} className={inputCls}>
          <option value="HIJRI">هجري (أم القرى)</option>
          <option value="GREGORIAN">ميلادي</option>
        </select>
      </Field>
      <Field name={`${prefix}Date`} label="التاريخ كما ورد في المصدر" hint="مثال: 1440/05/12 أو 2019-01-18. اتركيه فارغًا إن لم يظهر في المستند.">
        <input id={`${prefix}Date`} name={`${prefix}Date`} dir="ltr" defaultValue={v?.originalText ?? ""} maxLength={40} className={`${inputCls} text-right`} />
      </Field>
      <Field name={`${prefix}Verification`} label="حالة التحقق">
        <select id={`${prefix}Verification`} name={`${prefix}Verification`} defaultValue={v?.verification ?? "PENDING_VERIFICATION"} className={inputCls}>
          {Object.entries(VERIFICATION_AR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Field>
    </fieldset>
  );
}

export function EmployeeFormFields({ v, categories, stages, stageIds, sensitive, ministry, school }: { v?: EmployeeFormValues; categories: string[]; stages: Array<{ id: string; nameAr: string }>; stageIds: string[]; sensitive: boolean; ministry: ServiceDate; school: ServiceDate }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Field name="fullName" label="الاسم الكامل" className="md:col-span-2">
          <input id="fullName" name="fullName" defaultValue={v?.fullName} maxLength={150} className={inputCls} />
        </Field>
        <Field name="category" label="الفئة">
          <select id="category" name="category" defaultValue={v?.category ?? categories[0]} className={inputCls}>
            {categories.map((c) => <option key={c} value={c}>{CATEGORY_AR[c]}</option>)}
          </select>
        </Field>
        <Field name="jobTitle" label="المسمى الوظيفي">
          <input id="jobTitle" name="jobTitle" defaultValue={v?.jobTitle} maxLength={120} className={inputCls} />
        </Field>
        <Field name="specialization" label="التخصص">
          <input id="specialization" name="specialization" defaultValue={v?.specialization ?? ""} maxLength={120} className={inputCls} />
        </Field>
        <Field name="status" label="الحالة الوظيفية">
          <select id="status" name="status" defaultValue={v?.status ?? "ACTIVE"} className={inputCls}>
            {Object.entries(EMPLOYMENT_STATUS_AR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field name="dataStatus" label="حالة البيانات">
          <select id="dataStatus" name="dataStatus" defaultValue={v?.dataStatus ?? "INCOMPLETE"} className={inputCls}>
            <option value="COMPLETE">مكتمل</option>
            <option value="INCOMPLETE">غير مكتمل</option>
            <option value="PENDING_VERIFICATION">بانتظار التحقق</option>
          </select>
        </Field>
        <Field name="workLocation" label="الموقع المرتبط بالعمل (إن وجد)">
          <input id="workLocation" name="workLocation" defaultValue={v?.workLocation ?? ""} maxLength={200} className={inputCls} />
        </Field>
        <Field name="duties" label="المهام والمسؤوليات" className="md:col-span-2">
          <textarea id="duties" name="duties" rows={2} defaultValue={v?.duties ?? ""} maxLength={2000} className={inputCls} />
        </Field>
      </div>
      <fieldset className="rounded-lg border border-gray-200 p-4">
        <legend className="px-1 text-sm font-semibold text-brand-900">المراحل المرتبطة (يمكن أكثر من مرحلة عند وجود تكليف رسمي)</legend>
        <div className="flex flex-wrap gap-4">
          {stages.map((st) => (
            <label key={st.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="stageIds" value={st.id} defaultChecked={stageIds.includes(st.id)} /> {st.nameAr}
            </label>
          ))}
        </div>
      </fieldset>
      {sensitive ? (
        <>
          <DateFields prefix="ministry" title="تاريخ المباشرة بوزارة التعليم" v={ministry} />
          <DateFields prefix="school" title="تاريخ المباشرة بالمدرسة" v={school} />
          <p className="text-xs text-gray-600">التاريخان منفصلان ولا يُفترض تطابقهما. يُحفظ النص الأصلي ونوع تقويمه، ويُحسب المكافئ الميلادي بتقويم أم القرى.</p>
          <Field name="notes" label="ملاحظات إدارية ضرورية ومصرّح بها">
            <textarea id="notes" name="notes" rows={2} defaultValue={v?.notes ?? ""} maxLength={2000} className={inputCls} />
          </Field>
        </>
      ) : (
        <p className="text-xs text-gray-600">تواريخ المباشرة والملاحظات الإدارية تتطلب صلاحية خاصة.</p>
      )}
    </div>
  );
}
