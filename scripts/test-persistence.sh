#!/usr/bin/env bash
# اختبار الاستمرارية والنسخ الاحتياطي على قاعدة school_test:
# 1) كتابة سجل  2) إعادة تشغيل خادم PostgreSQL  3) قراءة السجل
# 4) نسخة احتياطية pg_dump  5) حذف القاعدة وإعادة إنشائها  6) استعادة النسخة  7) قراءة السجل
set -euo pipefail
cd "$(dirname "$0")/.."
ENV=.env.test
MARK="$(date +%s)"
run() { npx dotenv -e $ENV -- npx tsx scripts/persist-check.ts "$@"; }
export PGPASSWORD=devpass
mkdir -p backups

echo "1) كتابة سجل"; run write "$MARK"
echo "2) إعادة تشغيل PostgreSQL"; service postgresql restart >/dev/null; sleep 2; pg_isready -q
echo "3) القراءة بعد إعادة التشغيل"; run read "$MARK"
echo "4) نسخة احتياطية"; pg_dump -h localhost -U school -Fc school_test -f backups/test-backup.dump
echo "5) حذف القاعدة"; su postgres -c "psql -q -c 'DROP DATABASE school_test WITH (FORCE);' -c 'CREATE DATABASE school_test OWNER school;'"
if run read "$MARK" 2>/dev/null; then echo "خطأ: السجل موجود بعد الحذف"; exit 1; fi
echo "6) الاستعادة"; pg_restore -h localhost -U school -d school_test --no-owner backups/test-backup.dump
echo "7) القراءة بعد الاستعادة"; run read "$MARK"
rm -f backups/test-backup.dump
echo "✓ اختبار الاستمرارية والاستعادة ناجح"
