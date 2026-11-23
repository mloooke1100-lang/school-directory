"use client";
export function PrintButton({ label = "طباعة" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="no-print rounded-lg border border-brand-300 bg-white px-4 py-2 text-sm font-medium text-brand-800 hover:bg-brand-50">
      {label}
    </button>
  );
}
