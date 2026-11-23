import Link from "next/link";
import { getDb } from "@/db/client";
import type { AuthContext } from "@/auth/rbac";
import { can } from "@/auth/rbac";
import { studentAttendanceHistory } from "@/server/services/attendance";
import { studentLeaves } from "@/server/services/leaves";
import { listStatusChanges } from "@/server/services/status-changes";
import { ABSENCE_KIND_AR, RECORD_STATUS_AR, REQUEST_STATUS_AR, STATUS_CHANGE_AR } from "@/domain/labels";
import { minutesToHHMM } from "@/domain/time";
import { btnSecondary, Card } from "./ui";

/** سجل شؤون الطالبة: الغياب والتأخر (بما فيه المصحَّح والملغى) والاستئذان والانقطاع والنقل */
export async function StudentAffairs({ ctx, studentId, stageId }: { ctx: AuthContext; studentId: string; stageId: string | null }) {
  const db = getDb();
  const [att, leaves, changes] = await Promise.all([
    can(ctx, "attendance.read") ? studentAttendanceHistory(db, ctx, studentId) : Promise.resolve([]),
    can(ctx, "leave.read") ? studentLeaves(db, ctx, studentId) : Promise.resolve([]),
    can(ctx, "status_changes.read") ? listStatusChanges(db, ctx, { studentId }) : Promise.resolve([]),
  ]);
  const active = att.filter((a) => ["RECORDED", "APPROVED"].includes(a.e.status));
  return (
    <Card title="سجل شؤون الطالبة">
      <p className="mb-3 text-sm text-gray-700">
        الغياب: {active.filter((a) => a.e.type === "ABSENCE").length} يوم · التأخر: {active.filter((a) => a.e.type === "LATE").length} مرة · الاستئذان: {leaves.filter((l) => l.status !== "CANCELLED").length}
        <span className="block text-xs text-gray-600">حالة القيد منفصلة عن الأحداث اليومية ولا تتغير آليًا بسبب الغياب.</span>
      </p>
      {stageId && can(ctx, "status_changes.write", stageId) && <Link href={`/status-changes/new?student=${studentId}`} className={`${btnSecondary} no-print mb-3`}>تسجيل طلب انقطاع أو نقل</Link>}
      {att.length > 0 && (
        <ul className="mb-3 divide-y divide-gray-100 text-sm">
          {att.map((a) => (
            <li key={a.e.id} className={`flex flex-wrap justify-between gap-2 py-1.5 ${["CORRECTED", "CANCELLED"].includes(a.e.status) ? "text-gray-500 line-through decoration-gray-300" : ""}`}>
              <span><span dir="ltr">{a.e.date}</span> · {a.e.type === "ABSENCE" ? `غياب ${ABSENCE_KIND_AR[a.e.absenceKind ?? "UNKNOWN"]}` : `تأخر ${a.e.lateMinutes} د (وصول ${minutesToHHMM(a.e.arrivalMinute!)})`}</span>
              <span className="text-xs">{RECORD_STATUS_AR[a.e.status]} · {a.recordedBy}</span>
            </li>
          ))}
        </ul>
      )}
      {leaves.length > 0 && (
        <ul className="mb-3 divide-y divide-gray-100 text-sm">
          {leaves.map((l) => <li key={l.id} className="py-1.5">استئذان <span dir="ltr">{l.date} {minutesToHHMM(l.requestMinute)}</span> · {l.reason} · {REQUEST_STATUS_AR[l.status]}</li>)}
        </ul>
      )}
      {changes.length > 0 && (
        <ul className="divide-y divide-gray-100 text-sm">
          {changes.map((c) => <li key={c.c.id} className="py-1.5">{STATUS_CHANGE_AR[c.c.type]} من <span dir="ltr">{c.c.effectiveDate}</span>{c.c.destinationSchool && ` إلى ${c.c.destinationSchool}`} · {REQUEST_STATUS_AR[c.c.status]}</li>)}
        </ul>
      )}
      {att.length + leaves.length + changes.length === 0 && <p className="text-sm text-gray-600">لا توجد سجلات.</p>}
    </Card>
  );
}
