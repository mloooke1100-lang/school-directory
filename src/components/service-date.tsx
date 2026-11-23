import { describeServiceDate, VERIFICATION_AR, type Verification } from "@/domain/service-dates";

/** عرض تاريخ المباشرة بالهجري والميلادي مع حالة التحقق والنص الأصلي */
export function ServiceDateView({ v }: { v: { date: string | null; originalText: string | null; originalCalendar: string | null; verification: string } | null }) {
  const d = describeServiceDate(v);
  if (!v || !d) return <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{VERIFICATION_AR[(v?.verification as Verification) ?? "PENDING_VERIFICATION"]} — غير مكتمل</span>;
  return (
    <span className="block">
      <span className="block">{d.hijri}</span>
      <span className="block text-xs text-gray-600">{d.gregorian} م</span>
      {v.verification !== "COMPLETE" && <span className="mt-0.5 inline-block rounded bg-amber-100 px-1.5 text-xs text-amber-900">{VERIFICATION_AR[v.verification as Verification]}</span>}
    </span>
  );
}
