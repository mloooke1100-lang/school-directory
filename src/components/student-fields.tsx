"use client";
import { useState } from "react";
import { Field } from "./form";
import { inputCls } from "./ui";

export interface SectionOption { id: string; yearId: string; name: string; gradeName: string; stageName: string }

/** اختيار السنة ثم الفصل التابع لها (الفصول تُصفّى حسب السنة) */
export function YearSectionFields({ years, sections, defaultYearId, defaultSectionId, lockYear, idPrefix = "" }: { years: Array<{ id: string; name: string }>; sections: SectionOption[]; defaultYearId?: string; defaultSectionId?: string; lockYear?: boolean; idPrefix?: string }) {
  const [yearId, setYearId] = useState(defaultYearId ?? years[0]?.id ?? "");
  const list = sections.filter((x) => x.yearId === yearId);
  return (
    <>
      {!lockYear && (
        <Field name="yearId" id={`${idPrefix}yearId`} label="السنة الدراسية">
          <select id={`${idPrefix}yearId`} name="yearId" value={yearId} onChange={(e) => setYearId(e.target.value)} className={inputCls}>
            {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
          </select>
        </Field>
      )}
      <Field name="sectionId" id={`${idPrefix}sectionId`} label="الصف والشعبة">
        <select id={`${idPrefix}sectionId`} name="sectionId" defaultValue={defaultSectionId ?? ""} key={yearId} className={inputCls}>
          <option value="">— اختاري —</option>
          {list.map((x) => <option key={x.id} value={x.id}>{x.stageName} · {x.gradeName} / {x.name}</option>)}
        </select>
      </Field>
    </>
  );
}
