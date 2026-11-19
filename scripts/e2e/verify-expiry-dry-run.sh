#!/usr/bin/env bash
# Validates the real expiry Edge Function against a disposable Supabase database.
# Intentionally exercises only the default/explicit dry-run paths. Never sends email.
set -euo pipefail

: "${DB_URL:?DB_URL must point to the disposable CI database}"
: "${SUPABASE_URL:?SUPABASE_URL must point to the disposable CI API}"
: "${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY required}"
: "${EXPIRY_ALERTS_CRON_SECRET:?Synthetic cron secret required}"

endpoint="${SUPABASE_URL%/}/functions/v1/send-expiry-notifications"

# The CI environment exports a loopback URL. Refuse to run against a remote
# environment even when someone accidentally passes real credentials.
case "$endpoint" in
  http://127.0.0.1:*/*|http://localhost:*/*) ;;
  *) echo "::error::Dry-run homologation must target local disposable Supabase only."; exit 1 ;;
esac

database_fingerprint() {
  local table="$1"
  case "$table" in
    expiry_notification_deliveries|operational_email_events) ;;
    *) echo "Unknown outbox table" >&2; return 1 ;;
  esac
  psql "$DB_URL" -X -A -t -v ON_ERROR_STOP=1 \
    -c "SELECT COALESCE(md5(string_agg(row_to_json(t)::text, '|' ORDER BY t.id::text)), md5('')) FROM public.$table AS t;"
}

before_expiry="$(database_fingerprint expiry_notification_deliveries)"
before_operational="$(database_fingerprint operational_email_events)"

request() {
  local body="$1"
  local secret="$2"
  local destination
  destination="$(mktemp)"
  local code
  code="$(curl --silent --show-error --output "$destination" --write-out '%{http_code}' \
    --request POST "$endpoint" \
    --header "apikey: $SUPABASE_ANON_KEY" \
    --header "Authorization: Bearer $SUPABASE_ANON_KEY" \
    --header "x-expiry-alert-secret: $secret" \
    --header "Content-Type: application/json" \
    --data "$body")"
  RESPONSE="$(cat "$destination")"
  rm -f "$destination"
  HTTP_STATUS="$code"
}

assert_http() {
  local expected="$1"
  local scenario="$2"
  if [ "$HTTP_STATUS" != "$expected" ]; then
    echo "::error::$scenario returned HTTP $HTTP_STATUS; expected $expected."
    exit 1
  fi
}

assert_no_send() {
  local scenario="$1"
  if ! jq -e '.status == "dry_run" and .sent == 0 and .failed == 0 and .skipped == 0 and .uncertain == 0' \
    >/dev/null <<<"$RESPONSE"; then
    echo "::error::$scenario did not confirm a zero-delivery dry-run."
    exit 1
  fi
}

assert_expiry_window() {
  local scenario="$1"
  local processed="$2"
  local has_more="$3"
  local next_offset="$4"
  if ! jq -e \
    --argjson processed "$processed" \
    --argjson has_more "$has_more" \
    --argjson next_offset "$next_offset" \
    '.candidates == 4 and .processed == $processed and .has_more == $has_more and .next_offset == $next_offset' \
    >/dev/null <<<"$RESPONSE"; then
    echo "::error::$scenario returned an unexpected recipient/batch count."
    exit 1
  fi
}

# Authentication must be required even for read-only simulation.
request '{"dry_run":true}' "not-the-authorized-cron-secret"
assert_http 401 "Unauthorized simulation"

# Reject a string value instead of silently treating it as an instruction to send.
request '{"dry_run":"false"}' "$EXPIRY_ALERTS_CRON_SECRET"
assert_http 400 "Invalid dry_run type"

# When dry_run is omitted, the safe default must remain enabled.
request '{"batch_size":100,"offset":0}' "$EXPIRY_ALERTS_CRON_SECRET"
assert_http 200 "Implicit simulation"
assert_no_send "Implicit simulation"
assert_expiry_window "Implicit simulation" 4 false null

request '{"dry_run":true,"batch_size":100,"offset":0}' "$EXPIRY_ALERTS_CRON_SECRET"
assert_http 200 "Explicit simulation"
assert_no_send "Explicit simulation"
assert_expiry_window "Explicit simulation" 4 false null
first_response="$RESPONSE"

# Repeating the same request must have identical results and no side effects.
request '{"dry_run":true,"batch_size":100,"offset":0}' "$EXPIRY_ALERTS_CRON_SECRET"
assert_http 200 "Repeated simulation"
assert_no_send "Repeated simulation"
if [ "$RESPONSE" != "$first_response" ]; then
  echo "::error::Repeated simulation changed the candidate payload."
  exit 1
fi

request '{"dry_run":true,"batch_size":2,"offset":0}' "$EXPIRY_ALERTS_CRON_SECRET"
assert_http 200 "First simulated batch"
assert_no_send "First simulated batch"
assert_expiry_window "First simulated batch" 2 true 2

request '{"dry_run":true,"batch_size":2,"offset":2}' "$EXPIRY_ALERTS_CRON_SECRET"
assert_http 200 "Final simulated batch"
assert_no_send "Final simulated batch"
assert_expiry_window "Final simulated batch" 2 false null

# The same endpoint also hosts operational emails. Its simulated path must
# leave the operational queue untouched, without invoking a provider.
request '{"channel":"operational"}' "$EXPIRY_ALERTS_CRON_SECRET"
assert_http 200 "Operational queue simulation"
assert_no_send "Operational queue simulation"

after_expiry="$(database_fingerprint expiry_notification_deliveries)"
after_operational="$(database_fingerprint operational_email_events)"
if [ "$before_expiry" != "$after_expiry" ] || [ "$before_operational" != "$after_operational" ]; then
  echo "::error::A simulated invocation mutated an email outbox."
  exit 1
fi

echo "PASS: 4 synthetic expiry candidates, authenticated default/explicit/repeated/paged dry-run, zero sends and unchanged outboxes."
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Expiry notification homologation — disposable database"
    echo ""
    echo "- Four synthetic expiry candidates across two Secretarias."
    echo "- Default, explicit, repeated and paginated dry-runs succeeded."
    echo "- Invalid cron secret denied (401); invalid dry-run type denied (400)."
    echo "- Both expiry and operational email outboxes unchanged."
    echo "- Sent = 0; no live provider configured or invoked."
  } >> "$GITHUB_STEP_SUMMARY"
fi
