/** حساب مدة التأخر بالدقائق (لا تُقبل قيمة سالبة: الوصول قبل البداية ليس تأخرًا) */
export function computeLateMinutes(schoolStartMinute: number, arrivalMinute: number): number {
  for (const v of [schoolStartMinute, arrivalMinute]) {
    if (!Number.isInteger(v) || v < 0 || v >= 1440) throw new Error("وقت غير صالح");
  }
  if (arrivalMinute <= schoolStartMinute) throw new Error("وقت الوصول ليس بعد بداية الدوام — لا يُسجَّل تأخر");
  return arrivalMinute - schoolStartMinute;
}
