#!/bin/bash
# End-to-end test script for chat-based outbound engine
set -e

STEP="${1:-all}"
SERVICE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY ~/outbound-engine/.env | cut -d= -f2-)
BRAND_ID="eca346ab-1cc0-4e85-bf63-1c111ff4bb32"
BASE="http://localhost:3001"

SESSION_ID="${SESSION_ID:-}"

chat() {
  local msg="$1"
  local label="$2"

  echo ""
  echo "╔══════════════════════════════════════════════╗"
  echo "║  $label"
  echo "╚══════════════════════════════════════════════╝"
  echo ">>> $msg"

  # Build JSON body
  local body
  if [ -n "$SESSION_ID" ]; then
    body=$(printf '{"message":"%s","brand_id":"%s","session_id":"%s"}' "$msg" "$BRAND_ID" "$SESSION_ID")
  else
    body=$(printf '{"message":"%s","brand_id":"%s"}' "$msg" "$BRAND_ID")
  fi

  local output
  output=$(curl -s --max-time 600 -X POST "$BASE/api/chat" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -d "$body" 2>&1)

  echo "$output" | awk '
    BEGIN { ev="?"; }
    /^event: / { ev=substr($0,8); next }
    /^data: /   { printf "  [%s] %s\n", ev, substr($0,7); ev="?"; next }
    '

  # Capture session ID from response
  local new_sid
  new_sid=$(echo "$output" | grep '^event: session' -A1 | grep '^data: ' | sed 's/.*"session_id":"\([^"]*\)".*/\1/')
  if [ -n "$new_sid" ]; then
    SESSION_ID="$new_sid"
    echo "  → Using session: $SESSION_ID"
  fi
  echo ""
}

if [ "$STEP" = "all" ] || [ "$STEP" = "discover" ]; then
  chat "find event management companies in Dubai" "STEP 1: DISCOVER"
fi

if [ "$STEP" = "all" ] || [ "$STEP" = "research" ]; then
  chat "research the leads" "STEP 2: RESEARCH"
fi

if [ "$STEP" = "all" ] || [ "$STEP" = "enrich" ]; then
  chat "enrich the leads" "STEP 3: ENRICH"
fi

if [ "$STEP" = "all" ] || [ "$STEP" = "qualify" ]; then
  chat "qualify the leads" "STEP 4: QUALIFY"
fi

if [ "$STEP" = "all" ] || [ "$STEP" = "draft" ]; then
  chat "draft outreach emails for the qualified leads" "STEP 5: DRAFT"
fi

if [ "$STEP" = "all" ] || [ "$STEP" = "send" ]; then
  chat "send the drafts" "STEP 6: SEND"
fi

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  DONE - All steps completed"
echo "╚══════════════════════════════════════════════╝"
