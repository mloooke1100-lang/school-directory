import "server-only";
import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { errorToState, type FormState } from "./forms";

/**
 * غلاف موحّد لعمليات الخادم: ينفّذ العملية، ثم يعيد التحقق من المسارات، ولا يُرجع ok إلا بعد نجاح الكتابة.
 * أخطاء التحويل (redirect) تُمرَّر كما هي.
 */
export async function runAction(fn: () => Promise<FormState>, paths: string[] = []): Promise<FormState> {
  try {
    const r = await fn();
    for (const p of paths) revalidatePath(p);
    return { ok: true, message: "تم الحفظ", nonce: Date.now(), ...r };
  } catch (e) {
    unstable_rethrow(e);
    return errorToState(e);
  }
}

/**
 * لعمليات يختفي بعدها النموذج نفسه (اعتماد، إلغاء، تصحيح ينشئ سجلًا جديدًا):
 * بعد نجاح الحفظ فقط يُعاد التوجيه للصفحة نفسها مع ?done=… لتظهر رسالة التأكيد فيها.
 * عنوان العودة يُقبل فقط إن بدأ بالمسار المتوقع (منع إعادة التوجيه لمكان آخر).
 */
export async function runAndRedirect(fn: () => Promise<unknown>, fd: FormData, prefix: string, done: string, paths: string[] = []): Promise<FormState> {
  try {
    await fn();
  } catch (e) {
    unstable_rethrow(e);
    return errorToState(e);
  }
  for (const p of paths) revalidatePath(p);
  const back = fd.get("back");
  const base = typeof back === "string" && back.startsWith(prefix) && !back.startsWith("//") ? back.replace(/([?&])done=[^&]*&?/, "$1").replace(/[?&]$/, "") : prefix;
  redirect(`${base}${base.includes("?") ? "&" : "?"}done=${done}`);
}

export const DONE_AR: Record<string, string> = {
  approved: "تم الاعتماد",
  rejected: "تم الرفض",
  corrected: "تم حفظ التصحيح",
  cancelled: "تم الإلغاء",
  exit: "تم تسجيل الخروج",
  saved: "تم الحفظ",
};
