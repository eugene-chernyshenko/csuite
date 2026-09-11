"use client";

import { useMemo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useSim } from "@/lib/sim";
import type { Id, Task } from "@csuite/contract";
import { useMeasure } from "../../useMeasure";
import { computeLayout, routeBetween, type FloorLayout } from "./layout";
import { deriveFeedLines, deriveMoments } from "./derive";
import { AgentNode } from "./AgentNode";
import { CeoNode } from "./CeoNode";
import { MessageDot, TravelMotif } from "./Motifs";
import { TaskChip } from "./TaskChip";
import { NowStrip } from "./NowStrip";

export function OrgChartFloor() {
  const t = useTranslations();
  const tf = useTranslations("floor");
  const config = useSim((s) => s.config);
  const feed = useSim((s) => s.state.feed);
  const activityMap = useSim((s) => s.state.activity);
  const tasks = useSim((s) => s.state.tasks);
  const escalations = useSim((s) => s.state.escalations);
  const proposals = useSim((s) => s.state.proposals);
  const mode = useSim((s) => s.mode);
  const now = useSim((s) => s.now);
  const time = useSim((s) => s.time);
  const speed = useSim((s) => s.speed);
  const playing = useSim((s) => s.playing);
  const awaiting = useSim((s) => s.awaiting);
  const play = useSim((s) => s.play);
  const connection = useSim((s) => s.connection);

  const reducedRaw = useReducedMotion();
  const reduced = reducedRaw ?? false;

  const [stageRef, size] = useMeasure<HTMLDivElement>();
  const layout: FloorLayout = useMemo(
    () => computeLayout(config, size.w, size.h),
    [config, size.w, size.h],
  );

  const roles = config.roles;
  const roleById = useMemo(() => {
    const m: Record<Id, (typeof roles)[number]> = {};
    for (const r of roles) m[r.id] = r;
    return m;
  }, [roles]);
  const roleDept = useMemo(() => {
    const m: Record<Id, Id | undefined> = {};
    for (const r of roles) m[r.id] = r.departmentId;
    return m;
  }, [roles]);

  const moments = useMemo(
    () => deriveMoments(t, feed, now, time, speed, proposals, roleDept, layout.ceoRoleId),
    [t, feed, now, time, speed, proposals, roleDept, layout.ceoRoleId],
  );

  // The strip only changes when the feed does — keep its identity stable so the
  // 100ms tick doesn't re-render (and re-animate) it.
  const feedSig = `${feed.length}:${feed[feed.length - 1]?.id ?? ""}`;
  const feedLines = useMemo(
    () => deriveFeedLines(t, feed, config, proposals, tasks),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feedSig, config, t],
  );

  const openEscalations = useMemo(
    () => Object.values(escalations).filter((e) => e.status === "open"),
    [escalations],
  );
  const escalatedRoles = useMemo(
    () => new Set(openEscalations.map((e) => e.fromRoleId)),
    [openEscalations],
  );

  const tasksByDept = useMemo(() => {
    const m: Record<Id, Task[]> = {};
    for (const t of Object.values(tasks)) (m[t.departmentId] ??= []).push(t);
    return m;
  }, [tasks]);

  const activeEdges = useMemo(() => {
    const s = new Set<string>();
    for (const t of moments.travels) {
      const r = routeBetween(layout, t.from, t.to);
      if (!r) continue;
      for (let i = 0; i < r.length - 1; i++) {
        s.add(`${r[i]}->${r[i + 1]}`);
        s.add(`${r[i + 1]}->${r[i]}`);
      }
    }
    return s;
  }, [moments.travels, layout]);

  const deliberating = Object.keys(moments.deliberations).length > 0;
  /** Demo-only: a scripted day that has not been started yet. */
  const notStarted = mode === "demo" && now === 0 && !playing;
  /** Live: a real company whose log is still empty (or not yet fetched). */
  const quiet = mode === "live" && feed.length === 0;
  const awaitingTitle = awaiting ? proposals[awaiting]?.title : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <div ref={stageRef} className="relative min-h-0 flex-1 overflow-auto">
        <div className="relative" style={{ width: layout.width, height: layout.height }}>
          {/* ---- zones ---------------------------------------------------- */}
          <div
            className="absolute rounded-md border border-line"
            style={{
              left: layout.boardZone.x,
              top: layout.boardZone.y,
              width: layout.boardZone.w,
              height: layout.boardZone.h,
            }}
          >
            <div className="flex items-center gap-2 px-3 pt-2">
              <span className="text-[11px] text-ink-soft">{tf("boardroom")}</span>
              {deliberating && (
                <span className="flex items-center gap-1.5 text-[10.5px] text-hold">
                  <span className="h-1.5 w-1.5 rounded-full bg-hold" />
                  {tf("inSession")}
                </span>
              )}
            </div>
          </div>

          {layout.departments.map((d) => {
            const list = tasksByDept[d.dept.id] ?? [];
            const done = list.filter((t) => t.status === "done").length;
            const deptEscalations = openEscalations.filter(
              (e) => roleDept[e.fromRoleId] === d.dept.id,
            );
            const flashKey = moments.deptFlash[d.dept.id];
            return (
              <div
                key={d.zone.id}
                className="absolute overflow-hidden rounded-md border"
                style={{
                  left: d.zone.x,
                  top: d.zone.y,
                  width: d.zone.w,
                  height: d.zone.h,
                  borderColor:
                    deptEscalations.length > 0 ? "var(--color-pencil)" : "var(--color-line)",
                }}
              >
                <div className="flex items-baseline gap-2 px-3 pt-2">
                  <span className="shrink-0 text-[12.5px] font-medium text-ink">{d.dept.name}</span>
                  {deptEscalations.length > 0 && (
                    <span
                      className="min-w-0 truncate rounded-sm bg-pencil-soft px-1.5 py-[1px] text-[10px] text-pencil"
                      title={deptEscalations
                        .map((e) => `${e.reason} — ${e.ask}`)
                        .join(" · ")}
                    >
                      {tf("escalated", { reason: deptEscalations[0].reason })}
                    </span>
                  )}
                  {list.length > 0 && (
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-soft tnum">
                      {tf("doneOfTotal", { done, total: list.length })}
                    </span>
                  )}
                </div>
                {flashKey && !reduced && (
                  <motion.span
                    key={flashKey}
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-md"
                    style={{ background: "var(--color-pencil)" }}
                    initial={{ opacity: 0.16 }}
                    animate={{ opacity: 0 }}
                    transition={{ duration: 1, ease: "easeOut" }}
                  />
                )}
              </div>
            );
          })}

          {/* ---- reporting lines ------------------------------------------ */}
          <svg
            className="pointer-events-none absolute top-0 left-0"
            width={layout.width}
            height={layout.height}
            aria-hidden
          >
            {layout.edges.map((e) => {
              const hot = activeEdges.has(e.id) || moments.deliberations[e.to] !== undefined;
              return (
                <path
                  key={e.id}
                  d={e.d}
                  fill="none"
                  stroke={hot ? "var(--color-sign)" : "var(--color-line)"}
                  strokeWidth={hot ? 1.4 : 1}
                  strokeOpacity={hot ? 0.5 : 1}
                />
              );
            })}
          </svg>

          {/* ---- task rails ------------------------------------------------ */}
          {layout.departments.map((d) => {
            const list = tasksByDept[d.dept.id] ?? [];
            if (list.length === 0) return null;
            const maxH = Math.max(24, d.zone.y + d.zone.h - d.tasksTop - 10);
            return (
              <div key={`tasks-${d.dept.id}`}>
                <div
                  className="absolute flex items-center gap-2"
                  style={{ left: d.zone.x + 10, top: d.tasksTop - 17, width: d.zone.w - 20 }}
                >
                  <span className="shrink-0 text-[10px] text-ink-soft">{tf("tasksHeading")}</span>
                  <span className="h-px flex-1 bg-line" />
                </div>
                <div
                  className="absolute flex flex-wrap content-start gap-1 overflow-hidden"
                  style={{
                    left: d.zone.x + 10,
                    top: d.tasksTop,
                    width: d.zone.w - 20,
                    maxHeight: maxH,
                  }}
                >
                  <AnimatePresence initial={false}>
                    {list.map((t) => (
                      <TaskChip
                        key={t.id}
                        title={t.title}
                        status={t.status}
                        assignee={t.assigneeRoleId ? roleById[t.assigneeRoleId]?.name : undefined}
                        flashKey={moments.taskFlash[t.id]}
                        reduced={reduced}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            );
          })}

          {/* ---- the people ------------------------------------------------ */}
          {layout.ceo && layout.ceoRoleId && (
            <CeoNode
              title={roleById[layout.ceoRoleId]?.title ?? tf("ceo.titleFallback")}
              companyName={config.name}
              x={layout.ceo.cx}
              y={layout.ceo.cy}
              w={layout.ceo.w}
              h={layout.ceo.h}
              awaiting={Boolean(awaiting)}
              awaitingTitle={awaitingTitle}
              openEscalations={openEscalations.length}
              reduced={reduced}
            />
          )}

          {Object.values(layout.nodes).map((box) => {
            if (box.id === layout.ceoRoleId) return null;
            const role = roleById[box.id];
            if (!role) return null;
            const act = activityMap[box.id];
            const delib = moments.deliberations[box.id];
            return (
              <AgentNode
                key={box.id}
                name={role.name}
                title={role.title}
                model={role.model}
                activity={act?.activity ?? "idle"}
                note={act?.note}
                x={box.cx}
                y={box.cy}
                w={box.w}
                h={box.h}
                stanceTone={delib?.tone}
                stanceText={delib?.text}
                escalated={escalatedRoles.has(box.id)}
                flashKey={moments.nodeFlash[box.id]}
                reduced={reduced}
              />
            );
          })}

          {/* ---- moments in motion ----------------------------------------- */}
          {!reduced && (
            <AnimatePresence>
              {moments.messages.map((m) => (
                <MessageDot key={m.key} layout={layout} from={m.from} to={m.to} />
              ))}
              {moments.travels.map((t) => (
                <TravelMotif
                  key={t.key}
                  layout={layout}
                  from={t.from}
                  to={t.to}
                  tone={t.tone}
                  kind={t.kind}
                  label={t.title}
                />
              ))}
            </AnimatePresence>
          )}
        </div>

        {notStarted && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-paper/75 px-6 backdrop-blur-[1.5px]">
            <div className="max-w-[460px] rounded-md border border-line bg-sheet px-7 py-6 text-center">
              <div className="font-serif text-[20px] leading-tight text-ink">{config.name}</div>
              <p className="mx-auto mt-1.5 max-w-[44ch] font-serif text-[13.5px] text-ink-soft">
                {config.product}
              </p>
              <hr className="my-5 border-line" />
              <div className="text-[14px] font-medium text-ink">{tf("start.title")}</div>
              <p className="mx-auto mt-1.5 max-w-[46ch] text-[11.5px] leading-relaxed text-ink-soft">
                {tf("start.body")}
              </p>
              <button
                onClick={play}
                className="mt-5 rounded-md bg-sign px-5 py-1.5 text-[12.5px] font-medium text-white hover:opacity-90"
              >
                {tf("start.play")}
              </button>
            </div>
          </div>
        )}

        {quiet && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-paper/75 px-6 backdrop-blur-[1.5px]">
            <div className="max-w-[460px] rounded-md border border-line bg-sheet px-7 py-6 text-center">
              <div className="font-serif text-[20px] leading-tight text-ink">{config.name}</div>
              {config.product && (
                <p className="mx-auto mt-1.5 max-w-[44ch] font-serif text-[13.5px] text-ink-soft">
                  {config.product}
                </p>
              )}
              <hr className="my-5 border-line" />
              <div className="text-[14px] font-medium text-ink">
                {connection === "online" ? tf("live.quietTitle") : tf("live.connectingTitle")}
              </div>
              <p className="mx-auto mt-1.5 max-w-[46ch] text-[11.5px] leading-relaxed text-ink-soft">
                {connection === "online" ? tf("live.quietBody") : tf("live.connectingBody")}
              </p>
            </div>
          </div>
        )}
      </div>

      <NowStrip lines={feedLines} reduced={reduced} format={time.format} />
    </div>
  );
}
