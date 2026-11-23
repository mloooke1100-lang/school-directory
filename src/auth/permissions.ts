/**
 * فهرس الصلاحيات والأدوار — مصدر الحقيقة في الكود، ويُزامَن إلى قاعدة البيانات عبر seed.
 * الأدوار قابلة للتعديل لاحقًا من قاعدة البيانات، لكن الأدوار النظامية الأربعة تُعاد مزامنتها من هنا.
 */

export const PERMISSIONS = {
  "students.read": "عرض الطالبات",
  "students.write": "إضافة وتعديل الطالبات",
  "students.export": "تصدير بيانات الطالبات",
  "students.archive": "أرشفة وترحيل الطالبات",
  "attendance.read": "عرض الغياب والتأخر",
  "attendance.write": "تسجيل الغياب والتأخر",
  "attendance.approve": "اعتماد الغياب والتأخر",
  "leave.read": "عرض الاستئذان",
  "leave.write": "تسجيل الاستئذان",
  "leave.approve": "اعتماد الاستئذان",
  "status_changes.read": "عرض الانقطاع والنقل",
  "status_changes.write": "تسجيل الانقطاع والنقل",
  "status_changes.approve": "اعتماد الانقطاع والنقل",
  "employees.read": "عرض دليل الموظفات",
  "employees.read_sensitive": "عرض تواريخ المباشرة والملاحظات الإدارية",
  "employees.write": "إضافة وتعديل الموظفات",
  "timetable.read": "عرض الجداول",
  "timetable.write": "تعديل الجداول",
  "timetable.approve": "اعتماد الجداول",
  "substitutes.read": "عرض حصص الانتظار",
  "substitutes.write": "إدارة حصص الانتظار",
  "activities.read": "عرض الأنشطة",
  "activities.write": "إدارة الأنشطة",
  "supervision.read": "عرض مراقبة الأدوار",
  "supervision.write": "إدارة مراقبة الأدوار",
  "reports.read": "عرض التقارير",
  "reports.export": "تصدير التقارير",
  "imports.manage": "استيراد ومراجعة البيانات",
  "audit.read": "عرض سجل التدقيق",
  "settings.read": "عرض الإعدادات",
  "settings.write": "تعديل إعدادات المدرسة",
  "users.manage": "إدارة الحسابات والصلاحيات",
  "years.manage": "إدارة السنوات الدراسية والأرشفة",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/** الصلاحيات التي تُقيَّد بالمرحلة التعليمية عندما يكون الدور مقيّدًا بمرحلة */
export const STAGE_SCOPED: ReadonlySet<Permission> = new Set<Permission>([
  "students.read",
  "students.write",
  "students.export",
  "students.archive",
  "attendance.read",
  "attendance.write",
  "attendance.approve",
  "leave.read",
  "leave.write",
  "leave.approve",
  "status_changes.read",
  "status_changes.write",
  "status_changes.approve",
  "timetable.read",
  "timetable.write",
  "timetable.approve",
  "substitutes.read",
  "substitutes.write",
  "activities.read",
  "activities.write",
]);

const READ_COMMON: Permission[] = [
  "students.read",
  "attendance.read",
  "leave.read",
  "status_changes.read",
  "employees.read",
  "timetable.read",
  "substitutes.read",
  "activities.read",
  "supervision.read",
  "reports.read",
  "settings.read",
];

export const SYSTEM_ROLES: Record<string, { nameAr: string; permissions: Permission[] }> = {
  PRINCIPAL: {
    nameAr: "المديرة",
    permissions: ALL_PERMISSIONS,
  },
  VP_ACADEMIC: {
    nameAr: "وكيلة الشؤون التعليمية",
    permissions: [
      ...READ_COMMON,
      "employees.read_sensitive",
      "employees.write",
      "timetable.write",
      "timetable.approve",
      "substitutes.write",
      "activities.write",
      "supervision.write",
      "reports.export",
    ],
  },
  VP_STUDENTS: {
    nameAr: "وكيلة شؤون الطالبات",
    permissions: [
      ...READ_COMMON,
      "students.write",
      "students.export",
      "attendance.write",
      "attendance.approve",
      "leave.write",
      "leave.approve",
      "status_changes.write",
      "status_changes.approve",
      "reports.export",
    ],
  },
  DIRECTORY_OFFICER: {
    nameAr: "مسؤولة الدليل الرقمي",
    permissions: [
      ...READ_COMMON,
      "students.write",
      "students.export",
      "employees.read_sensitive",
      "employees.write",
      "timetable.write",
      "reports.export",
      "imports.manage",
    ],
  },
};
