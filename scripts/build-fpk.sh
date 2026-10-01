#!/bin/bash

set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_ID="${ZHENSHU_BUILD_ID:-$(date -u +%Y%m%d%H%M%S)}"
BUILD_ROOT="${ZHENSHU_BUILD_ROOT:-$ROOT/.build/fpk-$BUILD_ID}"
# One output directory per released version; rebuilding a version is refused
# below so a version number always identifies exactly one package.
VERSION="$(sed -n 's/^version=//p' "$ROOT/manifest" | tr -d '\r')"
DIST_DIR="${ZHENSHU_BUILD_DIST_DIR:-$ROOT/dist-v$VERSION}"

if ! command -v fnpack >/dev/null 2>&1; then
  printf '%s\n' '错误：未找到 fnpack。请安装与当前平台匹配的 fnpack 后重试。' >&2
  exit 1
fi

case "$BUILD_ROOT" in
  "$ROOT"/.build/*) ;;
  *) printf '%s\n' '错误：FPK staging 目录必须位于仓库 .build/ 下。' >&2; exit 1 ;;
esac
case "$DIST_DIR" in
  "$ROOT"/dist-*) ;;
  *) printf '%s\n' '错误：FPK 输出目录必须是仓库内 dist-* 隔离目录。' >&2; exit 1 ;;
esac
if [ -e "$BUILD_ROOT" ] || [ -e "$DIST_DIR" ]; then
  printf '错误：隔离构建目录已存在，拒绝覆盖：%s 或 %s\n' "$BUILD_ROOT" "$DIST_DIR" >&2
  exit 1
fi

mkdir -p "$BUILD_ROOT" "$DIST_DIR"

for item in app cmd config wizard manifest ICON.PNG ICON_256.PNG LICENSE package.json package-lock.json README.md; do
  if [ -e "$ROOT/$item" ]; then
    cp -R "$ROOT/$item" "$BUILD_ROOT/"
  fi
done

mkdir -p "$BUILD_ROOT/app/docs"
cp "$ROOT/docs/FNOS_DEVICE_ACCEPTANCE.md" "$BUILD_ROOT/app/docs/"
cp "$ROOT/README.md" "$BUILD_ROOT/app/docs/"
cp "$ROOT/scripts/fnos-device-acceptance.sh" "$BUILD_ROOT/app/docs/"

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
            if normalized.lower().endswith(('.cmd', '.bat', '.ps1', '.exe', '.dll', '.node', '.map')):
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
