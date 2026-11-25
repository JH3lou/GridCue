import type { FilterOperator, Scalar } from "gridcue";

/**
 * The House Terms the eval schemas declare (named filters spec, 5.3), set by the lead before any case was labelled.
 * A case with `"terms": true` runs on its schema with these declared. They live here, not in the fixtures, so no other
 * case sees them: with them declared, one existing labelled request reads differently (`house-terms.test.ts`, Task 3.4).
 */
export interface EvalHouseTerm {
  label: string;
  aliases?: string[];
  /** Every condition must hold. An `isEmpty` condition has no value. */
  where: Array<{ columnId: string; operator: FilterOperator; value?: Scalar }>;
}

/** The wealth fixture's terms: one comparison, two conditions, and one empty condition. */
export const wealthHouseTerms: EvalHouseTerm[] = [
  { label: "Large", aliases: ["big"], where: [{ columnId: "market_value", operator: "gt", value: 1_000_000 }] },
  {
    label: "Needs attention",
    aliases: ["need attention", "needing attention"],
    where: [
      { columnId: "concentration", operator: "gt", value: 0.1 },
      { columnId: "has_restricted_holding", operator: "eq", value: true },
    ],
  },
  { label: "Unassigned", aliases: ["orphaned"], where: [{ columnId: "advisor_name", operator: "isEmpty" }] },
];

/** The ledger fixture's terms: one comparison, two conditions, and one empty condition. */
export const ledgerHouseTerms: EvalHouseTerm[] = [
  { label: "Material", aliases: ["sizeable"], where: [{ columnId: "amount", operator: "gt", value: 10_000 }] },
  {
    label: "Needs review",
    aliases: ["need review", "needing review"],
    where: [
      { columnId: "cleared", operator: "eq", value: false },
      { columnId: "amount", operator: "gt", value: 5_000 },
    ],
  },
  { label: "Uncoded", aliases: ["uncategorized", "uncategorised"], where: [{ columnId: "category", operator: "isEmpty" }] },
];
