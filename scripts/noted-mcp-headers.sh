#!/bin/zsh

set -euo pipefail

vars_file="/Users/toddburton/Projects/notes-app/.dev.vars"

if [[ ! -r "$vars_file" ]]; then
  print -u2 "Noted MCP credentials file is missing or unreadable: $vars_file"
  exit 1
fi

token="$(/usr/bin/awk '
  /^NOTES_MCP_TOKEN=/ {
    sub(/^[^=]*=/, "")
    sub(/\r$/, "")
    print
    exit
  }
' "$vars_file")"

if [[ -z "$token" ]]; then
  print -u2 "NOTES_MCP_TOKEN is missing or empty in $vars_file"
  exit 1
fi

/usr/bin/jq -cn --arg token "$token" '{Authorization: ("Bearer " + $token)}'
