/** المسميات العربية لكل القيم التي تراها المستخدمة (لا نصوص إنجليزية في الواجهة) */
export const CATEGORY_AR: Record<string, string> = {
  LEADERSHIP: "قيادة",
  TEACHER: "معلمة",
  ADMINISTRATIVE: "إدارية",
  SERVICE: "مستخدمة",
  GUARD: "حارس",
  COUNSELOR: "مرشدة طلابية",
};

export const EMPLOYMENT_STATUS_AR: Record<string, string> = {
  ACTIVE: "على رأس العمل",
  ON_LEAVE: "في إجازة",
  SECONDED: "مكلّفة خارج المدرسة",
  TRANSFERRED: "منقولة",
  RETIRED: "متقاعدة",
  INACTIVE: "غير نشطة",
};

export const DATA_STATUS_AR: Record<string, string> = {
  COMPLETE: "مكتمل",
  INCOMPLETE: "غير مكتمل",
  PENDING_VERIFICATION: "بانتظار التحقق",
};

export const ENROLLMENT_STATUS_AR: Record<string, string> = {
  ACTIVE: "منتظمة",
  TRANSFERRED_OUT: "منقولة",
  DROPPED_OUT: "منقطعة",
  WITHDRAWN: "منسحبة",
  GRADUATED: "متخرجة",
  PROMOTED: "منقولة للصف التالي",
};

export const POSITION_AR: Record<string, string> = {
  PRINCIPAL: "المديرة",
  VP_ACADEMIC: "وكيلة الشؤون التعليمية",
  VP_STUDENTS: "وكيلة شؤون الطالبات",
  COUNSELOR: "المرشدة الطلابية",
  DIRECTORY_OFFICER: "مسؤولة الدليل الرقمي",
  OTHER: "أخرى",
};

export const YEAR_STATUS_AR: Record<string, string> = { PLANNED: "مخططة", ACTIVE: "نشطة", ARCHIVED: "مؤرشفة" };

export const AUDIT_ACTION_AR: Record<string, string> = {
  login: "تسجيل دخول",
  logout: "تسجيل خروج",
  login_failed: "محاولة دخول فاشلة",
  login_locked: "محاولة دخول لحساب موقوف",
  create: "إضافة",
  update: "تعديل",
  delete: "حذف",
  export: "تصدير",
  approve: "اعتماد",
  password_change: "تغيير كلمة المرور",
  password_reset: "إعادة تعيين كلمة المرور",
  password_change_failed: "محاولة فاشلة لتغيير كلمة المرور",
  roles_update: "تعديل الصلاحيات",
};

export const AUDIT_ENTITY_AR: Record<string, string> = {
  user: "حساب",
  student: "طالبة",
  enrollment: "قيد طالبة",
  employee: "موظفة",
  attendance: "غياب/تأخر",
  section: "شعبة",
  school: "إعدادات المدرسة",
  leadership: "القيادة المدرسية",
  period: "أوقات الحصص",
  timetable: "جدول أسبوعي",
  timetable_entry: "خانة جدول",
  substitute: "حصة انتظار",
  activity: "نشاط",
  activity_session: "جلسة نشاط",
  subject: "مادة دراسية",
  room: "قاعة",
};

export const ASSIGNMENT_STATUS_AR: Record<string, string> = { PLANNED: "مخطط", CONFIRMED: "مؤكد", DONE: "منفّذ", CANCELLED: "ملغى" };
export const PERIOD_KIND_AR: Record<string, string> = { LESSON: "حصة", BREAK: "فسحة", PRAYER: "صلاة", ASSEMBLY: "طابور", OTHER: "أخرى" };
export const ENTRY_KIND_AR: Record<string, string> = { LESSON: "حصة أساسية", STANDBY: "انتظار ثابت", ACTIVITY: "نشاط" };
export const TIMETABLE_STATUS_AR: Record<string, string> = { DRAFT: "مسودة", APPROVED: "معتمد", SUPERSEDED: "مستبدل (أرشيف)" };
