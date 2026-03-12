/**
 * Cron guard: skip execution when DISABLE_CRONS=true.
 *
 * Set in Convex env via:
 *   npx convex env set DISABLE_CRONS true
 */
export function isCronDisabled(): boolean {
  return process.env.DISABLE_CRONS === 'true'
}
