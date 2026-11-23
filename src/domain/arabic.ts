/**
 * تطبيع النص العربي لأغراض البحث فقط — الاسم الأصلي يُحفظ ويُعرض كما هو دون تعديل.
 */
const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;

export function normalizeArabic(input: string): string {
  return input
    .normalize("NFKC")
    .replace(TASHKEEL, "")
    .replace(TATWEEL, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** يحوّل نص البحث إلى نمط LIKE آمن (تهريب % و _ و \) */
export function toLikePattern(query: string): string {
  const n = normalizeArabic(query).replace(/[\\%_]/g, (c) => "\\" + c);
  return `%${n}%`;
}
