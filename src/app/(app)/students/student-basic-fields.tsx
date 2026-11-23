import { Field } from "@/components/form";
import { inputCls } from "@/components/ui";

export function StudentBasicFields({ v }: { v?: { fullName: string; schoolNumber: string | null; notes: string | null; dataStatus: string } }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field name="fullName" label="الاسم الكامل" className="md:col-span-2">
        <input id="fullName" name="fullName" defaultValue={v?.fullName} required maxLength={150} className={inputCls} />
      </Field>
      <Field name="schoolNumber" label="الرقم المدرسي (اختياري — فقط إن كان مصرحًا باستخدامه)" hint="لا يُدخل رقم السجل المدني إطلاقًا.">
        <input id="schoolNumber" name="schoolNumber" dir="ltr" defaultValue={v?.schoolNumber ?? ""} maxLength={30} className={`${inputCls} text-right`} />
      </Field>
      <Field name="dataStatus" label="حالة البيانات">
        <select id="dataStatus" name="dataStatus" defaultValue={v?.dataStatus ?? "COMPLETE"} className={inputCls}>
          <option value="COMPLETE">مكتمل</option>
          <option value="INCOMPLETE">غير مكتمل</option>
          <option value="PENDING_VERIFICATION">بانتظار التحقق</option>
        </select>
      </Field>
      <Field name="notes" label="ملاحظات إدارية محدودة" className="md:col-span-2" hint="ملاحظات إدارية ضرورية فقط، دون بيانات شخصية حساسة.">
        <textarea id="notes" name="notes" rows={2} maxLength={500} defaultValue={v?.notes ?? ""} className={inputCls} />
      </Field>
    </div>
  );
}
