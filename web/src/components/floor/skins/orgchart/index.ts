import type { FloorSkin } from "@/lib/skin";
import { OrgChartFloor } from "./OrgChartFloor";

/** The living org chart: zones, reporting lines, documents in flight. */
export const orgChartSkin: FloorSkin = {
  id: "orgchart",
  name: "Org chart",
  Component: OrgChartFloor,
};
