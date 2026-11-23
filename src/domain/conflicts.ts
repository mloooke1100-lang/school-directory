/** أدوات كشف التعارض الزمني (نطاقات نصف مفتوحة [start, end)) */
export interface TimeRange {
  startMinute: number;
  endMinute: number;
}

export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}

export class ConflictError extends Error {
  status = 409;
  constructor(
    message: string,
    public details: string[] = [],
  ) {
    super(message);
  }
}

/** يرمي عند تعديل سجل تغيّر منذ قراءته (القفل التفاؤلي) */
export class StaleRecordError extends Error {
  status = 409;
  constructor() {
    super("تم تعديل هذا السجل من مستخدمة أخرى بعد فتحه. حدّثي الصفحة وراجعي التغييرات قبل الحفظ.");
  }
}
