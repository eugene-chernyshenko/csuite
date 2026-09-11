import type { EventStore } from "../store/types";

/**
 * Startup sweep: mark deliberations that a process restart killed mid-flight.
 *
 * Board runs are fire-and-forget inside this process (durable orchestration is
 * a later phase — see ARCHITECTURE "Agent execution"). When the server starts,
 * by definition nothing is in flight, so any drafting_started without its
 * proposal_submitted and without a terminal marker is an orphan. We append a
 * "Board run failed — interrupted…" worklog so the Desk/LiveBar never hang on
 * a deliberation that will not finish, and the CEO knows to ask again.
 *
 * Idempotent: the marker carries the proposal id in brackets; a marked run is
 * never marked twice.
 */
export async function sweepOrphanedRuns(
  store: EventStore,
  companyIds: string[],
  log: { info(msg: string): void; warn(msg: string): void },
): Promise<void> {
  for (const companyId of companyIds) {
    try {
      const state = await store.getState(companyId);
      const feed = state.feed;
      for (let i = 0; i < feed.length; i++) {
        const ev = feed[i];
        if (!ev || ev.type !== "drafting_started") continue;
        const pid = ev.proposalId;
        const rest = feed.slice(i + 1);
        const finished = rest.some(
          (e) => e.type === "proposal_submitted" && e.proposal.id === pid,
        );
        if (finished) continue;
        const marked = rest.some(
          (e) => e.type === "worklog" && (e.note ?? "").includes(`[${pid}]`),
        );
        if (marked) continue;
        // A failed run leaves its own terminal worklog right after the last
        // position of that run; those notes never carry the [pid] marker, so
        // match them loosely: a failure note later in the feed with no other
        // drafting in between belongs to this run.
        const failedInPlace = rest.some(
          (e, j) =>
            e.type === "worklog" &&
            /^Board (run|revision) failed/.test(e.note ?? "") &&
            !rest.slice(0, j).some((x) => x.type === "drafting_started"),
        );
        if (failedInPlace) continue;

        await store.appendEvents(companyId, [
          {
            type: "worklog",
            roleId: ev.authorRoleId,
            activity: "idle",
            note:
              `Board run failed — "${ev.title}" was interrupted by a server restart ` +
              `before the board could finish. Ask the question again. [${pid}]`,
          },
        ]);
        log.warn(`swept orphaned board run ${pid} in ${companyId}`);
      }
    } catch (err) {
      log.warn(`orphan sweep failed for ${companyId}: ${String(err)}`);
    }
  }
}
