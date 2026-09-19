#!/usr/bin/env python3

import hashlib
import io
import json
import os
import platform
import subprocess
import sys
import tarfile
from datetime import datetime, timezone


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def command_output(args, default="unknown"):
    try:
        return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT).strip()
    except Exception:
        return default


def manifest_version(root):
    with open(os.path.join(root, "manifest"), "r", encoding="utf-8") as handle:
        for line in handle:
            if line.startswith("version="):
                return line.split("=", 1)[1].strip()
    return "unknown"


def validate_member_names(archive, label):
    for member in archive.getmembers():
        normalized = member.name.replace("\\", "/").lstrip("./")
        parts = [part for part in normalized.split("/") if part]
        if member.name.startswith(("/", "\\")) or any(part == ".." for part in parts):
            raise ValueError(f"{label} contains unsafe member path: {member.name}")


def read_required_member(archive, name, label):
    try:
        member = archive.getmember(name)
    except KeyError as error:
        raise ValueError(f"{label} is missing required member: {name}") from error
    if not member.isfile():
        raise ValueError(f"{label} required member is not a regular file: {name}")
    stream = archive.extractfile(member)
    if stream is None:
        raise ValueError(f"{label} required member cannot be read: {name}")
    return stream.read()


def archive_evidence(fpk_path):
    required_outer = ("manifest", "app.tgz", "cmd/main")
    required_app = (
        "server/index.js",
        "server/package-lock.json",
        "ui/index.html",
        "ui/styles.css",
        "ui/app.js",
        "ui/core/state.js",
        "ui/core/utils.js",
        "ui/core/api.js",
        "ui/core/user-state.js",
        "ui/reader/epub.js",
        "ui/reader/document.js",
        "ui/reader/editor.js",
        "ui/reader/highlights.js",
        "ui/reader/actions.js",
        "ui/reader/progress.js",
        "ui/reader/pagination.js",
        "ui/reader/settings.js",
        "ui/reader/navigation.js",
        "ui/reader/lifecycle.js",
        "ui/shell/drawer.js",
        "ui/library/view.js",
    )
    evidence = {
        "outer_sha256": sha256_file(fpk_path),
        "members": {},
        "app_members": {},
    }
    with tarfile.open(fpk_path, "r:gz") as archive:
        validate_member_names(archive, "FPK")
        outer_payloads = {}
        for member_name in required_outer:
            payload = read_required_member(archive, member_name, "FPK")
            outer_payloads[member_name] = payload
            evidence["members"][member_name] = {
                "size": len(payload),
                "sha256": sha256_bytes(payload),
            }

        with tarfile.open(fileobj=io.BytesIO(outer_payloads["app.tgz"]), mode="r:gz") as app_archive:
            validate_member_names(app_archive, "app.tgz")
            for candidate in required_app:
                nested_payload = read_required_member(app_archive, candidate, "app.tgz")
                evidence["app_members"][candidate] = {
                    "size": len(nested_payload),
                    "sha256": sha256_bytes(nested_payload),
                }
    return evidence


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: write-build-provenance.py <fpk> <output-json>")

    fpk_path = os.path.abspath(sys.argv[1])
    output_path = os.path.abspath(sys.argv[2])
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    git_commit = os.environ.get("GITHUB_SHA") or command_output(
        ["git", "-C", root, "rev-parse", "HEAD"]
    )
    git_status = command_output(["git", "-C", root, "status", "--porcelain"], "")
    fnpack_path = command_output(["sh", "-c", "command -v fnpack"], "unknown")

    payload = {
        "schema": 1,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "artifact": os.path.basename(fpk_path),
        "manifest_version": manifest_version(root),
        "source": {
            "git_commit": git_commit,
            "git_ref": os.environ.get("GITHUB_REF", ""),
            "git_dirty": bool(git_status),
        },
        "toolchain": {
            "node": command_output(["node", "--version"]),
            "npm": command_output(["npm", "--version"]),
            "python": platform.python_version(),
            "fnpack_declared_version": os.environ.get("FNPACK_VERSION", "unversioned-local"),
            "fnpack_path": fnpack_path,
            "fnpack_sha256": sha256_file(fnpack_path) if os.path.isfile(fnpack_path) else "unknown",
            "platform": platform.platform(),
            "machine": platform.machine(),
        },
        "archive": archive_evidence(fpk_path),
    }

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
    with open(fpk_path + ".sha256", "w", encoding="utf-8", newline="\n") as handle:
        handle.write(f'{payload["archive"]["outer_sha256"]}  {os.path.basename(fpk_path)}\n')


if __name__ == "__main__":
    main()
