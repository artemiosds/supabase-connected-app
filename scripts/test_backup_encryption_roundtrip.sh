#!/usr/bin/env bash
set -euo pipefail

for command in age age-keygen sha256sum tar python3; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Missing required command: $command" >&2
    exit 1
  }
done

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
backup_dir="$work_dir/backup"
restored_dir="$work_dir/restored"
mkdir -p "$backup_dir/database" "$backup_dir/storage/gfs-private-documents/tenant-fixture" "$restored_dir"

printf '%s\n' 'CREATE TABLE synthetic_backup_probe(id integer PRIMARY KEY);' > "$backup_dir/database/schema.sql"
printf '%s\n' 'INSERT INTO synthetic_backup_probe VALUES (20261113);' > "$backup_dir/database/data.sql"
printf '%s\n' 'CREATE ROLE synthetic_backup_probe NOLOGIN;' > "$backup_dir/database/roles.sql"
printf '%s\n' 'Only synthetic fixture content; no SMS2 or production data.' > "$backup_dir/RESTORE-NOTES.txt"
printf '%s\n' 'Synthetic private DOCX fixture bytes for encrypted package verification.' > "$backup_dir/storage/gfs-private-documents/tenant-fixture/model-v1.docx"

document="$backup_dir/storage/gfs-private-documents/tenant-fixture/model-v1.docx"
document_sha="$(sha256sum "$document" | awk '{print $1}')"
document_size="$(wc -c < "$document" | tr -d ' ')"
python3 - "$backup_dir/storage/gfs-private-documents/manifest.json" "$document_sha" "$document_size" <<'PY'
import json
import pathlib
import sys

path, digest, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
manifest = {
    "bucket": "gfs-private-documents",
    "object_count": 1,
    "total_size_bytes": size,
    "objects": [{
        "path": "tenant-fixture/model-v1.docx",
        "size_bytes": size,
        "sha256": digest,
        "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }],
}
pathlib.Path(path).write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
PY

age-keygen -o "$work_dir/age-identity.txt" >/dev/null 2>&1
recipient="$(age-keygen -y "$work_dir/age-identity.txt")"
tar -czf "$work_dir/sms2-fixture.tar.gz" -C "$backup_dir" .
age -r "$recipient" -o "$work_dir/sms2-fixture.tar.gz.age" "$work_dir/sms2-fixture.tar.gz"
sha256sum "$work_dir/sms2-fixture.tar.gz.age" > "$work_dir/sms2-fixture.tar.gz.age.sha256"
sha256sum --check "$work_dir/sms2-fixture.tar.gz.age.sha256"
age -d -i "$work_dir/age-identity.txt" -o "$work_dir/restored.tar.gz" "$work_dir/sms2-fixture.tar.gz.age"
tar -xzf "$work_dir/restored.tar.gz" -C "$restored_dir"

for relative_path in   "database/schema.sql"   "database/data.sql"   "database/roles.sql"   "RESTORE-NOTES.txt"   "storage/gfs-private-documents/tenant-fixture/model-v1.docx"; do
  cmp "$backup_dir/$relative_path" "$restored_dir/$relative_path"
done

python3 - "$restored_dir" <<'PY'
import hashlib
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
manifest_path = root / "storage/gfs-private-documents/manifest.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
assert manifest["bucket"] == "gfs-private-documents"
assert manifest["object_count"] == 1
for item in manifest["objects"]:
    target = root / "storage/gfs-private-documents" / item["path"]
    content = target.read_bytes()
    assert len(content) == item["size_bytes"]
    assert hashlib.sha256(content).hexdigest() == item["sha256"]
PY

if [[ -n "${BACKUP_RESTORE_DATABASE_URL:-}" ]]; then
  psql "$BACKUP_RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$restored_dir/database/roles.sql"
  psql "$BACKUP_RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$restored_dir/database/schema.sql"
  psql "$BACKUP_RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$restored_dir/database/data.sql"
  restored_value="$(psql "$BACKUP_RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc \
    "SELECT id FROM backup_fixture.synthetic_backup_probe WHERE id = 20261113")"
  test "$restored_value" = "20261113"
  psql "$BACKUP_RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -c \
    "DROP SCHEMA backup_fixture CASCADE; DROP ROLE synthetic_backup_probe;"
  echo "PASS: decrypted synthetic SQL schema, data and role restored and queried in disposable PostgreSQL."
fi

echo "PASS: synthetic backup package encrypted, checksummed, decrypted and restored byte-for-byte."
if [[ -n "${BACKUP_RESTORE_DATABASE_URL:-}" ]]; then
  echo "PASS: synthetic database restore was verified in an isolated schema on disposable local Supabase."
else
  echo "NOTE: this validates package integrity only; set BACKUP_RESTORE_DATABASE_URL to additionally verify SQL restore."
fi
echo "NOTE: this synthetic test does not access SMS2 or prove a live SMS2 backup restore."
