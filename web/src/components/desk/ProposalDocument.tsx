"use client";

import { Fragment } from "react";
import { useTranslations } from "next-intl";
import type { Department, Proposal, Task } from "@csuite/contract";
import {
  Body,
  Byline,
  DocKicker,
  DocTitle,
  Dot,
  Rail,
  Section,
  Stamp,
  Statements,
} from "./primitives";
import {
  departmentName,
  isDecided,
  money,
  paragraphs,
  proposalStatusLabel,
  proposalTone,
  roleName,
  roleTitle,
  shareOfBudget,
  stampLabel,
  stanceLabel,
  stanceTone,
  taskStatusLabel,
  taskTone,
  toneText,
  type RoleMap,
} from "./util";

function Positions({ proposal, roles }: { proposal: Proposal; roles: RoleMap }) {
  const t = useTranslations();
  if (!proposal.positions.length) {
    return <p className="text-[13px] text-ink-soft">{t("desk.noPositions")}</p>;
  }
  return (
    <ul className="space-y-3">
      {proposal.positions.map((p, i) => {
        const tone = stanceTone(p.stance);
        return (
          <li
            key={`${p.roleId}-${i}`}
            className="relative rounded-md border border-line bg-paper py-3 pr-4 pl-5"
          >
            <Rail tone={tone} />
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[13px] font-medium text-ink">
                {roleName(t, roles, p.roleId)}
              </span>
              <span className="text-[12px] text-ink-soft">{roleTitle(roles, p.roleId)}</span>
              <span className={`ml-auto text-[12px] font-medium ${toneText(tone)}`}>
                {stanceLabel(t, p.stance)}
              </span>
            </div>
            <p className="mt-2 max-w-prose font-serif text-[14.5px] text-ink">{p.summary}</p>
            {p.keyPoints.length > 0 && (
              <div className="mt-2.5">
                <Statements items={p.keyPoints} tone={tone} size="small" />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Disagreements({ proposal, roles }: { proposal: Proposal; roles: RoleMap }) {
  const t = useTranslations();
  return (
    <div className="space-y-3">
      {proposal.disagreements.map((d, i) => (
        <div
          key={`${d.topic}-${i}`}
          className="relative rounded-md border border-line bg-paper py-3 pr-4 pl-5"
        >
          <Rail tone="pencil" />
          <p className="text-[13px] font-medium text-ink">{d.topic}</p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
            {d.roleIds.map((id, idx) => (
              <Fragment key={`${id}-${idx}`}>
                {idx > 0 && <span className="text-pencil">{t("desk.against")}</span>}
                <span className="rounded border border-line bg-sheet px-1.5 py-0.5 text-ink">
                  {roleName(t, roles, id)}
                </span>
              </Fragment>
            ))}
          </p>
          <p className="mt-2.5 max-w-prose font-serif text-[14.5px] text-ink">{d.detail}</p>
        </div>
      ))}
    </div>
  );
}

function Work({
  tasks,
  roles,
  departments,
}: {
  tasks: Task[];
  roles: RoleMap;
  departments: readonly Department[];
}) {
  const t = useTranslations();
  const done = tasks.filter((task) => task.status === "done").length;
  const blocked = tasks.filter((task) => task.status === "blocked").length;

  return (
    <div>
      <p className="mb-3 text-[13px] text-ink-soft">
        <span className="font-mono text-ink tnum">{t("desk.workDone", { done, total: tasks.length })}</span>
        {blocked > 0 && (
          <>
            {" · "}
            <span className="text-pencil">{t("desk.blockedCount", { count: blocked })}</span>
          </>
        )}
      </p>
      <ul className="divide-y divide-line overflow-hidden rounded-md border border-line">
        {tasks.map((task) => {
          const tone = taskTone(task.status);
          return (
            <li key={task.id} className="flex items-center gap-2.5 bg-sheet px-3 py-2">
              <Dot tone={tone} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{task.title}</span>
              <span className="hidden shrink-0 text-[12px] text-ink-soft sm:inline">
                {task.assigneeRoleId
                  ? roleName(t, roles, task.assigneeRoleId)
                  : departmentName(departments, task.departmentId)}
              </span>
              <span className={`w-[5.5rem] shrink-0 text-right text-[12px] ${toneText(tone)}`}>
                {taskStatusLabel(t, task.status)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ProposalDocument({
  proposal,
  roles,
  departments,
  monthlyBudget,
  tasks,
  submittedAt,
  decidedAt,
  fresh,
}: {
  proposal: Proposal;
  roles: RoleMap;
  departments: readonly Department[];
  monthlyBudget: number;
  tasks: Task[];
  submittedAt?: number;
  decidedAt?: number;
  /** The user just made this decision — the stamp gets to settle in. */
  fresh: boolean;
}) {
  const t = useTranslations();
  const tone = proposalTone(proposal.status);
  const stamp = stampLabel(t, proposal.status);
  const decided = isDecided(proposal.status);
  const budgetShare = shareOfBudget(t, proposal.cost.amount, monthlyBudget);

  return (
    <article className="mx-auto w-full max-w-[46rem] rounded-md border border-line bg-sheet px-8 py-7">
      <header className="border-b border-line pb-5">
        <DocKicker
          kind={t("desk.kind.proposal")}
          tone={tone}
          status={proposalStatusLabel(t, proposal.status)}
        />
        <DocTitle>{proposal.title}</DocTitle>
        <Byline
          name={roleName(t, roles, proposal.authorRoleId)}
          title={roleTitle(roles, proposal.authorRoleId)}
          at={submittedAt}
        />
      </header>

      <p className="mt-5 max-w-prose font-serif text-[17px] leading-relaxed text-ink">
        {proposal.summary}
      </p>

      {decided && stamp && (
        <div className="mt-6">
          <Stamp tone={tone} label={stamp} at={decidedAt} fresh={fresh} />
          {proposal.ceoNote && (
            <p className="mt-3 max-w-prose border-l-2 border-line pl-3 font-serif text-[14.5px] text-ink-soft italic">
              {t("desk.quoteAttribution", { quote: proposal.ceoNote })}
            </p>
          )}
        </div>
      )}

      <Section title={t("desk.section.rationale")}>
        <div className="space-y-3">
          {paragraphs(proposal.rationale).map((p, i) => (
            <Body key={i}>{p}</Body>
          ))}
        </div>
      </Section>

      <Section title={t("desk.section.alternatives")}>
        <Statements items={proposal.alternatives} />
      </Section>

      <Section title={t("desk.section.cost")}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-[22px] text-ink tnum">
            {money(proposal.cost.amount)}
          </span>
          {budgetShare && <span className="text-[12px] text-ink-soft">{budgetShare}</span>}
        </div>
        {proposal.cost.note && (
          <p className="mt-1.5 max-w-prose text-[13px] text-ink-soft">{proposal.cost.note}</p>
        )}
      </Section>

      <Section title={t("desk.section.risks")}>
        <Statements items={proposal.risks} tone="pencil" />
      </Section>

      <Section title={t("desk.section.boardPositions")}>
        <Positions proposal={proposal} roles={roles} />
      </Section>

      {proposal.disagreements.length > 0 && (
        <Section
          title={t("desk.section.disagreements")}
          note={t("desk.section.disagreementsNote")}
        >
          <Disagreements proposal={proposal} roles={roles} />
        </Section>
      )}

      {tasks.length > 0 && (
        <Section title={t("desk.section.workInFlight")}>
          <Work tasks={tasks} roles={roles} departments={departments} />
        </Section>
      )}
    </article>
  );
}
