#!/bin/sh

set -u

APP_NAME="${BABYREADER_APP_NAME:-babyreader-fnos}"
PKG_ROOT="${TRIM_PKGROOT:-/var/apps/$APP_NAME}"
APP_DEST="${TRIM_APPDEST:-/var/apps/$APP_NAME/target}"
PKG_VAR="${TRIM_PKGVAR:-/var/apps/$APP_NAME/var}"
PKG_ETC="${TRIM_PKGETC:-/var/apps/$APP_NAME/etc}"
PKG_TMP="${TRIM_PKGTMP:-/var/apps/$APP_NAME/tmp}"
SOCKET_FILE="$APP_DEST/app.sock"
MAIN="${TRIM_MAIN:-$PKG_ROOT/cmd/main}"
NODE_BIN="/var/apps/nodejs_v22/target/bin/node"
PACKAGE_USER="${BABYREADER_PACKAGE_USER:-babyreader_fnos}"
FAILURES=0
LIFECYCLE_STATUS_DEFERRED=0

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

check_runtime_root_list() {
  LABEL="$1"
  VALUE="$2"
  if [ -z "$VALUE" ]; then
    skip "$LABEL is not present in the acceptance process environment"
    return 0
  fi

  ROOTS_FILE="${TMPDIR:-/tmp}/babyreader-${LABEL}.$$"
  printf '%s\n' "$VALUE" | tr ':' '\n' | sed '/^[[:space:]]*$/d' > "$ROOTS_FILE"
  ROOT_COUNT="$(wc -l < "$ROOTS_FILE" | tr -d ' ')"
  info "${LABEL}_count=$ROOT_COUNT"
  while IFS= read -r root; do
    if path_readable_as_package "$root"; then
      pass "package user can traverse/read ${LABEL} root: $root"
    else
      CODE=$?
      if [ "$CODE" -eq 125 ]; then
        skip "cannot switch to package user; manually verify ${LABEL} ACL for: $root"
      else
        fail "package user cannot traverse/read ${LABEL} root: $root"
      fi
    fi
  done < "$ROOTS_FILE"
  rm -f "$ROOTS_FILE"
}

check_gateway_root_diagnostics() {
  if [ -z "${BABYREADER_GATEWAY_URL:-}" ] || [ -z "${BABYREADER_GATEWAY_COOKIE:-}" ]; then
    skip "admin root diagnostics require an authenticated fnOS Gateway session"
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1 || [ ! -x "$NODE_BIN" ]; then
    skip "curl and Node.js are required for admin root diagnostics"
    return 0
  fi

  DIAGNOSTICS_BODY="${TMPDIR:-/tmp}/babyreader-diagnostics.$$"
  DIAGNOSTICS_CODE="$(curl -sS -H "Cookie: $BABYREADER_GATEWAY_COOKIE" \
    -o "$DIAGNOSTICS_BODY" -w '%{http_code}' \
    "$BABYREADER_GATEWAY_URL/app/babyreader-fnos/api/diagnostics" 2>/dev/null || true)"
  if [ "$DIAGNOSTICS_CODE" = "403" ]; then
    skip "authenticated fnOS session is not an administrator; root diagnostics skipped"
  elif [ "$DIAGNOSTICS_CODE" = "200" ]; then
    ROOT_COUNTS="$("$NODE_BIN" -e '
      const fs=require("fs");
      const body=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
      const counts=body.rootCounts||{};
      const keys=["configured","accessible","shared","authorized","rejected"];
      if (!keys.every((key)=>Number.isInteger(counts[key]) && counts[key] >= 0)) process.exit(1);
      console.log(keys.map((key)=>key+"="+counts[key]).join(" "));
    ' "$DIAGNOSTICS_BODY" 2>/dev/null || true)"
    if [ -n "$ROOT_COUNTS" ]; then
      pass "authenticated fnOS admin diagnostics returned safe library root counts"
      info "root_counts=$ROOT_COUNTS"
    else
      fail "authenticated fnOS admin diagnostics did not return valid root counts"
    fi
  else
    fail "authenticated fnOS admin diagnostics returned ${DIAGNOSTICS_CODE:-no response}"
  fi
  rm -f "$DIAGNOSTICS_BODY"
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

ai_test_connection() {
  if ! command -v curl >/dev/null 2>&1; then
    fail "curl is required for the authenticated AI connection test"
    printf 'RESULT | FAIL | count=%s\n' "$FAILURES" >&2
    return 1
  fi
  if [ -z "${BABYREADER_GATEWAY_URL:-}" ]; then
    fail "BABYREADER_GATEWAY_URL is required for ai-test"
    printf 'RESULT | FAIL | count=%s\n' "$FAILURES" >&2
    return 1
  fi
  if [ -z "${BABYREADER_GATEWAY_COOKIE:-}" ]; then
    fail "BABYREADER_GATEWAY_COOKIE is required for ai-test"
    printf 'RESULT | FAIL | count=%s\n' "$FAILURES" >&2
    return 1
  fi

  AI_TEST_BODY="${TMPDIR:-/tmp}/babyreader-ai-test.$$"
  AI_TEST_CODE="$(curl -sS -X POST \
    -H "Cookie: $BABYREADER_GATEWAY_COOKIE" \
    -H 'Content-Type: application/json' \
    -d '{}' \
    -o "$AI_TEST_BODY" \
    -w '%{http_code}' \
    "$BABYREADER_GATEWAY_URL/app/babyreader-fnos/api/ai/test-connection" 2>/dev/null || true)"
  if [ "$AI_TEST_CODE" = "200" ]; then
    pass "authenticated fnOS AI provider connection test returned 200"
    info "ai_test_response_status=$AI_TEST_CODE"
  else
    fail "authenticated fnOS AI provider connection test returned ${AI_TEST_CODE:-no response}"
  fi
  rm -f "$AI_TEST_BODY"
  if [ "$FAILURES" -eq 0 ]; then
    printf 'RESULT | PASS\n'
    return 0
  fi
  printf 'RESULT | FAIL | count=%s\n' "$FAILURES" >&2
  return 1
}

check_fts_contract() {
  if [ ! -x "$NODE_BIN" ]; then
    skip "Node.js 22 runtime unavailable; SQLite/FTS5 contract not checked"
    return 0
  fi

  FTS_RESULT="$(AI_FTS_INDEX_ROOT="$PKG_VAR/ai-index" "$NODE_BIN" -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const { DatabaseSync } = require("node:sqlite");
    const root = process.env.AI_FTS_INDEX_ROOT;
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE VIRTUAL TABLE ai_fts_capability_check USING fts5(value);");
    db.close();
    const result = { fts5: true, indexCount: 0, directoryPermission: null, badPermissions: [], temporaryFiles: [], invalidIndexes: [] };
    if (fs.existsSync(root)) {
      result.directoryPermission = (fs.statSync(root).mode & 0o777).toString(8);
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.name.endsWith(".tmp")) result.temporaryFiles.push(entry.name);
        if (!entry.isFile() || !entry.name.endsWith(".sqlite")) continue;
        result.indexCount += 1;
        const file = path.join(root, entry.name);
        const mode = fs.statSync(file).mode & 0o777;
        if (mode !== 0o600) result.badPermissions.push(`${entry.name}:${mode.toString(8)}`);
        let index;
        try {
          index = new DatabaseSync(file);
          const tables = index.prepare("SELECT name FROM sqlite_master WHERE type = ? AND name IN (?, ?, ?)").all("table", "ai_meta", "ai_chunk_text", "ai_chunks");
          if (tables.length !== 3) result.invalidIndexes.push(entry.name);
        } catch {
          result.invalidIndexes.push(entry.name);
        } finally {
          index?.close();
        }
      }
    }
    if (result.directoryPermission && result.directoryPermission !== "700"
      || result.badPermissions.length || result.temporaryFiles.length || result.invalidIndexes.length) process.exitCode = 1;
    console.log(JSON.stringify(result));
  ' 2>/dev/null)"
  FTS_STATUS=$?
  if [ "$FTS_STATUS" -eq 0 ]; then
    pass "SQLite FTS5 runtime and index contract passed"
    info "fts=$(printf '%s' "$FTS_RESULT")"
    if printf '%s' "$FTS_RESULT" | grep -q '"indexCount":0'; then
      skip "no SQLite book index exists yet; run one AI question before checking index permissions"
    else
      pass "existing SQLite indexes use 600 permissions and contain required tables"
    fi
  else
    fail "SQLite FTS5 runtime or existing index contract failed: ${FTS_RESULT:-no output}"
  fi
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
    if TRIM_APPDEST="$APP_DEST" \
      TRIM_PKGVAR="$PKG_VAR" \
      TRIM_PKGETC="$PKG_ETC" \
      TRIM_PKGTMP="$PKG_TMP" \
      "$MAIN" status; then
      pass "cmd/main status reports running"
    else
      STATUS=$?
      if [ "$STATUS" -eq 3 ] && [ -S "$SOCKET_FILE" ]; then
        LIFECYCLE_STATUS_DEFERRED=1
        skip "cmd/main status returned 3 while the target socket exists; verifying service health"
      else
        fail "cmd/main status failed with code $STATUS"
      fi
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
      if [ "$LIFECYCLE_STATUS_DEFERRED" -eq 1 ]; then
        pass "service is running under fnOS supervisor; socket health reconciled cmd/main status 3"
      fi
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

  check_runtime_root_list "TRIM_DATA_ACCESSIBLE_PATHS" "${TRIM_DATA_ACCESSIBLE_PATHS:-}"
  check_runtime_root_list "TRIM_DATA_SHARE_PATHS" "${TRIM_DATA_SHARE_PATHS:-}"

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
      check_gateway_root_diagnostics
    else
      skip "BABYREADER_GATEWAY_URL supplied without BABYREADER_GATEWAY_COOKIE"
    fi
  else
    skip "Gateway identity injection requires an authenticated fnOS session"
  fi

  check_fts_contract

  if [ "$FAILURES" -eq 0 ]; then
    printf 'RESULT | PASS\n'
    return 0
  fi
  printf 'RESULT | FAIL | count=%s\n' "$FAILURES" >&2
  return 1
}

case "${1:-check}" in
  check) check_device ;;
  ai-test) ai_test_connection ;;
  snapshot) snapshot "${2:-}" ;;
  compare) compare_snapshots "${2:-}" "${3:-}" ;;
  *)
    printf 'usage: %s {check|ai-test|snapshot <file>|compare <before> <after>}\n' "$0" >&2
    exit 2
    ;;
esac
