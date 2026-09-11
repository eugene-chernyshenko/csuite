"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useSim } from "@/lib/sim";
import type { CeoDecision, Id } from "@csuite/contract";
import { DecisionBar } from "./DecisionBar";
import { EscalationDocument } from "./EscalationDocument";
import { Inbox } from "./Inbox";
import { ProposalDocument } from "./ProposalDocument";
import {
  buildInbox,
  buildRoleMap,
  consultationsByRole,
  itemKey,
  readTimes,
  tasksForProposal,
  type Consultation,
  type InboxItem,
} from "./util";

/** How long the signature stroke is allowed to draw before the decision lands. */
const SIGNING_MS = 470;
/** How long a just-made decision holds the reading pane before the desk moves on. */
const FRESH_MS = 1700;

/** What the user last chose to read, and whether they chose it themselves. */
interface Pick {
  key: string;
  explicit: boolean;
}

function EmptyPane({ hasItems }: { hasItems: boolean }) {
  const t = useTranslations("desk");
  // "Watch the Floor" is demo advice: there, a scripted day is already running.
  // In live mode nothing happens until the CEO asks the board something, so the
  // empty desk points at the one control that does anything.
  const mode = useSim((s) => s.mode);
  return (
    <div className="flex h-full items-center justify-center px-8">
      <p className="max-w-[44ch] text-center font-serif text-[16px] leading-relaxed text-ink-soft">
        {hasItems ? (
          t("emptyPanePick")
        ) : mode === "live" ? (
          t("emptyPaneNothingLive")
        ) : (
          t.rich("emptyPaneNothing", {
            floor: (chunks) => (
              <Link href="/" className="text-sign underline underline-offset-2">
                {chunks}
              </Link>
            ),
          })
        )}
      </p>
    </div>
  );
}

export function DeskView() {
  const config = useSim((s) => s.config);
  const state = useSim((s) => s.state);
  const decide = useSim((s) => s.decide);
  const resolveEscalation = useSim((s) => s.resolveEscalation);
  const reduced = useReducedMotion();
  const t = useTranslations();

  const roles = useMemo(() => buildRoleMap(config.roles), [config.roles]);
  const times = useMemo(() => readTimes(state.feed), [state.feed]);
  const items = useMemo(
    () => buildInbox(t, state.proposals, state.escalations, times),
    [t, state.proposals, state.escalations, times],
  );

  const [pick, setPick] = useState<Pick | null>(null);
  /** Note draft, tied to the document it was typed on. */
  const [draft, setDraft] = useState<{ key: string; text: string } | null>(null);
  /** A decision mid-signature, tied to the document being signed. */
  const [signState, setSignState] = useState<{ key: string; decision: CeoDecision } | null>(
    null,
  );
  /** Key of an item the user just acted on — its stamp gets to animate in. */
  const [freshKey, setFreshKey] = useState<string | null>(null);

  const timers = useRef<number[]>([]);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending) window.clearTimeout(t);
    };
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  /*
   * Selection is derived, never stored as truth: the day can be scrubbed
   * backwards and the selected proposal may simply cease to exist. A pick the
   * user made themselves is never taken away from them while it still exists;
   * otherwise the desk shows whatever is most urgent.
   */
  const urgent = items.find((i) => i.needsYou) ?? null;
  const held = pick && items.some((i) => i.key === pick.key) ? pick : null;
  const selectedKey = held
    ? held.explicit
      ? held.key
      : (urgent?.key ?? held.key)
    : ((urgent ?? items[0])?.key ?? null);
  const selected: InboxItem | null =
    items.find((i) => i.key === selectedKey) ?? null;

  const note = draft && draft.key === selectedKey ? draft.text : "";
  const signing =
    signState && signState.key === selectedKey ? signState.decision : null;

  const proposal =
    selected?.kind === "proposal" ? state.proposals[selected.id] : undefined;
  const escalation =
    selected?.kind === "escalation" ? state.escalations[selected.id] : undefined;
  const pending = proposal?.status === "pending_approval" ? proposal : undefined;

  const proposalId = proposal?.id;
  const consultations = useMemo<Record<string, Consultation[]>>(
    () => (proposalId ? consultationsByRole(state.feed, proposalId) : {}),
    [state.feed, proposalId],
  );

  const setNote = useCallback(
    (text: string) => {
      if (!selectedKey) return;
      setDraft({ key: selectedKey, text });
    },
    [selectedKey],
  );

  /** Hold the document still long enough for its stamp to land, then move on. */
  const markFresh = useCallback(
    (key: string) => {
      setFreshKey(key);
      setPick({ key, explicit: true });
      later(() => {
        setFreshKey((k) => (k === key ? null : k));
        setPick((p) => (p && p.key === key ? { key, explicit: false } : p));
      }, FRESH_MS);
    },
    [later],
  );

  const land = useCallback(
    (proposalId: Id, decision: CeoDecision, withNote: string) => {
      decide(proposalId, decision, withNote.trim() || undefined);
      setDraft(null);
      setSignState(null);
      markFresh(itemKey("proposal", proposalId));
    },
    [decide, markFresh],
  );

  const submitDecision = useCallback(
    (decision: CeoDecision) => {
      if (!pending || signing) return;
      const id = pending.id;
      const key = itemKey("proposal", id);
      const withNote = note;
      if (decision === "approved" && !reduced) {
        setSignState({ key, decision });
        later(() => land(id, decision, withNote), SIGNING_MS);
      } else {
        land(id, decision, withNote);
      }
    },
    [pending, signing, note, reduced, later, land],
  );

  const handleResolve = useCallback(
    (id: Id, resolution: string) => {
      resolveEscalation(id, resolution);
      markFresh(itemKey("escalation", id));
    },
    [resolveEscalation, markFresh],
  );

  // A to approve, R to reject — unless you are typing.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key !== "a" && key !== "r") return;
      if (!pending) return;
      e.preventDefault();
      submitDecision(key === "a" ? "approved" : "rejected");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pending, submitDecision]);

  const handleSelect = useCallback((item: InboxItem) => {
    setPick({ key: item.key, explicit: true });
  }, []);

  // A new document is read from the top.
  const pane = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (pane.current) pane.current.scrollTop = 0;
  }, [selectedKey]);

  return (
    <div className="flex h-full min-h-0">
      <Inbox
        items={items}
        roles={roles}
        selectedKey={selectedKey}
        onSelect={handleSelect}
      />

      <section className="flex min-w-0 flex-1 flex-col bg-paper">
        <div ref={pane} className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {proposal ? (
            <ProposalDocument
              key={proposal.id}
              proposal={proposal}
              roles={roles}
              departments={config.departments}
              monthlyBudget={config.monthlyBudget}
              tasks={tasksForProposal(state.tasks, proposal.id)}
              submittedAt={times.submitted[proposal.id]}
              decidedAt={times.decided[proposal.id]}
              fresh={freshKey === itemKey("proposal", proposal.id)}
              consultations={consultations}
            />
          ) : escalation ? (
            <EscalationDocument
              key={escalation.id}
              escalation={escalation}
              roles={roles}
              raisedAt={times.raised[escalation.id]}
              resolvedAt={times.resolved[escalation.id]}
              fresh={freshKey === itemKey("escalation", escalation.id)}
              onResolve={(resolution) => handleResolve(escalation.id, resolution)}
            />
          ) : (
            <EmptyPane hasItems={items.length > 0} />
          )}
        </div>

        {pending && (
          <DecisionBar
            note={note}
            onNoteChange={setNote}
            onDecide={submitDecision}
            signing={signing}
          />
        )}
      </section>
    </div>
  );
}
