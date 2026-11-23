/**
 * أدوات مشتركة لعمليات الحفظ: تحويل FormData، مساعدات Zod، وتحويل الأخطاء إلى رسائل عربية واضحة.
 * القاعدة: لا تُعرض «تم الحفظ» إلا عندما يرجع الخادم ok=true بعد نجاح المعاملة فعليًا.
 */
import { z, ZodError } from "zod";
import { ForbiddenError, AuthError } from "@/auth/rbac";
import { ConflictError, StaleRecordError } from "@/domain/conflicts";

export interface FormState {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  /** قيمة تُعرض مرة واحدة فقط (مثل كلمة مرور مؤقتة) */
  secret?: string;
  /** يزداد مع كل إرسال ناجح لإعادة تهيئة النماذج */
  nonce?: number;
}

/** خطأ تحقق في منطق الأعمال مرتبط بحقل محدد */
export class ValidationError extends Error {
  status = 400;
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

/** يحوّل FormData إلى كائن عادي؛ المفاتيح المتكررة تصبح مصفوفة، وتُتجاهل مفاتيح Next الداخلية */
export function formToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(fd.keys())) {
    if (key.startsWith("$ACTION")) continue;
    const all = fd.getAll(key).filter((v): v is string => typeof v === "string");
    out[key] = all.length > 1 ? all : all[0];
  }
  return out;
}

// ───── مساعدات Zod ─────
export const reqText = (label: string, max = 200) =>
  z
    .string({ error: `${label} مطلوب` })
    .trim()
    .min(1, { error: `${label} مطلوب` })
    .max(max, { error: `${label} أطول من المسموح (${max} حرفًا)` });

export const optText = (max = 1000) =>
  z
    .string()
    .trim()
    .max(max, { error: `النص أطول من المسموح (${max} حرفًا)` })
    .optional()
    .transform((v) => (v ? v : null));

export const optUuid = () =>
  z
    .union([z.literal(""), z.uuid({ error: "معرّف غير صالح" })])
    .optional()
    .transform((v) => (v ? v : null));

export const reqUuid = (label: string) => z.uuid({ error: `اختاري ${label}` });

export const isoDate = (label: string) =>
  z.string({ error: `${label} مطلوب` }).regex(/^\d{4}-\d{2}-\d{2}$/, { error: `${label} غير صالح` }).refine(
    (v) => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v,
    { error: `${label} غير صالح` },
  );

export const versionField = z.coerce.number({ error: "رقم الإصدار مفقود" }).int().min(1);

/** مربع اختيار HTML: "on" أو "true" → true، وغيابه → false */
export const checkbox = z
  .union([z.literal("on"), z.literal("true"), z.literal("false"), z.literal("")])
  .optional()
  .transform((v) => v === "on" || v === "true");

/** يقبل قيمة مفردة أو مصفوفة (من FormData) ويعيد مصفوفة */
export const stringArray = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]).filter((x) => x !== ""));

// ───── رسائل قيود قاعدة البيانات ─────
const CONSTRAINT_AR: Record<string, string> = {
  students_school_number_unique: "الرقم المدرسي مستخدم لطالبة أخرى.",
  enrollment_student_year_uq: "للطالبة قيد مسجّل في هذه السنة الدراسية مسبقًا.",
  sections_grade_year_name_uq: "توجد شعبة بالاسم نفسه لهذا الصف في السنة نفسها.",
  users_username_unique: "اسم المستخدم مستخدم لحساب آخر.",
  users_employee_id_unique: "هذه الموظفة مرتبطة بحساب دخول آخر.",
  user_roles_uq: "الدور مُسند مسبقًا بالنطاق نفسه.",
  service_dates_emp_kind_uq: "تاريخ المباشرة من هذا النوع مسجّل مسبقًا.",
  tt_one_draft_uq: "توجد مسودة جدول لهذه المرحلة في هذا الفصل الدراسي؛ أكمليها أو اعتمديها.",
  tt_one_approved_uq: "يوجد جدول معتمد آخر لهذه المرحلة في هذا الفصل الدراسي.",
  subjects_stage_name_uq: "المادة موجودة مسبقًا لهذه المرحلة.",
  rooms_name_unique: "توجد قاعة بالاسم نفسه.",
  periods_slot_uq: "رقم الفترة مستخدم مسبقًا لهذه المرحلة في اليوم نفسه.",
};

function dbErrorInfo(e: unknown): { code?: string; constraint?: string } | null {
  const c = (e as { cause?: unknown })?.cause ?? e;
  if (c && typeof c === "object" && "code" in c) return c as { code?: string; constraint?: string };
  return null;
}

/** يحوّل أي خطأ إلى حالة نموذج؛ لا يكشف تفاصيل داخلية للمستخدمة */
export function errorToState(e: unknown): FormState {
  if (e instanceof ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const i of e.issues) {
      const k = i.path.join(".") || "_";
      fieldErrors[k] ??= i.message;
    }
    return { ok: false, error: "تحققي من الحقول المعلَّمة: " + Object.values(fieldErrors)[0], fieldErrors };
  }
  if (e instanceof ValidationError) return { ok: false, error: e.message, fieldErrors: e.field ? { [e.field]: e.message } : undefined };
  if (e instanceof ForbiddenError || e instanceof AuthError) return { ok: false, error: e.message };
  if (e instanceof StaleRecordError || e instanceof ConflictError) return { ok: false, error: e.message };
  const db = dbErrorInfo(e);
  if (db?.code === "23505") return { ok: false, error: CONSTRAINT_AR[db.constraint ?? ""] ?? "السجل مكرر ولم يُحفظ." };
  if (db?.code === "23503") return { ok: false, error: "أحد الاختيارات لم يعد موجودًا. حدّثي الصفحة وحاولي مجددًا." };
  if (db?.code === "23514") return { ok: false, error: "القيم المدخلة تخالف قيود البيانات ولم تُحفظ." };
  console.error("[action-error]", e);
  return { ok: false, error: "تعذّر الحفظ بسبب خطأ غير متوقع أو انقطاع الاتصال بقاعدة البيانات. لم يُحفظ أي تغيير؛ حاولي مجددًا." };
}
