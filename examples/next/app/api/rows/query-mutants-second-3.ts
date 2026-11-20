// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the strings are query.ts source text, which holds template literals.
/**
 * Data Queries from the second held-out check of the Query Check, round 3, for the Query Check's own tests (see
 * query-mutants-second-3.test.ts). Each is the example's query (query.ts) with one choice made another way, written as
 * the text it finds in query.ts and the text it puts in its place. Test code only: nothing outside the tests imports
 * this file.
 *
 * `WRONG` are wrong translations: each keeps rows, or an order, that `applyView` doesn't, past what rulings R1 to R3
 * (more grids spec 5.5, `compare`) leave to the Host. `RIGHT` are right Data Queries: each makes a choice the rulings
 * leave to the Host, and the Query Check must pass every one. The ids are this held-out list's (W201 to W225, V201 to
 * V208). W224 reads a row twice across pages and loses none: whether that fails is ruling R5, still the owner's, so it
 * is apart from `WRONG`. W220 stays in `WRONG` as the list wrote it, but a later ruling makes it a right Data Query
 * (spec 5.5, "Text order beyond the letters A to Z"): the test holds the Query Check to passing it.
 */
import type { Mutant } from "./query-mutants";

// The pieces of query.ts these change, exactly as the file has them.
const ORDER = 'return [...keys, "rowid"].join(", ");';
const KEY = 'return `${quoted(column.id)}${TEXT_KINDS.has(column.kind) ? " COLLATE NOCASE" : ""} ${direction}`;';
const ORDER_CALL = "const order = orderSql(schema, sorts);";
const LIMIT = "const limit = state.limit;";
const ON_PAGE = "const rowsOnPage = limit === undefined ? page.size : Math.max(0, Math.min(page.size, limit - page.offset));";
const ROWS_SQL = "sql: `SELECT ${columns} FROM ${TABLE}${where} ORDER BY ${order} LIMIT ? OFFSET ?`,";
const ROWS_PARAMS = "params: [...params, rowsOnPage, page.offset],";
const OWN_TOTAL =
  "limit === undefined\n        ? { sql: `SELECT count(*) AS total FROM ${TABLE}${where}`, params: [...params] }\n        : { sql: `SELECT min(count(*), ?) AS total FROM ${TABLE}${where}`, params: [limit, ...params] }";
const TOTAL = `total:\n      ${OWN_TOTAL},`;
const CONDITIONS = "const conditions = state.filters ? [groupSql(schema, state.filters, params)] : [];";
const PARTS = "const parts = group.children.map((child) =>";
const CHILD = 'child.type === "group" ? groupSql(schema, child, params) : predicateSql(schema, child as FilterPredicate, params),';
const JOINS = 'const JOINS = { and: " AND ", or: " OR " } as const;';

/** The rows' own key: the first column of both schemas the tests run on holds the ids. */
const ID = "quoted(returnedColumns(schema)[0]?.id as string)";
const VISIBLE = "state.visibleColumnIds.includes(s.columnId)";
/** Whether the View State's filters hold an or group anywhere. */
const HAS_OR = 'JSON.stringify(state.filters ?? null).includes(\'"combinator":"or"\')';
/** Whether the root "and" holds an or group. */
const OR_IN_AND =
  '(state.filters?.combinator === "and" && state.filters.children.some((c) => c.type === "group" && JSON.stringify(c).includes(\'"combinator":"or"\')))';
/** The example's own sort key for a column, after `KEY`'s `return`. */
const OWN_KEY = '`${quoted(column.id)}${TEXT_KINDS.has(column.kind) ? " COLLATE NOCASE" : ""} ${direction}`';
const STRING_KEY = (key: string): Mutant["edits"][number] => [KEY, `return column.kind === "string" ? ${key} : ${OWN_KEY};`];
const ID_LAST: Mutant["edits"][number] = [ORDER, `return [...keys, ${ID}].join(", ");`];

/**
 * A count made in SQL, not by the page's LIMIT: when there is a count and `when` holds, the rows come from `source` (a
 * query over the table), with `sourceParams` bound to its `?`s, and each page reads them in `outer`. Otherwise the
 * query is the example's own. `before` is code run first.
 */
const cutWhen = (when: string, before: string, source: string, sourceParams: string, outer = "${order}"): Mutant["edits"] => [
  [
    ON_PAGE,
    `${ON_PAGE}\n  ${before}\n  const cutting = limit !== undefined && (${when});\n  const cut = cutting ? \`(${source})\` : \`\${TABLE}\${where}\`;\n  const cutParams: SQLInputValue[] = cutting ? [${sourceParams}] : [...params];`,
  ],
  [ROWS_SQL, `sql: \`SELECT \${columns} FROM \${cut} ORDER BY \${cutting ? \`${outer}\` : order} LIMIT ? OFFSET ?\`,`],
  [ROWS_PARAMS, "params: [...cutParams, cutting ? page.size : rowsOnPage, page.offset],"],
  [TOTAL, `total: cutting\n      ? { sql: \`SELECT count(*) AS total FROM \${cut}\`, params: [...cutParams] }\n      : ${OWN_TOTAL},`],
];

/** A count cut by `cutKeys` (an ORDER BY list ending in rowid), then read in the example's order. */
const cutBy = (when: string, cutKeys: string): Mutant["edits"] =>
  cutWhen(
    when,
    `const cutKeys = ${cutKeys};`,
    "SELECT *, rowid AS rowid FROM ${TABLE}${where} ORDER BY ${cutKeys} LIMIT ?",
    "...params, limit as number",
  );

/** Filters that leave a leaf on a hidden column out of a group that is not the root, when `drop` holds for it. */
const hiddenLeaf = (drop: string): Mutant["edits"] => [
  [JOINS, `let shownColumns: readonly string[] = [];\nlet rootGroup: unknown;\n${JOINS}`],
  [
    PARTS,
    `const parts = group.children.filter((child) => group === rootGroup || child.type === "group" || shownColumns.includes((child as FilterPredicate).columnId) || !(${drop})).map((child) =>`,
  ],
  [CONDITIONS, `shownColumns = state.visibleColumnIds;\n  rootGroup = state.filters;\n  ${CONDITIONS}`],
];

const NEEDS_SORTS = (n: number) => `sorts.length >= ${n}`;

/** Wrong translations. `rule` is the rule each one breaks. */
export const WRONG: readonly Mutant[] = [
  // --- Class 1: a count cut by fewer than all of three or more sorts (R2) ---
  {
    id: "W201",
    rule: "a count cuts by every sorted column, not the first two of three",
    edits: cutBy(NEEDS_SORTS(3), "orderSql(schema, sorts.slice(0, 2))"),
  },
  {
    id: "W202",
    rule: "a count sorts by every sorted column, not without the middle one",
    edits: [
      [ORDER_CALL, "const order = orderSql(schema, limit !== undefined && sorts.length >= 3 ? sorts.filter((_, i) => i !== 1) : sorts);"],
    ],
  },
  {
    id: "W203",
    rule: "a count cuts by every sorted column, not the first three of four",
    edits: cutBy(NEEDS_SORTS(4), "orderSql(schema, sorts.slice(0, 3))"),
  },
  {
    id: "W204",
    rule: "a count cuts by every sorted column in its own direction (not the third one turned round)",
    edits: cutBy(
      NEEDS_SORTS(3),
      'orderSql(schema, sorts.map((s, i) => (i === 2 ? { ...s, direction: s.direction === "asc" ? ("desc" as const) : ("asc" as const) } : s)))',
    ),
  },
  {
    id: "W205",
    rule: "a count sorts by every sorted column, not without the first one",
    edits: [[ORDER_CALL, "const order = orderSql(schema, limit !== undefined && sorts.length >= 3 ? sorts.slice(1) : sorts);"]],
  },
  // --- Class 2: an or group beside several sorts ---
  {
    id: "W206",
    rule: "a later sort keeps its direction when an or group sits inside an and",
    edits: [
      [
        ORDER_CALL,
        `const order = orderSql(schema, ${OR_IN_AND} ? sorts.map((s, i) => (i > 0 ? { ...s, direction: "asc" as const } : s)) : sorts);`,
      ],
    ],
  },
  {
    id: "W207",
    rule: "every sort orders the rows beside an or group (not the first and then the rows' own key)",
    edits: [
      [
        ORDER_CALL,
        `const order = ${HAS_OR} && sorts.length > 1 ? \`\${orderSql(schema, sorts.slice(0, 1)).replace(/, rowid$/, "")}, \${${ID}}, rowid\` : orderSql(schema, sorts);`,
      ],
    ],
  },
  {
    id: "W208",
    rule: "every sort orders the rows beside an or group of three or more (not the last alone)",
    edits: [
      [
        JOINS,
        `const wideOr = (g: FilterGroup | undefined): boolean => g !== undefined && g !== null && ((g.combinator === "or" && g.children.length >= 3) || g.children.some((c) => c.type === "group" && wideOr(c as FilterGroup)));\n${JOINS}`,
      ],
      [ORDER_CALL, "const order = orderSql(schema, wideOr(state.filters) ? sorts.slice(-1) : sorts);"],
    ],
  },
  // --- Class 3: a count beside an or group ---
  {
    id: "W209",
    rule: "a count caps the rows when an or group sits inside an and",
    edits: [[LIMIT, `const limit = ${OR_IN_AND} ? undefined : state.limit;`]],
  },
  {
    id: "W210",
    rule: "a count keeps the first rows of the filtered rows beside an or group (cut after the filter, not before)",
    edits: cutWhen(
      HAS_OR,
      "",
      'SELECT * FROM (SELECT *, rowid AS rowid FROM ${TABLE}${hasValue ? ` WHERE ${hasValue}` : ""} ORDER BY ${order} LIMIT ?)${state.filters ? ` WHERE ${conditions[0]}` : ""}',
      "limit as number, ...params",
    ),
  },
  {
    id: "W211",
    rule: "a count caps the whole result beside an or group, not each branch",
    edits: cutWhen(
      "branches.length > 0",
      'const branches = state.filters?.combinator === "or" ? state.filters.children.map((child) => { const ps: SQLInputValue[] = []; const sql = groupSql(schema, { ...(state.filters as FilterGroup), children: [child] }, ps); return { sql: `SELECT * FROM (SELECT *, rowid AS rowid FROM ${TABLE} WHERE ${sql}${hasValue ? ` AND ${hasValue}` : ""} ORDER BY ${order} LIMIT ?)`, ps: [...ps, limit as number] }; }) : [];',
      '${branches.map((b) => b.sql).join(" UNION ")}',
      "...branches.flatMap((b) => b.ps)",
    ),
  },
  // --- Class 4: a filter on a hidden column inside nested groups ---
  {
    // Round 2's W116 left out every hidden leaf of a nested or; this leaves out only a comparison.
    id: "W212",
    rule: "a filter on a hidden column still holds in an or group inside an and (a comparison)",
    edits: hiddenLeaf('group.combinator === "or" && ["gt", "gte", "lt", "lte"].includes((child as FilterPredicate).operator)'),
  },
  {
    id: "W213",
    rule: "a filter on a hidden column in an or group inside an and narrows the rows (not always true)",
    edits: [
      [JOINS, `let shownColumns: readonly string[] = [];\nlet rootGroup: unknown;\n${JOINS}`],
      [
        CHILD,
        'child.type === "group" ? groupSql(schema, child, params) : group !== rootGroup && group.combinator === "or" && !shownColumns.includes((child as FilterPredicate).columnId) ? "1" : predicateSql(schema, child as FilterPredicate, params),',
      ],
      [CONDITIONS, `shownColumns = state.visibleColumnIds;\n  rootGroup = state.filters;\n  ${CONDITIONS}`],
    ],
  },
  {
    id: "W214",
    rule: "a filter on a hidden column still holds in an and group inside an or",
    edits: hiddenLeaf('group.combinator === "and"'),
  },
  // --- Class 5: a hidden sort column in a count's cut ---
  {
    id: "W215",
    rule: "a count cuts by a hidden first sorted column too",
    edits: cutBy(
      `sorts[0] !== undefined && !state.visibleColumnIds.includes(sorts[0].columnId)`,
      `orderSql(schema, sorts.filter((s) => ${VISIBLE}))`,
    ),
  },
  {
    id: "W216",
    rule: "a count cuts by a hidden sorted column in its own direction (not always going down)",
    edits: cutBy(
      `sorts.some((s) => !${VISIBLE})`,
      `orderSql(schema, sorts.map((s) => (${VISIBLE} ? s : { ...s, direction: "desc" as const })))`,
    ),
  },
  {
    id: "W217",
    rule: "a count cuts by a hidden last sorted column of three too",
    edits: cutBy(
      "sorts.length >= 3 && !state.visibleColumnIds.includes((sorts[sorts.length - 1] as SortSpec).columnId)",
      "orderSql(schema, sorts.slice(0, -1))",
    ),
  },
  // --- Class 6: text order ---
  {
    id: "W218",
    rule: "text sorts by its letters, ignoring case (not by its first letter, then its length)",
    edits: [
      STRING_KEY(
        "`substr(lower(${quoted(column.id)}), 1, 1) ${direction}, length(${quoted(column.id)}) ${direction}, lower(${quoted(column.id)}) ${direction}`",
      ),
    ],
  },
  {
    id: "W219",
    rule: "text sorts by its letters going down too (not by its length first)",
    edits: [
      [
        KEY,
        `return column.kind === "string" && s.direction === "desc" ? \`length(\${quoted(column.id)}) DESC NULLS FIRST, lower(\${quoted(column.id)}) \${direction}\` : ${OWN_KEY};`,
      ],
    ],
  },
  // Listed as wrong, and right by a later ruling: where a space sorts against a letter is the Host's collation's own.
  {
    id: "W220",
    rule: "text sorts by its letters, a space included (not with spaces taken out)",
    edits: [STRING_KEY("`replace(lower(${quoted(column.id)}), ' ', '') ${direction}`")],
  },
  {
    id: "W221",
    rule: "a count cuts text by its letters ignoring case, not by character code",
    edits: [
      [JOINS, `let byteText = false;\n${JOINS}`],
      [
        KEY,
        'return `${quoted(column.id)}${TEXT_KINDS.has(column.kind) && !(byteText && column.kind === "string") ? " COLLATE NOCASE" : ""} ${direction}`;',
      ],
      ...cutWhen(
        'sorts.some((s) => usableColumn(schema, s.columnId, "sort").kind === "string")',
        "byteText = true;\n  const cutKeys = orderSql(schema, sorts);\n  byteText = false;",
        "SELECT *, rowid AS rowid FROM ${TABLE}${where} ORDER BY ${cutKeys} LIMIT ?",
        "...params, limit as number",
      ),
    ],
  },
  // --- Class 7: other counting habits ---
  {
    id: "W222",
    rule: "a count keeps exactly its number of rows, none from behind a tie (not one row for each value)",
    edits: cutWhen(
      "sorts.length > 0",
      "",
      'SELECT *, min(rowid) AS rowid FROM ${TABLE}${where} GROUP BY ${sorts.map((s) => quoted(s.columnId)).join(", ")} ORDER BY ${order} LIMIT ?',
      "...params, limit as number",
    ),
  },
  {
    id: "W223",
    rule: "a count caps the whole result, not each value of another column",
    edits: cutWhen(
      "part !== undefined",
      'const part = schema.columns.find((c) => c.kind === "enum" && c.sensitivity !== "restricted")?.id;',
      "SELECT * FROM (SELECT *, rowid AS rowid, ROW_NUMBER() OVER (PARTITION BY ${quoted(part as string)} ORDER BY ${order}) AS rn FROM ${TABLE}${where}) WHERE rn <= ?",
      "...params, limit as number",
    ),
  },
  // --- Class 8: paging ---
  {
    id: "W225",
    rule: "a paged result is the whole result cut in pieces (no row lost between pages)",
    edits: [[ROWS_PARAMS, "params: [...params, rowsOnPage, page.offset === 0 ? 0 : page.offset + 1],"]],
  },
];

/**
 * W224: each page reads one row more, never past the count. It loses no row but reads one twice where pages meet.
 * Whether that fails is ruling R5, the owner's and not decided: `compare` now treats a repeated id as one.
 */
export const W224: Mutant = {
  id: "W224",
  rule: "a paged result is the whole result cut in pieces (no page ends a row late)",
  edits: [[ON_PAGE, "const rowsOnPage = limit === undefined ? page.size + 1 : Math.max(0, Math.min(page.size + 1, limit - page.offset));"]],
};

/** Right Data Queries: what rulings R1 to R4 leave to the Host. `rule` says the choice each one makes. */
export const RIGHT: readonly Mutant[] = [
  {
    id: "V201",
    rule: "ties are broken by the rows' own key going down, after three or more sorts",
    edits: [[ORDER, `return [...keys, \`\${${ID}} DESC\`].join(", ");`]],
  },
  {
    id: "V202",
    rule: "a hidden sort is in the cut, with the rows' own key last",
    edits: [[ORDER, `return [...keys, ${ID}, "rowid"].join(", ");`]],
  },
  { id: "V203", rule: "beside a nested or group every leaf and every sort is kept, the rows' own key last", edits: [ID_LAST] },
  {
    id: "V204",
    rule: "a root or group as a UNION of its branches, the count cut after the UNION",
    edits: [
      [
        ON_PAGE,
        [
          ON_PAGE,
          '  const unionOf = state.filters?.combinator === "or" && state.filters.children.length > 0 ? state.filters.children.map((child) => { const ps: SQLInputValue[] = []; return { sql: `SELECT *, rowid AS rowid FROM ${TABLE} WHERE ${groupSql(schema, { ...(state.filters as FilterGroup), children: [child] }, ps)}`, ps }; }) : [];',
          `  const idKey = ${ID};`,
          '  const keysOnly = order.replace(/, rowid$/, "");',
          "  const unioned = unionOf.length > 0;",
          '  const cut = unioned ? `(SELECT * FROM (${unionOf.map((b) => b.sql).join(" UNION ")})${hasValue ? ` WHERE ${hasValue}` : ""}${limit === undefined ? "" : ` ORDER BY ${keysOnly}, ${idKey} LIMIT ?`})` : `${TABLE}${where}`;',
          "  const cutParams: SQLInputValue[] = unioned ? [...unionOf.flatMap((b) => b.ps), ...(limit === undefined ? [] : [limit])] : [...params];",
        ].join("\n"),
      ],
      [ROWS_SQL, "sql: `SELECT ${columns} FROM ${cut} ORDER BY ${order} LIMIT ? OFFSET ?`,"],
      [ROWS_PARAMS, "params: [...cutParams, rowsOnPage, page.offset],"],
      [TOTAL, `total: unioned\n      ? { sql: \`SELECT count(*) AS total FROM \${cut}\`, params: [...cutParams] }\n      : ${OWN_TOTAL},`],
    ],
  },
  {
    id: "V205",
    rule: "text sorts by upper(), ties broken by the rows' own key",
    edits: [STRING_KEY("`upper(${quoted(column.id)}) ${direction}`"), ID_LAST],
  },
  {
    id: "V206",
    rule: "the rows' own key is the last key of the count's cut and of every page",
    edits: [
      ID_LAST,
      ...cutWhen("true", "", "SELECT *, rowid AS rowid FROM ${TABLE}${where} ORDER BY ${order} LIMIT ?", "...params, limit as number"),
    ],
  },
  {
    id: "V207",
    rule: "a count is ROW_NUMBER over every sort and the rows' own key, pages read by that number",
    edits: cutWhen(
      "true",
      `const keysOnly = order.replace(/, rowid$/, "");\n  const idKey = ${ID};`,
      "SELECT * FROM (SELECT *, rowid AS rowid, ROW_NUMBER() OVER (ORDER BY ${keysOnly}, ${idKey}) AS rn FROM ${TABLE}${where}) WHERE rn <= ?",
      "...params, limit as number",
      "rn",
    ),
  },
  {
    id: "V208",
    rule: "text sorts by lower(), then by its length, then the rows' own key",
    edits: [STRING_KEY("`lower(${quoted(column.id)}) ${direction}, length(${quoted(column.id)}) ASC`"), ID_LAST],
  },
];
