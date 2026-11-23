# مخطط العلاقات (مختصر)

```mermaid
erDiagram
  schools ||--o{ educational_stages : has
  schools ||--o{ academic_years : has
  academic_years ||--o{ academic_terms : has
  educational_stages ||--o{ grades : has
  grades ||--o{ class_sections : has
  academic_years ||--o{ class_sections : "per year"
  students ||--o{ student_enrollments : "one per year"
  class_sections ||--o{ student_enrollments : contains
  student_enrollments ||--o{ student_attendance_events : records
  student_enrollments ||--o{ student_leave_requests : records
  student_enrollments ||--o{ student_status_changes : records
  employees ||--o{ employee_service_dates : "MINISTRY + SCHOOL"
  employees ||--o{ employee_assignments : positions
  employees ||--o{ teacher_subjects : teaches
  academic_terms ||--o{ period_definitions : "per stage"
  academic_terms ||--o{ weekly_timetables : has
  weekly_timetables ||--o{ timetable_entries : has
  timetable_entries ||--o{ timetable_overrides : "day exceptions"
  class_sections ||--o{ substitute_assignments : "waiting periods"
  activities ||--o{ activity_sessions : has
  floors ||--o{ supervision_areas : has
  supervision_areas ||--o{ supervision_assignments : has
  users ||--o{ user_roles : has
  roles ||--o{ user_roles : "optional stage scope"
  roles ||--o{ role_permissions : grants
  users ||--o{ sessions : has
  users ||--o{ audit_logs : acts
  import_batches ||--o{ import_row_issues : has
```

## تغييرات المرحلة 4 (ترحيل `drizzle/0001_phase4_directory.sql`)
- `users.version` و`class_sections.version/updated_at/updated_by_id` للقفل التفاؤلي.
- `employees.work_location`: المرحلة أو موقع العمل (دليل المستخدمات والحراس).
- صلاحية جديدة `sections.write` (مقيّدة بالمرحلة): المديرة، وكيلة الشؤون التعليمية، مسؤولة الدليل.

## تغييرات المرحلة 5 (ترحيل `drizzle/0002_phase5_timetables.sql`)
- `weekly_timetables`: `version`، `source_timetable_id` (نُسخ من)، `created_by_id`، وفهرسان فريدان جزئيان: جدول **معتمد** واحد و**مسودة** واحدة لكل (فصل دراسي، مرحلة). المعتمد السابق يصبح `SUPERSEDED` ولا يُحذف.
- `period_definitions`: `version/updated_at/updated_by_id`.
- `activities`: `version/updated_at`.

## تغييرات المرحلة 6 (ترحيل `drizzle/0003_phase6_affairs_supervision.sql`)
- `student_attendance_events`: `version`، `approved_by_id`.
- `supervision_areas`: `version`.
- فهارس فريدة جزئية: `leave_active_uq` (استئذان نشط واحد للطالبة في اليوم)، `status_change_pending_uq` (طلب انقطاع/نقل واحد قيد الاعتماد لكل قيد).
