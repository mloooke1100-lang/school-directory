import "server-only";
import { unstable_rethrow } from "next/navigation";
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
