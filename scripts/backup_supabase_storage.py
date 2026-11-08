#!/usr/bin/env python3
"""Download every object from one private Supabase Storage bucket for an encrypted backup."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

DEFAULT_LIMIT = 100
MAX_RETRIES = 5
CHUNK_SIZE = 1024 * 1024


def _safe_path(root: Path, relative: str) -> Path:
    if not relative or relative.startswith(("/", "\\")):
        raise ValueError("Storage returned an empty or absolute object path.")
    parts = relative.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise ValueError("Storage returned an unsafe object path.")
    target = (root / Path(*parts)).resolve()
    try:
        target.relative_to(root.resolve())
    except ValueError as exc:
        raise ValueError("Storage object path escapes the backup directory.") from exc
    return target


def _request(url: str, *, method: str, api_key: str, payload: dict[str, Any] | None = None) -> tuple[Any, bytes]:
    headers = {
        "apikey": api_key,
        "Authorization": "Bearer " + api_key,
        "User-Agent": "gfs-supabase-encrypted-backup/1.0",
    }
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    last_error: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.headers, response.read()
        except urllib.error.HTTPError as exc:
            if exc.code not in {408, 425, 429, 500, 502, 503, 504} or attempt == MAX_RETRIES - 1:
                detail = exc.read(2048).decode("utf-8", errors="replace")
                raise RuntimeError(f"Supabase Storage returned HTTP {exc.code}: {detail}") from exc
            last_error = exc
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt == MAX_RETRIES - 1:
                raise RuntimeError("Supabase Storage request failed after retries.") from exc
            last_error = exc
        time.sleep(min(2**attempt, 16))
    raise RuntimeError("Supabase Storage request failed.") from last_error


def _list_folder(base_url: str, bucket: str, api_key: str, prefix: str) -> list[dict[str, Any]]:
    url = base_url.rstrip("/") + "/storage/v1/object/list/" + urllib.parse.quote(bucket, safe="")
    items: list[dict[str, Any]] = []
    offset = 0
    while True:
        _, body = _request(
            url,
            method="POST",
            api_key=api_key,
            payload={"prefix": prefix, "limit": DEFAULT_LIMIT, "offset": offset,
                     "sortBy": {"column": "name", "order": "asc"}},
        )
        try:
            page = json.loads(body or b"[]")
        except json.JSONDecodeError as exc:
            raise RuntimeError("Supabase Storage returned invalid JSON while listing objects.") from exc
        if not isinstance(page, list):
            raise RuntimeError("Supabase Storage list response was not a JSON array.")
        items.extend(page)
        if len(page) < DEFAULT_LIMIT:
            break
        offset += len(page)
    return items


def _download_object(base_url: str, bucket: str, api_key: str, object_key: str,
                     destination: Path) -> dict[str, Any]:
    url = (
        base_url.rstrip("/") + "/storage/v1/object/authenticated/"
        + urllib.parse.quote(bucket, safe="") + "/" + urllib.parse.quote(object_key, safe="/")
    )
    headers, body = _request(url, method="GET", api_key=api_key)
    destination.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    size = 0
    with destination.open("wb") as output:
        view = memoryview(body)
        while size < len(view):
            end = min(size + CHUNK_SIZE, len(view))
            chunk = view[size:end]
            output.write(chunk)
            digest.update(chunk)
            size = end
    content_type = headers.get("Content-Type", "") if headers is not None else ""
    return {"path": object_key, "size_bytes": destination.stat().st_size,
            "sha256": digest.hexdigest(), "content_type": content_type}


def backup_bucket(base_url: str, bucket: str, api_key: str, output_dir: Path) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest: list[dict[str, Any]] = []
    visited_prefixes: set[str] = set()

    def walk(prefix: str) -> None:
        if prefix in visited_prefixes:
            raise RuntimeError("Storage returned a repeated folder path.")
        visited_prefixes.add(prefix)
        for item in _list_folder(base_url, bucket, api_key, prefix):
            name = item.get("name")
            if not isinstance(name, str) or not name or "/" in name or "\\" in name:
                raise RuntimeError("Storage returned an invalid object or folder name.")
            object_key = prefix + name
            if item.get("id") is None:
                walk(object_key + "/")
            else:
                destination = _safe_path(output_dir, object_key)
                manifest.append(_download_object(base_url, bucket, api_key, object_key, destination))

    walk("")
    manifest.sort(key=lambda row: row["path"])
    result = {"bucket": bucket, "object_count": len(manifest),
              "total_size_bytes": sum(row["size_bytes"] for row in manifest), "objects": manifest}
    (output_dir / "manifest.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bucket", default="gfs-private-documents")
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    base_url = os.environ.get("SUPABASE_URL", "").strip()
    api_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not base_url or not api_key:
        print("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable.", file=sys.stderr)
        return 2
    if not base_url.startswith("https://"):
        print("SUPABASE_URL must use HTTPS.", file=sys.stderr)
        return 2
    try:
        result = backup_bucket(base_url, args.bucket, api_key, args.output_dir)
    except Exception as exc:  # noqa: BLE001 - fail closed in backup workflow
        print(f"Storage backup failed: {exc}", file=sys.stderr)
        return 1
    print(f"Backed up {result['object_count']} object(s), {result['total_size_bytes']} byte(s), bucket={args.bucket}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
