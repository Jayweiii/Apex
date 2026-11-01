#!/usr/bin/env bash
# Claude Code status line: context-window % plus per-session token counts.
# Also records a per-session summary in ~/.claude/token-usage/sessions.tsv.
# Wired up in .claude/settings.json (statusLine). Requires jq.
set -u
input=$(cat)
j() { jq -r "$1 // empty" <<<"$input"; }

sid=$(j .session_id)
model=$(j .model.display_name)
pct=$(j '.context_window.used_percentage')
ctx_size=$(j .context_window.context_window_size)
ctx_used=$(j .context_window.total_input_tokens)
transcript=$(j .transcript_path)

# Human-readable counts: 1234 -> 1.2k, 1234567 -> 1.2M
h() { awk -v n="${1:-0}" 'BEGIN{ if(n>=1e6) printf "%.1fM", n/1e6; else if(n>=1e3) printf "%.1fk", n/1e3; else printf "%d", n }'; }

# Cumulative session usage summed from the transcript (deduped by API message id),
# cached by transcript size so large transcripts are only re-read when they grow.
in_t=0 out_t=0 cr_t=0 cw_t=0
if [ -n "$transcript" ] && [ -f "$transcript" ]; then
  cache_dir="${HOME}/.claude/token-usage"; mkdir -p "$cache_dir"
  cache="$cache_dir/.cache-${sid:-unknown}"
  size=$(wc -c <"$transcript")
  if [ -f "$cache" ] && [ "$(head -1 "$cache")" = "$size" ]; then
    read -r in_t out_t cr_t cw_t < <(sed -n 2p "$cache")
  else
    read -r in_t out_t cr_t cw_t < <(jq -rn '
      [inputs | select(.type=="assistant" and .message.usage != null)
        | {id: (.message.id // .uuid), u: .message.usage}]
      | group_by(.id) | map(.[-1].u)
      | [ (map(.input_tokens // 0) | add // 0),
          (map(.output_tokens // 0) | add // 0),
          (map(.cache_read_input_tokens // 0) | add // 0),
          (map(.cache_creation_input_tokens // 0) | add // 0) ] | @tsv' "$transcript" 2>/dev/null || echo "0 0 0 0")
    printf '%s\n%s %s %s %s\n' "$size" "$in_t" "$out_t" "$cr_t" "$cw_t" >"$cache"
  fi
fi

# Persist latest totals per session (one row per session id).
if [ -n "$sid" ]; then
  log="${HOME}/.claude/token-usage/sessions.tsv"
  mkdir -p "$(dirname "$log")"
  [ -f "$log" ] || printf 'session_id\tupdated\tmodel\tctx_pct\tctx_tokens\tctx_size\tinput\toutput\tcache_read\tcache_write\n' >"$log"
  row=$(printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s' "$sid" "$(date -u +%FT%TZ)" "$model" "${pct:-}" "${ctx_used:-0}" "${ctx_size:-0}" "$in_t" "$out_t" "$cr_t" "$cw_t")
  { grep -v "^${sid}	" "$log"; echo "$row"; } >"$log.tmp" && mv "$log.tmp" "$log"
fi

# Colour the context % by how full the window is.
if [ -n "$pct" ]; then
  p=${pct%.*}
  if   [ "$p" -ge 80 ]; then c='\033[31m'; elif [ "$p" -ge 50 ]; then c='\033[33m'; else c='\033[32m'; fi
  ctx=$(printf "${c}ctx %s%%\033[0m (%s/%s)" "$p" "$(h "$ctx_used")" "$(h "$ctx_size")")
else
  ctx="ctx --"
fi

printf '%s │ %b │ session in %s · out %s · cache r %s / w %s\n' \
  "${model:-Claude}" "$ctx" "$(h "$in_t")" "$(h "$out_t")" "$(h "$cr_t")" "$(h "$cw_t")"
