import type { ReactNode } from "react";
import { periodsForDay, type PeriodDef } from "@/domain/periods";
import { DAY_NAMES_AR, minutesToHHMM } from "@/domain/time";

/** شبكة أسبوعية (الأحد–الخميس × الحصص) مبنية على أوقات المرحلة المُعدّة فقط */
export function WeekGrid({ defs, cell, caption }: { defs: PeriodDef[]; cell: (day: number, period: number) => ReactNode; caption?: string }) {
  const days = [0, 1, 2, 3, 4];
  const numbers = [...new Set(defs.filter((d) => d.kind === "LESSON").map((d) => d.number))].sort((a, b) => a - b);
  if (numbers.length === 0) return <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">أوقات الحصص غير مكتملة لهذه المرحلة.</p>;
  const general = periodsForDay(defs, 0);
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full min-w-[720px] table-fixed text-xs">
        {caption && <caption className="p-2 text-right text-sm font-semibold">{caption}</caption>}
        <thead className="bg-brand-50 text-brand-900">
          <tr>
            <th className="w-20 p-2 text-right">اليوم</th>
            {numbers.map((n) => {
              const g = general.find((p) => p.number === n);
              return (
                <th key={n} className="p-2 text-center">
                  الحصة {n}
                  {g && <span className="block font-normal text-gray-600" dir="ltr">{minutesToHHMM(g.startMinute)}–{minutesToHHMM(g.endMinute)}</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {days.map((d) => (
            <tr key={d}>
              <th scope="row" className="bg-gray-50 p-2 text-right font-semibold">{DAY_NAMES_AR[d]}</th>
              {numbers.map((n) => (
                <td key={n} className="h-14 border-r border-gray-100 p-1.5 align-top">{cell(d, n)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
