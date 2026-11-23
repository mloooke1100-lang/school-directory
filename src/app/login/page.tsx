import { getDb } from "@/db/client";
import { getSchool } from "@/server/school";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const school = await getSchool(getDb());
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50 to-gray-100 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-700 text-2xl font-bold text-white" aria-hidden>د</div>
          <h1 className="text-xl font-bold text-brand-900">{school?.systemName ?? "الدليل الرقمي المدرسي المتكامل"}</h1>
          {school && <p className="mt-1 text-sm text-gray-700">{school.nameAr}</p>}
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <LoginForm />
        </div>
        <p className="mt-6 text-center text-xs text-gray-600">{school?.creditLine}</p>
      </div>
    </main>
  );
}
