export function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-sm text-gray-700">{label}</p>
      <p className="mt-1 text-2xl font-bold text-brand-800">{value === null ? <span className="text-base font-normal text-gray-500">غير متاح</span> : value.toLocaleString("en-US")}</p>
    </div>
  );
}
