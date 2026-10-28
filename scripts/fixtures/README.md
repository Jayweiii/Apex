# Verify fixtures

Committed fixtures used by `npm test` / `scripts/verify-*.ts`:

| Path | Used by |
| --- | --- |
| `src/lib/fixtures/gopro-thunderhill-west-session-gps.json` | gopro / reparse / sf verifies |
| `artifacts/reparse-persist/gl010057-repair-payload.json` | `verify-speed-chart-hydration.ts` |
| `/cursor/stores/self/fixtures/GL010057-session-gps.json` | reparse toolbar e2e (agent store) |

Prefer asserting behavior via exported contracts in `src/lib/*-contract.ts` over brittle className regexes.
