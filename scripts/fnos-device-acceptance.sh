#!/bin/sh

set -u

APP_NAME="${BABYREADER_APP_NAME:-babyreader-fnos}"
APP_DEST="${TRIM_APPDEST:-/var/apps/$APP_NAME/target}"
PKG_VAR="${TRIM_PKGVAR:-/var/apps/$APP_NAME/var}"
PKG_ETC="${TRIM_PKGETC:-/var/apps/$APP_NAME/etc}"
PKG_TMP="${TRIM_PKGTMP:-/var/apps/$APP_NAME/tmp}"
SOCKET_FILE="$APP_DEST/app.sock"
MAIN="$APP_DEST/cmd/main"
NODE_BIN="/var/apps/nodejs_v22/target/bin/node"
PACKAGE_USER="${BABYREADER_PACKAGE_USER:-babyreader_fnos}"
FAILURES=0

pass() {
  printf 'PASS | %s\n' "$*"
}

fail() {
  printf 'FAIL | %s\n' "$*" >&2
  FAILURES=$((FAILURES + 1))
}

skip() {
  printf 'SKIP | %s\n' "$*"
}

info() {
  printf 'INFO | %s\n' "$*"
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    printf 'unavailable'
  fi
}

path_readable_as_package() {
  TARGET_PATH="$1"
  if [ "$(id -un 2>/dev/null || true)" = "$PACKAGE_USER" ]; then
    [ -r "$TARGET_PATH" ] && [ -x "$TARGET_PATH" ]
  elif command -v runuser >/dev/null 2>&1; then
    runuser -u "$PACKAGE_USER" -- test -r "$TARGET_PATH" &&
      runuser -u "$PACKAGE_USER" -- test -x "$TARGET_PATH"
  else
    return 125
  fi
}

snapshot() {
  OUTPUT="${1:-}"
  if [ -z "$OUTPUT" ]; then
    printf 'usage: %s snapshot <output-file>\n' "$0" >&2
    exit 2
  fi
  {
    printf 'schema=1\n'
    printf 'timestamp_utc=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date)"
    printf 'arch=%s\n' "$(uname -m)"
    printf 'app_dest=%s\n' "$APP_DEST"
    printf 'pkg_var=%s\n' "$PKG_VAR"
    if [ -f "$APP_DEST/manifest" ]; then
      printf 'manifest_sha256=%s\n' "$(sha256_of "$APP_DEST/manifest")"
    fi
    if [ -f "$PKG_ETC/settings.json" ]; then
      printf 'settings_sha256=%s\n' "$(sha256_of "$PKG_ETC/settings.json")"
    fi
    if [ -d "$PKG_VAR/users" ]; then
      find "$PKG_VAR/users" -type f -name 'reading-state.json' -print 2>/dev/null |
        sort |
        while IFS= read -r file; do
          printf 'state=%s|%s\n' "$file" "$(sha256_of "$file")"
        done
    fi
  } > "$OUTPUT"
  printf 'Snapshot written: %s\n' "$OUTPUT"
}

compare_snapshots() {
  BEFORE="${1:-}"
  AFTER="${2:-}"
  if [ -z "$BEFORE" ] || [ -z "$AFTER" ]; then
    printf 'usage: %s compare <before> <after>\n' "$0" >&2
    exit 2
  fi
  BEFORE_DATA="${TMPDIR:-/tmp}/babyreader-before-data.$$"
  AFTER_DATA="${TMPDIR:-/tmp}/babyreader-after-data.$$"
  grep -E '^(settings_sha256=|state=)' "$BEFORE" > "$BEFORE_DATA" || true
  grep -E '^(settings_sha256=|state=)' "$AFTER" > "$AFTER_DATA" || true
  if diff -u "$BEFORE_DATA" "$AFTER_DATA"; then
    pass "upgrade user settings and reading-state hashes unchanged"
  else
    fail "upgrade changed user settings or reading-state data"
  fi
  rm -f "$BEFORE_DATA" "$AFTER_DATA"
  [ "$FAILURES" -eq 0 ]
}

check_device() {
  ARCH="$(uname -m)"
  info "architecture=$ARCH"
  case "$ARCH" in
    x86_64|amd64|aarch64|arm64) pass "supported CPU architecture: $ARCH" ;;
    *) fail "unexpected CPU architecture: $ARCH" ;;
  esac

  if [ -r /etc/os-release ]; then
    info "os=$(tr '\n' ' ' < /etc/os-release | sed 's/[[:space:]][[:space:]]*/ /g')"
  fi

  if [ -x "$NODE_BIN" ]; then
    NODE_VERSION="$("$NODE_BIN" --version 2>/dev/null || true)"
    case "$NODE_VERSION" in
      v22.*) pass "Node.js runtime: $NODE_VERSION" ;;
      *) fail "expected Node.js 22, got: ${NODE_VERSION:-unknown}" ;;
    esac
  else
    fail "Node.js 22 runtime missing: $NODE_BIN"
  fi

  if [ -x "$MAIN" ]; then
    if "$MAIN" status; then
      pass "cmd/main status reports running"
    else
      STATUS=$?
      fail "cmd/main status failed with code $STATUS"
    fi
  else
    fail "lifecycle entry missing or not executable: $MAIN"
  fi

  if [ -S "$SOCKET_FILE" ]; then
    pass "Unix socket exists: $SOCKET_FILE"
    if command -v stat >/dev/null 2>&1; then
      info "socket_stat=$(stat -c '%U:%G %a %n' "$SOCKET_FILE" 2>/dev/null || stat "$SOCKET_FILE" 2>/dev/null || true)"
    fi
  else
    fail "Unix socket missing: $SOCKET_FILE"
  fi

  if command -v curl >/dev/null 2>&1 && [ -S "$SOCKET_FILE" ]; then
    HEALTH_BODY="${TMPDIR:-/tmp}/babyreader-health.$$"
    HEALTH_CODE="$(curl -sS --unix-socket "$SOCKET_FILE" -o "$HEALTH_BODY" -w '%{http_code}' \
      "http://localhost/app/babyreader-fnos/api/health" 2>/dev/null || true)"
    if [ "$HEALTH_CODE" = "200" ]; then
      pass "direct Unix-socket health endpoint returned 200"
      info "health=$(cat "$HEALTH_BODY" 2>/dev/null || true)"
    else
      fail "direct Unix-socket health endpoint returned ${HEALTH_CODE:-no response}"
    fi
    rm -f "$HEALTH_BODY"

    SESSION_CODE="$(curl -sS --unix-socket "$SOCKET_FILE" -o /dev/null -w '%{http_code}' \
      "http://localhost/app/babyreader-fnos/api/session" 2>/dev/null || true)"
    if [ "$SESSION_CODE" = "401" ]; then
      pass "direct session request without gateway identity is rejected with 401"
    else
      fail "direct session request without gateway identity expected 401, got ${SESSION_CODE:-no response}"
    fi
  else
    skip "curl or Unix socket unavailable; direct HTTP contract not checked"
  fi

  for path in "$APP_DEST" "$PKG_VAR" "$PKG_ETC" "$PKG_TMP"; do
    if [ -e "$path" ]; then
      info "path=$(ls -ld "$path" 2>/dev/null || true)"
    else
      fail "expected runtime path missing: $path"
    fi
  done

  if [ -f "$PKG_ETC/settings.json" ] && [ -x "$NODE_BIN" ]; then
    ROOTS_FILE="${TMPDIR:-/tmp}/babyreader-roots.$$"
    "$NODE_BIN" -e '
      const fs=require("fs");
      const p=process.argv[1];
      const cfg=JSON.parse(fs.readFileSync(p,"utf8"));
      for(const root of cfg.libraryRoots||[]) console.log(root);
    ' "$PKG_ETC/settings.json" > "$ROOTS_FILE" 2>/dev/null || true
    if [ ! -s "$ROOTS_FILE" ]; then
      skip "settings.json contains no libraryRoots"
    else
      while IFS= read -r root; do
        [ -n "$root" ] || continue
        if path_readable_as_package "$root"; then
          pass "package user can traverse/read library root: $root"
        else
          CODE=$?
          if [ "$CODE" -eq 125 ]; then
            skip "cannot switch to package user; manually verify ACL for: $root"
          else
            fail "package user cannot traverse/read library root: $root"
          fi
        fi
      done < "$ROOTS_FILE"
    fi
    rm -f "$ROOTS_FILE"
  else
    skip "settings.json or Node.js unavailable; ACL roots not checked"
  fi

  if [ -n "${BABYREADER_GATEWAY_URL:-}" ]; then
    if [ -n "${BABYREADER_GATEWAY_COOKIE:-}" ]; then
      GATEWAY_BODY="${TMPDIR:-/tmp}/babyreader-session.$$"
      GATEWAY_CODE="$(curl -sS -H "Cookie: $BABYREADER_GATEWAY_COOKIE" -o "$GATEWAY_BODY" -w '%{http_code}' \
        "$BABYREADER_GATEWAY_URL/app/babyreader-fnos/api/session" 2>/dev/null || true)"
      if [ "$GATEWAY_CODE" = "200" ]; then
        pass "authenticated fnOS Gateway session endpoint returned 200"
        info "gateway_session=$(cat "$GATEWAY_BODY" 2>/dev/null || true)"
      else
        fail "authenticated fnOS Gateway session endpoint returned ${GATEWAY_CODE:-no response}"
      fi
      rm -f "$GATEWAY_BODY"
    else
      skip "BABYREADER_GATEWAY_URL supplied without BABYREADER_GATEWAY_COOKIE"
    fi
  else
    skip "Gateway identity injection requires an authenticated fnOS session"
  fi

  if [ "$FAILURES" -eq 0 ]; then
    printf 'RESULT | PASS\n'
    return 0
  fi
  printf 'RESULT | FAIL | count=%s\n' "$FAILURES" >&2
  return 1
}

case "${1:-check}" in
  check) check_device ;;
  snapshot) snapshot "${2:-}" ;;
  compare) compare_snapshots "${2:-}" "${3:-}" ;;
  *)
    printf 'usage: %s {check|snapshot <file>|compare <before> <after>}\n' "$0" >&2
    exit 2
    ;;
esac
