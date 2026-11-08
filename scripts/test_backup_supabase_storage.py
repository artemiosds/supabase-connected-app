import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backup_supabase_storage import _safe_path, backup_bucket


class FakeHeaders(dict):
    pass


class FakeResponse:
    def __init__(self, body: bytes, headers=None):
        self._body = body
        self.headers = FakeHeaders(headers or {})

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self, amount=-1):
        return self._body if amount < 0 else self._body[:amount]


class BackupStorageTests(unittest.TestCase):
    def test_safe_path_rejects_parent_traversal(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                _safe_path(Path(tmp), "../outside.txt")

    def test_recursive_backup_downloads_files_and_writes_manifest(self):
        def fake_urlopen(request, timeout=0):
            url = request.full_url
            if request.method == "POST" and url.endswith("/object/list/private-bucket"):
                payload = json.loads(request.data.decode("utf-8"))
                if payload["prefix"] == "":
                    body = [{"name": "tenant-a", "id": None, "metadata": None}]
                elif payload["prefix"] == "tenant-a/":
                    body = [{"name": "contract.pdf", "id": "object-1", "metadata": {"size": 7}}]
                else:
                    body = []
                return FakeResponse(json.dumps(body).encode("utf-8"))
            if request.method == "GET" and url.endswith("/tenant-a/contract.pdf"):
                return FakeResponse(b"PDFDATA", {"Content-Type": "application/pdf"})
            raise AssertionError(f"Unexpected request: {request.method} {url}")

        with tempfile.TemporaryDirectory() as tmp:
            with patch("urllib.request.urlopen", side_effect=fake_urlopen):
                result = backup_bucket("https://example.supabase.co", "private-bucket",
                                       "test-service-key", Path(tmp))
            saved = Path(tmp) / "tenant-a" / "contract.pdf"
            self.assertEqual(saved.read_bytes(), b"PDFDATA")
            self.assertEqual(result["object_count"], 1)
            self.assertEqual(result["total_size_bytes"], 7)
            manifest = json.loads((Path(tmp) / "manifest.json").read_text("utf-8"))
            self.assertEqual(manifest["objects"][0]["path"], "tenant-a/contract.pdf")
            self.assertEqual(manifest["objects"][0]["content_type"], "application/pdf")


if __name__ == "__main__":
    unittest.main()
