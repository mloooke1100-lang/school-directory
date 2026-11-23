import Link from "next/link";
import type { ReactNode } from "react";
import { DATA_STATUS_AR } from "@/domain/labels";

export const inputCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 focus:border-brand-600 focus:outline-none";
export const btnSecondary = "inline-block rounded-lg border border-brand-300 bg-white px-4 py-2 text-sm font-medium text-brand-800 hover:bg-brand-50";
export const btnPrimary = "inline-block rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-brand-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-gray-700">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-gray-200 bg-white p-4 md:p-5 ${className}`}>
      {title && <h2 className="mb-3 font-semibold text-gray-900">{title}</h2>}
      {children}
    </section>
  );
}

export function DataBadge({ status }: { status: string }) {
  if (status === "COMPLETE") return <span className="rounded bg-green-50 px-2 py-0.5 text-xs text-green-800">{DATA_STATUS_AR[status]}</span>;
  return <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{DATA_STATUS_AR[status] ?? status}</span>;
}

/** يظهر فقط بعد تحويل ناجح من عملية حفظ (الإضافة تُحوِّل بعد نجاح المعاملة) */
export function SavedNotice({ show }: { show: boolean }) {
  if (!show) return null;
  return <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-800">تم الحفظ</p>;
}

export function Denied({ message = "لا تملكين صلاحية الاطلاع على هذه الصفحة." }: { message?: string }) {
  return <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{message}</p>;
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return <Link href={href} className="no-print text-sm text-brand-700 underline-offset-2 hover:underline">← {label}</Link>;
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-brand-50 text-right text-brand-900">
          <tr>{head.map((h) => <th key={h} className="p-3 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-gray-100">{children}</tbody>
      </table>
    </div>
  );
}
