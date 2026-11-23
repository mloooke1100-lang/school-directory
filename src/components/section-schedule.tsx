import { getDb } from "@/db/client";
import type { AuthContext } from "@/auth/rbac";
import { can } from "@/auth/rbac";
import { sectionDay, sectionWeek } from "@/server/services/schedule";
import { ASSIGNMENT_STATUS_AR, ENTRY_KIND_AR } from "@/domain/labels";
import { formatHijri, minutesToHHMM, riyadhNow, DAY_NAMES_AR } from "@/domain/time";
import { dayOfWeekOf } from "@/domain/schedule";
import { WeekGrid } from "./week-grid";

const DAY_STATUS: Record<string, string> = { NO_TERM: "التاريخ خارج الفصول الدراسية", WEEKEND: "عطلة نهاية الأسبوع", HOLIDAY: "إجازة رسمية", NOT_CONFIGURED: "أوقات الحصص غير مكتملة لهذه المرحلة" };

/** الجدول الأسبوعي المعتمد للشعبة + جدول يوم محدد (بالانتظار والإلغاء والأنشطة) */
export async function SectionSchedule({ ctx, sectionId, stageId, date, dateParamHref }: { ctx: AuthContext; sectionId: string; stageId: string; date?: string; dateParamHref?: string }) {
  if (!can(ctx, "timetable.read", stageId)) return null;
  const db = getDb();
  const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : riyadhNow().date;
  const [week, day] = await Promise.all([sectionWeek(db, ctx, sectionId, d), sectionDay(db, ctx, sectionId, d)]);
  return (
    <>
      <section aria-labelledby="week" className="space-y-2">
        <h2 id="week" className="font-semibold">الجدول الأسبوعي المعتمد</h2>
        {week?.status === "OK" ? (
          <WeekGrid
            defs={week.defs}
            cell={(dd, n) => {
              const c = week.cells.get(`${dd}:${n}`);
              if (!c) return null;
              return (
                <div className="rounded bg-brand-50 p-1">
                  <p className="font-semibold">{c.kind === "LESSON" ? c.subject : ENTRY_KIND_AR[c.kind]}</p>
                  <p className="text-gray-700">{c.teacher}</p>
                  {c.room && <p className="text-gray-600">{c.room}</p>}
                </div>
              );
            }}
          />
        ) : (
          <p className="text-sm text-gray-700">لا يوجد فصل دراسي حالي.</p>
        )}
      </section>
      <section aria-labelledby="day" className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="day" className="font-semibold">جدول يوم {DAY_NAMES_AR[dayOfWeekOf(d)]} {formatHijri(d)}</h2>
          {dateParamHref && (
            <form action={dateParamHref} className="no-print flex gap-2" aria-label="تاريخ جدول اليوم">
              <input type="date" name="date" defaultValue={d} aria-label="التاريخ" className="rounded-lg border border-gray-300 px-2 py-1 text-sm" />
              <button className="rounded-lg border border-brand-300 bg-white px-3 py-1 text-sm text-brand-800">عرض</button>
            </form>
          )}
        </div>
        {!day || day.status !== "OK" ? (
          <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{day ? DAY_STATUS[day.status] : "—"}</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white text-sm">
            {day.slots.map((x) => (
              <li key={`${x.number}-${x.startMinute}`} className="flex flex-wrap items-center justify-between gap-2 p-2.5">
                <span className="font-medium">{x.label ?? `الحصة ${x.number}`} <span dir="ltr" className="text-xs text-gray-600">{minutesToHHMM(x.startMinute)}–{minutesToHHMM(x.endMinute)}</span></span>
                {x.kind !== "LESSON" ? <span className="text-gray-600">—</span> : !x.lesson ? <span className="text-gray-500">لا توجد حصة</span> : x.lesson.cancelled ? <span className="text-red-800">ملغاة اليوم</span> : (
                  <span>
                    {x.lesson.subject} · {x.lesson.substitute ? <><strong>{x.lesson.substitute}</strong> <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-900">انتظار بدل {x.lesson.teacher}</span></> : x.lesson.teacher}
                    {x.lesson.room && ` · ${x.lesson.room}`}
                  </span>
                )}
              </li>
            ))}
            {day.activities.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2 bg-green-50 p-2.5">
                <span className="font-medium">نشاط: {a.name} <span dir="ltr" className="text-xs text-gray-600">{minutesToHHMM(a.startMinute)}–{minutesToHHMM(a.endMinute)}</span></span>
                <span>{a.supervisor}{(a.room || a.location) && ` · ${a.room ?? a.location}`} · {ASSIGNMENT_STATUS_AR[a.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
