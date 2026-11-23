import Link from "next/link";
import { getDb } from "@/db/client";
import { requireUser } from "@/server/current-user";
import { getDashboard } from "@/server/dashboard";
import { formatGregorian, formatHijri, riyadhNow, minutesToHHMM, DAY_NAMES_AR } from "@/domain/time";
import { Stat } from "@/components/stat";

import { AUDIT_ACTION_AR as ACTION_AR, AUDIT_ENTITY_AR as ENTITY_AR } from "@/domain/labels";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ password?: string }> }) {
  const ctx = await requireUser();
  const { password } = await searchParams;
  const d = await getDashboard(getDb(), ctx);
  const now = riyadhNow();
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {password === "changed" && <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-800">تم تغيير كلمة المرور بنجاح</p>}
      <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-900">{d.school?.nameAr}</h1>
          <p className="text-sm text-gray-700">
            {d.yearName ? `السنة الدراسية ${d.yearName}` : "لا توجد سنة نشطة"}
            {d.termName && ` · ${d.termName}`}
          </p>
        </div>
        <div className="text-sm text-gray-800 md:text-left">
          <p>{DAY_NAMES_AR[now.dayOfWeek]} {formatHijri(d.today)}</p>
          <p className="text-gray-600">{formatGregorian(d.today)} · {minutesToHHMM(now.minuteOfDay)} (الرياض)</p>
        </div>
      </header>

      <form action="/search" className="no-print flex gap-2" role="search">
        <label htmlFor="q" className="sr-only">بحث</label>
        <input id="q" name="q" placeholder="ابحثي عن طالبة أو معلمة أو فصل…" className="flex-1 rounded-xl border border-gray-300 bg-white px-4 py-3 focus:border-brand-600 focus:outline-none" />
        <button className="rounded-xl bg-brand-700 px-5 font-semibold text-white hover:bg-brand-800">بحث</button>
      </form>

      {d.alerts.length > 0 && (
        <section aria-labelledby="alerts" className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <h2 id="alerts" className="mb-2 font-semibold text-amber-900">تنبيهات البيانات</h2>
          <ul className="list-inside list-disc space-y-1 text-sm text-amber-900">
            {d.alerts.map((a) => <li key={a}>{a}</li>)}
          </ul>
        </section>
      )}

      <section aria-label="الإجماليات" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="الطالبات (منتظمات)" value={d.counts.students} />
        <Stat label="المعلمات" value={d.counts.teachers} />
        <Stat label="الإداريات والقيادة" value={d.counts.admins} />
        <Stat label="الفصول" value={d.counts.sections} />
      </section>

      <section aria-labelledby="today">
        <h2 id="today" className="mb-3 font-semibold text-gray-900">اليوم</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Stat label="الغياب" value={d.todayCounts.absences} />
          <Stat label="التأخر" value={d.todayCounts.lates} />
          <Stat label="الاستئذان" value={d.todayCounts.leaves} />
          <Stat label="حصص الانتظار" value={d.todayCounts.substitutes} />
          <Stat label="حصص النشاط" value={d.todayCounts.activities} />
          <Stat label="مراقبة الأدوار" value={d.todayCounts.supervision} />
        </div>
      </section>

      {d.recent.length > 0 && (
        <section aria-labelledby="recent" className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 id="recent" className="mb-2 font-semibold">آخر العمليات</h2>
          <ul className="divide-y divide-gray-100 text-sm">
            {d.recent.map((r, i) => (
              <li key={i} className="flex justify-between py-2">
                <span>{r.actor ?? "—"} · {ACTION_AR[r.action] ?? r.action} · {ENTITY_AR[r.entityType] ?? r.entityType}</span>
                <time className="text-gray-600" dateTime={r.createdAt.toISOString()}>{r.createdAt.toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })}</time>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-xs text-gray-600">الأرقام تُحسب مباشرة من قاعدة البيانات وفق صلاحياتك. <Link className="underline" href="/about">عن النظام</Link></p>
    </div>
  );
}
