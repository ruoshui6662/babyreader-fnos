#!/bin/bash

set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_ROOT="$ROOT/.build/fpk-root"
DIST_DIR="$ROOT/dist"

if ! command -v fnpack >/dev/null 2>&1; then
  printf '%s\n' '错误：未找到 fnpack。请安装与当前平台匹配的 fnpack 后重试。' >&2
  exit 1
fi

rm -rf "$BUILD_ROOT"
mkdir -p "$BUILD_ROOT" "$DIST_DIR"
rm -f "$ROOT"/*.fpk "$DIST_DIR"/*.fpk

for item in app cmd config wizard docs manifest ICON.PNG ICON_256.PNG LICENSE UPSTREAM_BASELINES package.json package-lock.json README.md CHANGELOG_WORK.md UI_INTERFACE_MAP.md; do
  if [ -e "$ROOT/$item" ]; then
    cp -R "$ROOT/$item" "$BUILD_ROOT/"
  fi
done

mkdir -p "$BUILD_ROOT/app/docs"
if [ -d "$ROOT/docs" ]; then
  cp -R "$ROOT/docs/." "$BUILD_ROOT/app/docs/"
fi
for document in README.md CHANGELOG_WORK.md UI_INTERFACE_MAP.md; do
  cp "$ROOT/$document" "$BUILD_ROOT/app/docs/"
done

cp -R "$ROOT/tests" "$BUILD_ROOT/app/tests"
cp "$BUILD_ROOT/package.json" "$BUILD_ROOT/package-lock.json" "$BUILD_ROOT/app/server/"
npm ci --omit=dev --ignore-scripts --prefix "$BUILD_ROOT/app/server"
find "$BUILD_ROOT/cmd" -type f -exec chmod 755 {} \;

node "$ROOT/scripts/validate-structure.js"
(
  cd "$DIST_DIR"
  fnpack build --directory "$BUILD_ROOT"
)

FPK_FILE="$(find "$DIST_DIR" -maxdepth 1 -type f -name '*.fpk' -print -quit)"
if [ -z "$FPK_FILE" ]; then
  printf '%s\n' '错误：fnpack 已执行，但未找到生成的 .fpk 文件。' >&2
  exit 1
fi

python - "$FPK_FILE" <<'PY'
import io
import os
import sys
import tarfile

archive = sys.argv[1]
temporary = archive + '.tmp'


def normalize(member, executable=False):
    member.uid = 0
    member.gid = 0
    member.uname = ''
    member.gname = ''
    if member.isdir():
        member.mode = 0o755
    elif member.isfile():
        member.mode = 0o755 if executable else 0o644
    return member


def repack_app(payload):
    output = io.BytesIO()
    with tarfile.open(fileobj=io.BytesIO(payload), mode='r:gz') as source, tarfile.open(
        fileobj=output, mode='w:gz', format=tarfile.GNU_FORMAT
    ) as target:
        for member in source.getmembers():
            normalized = member.name.lstrip('./')
            parts = normalized.split('/')
            if any(part.startswith('.') for part in parts):
                continue
            if normalized.lower().endswith(('.cmd', '.bat', '.ps1', '.exe', '.dll', '.node')):
                continue
            stream = source.extractfile(member) if member.isfile() else None
            target.addfile(normalize(member), stream)
    return output.getvalue()


with tarfile.open(archive, 'r:gz') as source, tarfile.open(
    temporary, 'w:gz', format=tarfile.GNU_FORMAT
) as target:
    for member in source.getmembers():
        normalized = member.name.lstrip('./')
        if normalized == 'app.tgz':
            payload = repack_app(source.extractfile(member).read())
            member.size = len(payload)
            target.addfile(normalize(member), io.BytesIO(payload))
            continue
        stream = source.extractfile(member) if member.isfile() else None
        target.addfile(normalize(member, member.isfile() and normalized.startswith('cmd/')), stream)
os.replace(temporary, archive)
PY

python "$ROOT/scripts/write-build-provenance.py" "$FPK_FILE" "$DIST_DIR/build-provenance.json"

printf 'FPK 已生成：%s\n' "$FPK_FILE"
printf '构建溯源：%s\n' "$DIST_DIR/build-provenance.json"
