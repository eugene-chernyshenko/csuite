import type { CompanyConfig, Department, Id, Role } from "@csuite/contract";

/**
 * Pure geometry for the org-chart floor.
 *
 * Everything is computed in stage pixels from the measured container so the SVG
 * edge layer and the absolutely-positioned HTML nodes share one coordinate
 * system. No state, no side effects — safe to recompute on every resize.
 */

export const NODE_H = 68;
export const NODE_W_MAX = 172;
export const NODE_W_MIN = 112;
export const CEO_W = 244;
export const CEO_H = 66;

const PAD = 18;
const GAP_BASE = 34;
const BOARD_ZONE_H = 134;
const DEPT_ZONE_MIN_H = 284;
const DEPT_GAP = 18;

export const MIN_STAGE_W = 900;
export const MIN_STAGE_H =
  PAD + CEO_H + GAP_BASE + BOARD_ZONE_H + GAP_BASE + DEPT_ZONE_MIN_H + PAD;

export interface Pt {
  x: number;
  y: number;
}

export interface NodeBox {
  id: Id;
  /** centre x */
  cx: number;
  /** centre y */
  cy: number;
  w: number;
  h: number;
}

export interface ZoneBox {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DeptLayout {
  dept: Department;
  zone: ZoneBox;
  lead?: NodeBox;
  workers: NodeBox[];
  /** y at which the task chip rail starts */
  tasksTop: number;
  /** board member who oversees this department (edge source) */
  supervisorRoleId?: Id;
}

export type EdgeKind = "board" | "department" | "team";

export interface Edge {
  id: string;
  from: Id;
  to: Id;
  kind: EdgeKind;
  d: string;
  /** cubic control points, parent → child */
  c: [Pt, Pt, Pt, Pt];
}

export interface FloorLayout {
  width: number;
  height: number;
  ceoRoleId?: Id;
  ceo?: NodeBox;
  boardZone: ZoneBox;
  board: NodeBox[];
  departments: DeptLayout[];
  /** every agent node (board, leads, workers) plus the CEO, by role id */
  nodes: Record<Id, NodeBox>;
  edges: Edge[];
  /** child role id → parent role id, following the reporting lines */
  parentOf: Record<Id, Id>;
  /** edge lookup keyed `${parent}->${child}` */
  edgeOf: Record<string, Edge>;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Vertical cubic between two boxes (bottom of `a` → top of `b`). */
function linkCurve(a: NodeBox, b: NodeBox): [Pt, Pt, Pt, Pt] {
  const p0 = { x: a.cx, y: a.cy + a.h / 2 };
  const p3 = { x: b.cx, y: b.cy - b.h / 2 };
  const dy = Math.max(18, (p3.y - p0.y) * 0.55);
  return [p0, { x: p0.x, y: p0.y + dy }, { x: p3.x, y: p3.y - dy }, p3];
}

export function curveToPath(c: [Pt, Pt, Pt, Pt]): string {
  return `M ${c[0].x} ${c[0].y} C ${c[1].x} ${c[1].y}, ${c[2].x} ${c[2].y}, ${c[3].x} ${c[3].y}`;
}

function cubicAt(c: [Pt, Pt, Pt, Pt], t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x,
    y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y,
  };
}

const SUPERVISOR_HINTS: Array<[RegExp, RegExp]> = [
  // department name pattern                       board title/mandate pattern
  [
    /engineer|platform|product|tech|infra|data|research/i,
    /technolog|technical|product|engineer|architect/i,
  ],
  [/growth|market|sales|revenue|demand|acquisition/i, /market|growth|revenue|sales|commercial/i],
  [/financ|account|billing/i, /financ|account/i],
  [/ops|operation|support|success|people/i, /operat|people|support|chief of staff/i],
];

/** Best-guess reporting line from a department to a board member. */
function pickSupervisor(dept: Department, board: Role[], index: number): Id | undefined {
  if (board.length === 0) return undefined;
  let best: { id: Id; score: number } | undefined;
  for (const r of board) {
    const hay = `${r.title} ${r.mandate}`;
    let score = 0;
    for (const [deptRe, boardRe] of SUPERVISOR_HINTS) {
      if (deptRe.test(dept.name) && boardRe.test(hay)) score += 2;
    }
    if (hay.toLowerCase().includes(dept.name.toLowerCase())) score += 3;
    if (score > 0 && (!best || score > best.score)) best = { id: r.id, score };
  }
  return best?.id ?? board[index % board.length].id;
}

export function computeLayout(config: CompanyConfig, cw: number, ch: number): FloorLayout {
  const width = Math.max(cw || MIN_STAGE_W, MIN_STAGE_W);
  const height = Math.max(ch || MIN_STAGE_H, MIN_STAGE_H);

  const roles = config.roles;
  const ceoRole = roles.find((r) => r.kind === "ceo");
  const board = roles.filter((r) => r.kind === "board");

  const extra = Math.max(0, height - MIN_STAGE_H);
  const gapA = GAP_BASE + Math.min(extra * 0.16, 26);
  const gapB = GAP_BASE + Math.min(extra * 0.16, 26);
  const boardH = BOARD_ZONE_H + Math.min(extra * 0.12, 26);

  const nodes: Record<Id, NodeBox> = {};

  const ceo: NodeBox | undefined = ceoRole
    ? { id: ceoRole.id, cx: width / 2, cy: PAD + CEO_H / 2, w: CEO_W, h: CEO_H }
    : undefined;
  if (ceo && ceoRole) nodes[ceoRole.id] = ceo;

  const boardZone: ZoneBox = {
    id: "zone-board",
    label: "Boardroom",
    x: PAD,
    y: PAD + CEO_H + gapA,
    w: width - PAD * 2,
    h: boardH,
  };

  const boardNodes: NodeBox[] = [];
  if (board.length > 0) {
    const slot = boardZone.w / board.length;
    const w = clamp(Math.min(NODE_W_MAX, slot - 20), NODE_W_MIN, NODE_W_MAX);
    const cy = boardZone.y + 36 + NODE_H / 2;
    board.forEach((r, i) => {
      const box: NodeBox = { id: r.id, cx: boardZone.x + slot * (i + 0.5), cy, w, h: NODE_H };
      boardNodes.push(box);
      nodes[r.id] = box;
    });
  }

  const deptTop = boardZone.y + boardZone.h + gapB;
  const deptH = Math.max(DEPT_ZONE_MIN_H, height - deptTop - PAD);
  const depts = config.departments;
  const zoneW =
    depts.length > 0 ? (width - PAD * 2 - DEPT_GAP * (depts.length - 1)) / depts.length : 0;

  const departments: DeptLayout[] = depts.map((dept, di) => {
    const zone: ZoneBox = {
      id: `zone-${dept.id}`,
      label: dept.name,
      x: PAD + di * (zoneW + DEPT_GAP),
      y: deptTop,
      w: zoneW,
      h: deptH,
    };
    const innerExtra = Math.max(0, deptH - DEPT_ZONE_MIN_H);

    const members = roles.filter((r) => r.departmentId === dept.id);
    const leadRole = members.find((r) => r.kind === "lead");
    const workerRoles = members.filter((r) => r.id !== leadRole?.id);

    let lead: NodeBox | undefined;
    const leadCy = zone.y + 68 + innerExtra * 0.14;
    if (leadRole) {
      lead = {
        id: leadRole.id,
        cx: zone.x + zone.w / 2,
        cy: leadCy,
        w: clamp(Math.min(NODE_W_MAX, zone.w - 44), NODE_W_MIN, NODE_W_MAX),
        h: NODE_H,
      };
      nodes[leadRole.id] = lead;
    }

    const workerCy = leadCy + 90 + innerExtra * 0.2;
    const workers: NodeBox[] = [];
    if (workerRoles.length > 0) {
      const inner = zone.w - 16;
      const slot = inner / workerRoles.length;
      const w = clamp(Math.min(NODE_W_MAX, slot - 14), NODE_W_MIN, NODE_W_MAX);
      workerRoles.forEach((r, i) => {
        const box: NodeBox = {
          id: r.id,
          cx: zone.x + 8 + slot * (i + 0.5),
          cy: workerCy,
          w,
          h: NODE_H,
        };
        workers.push(box);
        nodes[r.id] = box;
      });
    }

    const lowest = workers.length > 0 ? workerCy : leadCy;
    const tasksTop = lowest + NODE_H / 2 + 36 + innerExtra * 0.12;

    return {
      dept,
      zone,
      lead,
      workers,
      tasksTop,
      supervisorRoleId: pickSupervisor(dept, board, di),
    };
  });

  // ---- edges -------------------------------------------------------------
  const edges: Edge[] = [];
  const edgeOf: Record<string, Edge> = {};
  const parentOf: Record<Id, Id> = {};
  const addEdge = (from: NodeBox, to: NodeBox, kind: EdgeKind) => {
    const c = linkCurve(from, to);
    const edge: Edge = { id: `${from.id}->${to.id}`, from: from.id, to: to.id, kind, d: curveToPath(c), c };
    edges.push(edge);
    edgeOf[edge.id] = edge;
    parentOf[to.id] = from.id;
  };

  if (ceo) for (const b of boardNodes) addEdge(ceo, b, "board");

  for (const d of departments) {
    const sup = d.supervisorRoleId ? nodes[d.supervisorRoleId] : undefined;
    const head = d.lead;
    if (sup && head) addEdge(sup, head, "department");
    else if (sup) for (const w of d.workers) addEdge(sup, w, "department");
    if (head) for (const w of d.workers) addEdge(head, w, "team");
  }

  return {
    width,
    height,
    ceoRoleId: ceoRole?.id,
    ceo,
    boardZone,
    board: boardNodes,
    departments,
    nodes,
    edges,
    parentOf,
    edgeOf,
  };
}

function ancestry(layout: FloorLayout, id: Id): Id[] {
  const chain: Id[] = [id];
  let cur = id;
  // depth guard: the org tree is at most a handful of levels deep
  for (let i = 0; i < 8; i++) {
    const p = layout.parentOf[cur];
    if (!p || chain.includes(p)) break;
    chain.push(p);
    cur = p;
  }
  return chain;
}

/** The chain of role ids a document walks through, `from` → `to`. */
export function routeBetween(layout: FloorLayout, from: Id, to: Id): Id[] | undefined {
  if (!layout.nodes[from] || !layout.nodes[to]) return undefined;
  if (from === to) return undefined;
  const up = ancestry(layout, from);
  const down = ancestry(layout, to);
  const meet = up.find((id) => down.includes(id));
  if (!meet) return undefined;
  const head = up.slice(0, up.indexOf(meet) + 1);
  const tail = down.slice(0, down.indexOf(meet)).reverse();
  return [...head, ...tail];
}

/**
 * Sampled points a motif travels through, riding the drawn reporting edges.
 * Falls back to a gentle free arc when the two roles are not connected.
 */
export function travelPoints(layout: FloorLayout, from: Id, to: Id, perHop = 6): Pt[] {
  const a = layout.nodes[from];
  const b = layout.nodes[to];
  if (!a || !b) return [];
  const route = routeBetween(layout, from, to);
  if (!route || route.length < 2) {
    const mid = {
      x: (a.cx + b.cx) / 2,
      y: (a.cy + b.cy) / 2 - Math.min(50, Math.abs(a.cx - b.cx) * 0.2),
    };
    const out: Pt[] = [];
    for (let i = 0; i <= perHop; i++) {
      const t = i / perHop;
      const u = 1 - t;
      out.push({
        x: u * u * a.cx + 2 * u * t * mid.x + t * t * b.cx,
        y: u * u * a.cy + 2 * u * t * mid.y + t * t * b.cy,
      });
    }
    return out;
  }

  const pts: Pt[] = [];
  for (let i = 0; i < route.length - 1; i++) {
    const x = route[i];
    const y = route[i + 1];
    const down = layout.edgeOf[`${x}->${y}`];
    const upEdge = layout.edgeOf[`${y}->${x}`];
    const edge = down ?? upEdge;
    if (!edge) continue;
    const reversed = !down;
    for (let s = 0; s <= perHop; s++) {
      if (s === 0 && pts.length > 0) continue;
      const t = s / perHop;
      pts.push(cubicAt(edge.c, reversed ? 1 - t : t));
    }
  }
  return pts.length >= 2 ? pts : [{ x: a.cx, y: a.cy }, { x: b.cx, y: b.cy }];
}
