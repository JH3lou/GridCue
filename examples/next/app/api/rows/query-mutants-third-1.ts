// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the strings are query.ts source text, which holds template literals.
/**
 * Data Queries from the third held-out check of the Query Check, round 1, for the Query Check's own tests (see
 * query-mutants-third-1.test.ts). Each is the example's query (query.ts) with one choice made another way, written as
 * the text it finds in query.ts and the text it puts in its place. Test code only: nothing outside the tests imports
 * this file.
 *
 * This list tests the pairs promise (more grids spec 5.5, "Pairs, and no more"). Every `WRONG` Data Query is right
 * until ONE condition holds: one filter operator, one shape of group, a filter on a hidden column, the first sort's
 * direction, the first sorted column's kind, or a hidden sorted column. Under that condition it breaks one rule about
 * sorting or counting. `RIGHT` are right Data Queries: each makes a choice rulings R1 to R4 leave to the Host, and the
 * Query Check must pass every one. The ids are this held-out list's (W301 to W339, V301 to V317). W337 is not here: it
 * needs two conditions, and the list moved it to its two-condition entries (T-W337, in the table in the test file).
 */
import type { ViewState } from "gridcue";
import type { Mutant } from "./query-mutants";

// The pieces of query.ts these change, exactly as the file has them.
const ORDER_CALL = "const order = orderSql(schema, sorts);";
const KEYS = "const keys = sorts.map((s) => {";
const KEY = 'return `${quoted(column.id)}${TEXT_KINDS.has(column.kind) ? " COLLATE NOCASE" : ""} ${direction}`;';
const ON_PAGE = "const rowsOnPage = limit === undefined ? page.size : Math.max(0, Math.min(page.size, limit - page.offset));";
const ROWS_SQL = "sql: `SELECT ${columns} FROM ${TABLE}${where} ORDER BY ${order} LIMIT ? OFFSET ?`,";
const ROWS_PARAMS = "params: [...params, rowsOnPage, page.offset],";
const OWN_TOTAL =
  "limit === undefined\n        ? { sql: `SELECT count(*) AS total FROM ${TABLE}${where}`, params: [...params] }\n        : { sql: `SELECT min(count(*), ?) AS total FROM ${TABLE}${where}`, params: [limit, ...params] }";
const TOTAL = `total:\n      ${OWN_TOTAL},`;
const TOTAL_PARAMS = "params: [limit, ...params] }";
const CONDITIONS = "const conditions = state.filters ? [groupSql(schema, state.filters, params)] : [];";
const PARTS = "const parts = group.children.map((child) =>";
const JOINS = 'const JOINS = { and: " AND ", or: " OR " } as const;';
const IN = 'return `${cell} IN (${value.map(() => "?").join(", ")})`;';
const IS_EMPTY = "      return empty;\n";

/** The rows' own key: the first column of both schemas the tests run on holds the ids. */
const ID = "quoted(returnedColumns(schema)[0]?.id as string)";
const VISIBLE = "state.visibleColumnIds.includes(s.columnId)";
/** The example's own sort key for a column, after `KEY`'s `return`. */
const OWN_KEY = '`${quoted(column.id)}${TEXT_KINDS.has(column.kind) ? " COLLATE NOCASE" : ""} ${direction}`';

// --- The one condition each wrong Data Query turns on, as code inside buildRowsQuery ---------------------------------

/** The View State's filters hold this operator anywhere. */
const has = (operator: string) => `JSON.stringify(state.filters ?? null).includes('"operator":"${operator}"')`;
/** The filters hold an or group anywhere. */
const HAS_OR = 'JSON.stringify(state.filters ?? null).includes(\'"combinator":"or"\')';
/** The filters hold an `inner` group directly inside an `outer` group, anywhere. */
const nested = (outer: "and" | "or", inner: "and" | "or") =>
  `(function walk(g: FilterGroup | undefined): boolean { return g !== undefined && g !== null && g.children.some((c) => c.type === "group" && ((g.combinator === "${outer}" && c.combinator === "${inner}") || walk(c))); })(state.filters)`;
const OR_IN_AND = nested("and", "or");
const AND_IN_OR = nested("or", "and");
/** A filter sits on a column that is not shown. */
const HIDDEN_FILTER =
  '(function walk(g: FilterGroup | undefined): boolean { return g !== undefined && g !== null && g.children.some((c) => (c.type === "group" ? walk(c) : !state.visibleColumnIds.includes(c.columnId))); })(state.filters)';
const FIRST_ASC = 'sorts[0]?.direction === "asc"';
const FIRST_DESC = 'sorts[0]?.direction === "desc"';
/** The first sorted column is of this kind. */
const firstIs = (kind: string) => `(sorts[0] !== undefined && usableColumn(schema, sorts[0].columnId, "sort").kind === "${kind}")`;
/** Some sorted column is not shown. */
const HIDDEN_SORT = `sorts.some((s) => !${VISIBLE})`;

// --- The rule each one breaks under its condition --------------------------------------------------------------------

type Edits = Mutant["edits"];
const FLIPPED = '{ ...s, direction: s.direction === "asc" ? ("desc" as const) : ("asc" as const) }';

/** Under `when`, the rows are ordered by `sorts` (an expression for other sorts), not the View State's. */
const sortedBy = (when: string, sorts: string): Edits => [[ORDER_CALL, `const order = orderSql(schema, ${when} ? ${sorts} : sorts);`]];
/** Under `when`, no sort reaches ORDER BY: the rows come as they were loaded. */
const sortsDropped = (when: string): Edits => [[ORDER_CALL, `const order = ${when} ? "rowid" : orderSql(schema, sorts);`]];
const everySortFlipped = (when: string): Edits => sortedBy(when, `sorts.map((s) => (${FLIPPED}))`);
const firstSortOnly = (when: string): Edits => sortedBy(when, "sorts.slice(0, 1)");
const laterSortsFlipped = (when: string): Edits => sortedBy(when, `sorts.map((s, i) => (i > 0 ? ${FLIPPED} : s))`);

/** Under `when`, a count keeps `delta` rows more or fewer than its number. */
const countOffBy = (when: string, delta: "+ 1" | "- 1"): Edits => [
  [
    ON_PAGE,
    `const cap = limit === undefined ? undefined : ${when} ? limit ${delta} : limit;\n  const rowsOnPage = cap === undefined ? page.size : Math.max(0, Math.min(page.size, cap - page.offset));`,
  ],
  [TOTAL_PARAMS, "params: [cap as number, ...params] }"],
];

/**
 * A count made in SQL, not by the page's LIMIT: when there is a count and `when` holds, the rows come from `source` (a
 * query over the table), with `sourceParams` bound to its `?`s, and each page reads them in `outer`. Otherwise the
 * query is the example's own. `before` is code run first.
 */
const cutWhen = (when: string, before: string, source: string, sourceParams: string, outer = "${order}"): Edits => [
  [
    ON_PAGE,
    `${ON_PAGE}\n  ${before}\n  const cutting = limit !== undefined && (${when});\n  const cut = cutting ? \`(${source})\` : \`\${TABLE}\${where}\`;\n  const cutParams: SQLInputValue[] = cutting ? [${sourceParams}] : [...params];`,
  ],
  [ROWS_SQL, `sql: \`SELECT \${columns} FROM \${cut} ORDER BY \${cutting ? \`${outer}\` : order} LIMIT ? OFFSET ?\`,`],
  [ROWS_PARAMS, "params: [...cutParams, cutting ? page.size : rowsOnPage, page.offset],"],
  [TOTAL, `total: cutting\n      ? { sql: \`SELECT count(*) AS total FROM \${cut}\`, params: [...cutParams] }\n      : ${OWN_TOTAL},`],
];

/** Under `when`, a count is `RANK() <= N`: every row that ties at the cut is kept, so more than N rows come back. */
const countByRank = (when: string): Edits =>
  cutWhen(
    when,
    'const keysOnly = order.replace(/, rowid$/, "");',
    "SELECT * FROM (SELECT *, rowid AS rowid, RANK() OVER (ORDER BY ${keysOnly}) AS r FROM ${TABLE}${where}) WHERE r <= ?",
    "...params, limit as number",
  );

/**
 * Under `when`, a count keeps only the rows strictly ahead of the Nth row's value in the first sorted column, so the
 * rows that tie at the cut are dropped.
 */
const tiedRunDropped = (when: string): Edits =>
  cutWhen(
    when,
    'const firstKey = orderSql(schema, sorts.slice(0, 1)).replace(/, rowid$/, "");',
    "SELECT * FROM (SELECT *, rowid AS rowid, RANK() OVER (ORDER BY ${firstKey}) AS r FROM ${TABLE}${where}) WHERE r < (SELECT r FROM (SELECT RANK() OVER (ORDER BY ${firstKey}) AS r FROM ${TABLE}${where}) ORDER BY r LIMIT 1 OFFSET ?)",
    "...params, ...params, (limit as number) - 1",
  );

/** Under `when`, a count is cut by `cutKeys` (an ORDER BY list ending in rowid), then read in the example's order. */
const cutBy = (when: string, cutKeys: string): Edits =>
  cutWhen(
    when,
    `const cutKeys = ${cutKeys};`,
    "SELECT *, rowid AS rowid FROM ${TABLE}${where} ORDER BY ${cutKeys} LIMIT ?",
    "...params, limit as number",
  );
const cutByFirstSortAlone = (when: string): Edits => cutBy(when, "orderSql(schema, sorts.slice(0, 1))");

/** The first sort's key is `key` when its column is of `kind`. */
const firstKeyOf = (kind: string, key: string): Edits => [
  [KEYS, "const keys = sorts.map((s, i) => {"],
  [KEY, `return i === 0 && column.kind === "${kind}" ? ${key} : ${OWN_KEY};`],
];

/** Wrong translations. `rule` is the rule each one breaks, and the one condition it breaks it under. */
export const WRONG: readonly Mutant[] = [
  // --- eq ---
  { id: "W301", rule: "a sort orders the rows beside an eq filter (not dropped)", edits: sortsDropped(has("eq")) },
  {
    id: "W302",
    rule: "a count keeps exactly its number of rows beside an eq filter (not every tied row, RANK)",
    edits: countByRank(has("eq")),
  },
  // --- neq ---
  { id: "W303", rule: "every sort keeps its direction beside a neq filter", edits: everySortFlipped(has("neq")) },
  { id: "W304", rule: "a count keeps its number of rows beside a neq filter (not one more)", edits: countOffBy(has("neq"), "+ 1") },
  // --- in ---
  { id: "W305", rule: "a second sort orders the rows beside an in filter (not the first alone)", edits: firstSortOnly(has("in")) },
  { id: "W306", rule: "a count keeps the rows that tie at its cut beside an in filter", edits: tiedRunDropped(has("in")) },
  // --- one comparison ---
  { id: "W307", rule: "a second sort keeps its direction beside a gt filter", edits: laterSortsFlipped(has("gt")) },
  { id: "W308", rule: "a count keeps its number of rows beside an lte filter (not one fewer)", edits: countOffBy(has("lte"), "- 1") },
  // --- between ---
  {
    id: "W309",
    rule: "a count cuts by both sorts beside a between filter (not the first alone)",
    edits: cutByFirstSortAlone(has("between")),
  },
  { id: "W310", rule: "a sort orders the rows beside a between filter (not dropped)", edits: sortsDropped(has("between")) },
  // --- contains ---
  { id: "W311", rule: "every sort keeps its direction beside a contains filter", edits: everySortFlipped(has("contains")) },
  {
    id: "W312",
    rule: "a count keeps exactly its number of rows beside a contains filter (not every tied row, RANK)",
    edits: countByRank(has("contains")),
  },
  // --- startsWith ---
  {
    id: "W313",
    rule: "a second sort orders the rows beside a startsWith filter (not the first alone)",
    edits: firstSortOnly(has("startsWith")),
  },
  {
    id: "W314",
    rule: "a count keeps its number of rows beside a startsWith filter (not one more)",
    edits: countOffBy(has("startsWith"), "+ 1"),
  },
  // --- isEmpty ---
  { id: "W315", rule: "a sort orders the rows beside an isEmpty filter (not dropped)", edits: sortsDropped(has("isEmpty")) },
  { id: "W316", rule: "a count keeps the rows that tie at its cut beside an isEmpty filter", edits: tiedRunDropped(has("isEmpty")) },
  // --- isNotEmpty ---
  { id: "W317", rule: "a second sort keeps its direction beside an isNotEmpty filter", edits: laterSortsFlipped(has("isNotEmpty")) },
  {
    id: "W318",
    rule: "a count keeps its number of rows beside an isNotEmpty filter (not one fewer)",
    edits: countOffBy(has("isNotEmpty"), "- 1"),
  },
  // --- an or group ---
  { id: "W319", rule: "a second sort orders the rows beside an or group (not the first alone)", edits: firstSortOnly(HAS_OR) },
  {
    id: "W320",
    rule: "a count keeps exactly its number of rows beside an or group (not every tied row, RANK)",
    edits: countByRank(HAS_OR),
  },
  // --- an or group inside an and ---
  { id: "W321", rule: "every sort keeps its direction beside an or group inside an and", edits: everySortFlipped(OR_IN_AND) },
  {
    id: "W322",
    rule: "a count cuts by both sorts beside an or group inside an and (not the first alone)",
    edits: cutByFirstSortAlone(OR_IN_AND),
  },
  // --- an and group inside an or ---
  { id: "W323", rule: "a sort orders the rows beside an and group inside an or (not dropped)", edits: sortsDropped(AND_IN_OR) },
  {
    id: "W324",
    rule: "a count keeps its number of rows beside an and group inside an or (not one more)",
    edits: countOffBy(AND_IN_OR, "+ 1"),
  },
  // --- a filter on a hidden column ---
  { id: "W325", rule: "every sort keeps its direction beside a filter on a hidden column", edits: everySortFlipped(HIDDEN_FILTER) },
  {
    id: "W326",
    rule: "a count keeps exactly its number of rows beside a filter on a hidden column (not every tied row, RANK)",
    edits: countByRank(HIDDEN_FILTER),
  },
  // --- the first sort's direction ---
  { id: "W327", rule: "a count going up keeps exactly its number of rows (not every tied row, RANK)", edits: countByRank(FIRST_ASC) },
  { id: "W328", rule: "a count going up keeps the rows that tie at its cut", edits: tiedRunDropped(FIRST_ASC) },
  { id: "W329", rule: "every sort keeps its direction when the first goes down", edits: everySortFlipped(FIRST_DESC) },
  { id: "W330", rule: "a count going down keeps its number of rows (not one fewer)", edits: countOffBy(FIRST_DESC, "- 1") },
  // --- the first sorted column's kind ---
  {
    id: "W331",
    rule: "a second sort orders the rows after a yes/no column (not the first alone)",
    edits: firstSortOnly(firstIs("boolean")),
  },
  { id: "W332", rule: "every sort keeps its direction when the first sorted column is a date", edits: everySortFlipped(firstIs("date")) },
  {
    id: "W333",
    rule: "text sorts by its letters, ignoring case (not capitals first), when it is the first sort",
    edits: firstKeyOf("string", "`${quoted(column.id)} ${direction}`"),
  },
  {
    id: "W334",
    rule: "an enum sorts by its values' IDs as text (not in the order they were declared), when it is the first sort",
    edits: firstKeyOf(
      "enum",
      '`CASE ${quoted(column.id)} ${(column.enumValues ?? []).map((v, n) => `WHEN ${String.fromCharCode(39)}${v.id}${String.fromCharCode(39)} THEN ${n}`).join(" ")} END ${direction}`',
    ),
  },
  // --- a hidden sorted column ---
  {
    id: "W335",
    rule: "a hidden second sorted column still orders the rows",
    edits: sortedBy("true", `sorts.filter((s, i) => i === 0 || ${VISIBLE})`),
  },
  {
    id: "W336",
    rule: "a hidden first sorted column still orders the rows",
    edits: sortedBy("true", `sorts.filter((s, i) => i > 0 || ${VISIBLE})`),
  },
  // --- a filter on a hidden column, left out ---
  {
    id: "W338",
    rule: "a filter on a hidden column still holds",
    edits: [
      [JOINS, `let shownColumns: readonly string[] = [];\n${JOINS}`],
      [
        PARTS,
        'const kids = group.children.filter((child) => child.type === "group" || shownColumns.includes((child as FilterPredicate).columnId));\n  if (kids.length === 0) return "1";\n  const parts = kids.map((child) =>',
      ],
      [CONDITIONS, `shownColumns = state.visibleColumnIds;\n  ${CONDITIONS}`],
    ],
  },
  {
    id: "W339",
    rule: "a count cuts by a hidden sorted column too",
    edits: cutBy(HIDDEN_SORT, `orderSql(schema, sorts.filter((s) => ${VISIBLE}))`),
  },
];

/** The sort keys as the example writes them, with the key at `index` changed, when `when` holds. */
const keyAt = (when: string, index: number, from: string, to: string): Edits => [
  [
    ORDER_CALL,
    `const order = ${when} ? orderSql(schema, sorts).split(", ").map((k, i) => (i === ${index} ? k.replace("${from}", "${to}") : k)).join(", ") : orderSql(schema, sorts);`,
  ],
];
/** Rows that tie on every sort come in the order `last` gives, not the load order, when `when` holds. */
const tiesBy = (when: string, last: string): Edits => [
  [ORDER_CALL, `const order = ${when} ? orderSql(schema, sorts).replace(/, rowid$/, \`, ${last}\`) : orderSql(schema, sorts);`],
];

/**
 * Right Data Queries: what rulings R1 to R4 leave to the Host. `rule` says the choice each one makes. V303, V304 and
 * V314 are choices the example's query already makes, so they change nothing: they are here so the list is whole.
 */
export const RIGHT: readonly Mutant[] = [
  { id: "V301", rule: "beside an eq filter, ties are broken by the rows' own key (R1, R2)", edits: tiesBy(has("eq"), `\${${ID}}`) },
  {
    id: "V302",
    rule: "beside an in filter, empty cells of a first sort going up come first (R3)",
    edits: keyAt(`${has("in")} && ${FIRST_ASC}`, 0, "ASC NULLS LAST", "ASC NULLS FIRST"),
  },
  { id: "V303", rule: "empty cells of a first sort going up come last (R3): the example's own choice", edits: [] },
  { id: "V304", rule: "empty cells of a first sort going down come first (R3): the example's own choice", edits: [] },
  {
    id: "V305",
    rule: "beside an in filter, empty cells of a second sort going down come last (R3)",
    edits: keyAt(has("in"), 1, "DESC NULLS FIRST", "DESC NULLS LAST"),
  },
  {
    id: "V306",
    rule: "text sorts with its spaces skipped (R4)",
    edits: [[KEY, `return column.kind === "string" ? \`lower(replace(\${quoted(column.id)}, ' ', '')) \${direction}\` : ${OWN_KEY};`]],
  },
  {
    id: "V307",
    rule: "beside an eq filter, text sorts by lower() and not by a collation: another path, the same order",
    edits: [
      [JOINS, `let eqPath = false;\n${JOINS}`],
      [KEY, `return eqPath && column.kind === "string" ? \`lower(\${quoted(column.id)}) \${direction}\` : ${OWN_KEY};`],
      [ORDER_CALL, `eqPath = ${has("eq")};\n  const order = orderSql(schema, sorts);\n  eqPath = false;`],
    ],
  },
  {
    id: "V308",
    rule: "beside an or group, a count is ROW_NUMBER over every sort and the rows' own key (R2)",
    edits: cutWhen(
      HAS_OR,
      `const keysOnly = order.replace(/, rowid$/, "");\n  const idKey = ${ID};`,
      "SELECT * FROM (SELECT *, rowid AS rowid, ROW_NUMBER() OVER (ORDER BY ${keysOnly}, ${idKey}) AS rn FROM ${TABLE}${where}) WHERE rn <= ?",
      "...params, limit as number",
      "rn",
    ),
  },
  {
    id: "V309",
    rule: "beside a neq filter, tied rows come in the reverse of their load order (R1)",
    edits: tiesBy(has("neq"), "rowid DESC"),
  },
  {
    id: "V310",
    rule: "beside a filter on a hidden column, the rows' own key is the last key of a count's cut (R2)",
    edits: tiesBy(HIDDEN_FILTER, `\${${ID}}`),
  },
  {
    id: "V311",
    rule: "beside a contains filter, a count is an IN subquery cut by the same sorts (R2)",
    edits: cutWhen(
      has("contains"),
      `const idKey = ${ID};`,
      "SELECT *, rowid AS rowid FROM ${TABLE} WHERE ${idKey} IN (SELECT ${idKey} FROM ${TABLE}${where} ORDER BY ${order} LIMIT ?)",
      "...params, limit as number",
    ),
  },
  {
    id: "V312",
    rule: "isEmpty on text is NULLIF(cell, '') IS NULL",
    edits: [[IS_EMPTY, "      return TEXT_KINDS.has(column.kind) ? `NULLIF(${c}, '') IS NULL` : empty;\n"]],
  },
  {
    id: "V313",
    rule: "a number going down is sorted by its negation, going up",
    edits: [[KEY, `return NUMBER_KINDS.has(column.kind) && s.direction === "desc" ? \`-\${quoted(column.id)} ASC\` : ${OWN_KEY};`]],
  },
  { id: "V314", rule: "enum and text sort by a collation that ignores case (R4): the example's own choice", edits: [] },
  {
    id: "V315",
    rule: "a yes/no sort reads an empty cell as no (R3)",
    edits: [[KEY, `return column.kind === "boolean" ? \`coalesce(\${quoted(column.id)}, 0) \${direction}\` : ${OWN_KEY};`]],
  },
  {
    id: "V316",
    rule: "an in filter is written as equals joined by or",
    edits: [[IN, 'return `(${value.map(() => `${cell} = ?`).join(" OR ")})`;']],
  },
  {
    id: "V317",
    rule: "beside an and group inside an or, the rows are read by ROW_NUMBER over every sort and the rows' own key (R1)",
    edits: [
      [
        ON_PAGE,
        `${ON_PAGE}\n  const numbered = ${AND_IN_OR};\n  const from = numbered ? \`(SELECT *, ROW_NUMBER() OVER (ORDER BY \${order.replace(/, rowid$/, "")}, \${${ID}}) AS rn FROM \${TABLE}\${where})\` : \`\${TABLE}\${where}\`;`,
      ],
      [ROWS_SQL, 'sql: `SELECT ${columns} FROM ${from} ORDER BY ${numbered ? "rn" : order} LIMIT ? OFFSET ?`,'],
    ],
  },
];

// --- Probes: rows and a View State on which each wrong Data Query differs from applyView ------------------------------

type Cells = Record<string, unknown>;
export interface Probe {
  /** Ledger cells for each row, in load order. Row n has the id "n", from 1. */
  cells: readonly Cells[];
  /** The parts of the View State the probe sets. */
  state: Partial<Pick<ViewState, "filters" | "sorts" | "limit">>;
  /** Columns that are not shown. */
  hidden?: readonly string[];
  /** Whether the ids are compared in order (the mutant changes the order) or as a set (it changes which rows). */
  ordered: boolean;
}

const leaf = (id: string, columnId: string, operator: string, value?: unknown) => ({
  id,
  type: "predicate" as const,
  columnId,
  operator,
  ...(value === undefined ? {} : { value }),
});
const group = (id: string, combinator: "and" | "or", children: unknown[]) => ({ id, type: "group" as const, combinator, children });
const where = (...children: unknown[]) => group("root", "and", children) as ViewState["filters"];
const whereAny = (...children: unknown[]) => group("root", "or", children) as ViewState["filters"];
const up = (columnId: string) => ({ columnId, direction: "asc" as const });
const down = (columnId: string) => ({ columnId, direction: "desc" as const });
const each = <K extends string>(keys: readonly K[], rows: ReadonlyArray<readonly unknown[]>): Cells[] =>
  rows.map((row) => Object.fromEntries(keys.map((key, i) => [key, row[i]])));

const AVERY_OR_FEES_OVER_5 = whereAny(
  leaf("f1", "owner", "eq", "Avery"),
  group("g1", "and", [leaf("f2", "category", "eq", "fees"), leaf("f3", "units", "gt", 5)]),
);

/** The held-out list's own data for each wrong Data Query, on the ledger schema. */
export const PROBES: Record<string, Probe> = {
  W301: {
    cells: each(
      ["owner", "amount"],
      [
        ["Avery", 30],
        ["Blake", 5],
        ["Avery", 20],
        ["Avery", 10],
      ],
    ),
    state: { filters: where(leaf("f1", "owner", "eq", "Avery")), sorts: [up("amount")] },
    ordered: true,
  },
  W302: {
    cells: each(
      ["category", "units"],
      [
        ["fees", 1],
        ["fees", 2],
        ["fees", 2],
        ["fees", 2],
        ["fees", 9],
        ["travel", 1],
      ],
    ),
    state: { filters: where(leaf("f1", "category", "eq", "fees")), sorts: [up("units")], limit: 3 },
    ordered: false,
  },
  W303: {
    cells: each(
      ["counterparty", "units", "amount"],
      [
        ["Alder", 1, 5],
        ["Birch", 2, 3],
        ["Alder", 3, 1],
        ["Cedar Works", 2, 9],
      ],
    ),
    state: { filters: where(leaf("f1", "counterparty", "neq", "Cedar Works")), sorts: [up("units"), up("amount")] },
    ordered: true,
  },
  W304: {
    cells: each(
      ["owner", "amount"],
      [
        ["Avery", 40],
        ["Blake", 50],
        ["Casey", 30],
        ["Dana", 20],
        ["Emer", 10],
      ],
    ),
    state: { filters: where(leaf("f1", "owner", "neq", "Blake")), sorts: [down("amount")], limit: 2 },
    ordered: false,
  },
  W305: {
    cells: each(
      ["category", "amount"],
      [
        ["fees", 10],
        ["fees", 30],
        ["fees", 20],
        ["travel", 5],
        ["supplies", 99],
      ],
    ),
    state: { filters: where(leaf("f1", "category", "in", ["fees", "travel"])), sorts: [up("category"), down("amount")] },
    ordered: true,
  },
  W306: {
    cells: each(
      ["owner", "units"],
      [
        ["Avery", 1],
        ["Blake", 2],
        ["Avery", 3],
        ["Blake", 3],
        ["Avery", 3],
        ["Blake", 7],
        ["Casey", 1],
      ],
    ),
    state: { filters: where(leaf("f1", "owner", "in", ["Avery", "Blake"])), sorts: [up("units")], limit: 4 },
    ordered: false,
  },
  W307: {
    cells: each(
      ["owner", "units", "amount"],
      [
        ["Avery", 1, 200],
        ["Avery", 2, 300],
        ["Blake", 1, 150],
        ["Avery", 9, 50],
      ],
    ),
    state: { filters: where(leaf("f1", "amount", "gt", 100)), sorts: [up("owner"), up("units")] },
    ordered: true,
  },
  W308: {
    cells: each(
      ["units", "amount"],
      [
        [2, 40],
        [4, 30],
        [6, 20],
        [8, 10],
        [20, 99],
      ],
    ),
    state: { filters: where(leaf("f1", "units", "lte", 10)), sorts: [down("amount")], limit: 3 },
    ordered: false,
  },
  W309: {
    cells: each(
      ["amount", "category", "units"],
      [
        [20, "fees", 9],
        [20, "fees", 3],
        [20, "fees", 1],
        [20, "travel", 1],
        [500, "fees", 0],
      ],
    ),
    state: { filters: where(leaf("f1", "amount", "between", { min: 10, max: 100 })), sorts: [up("category"), up("units")], limit: 2 },
    ordered: false,
  },
  W310: {
    cells: each(["units"], [[2], [5], [3], [9]]),
    state: { filters: where(leaf("f1", "units", "between", { min: 2, max: 5 })), sorts: [down("units")] },
    ordered: true,
  },
  W311: {
    cells: each(
      ["counterparty", "amount"],
      [
        ["Cedar Works", 10],
        ["Birch Works", 30],
        ["Alder Supply", 99],
        ["Dun Works", 20],
      ],
    ),
    state: { filters: where(leaf("f1", "counterparty", "contains", "works")), sorts: [down("amount")] },
    ordered: true,
  },
  W312: {
    cells: each(
      ["owner", "amount"],
      [
        ["Avery", 5],
        ["Blake", 7],
        ["Dana", 7],
        ["Casey", 7],
        ["Bob", 1],
      ],
    ),
    state: { filters: where(leaf("f1", "owner", "contains", "a")), sorts: [up("amount")], limit: 2 },
    ordered: false,
  },
  W313: {
    cells: each(
      ["owner", "category", "amount"],
      [
        ["Avery", "fees", 30],
        ["Alder", "fees", 10],
        ["Abe", "fees", 20],
        ["Blake", "fees", 1],
      ],
    ),
    state: { filters: where(leaf("f1", "owner", "startsWith", "a")), sorts: [up("category"), up("amount")] },
    ordered: true,
  },
  W314: {
    cells: each(
      ["owner", "units"],
      [
        ["Casey", 5],
        ["Carla", 9],
        ["Cal", 7],
        ["Dana", 50],
      ],
    ),
    state: { filters: where(leaf("f1", "owner", "startsWith", "ca")), sorts: [down("units")], limit: 1 },
    ordered: false,
  },
  W315: {
    cells: each(
      ["counterparty", "amount"],
      [
        [null, 10],
        ["", 30],
        [null, 20],
        ["Cedar", 99],
      ],
    ),
    state: { filters: where(leaf("f1", "counterparty", "isEmpty")), sorts: [down("amount")] },
    ordered: true,
  },
  W316: {
    cells: each(
      ["counterparty", "units"],
      [
        [null, 1],
        ["", 2],
        [null, 2],
        ["", 2],
        [null, 4],
      ],
    ),
    state: { filters: where(leaf("f1", "counterparty", "isEmpty")), sorts: [up("units")], limit: 3 },
    ordered: false,
  },
  W317: {
    cells: each(
      ["counterparty", "category", "amount"],
      [
        ["Alder", "fees", 10],
        ["Birch", "fees", 20],
        [null, "fees", 15],
      ],
    ),
    state: { filters: where(leaf("f1", "counterparty", "isNotEmpty")), sorts: [up("category"), up("amount")] },
    ordered: true,
  },
  W318: {
    cells: each(
      ["counterparty", "units"],
      [
        ["Alder", 1],
        ["Birch", 2],
        ["Cedar", 3],
        ["Dunmore", 4],
        ["Ellery", 5],
        [null, 0],
      ],
    ),
    state: { filters: where(leaf("f1", "counterparty", "isNotEmpty")), sorts: [up("units")], limit: 3 },
    ordered: false,
  },
  W319: {
    cells: each(
      ["owner", "category", "amount"],
      [
        ["Avery", "fees", 30],
        ["Avery", "fees", 10],
        ["Blake", "travel", 5],
        ["Blake", "supplies", 1],
      ],
    ),
    state: {
      filters: whereAny(leaf("f1", "owner", "eq", "Avery"), leaf("f2", "category", "eq", "travel")),
      sorts: [up("category"), up("amount")],
    },
    ordered: true,
  },
  W320: {
    cells: each(
      ["units", "amount"],
      [
        [1, 10],
        [1, 20],
        [1, 30],
        [9, 900],
        [9, 1],
      ],
    ),
    state: { filters: whereAny(leaf("f1", "units", "lt", 2), leaf("f2", "amount", "gt", 500)), sorts: [up("units")], limit: 2 },
    ordered: false,
  },
  W321: {
    cells: each(
      ["category", "units", "amount"],
      [
        ["fees", 1, 10],
        ["travel", 1, 20],
        ["supplies", 1, 15],
      ],
    ),
    state: {
      filters: where(
        leaf("f1", "units", "gt", 0),
        group("g1", "or", [leaf("f2", "category", "eq", "fees"), leaf("f3", "category", "eq", "travel")]),
      ),
      sorts: [up("amount")],
    },
    ordered: true,
  },
  W322: {
    cells: each(
      ["amount", "owner", "category", "units"],
      [
        [1, "Avery", "fees", 9],
        [1, "Blake", "fees", 3],
        [1, "Avery", "fees", 1],
        [1, "Avery", "travel", 1],
        [1, "Casey", "fees", 0],
      ],
    ),
    state: {
      filters: where(
        leaf("f1", "amount", "gt", 0),
        group("g1", "or", [leaf("f2", "owner", "eq", "Avery"), leaf("f3", "owner", "eq", "Blake")]),
      ),
      sorts: [up("category"), up("units")],
      limit: 2,
    },
    ordered: false,
  },
  W323: {
    cells: each(
      ["owner", "category", "units", "amount"],
      [
        ["Avery", "travel", 1, 30],
        ["Blake", "fees", 9, 20],
        ["Avery", "travel", 1, 10],
        ["Blake", "travel", 9, 1],
      ],
    ),
    state: { filters: AVERY_OR_FEES_OVER_5, sorts: [up("amount")] },
    ordered: true,
  },
  W324: {
    cells: each(
      ["owner", "category", "units", "amount"],
      [
        ["Avery", "travel", 1, 40],
        ["Blake", "fees", 9, 30],
        ["Avery", "travel", 1, 20],
        ["Blake", "fees", 8, 10],
        ["Blake", "travel", 9, 99],
      ],
    ),
    state: { filters: AVERY_OR_FEES_OVER_5, sorts: [down("amount")], limit: 2 },
    ordered: false,
  },
  W325: {
    cells: each(
      ["cleared", "amount"],
      [
        [true, 10],
        [true, 20],
        [false, 5],
      ],
    ),
    state: { filters: where(leaf("f1", "cleared", "eq", true)), sorts: [up("amount")] },
    hidden: ["cleared"],
    ordered: true,
  },
  W326: {
    cells: each(
      ["category", "units"],
      [
        ["fees", 1],
        ["fees", 2],
        ["fees", 2],
        ["fees", 2],
        ["travel", 1],
      ],
    ),
    state: { filters: where(leaf("f1", "category", "eq", "fees")), sorts: [up("units")], limit: 2 },
    hidden: ["category"],
    ordered: false,
  },
  W327: { cells: each(["units"], [[1], [1], [1], [4]]), state: { sorts: [up("units")], limit: 2 }, ordered: false },
  W328: { cells: each(["amount"], [[5], [6], [6], [6], [9]]), state: { sorts: [up("amount")], limit: 3 }, ordered: false },
  W329: {
    cells: each(
      ["units", "amount"],
      [
        [1, 1],
        [2, 1],
        [2, 2],
      ],
    ),
    state: { sorts: [down("units"), up("amount")] },
    ordered: true,
  },
  W330: { cells: each(["amount"], [[50], [40], [30], [20], [10]]), state: { sorts: [down("amount")], limit: 3 }, ordered: false },
  W331: {
    cells: each(
      ["cleared", "amount"],
      [
        [true, 30],
        [true, 10],
        [false, 5],
      ],
    ),
    state: { sorts: [down("cleared"), up("amount")] },
    ordered: true,
  },
  W332: {
    cells: each(
      ["booked", "units"],
      [
        ["2025-03-01", 1],
        ["2025-01-10", 1],
        ["2026-01-05", 1],
      ],
    ),
    state: { sorts: [up("booked"), up("units")] },
    ordered: true,
  },
  W333: { cells: each(["owner"], [["bravo"], ["Zed"], ["alpha"]]), state: { sorts: [up("owner")] }, ordered: true },
  W334: { cells: each(["category"], [["travel"], ["services"], ["fees"]]), state: { sorts: [up("category")] }, ordered: true },
  W335: {
    cells: each(
      ["category", "amount"],
      [
        ["fees", 10],
        ["fees", 30],
        ["fees", 20],
        ["travel", 5],
      ],
    ),
    state: { sorts: [up("category"), down("amount")] },
    hidden: ["amount"],
    ordered: true,
  },
  W336: {
    cells: each(
      ["category", "amount"],
      [
        ["travel", 1],
        ["fees", 9],
        ["fees", 5],
      ],
    ),
    state: { sorts: [up("category"), up("amount")] },
    hidden: ["category"],
    ordered: true,
  },
  W338: {
    cells: each(
      ["category", "amount"],
      [
        ["fees", 10],
        ["travel", 5],
      ],
    ),
    state: { filters: where(leaf("f1", "category", "eq", "fees")), sorts: [up("amount")] },
    hidden: ["category"],
    ordered: true,
  },
  W339: {
    cells: each(
      ["category", "amount"],
      [
        ["fees", 30],
        ["fees", 20],
        ["fees", 10],
        ["travel", 1],
      ],
    ),
    state: { sorts: [up("category"), up("amount")], limit: 2 },
    hidden: ["amount"],
    ordered: false,
  },
};
