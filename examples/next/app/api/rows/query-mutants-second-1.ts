// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the strings are query.ts source text, which holds template literals.
/**
 * Data Queries from the second held-out check of the Query Check, round 1, for the Query Check's own tests (see
 * query-mutants-second-1.test.ts). Each is the example's query (query.ts) with one choice made another way, written as
 * the text it finds in query.ts and the text it puts in its place. Test code only: nothing outside the tests imports
 * this file.
 *
 * `WRONG` are wrong translations: each keeps rows, or an order, that `applyView` doesn't, past what rulings R1 to R3
 * (more grids spec 5.5, `compare`) leave to the Host. `RIGHT` are right Data Queries: each makes a choice the rulings
 * leave to the Host, and the Query Check must pass every one. The ids are the held-out list's (W1 to W45, V1 to V19),
 * so "second-1 W4" is not round 1's, round 3's or the rulings' W4. W3 was withdrawn from the list.
 */
import { createQueryAdapter, type ViewSchema } from "gridcue";
import { queryCheck } from "gridcue/testing";
import type { DataQueryModule, Failure } from "./query-check-run";
import type { Mutant } from "./query-mutants";

// The pieces of query.ts these change, exactly as the file has them.
const ORDER = 'return [...keys, "rowid"].join(", ");';
const DIRECTIONS = 'const DIRECTIONS = { asc: "ASC NULLS LAST", desc: "DESC NULLS FIRST" } as const;';
const KEYS = "const keys = sorts.map((s) => {";
const DIRECTION = "const direction = DIRECTIONS[s.direction as keyof typeof DIRECTIONS];";
const KEY = 'return `${quoted(column.id)}${TEXT_KINDS.has(column.kind) ? " COLLATE NOCASE" : ""} ${direction}`;';
const ORDER_CALL = "const order = orderSql(schema, sorts);";
const ON_PAGE = "const rowsOnPage = limit === undefined ? page.size : Math.max(0, Math.min(page.size, limit - page.offset));";
const ROWS_SQL = "sql: `SELECT ${columns} FROM ${TABLE}${where} ORDER BY ${order} LIMIT ? OFFSET ?`,";
const ROWS_PARAMS = "params: [...params, rowsOnPage, page.offset],";
const TOTAL =
  "total:\n      limit === undefined\n        ? { sql: `SELECT count(*) AS total FROM ${TABLE}${where}`, params: [...params] }\n        : { sql: `SELECT min(count(*), ?) AS total FROM ${TABLE}${where}`, params: [limit, ...params] },";
const HAS_VALUE = "const hasValue = limit === undefined ? undefined : hasValueSql(schema, sorts);";
const HAS_VALUE_SQL = "return TEXT_KINDS.has(column.kind) ? `(${c} IS NOT NULL AND ${c} <> '')` : `${c} IS NOT NULL`;";
const CONDITIONS = "const conditions = state.filters ? [groupSql(schema, state.filters, params)] : [];";
const PARTS = "const parts = group.children.map((child) =>";
const JOINS = 'const JOINS = { and: " AND ", or: " OR " } as const;';
const EQ = "return `${cell} = ?`;";
const NEQ = "return text ? `${cell} <> ?` : `(${c} IS NULL OR ${c} <> ?)`;";
const IN = 'return `${cell} IN (${value.map(() => "?").join(", ")})`;';
const CONTAINS = "return `instr(${cell}, ?) > 0`;";
const STARTS = "return `instr(${cell}, ?) = 1`;";
const LOWER_FN = 'db.function("lower", { deterministic: true }, (value) => (typeof value === "string" ? value.toLowerCase() : value));';

/** The rows' own key: the first column of both schemas the tests run on holds the ids. */
const ID = "quoted(returnedColumns(schema)[0]?.id as string)";
const VISIBLE = "state.visibleColumnIds.includes(s.columnId)";
/** "a IS NULL OR b IS NULL", over the sorted columns: whether a row has an empty cell in any of them. */
const ANY_EMPTY = '(sorts.map((s) => `${quoted(s.columnId)} IS NULL`).join(" OR ") || "1 = 0")';
const directions = (asc: "FIRST" | "LAST", desc: "FIRST" | "LAST") =>
  `const DIRECTIONS = { asc: "ASC NULLS ${asc}", desc: "DESC NULLS ${desc}" } as const;`;

/**
 * Lines added after the page size, in buildRowsQuery: the sort keys without the load order, the rows' own key, the
 * sorted columns as a PARTITION BY, and the rank of the row at a place (`OFFSET ?`) in the sorted, filtered rows.
 */
const PRELUDE = [
  "",
  '  const keysOnly = order.replace(/, rowid$/, "");',
  `  const idKey = ${ID};`,
  '  const tiedBy = sorts.map((s) => quoted(s.columnId)).join(", ") || "1";',
  "  const rankAt = `(SELECT r FROM (SELECT RANK() OVER (ORDER BY ${keysOnly}) AS r FROM ${TABLE}${where}) ORDER BY r LIMIT 1 OFFSET ?)`;",
].join("\n");

/**
 * A count made in SQL, not by the page's LIMIT: with a count, the rows come from `source` (a query over the table),
 * with `sourceParams` bound to its `?`s, and each page reads them in `outerOrder`. With no count, the query is the
 * example's own.
 */
const cutInSql = (source: string, sourceParams: string, outerOrder = "${order}"): Mutant["edits"] => [
  [
    ON_PAGE,
    `${ON_PAGE}${PRELUDE}\n  const cut = limit === undefined ? \`\${TABLE}\${where}\` : \`(${source})\`;\n  const cutParams: SQLInputValue[] = limit === undefined ? [...params] : [${sourceParams}];`,
  ],
  [ROWS_SQL, `sql: \`SELECT \${columns} FROM \${cut} ORDER BY \${limit === undefined ? order : \`${outerOrder}\`} LIMIT ? OFFSET ?\`,`],
  [ROWS_PARAMS, "params: [...cutParams, limit === undefined ? rowsOnPage : page.size, page.offset],"],
  [TOTAL, "total: { sql: `SELECT count(*) AS total FROM ${cut}`, params: [...cutParams] },"],
];

/** Registers a SQL function after the example's own `lower`. */
const FOLD_FUNCTIONS: Mutant["edits"][number] = [
  LOWER_FN,
  `${LOWER_FN}\n  db.function("fold", { deterministic: true }, (value) => (typeof value === "string" ? value.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase() : value));\n  db.function("fold_sv", { deterministic: true }, (value) => (typeof value === "string" ? [...value.toLowerCase()].map((ch) => ("åäö".includes(ch) ? ch : ch.normalize("NFD").replace(/[\\u0300-\\u036f]/g, ""))).join("") : value));`,
];

const RANKED = "SELECT * FROM (SELECT *, rowid AS rowid, RANK() OVER (ORDER BY ${keysOnly}) AS r FROM ${TABLE}${where})";

/** Wrong translations. `rule` is the rule each one breaks. */
export const WRONG: readonly Mutant[] = [
  // --- Class 1: a count that cuts inside tied rows (R2) ---
  {
    // RANK gives every tied row the same rank, so "rank <= N" keeps more than N rows.
    id: "W1",
    rule: "a count keeps exactly its number of rows (not every row that ties at the cut, RANK)",
    edits: cutInSql(`${RANKED} WHERE r <= ?`, "...params, limit"),
  },
  {
    // DENSE_RANK keeps every tied row, and rows from behind the tie too.
    id: "W2",
    rule: "a count keeps exactly its number of rows, none from behind the tie (DENSE_RANK)",
    edits: cutInSql(`${RANKED.replace("RANK()", "DENSE_RANK()")} WHERE r <= ?`, "...params, limit"),
  },
  {
    // Only the rows ahead of the value the row after the cut holds: a tied run at the cut is dropped.
    id: "W4",
    rule: "a count keeps its number of rows, and never drops the rows that tie at its cut",
    edits: cutInSql(`${RANKED} WHERE r < coalesce(\${rankAt}, 9e18)`, "...params, ...params, limit"),
  },
  {
    // The rows tied with the Nth row are sorted last, then the first N are kept: a row from behind takes their place.
    id: "W5",
    rule: "a count keeps no row from behind the tied rows at its cut",
    edits: [
      [ON_PAGE, `${ON_PAGE}${PRELUDE}`],
      [
        ROWS_SQL,
        `sql: limit === undefined ? \`SELECT \${columns} FROM \${TABLE}\${where} ORDER BY \${order} LIMIT ? OFFSET ?\` : \`SELECT \${columns} FROM (SELECT *, rowid AS rowid, RANK() OVER (ORDER BY \${keysOnly}) AS r FROM \${TABLE}\${where}) ORDER BY (r = \${rankAt}), \${order} LIMIT ? OFFSET ?\`,`,
      ],
      [
        ROWS_PARAMS,
        "params: limit === undefined ? [...params, rowsOnPage, page.offset] : [...params, ...params, limit - 1, rowsOnPage, page.offset],",
      ],
    ],
  },
  {
    // The rows ahead of the Nth row's value, and only one of the rows that hold it.
    id: "W6",
    rule: "a count keeps its number of rows when two or more places are left in a tied run",
    edits: cutInSql(
      "SELECT * FROM (SELECT *, rowid AS rowid, RANK() OVER (ORDER BY ${keysOnly}) AS r, ROW_NUMBER() OVER (PARTITION BY ${tiedBy} ORDER BY rowid) AS k FROM ${TABLE}${where}) WHERE r < coalesce(${rankAt}, 9e18) OR (r = ${rankAt} AND k = 1)",
      "...params, ...params, limit - 1, ...params, limit - 1",
    ),
  },
  {
    // One row more than the count when the row after the cut ties the Nth.
    id: "W7",
    rule: "a count keeps its number of rows (not one more when the next row ties)",
    edits: cutInSql(
      "SELECT *, rowid AS rowid FROM ${TABLE}${where} ORDER BY ${order} LIMIT ? + (SELECT count(*) = 2 AND count(DISTINCT r) = 1 FROM (SELECT r FROM (SELECT RANK() OVER (ORDER BY ${keysOnly}) AS r FROM ${TABLE}${where}) ORDER BY r LIMIT 2 OFFSET ?))",
      "...params, limit, ...params, limit - 1",
    ),
  },
  {
    // The cut is made by the first sort alone, then the rows are sorted by every column.
    id: "W8",
    rule: "a count cuts by every sorted column, not the first alone",
    edits: cutInSql('SELECT *, rowid AS rowid FROM ${TABLE}${where} ORDER BY ${order.split(", ")[0]}, rowid LIMIT ?', "...params, limit"),
  },
  // --- Class 2: an empty cell in a later sort column (R3), and the count's empty first cell ---
  {
    id: "W9",
    rule: "a row with an empty sort cell keeps its place by the columns before it (not after every other row)",
    edits: [[ORDER, `return [${ANY_EMPTY}, ...keys, "rowid"].join(", ");`]],
  },
  {
    id: "W10",
    rule: "a row with an empty sort cell keeps its place by the columns before it (not before every other row)",
    edits: [[ORDER, `return [\`\${${ANY_EMPTY}} DESC\`, ...keys, "rowid"].join(", ");`]],
  },
  {
    // Two or more sorts as one joined text key: an empty cell empties the key, and numbers sort as text.
    id: "W11",
    rule: "sorts by each column in turn, not by one joined key",
    edits: [
      [
        ORDER,
        'return [...(sorts.length > 1 ? [`${sorts.map((s) => quoted(s.columnId)).join(" || \'|\' || ")} ${DIRECTIONS[sorts[0]?.direction as keyof typeof DIRECTIONS]}`] : keys), "rowid"].join(", ");',
      ],
    ],
  },
  {
    // With a count, every row with an empty sort cell goes last before the cut.
    id: "W12",
    rule: "a count keeps a row with no value in a later sorted column by its place by the columns before it",
    edits: [[ORDER_CALL, `const order = (limit === undefined ? "" : \`\${${ANY_EMPTY}}, \`) + orderSql(schema, sorts);`]],
  },
  {
    // The right rows are cut, then put in order again with every row with an empty sort cell last.
    id: "W13",
    rule: "a row with no value in a later sorted column keeps its place after the count's cut",
    edits: cutInSql(
      "SELECT *, rowid AS rowid FROM ${TABLE}${where} ORDER BY ${order} LIMIT ?",
      "...params, limit",
      `\${${ANY_EMPTY}}, \${order}`,
    ),
  },
  {
    // Each page is read in the right place, then put in order again with every row with an empty sort cell last.
    id: "W14",
    rule: "a row with an empty sort cell keeps its place over the whole result, not one page",
    edits: [
      [
        ROWS_SQL,
        `sql: \`SELECT \${columns} FROM (SELECT *, rowid AS rid FROM \${TABLE}\${where} ORDER BY \${order} LIMIT ? OFFSET ?) ORDER BY \${${ANY_EMPTY}}, \${order.replace(/rowid$/, "rid")}\`,`,
      ],
    ],
  },
  {
    // No guard, and SQLite's own NULLS FIRST going up: the count keeps a row with no value.
    id: "W15",
    rule: "a count never keeps a row with no value in the first sorted column (going up)",
    edits: [
      [HAS_VALUE, "const hasValue = undefined;"],
      [DIRECTIONS, directions("FIRST", "LAST")],
    ],
  },
  {
    id: "W16",
    rule: "a count never keeps a row with no value in the first sorted column (not read as zero)",
    edits: [
      [HAS_VALUE, "const hasValue = undefined;"],
      [
        KEY,
        'return `${NUMBER_KINDS.has(column.kind) ? `coalesce(${quoted(column.id)}, 0)` : quoted(column.id)}${TEXT_KINDS.has(column.kind) ? " COLLATE NOCASE" : ""} ${direction}`;',
      ],
    ],
  },
  {
    // No guard, with NULLS FIRST going down, PostgreSQL's habit.
    id: "W17",
    rule: "a count never keeps a row with no value in the first sorted column (going down)",
    edits: [[HAS_VALUE, "const hasValue = undefined;"]],
  },
  {
    id: "W18",
    rule: "a count never keeps a row with empty text in the first sorted column",
    edits: [[HAS_VALUE_SQL, "return `${c} IS NOT NULL`;"]],
  },
  {
    id: "W19",
    rule: "a count's guard is on the first sorted column only (not every text column it sorts by)",
    edits: [
      [
        HAS_VALUE,
        'const hasValue = limit === undefined ? undefined : sorts.filter((s, i) => i === 0 || TEXT_KINDS.has(usableColumn(schema, s.columnId, "sort").kind)).map((s) => hasValueSql(schema, [s])).join(" AND ") || undefined;',
      ],
    ],
  },
  // --- Class 3: sorts and hidden columns ---
  {
    id: "W20",
    rule: "a sort on a hidden column still orders the rows",
    edits: [[ORDER_CALL, `const order = orderSql(schema, sorts.filter((s) => ${VISIBLE}));`]],
  },
  {
    id: "W21",
    rule: "a sort on a hidden column keeps its direction",
    edits: [[ORDER_CALL, `const order = orderSql(schema, sorts.map((s) => (${VISIBLE} ? s : { ...s, direction: "asc" as const })));`]],
  },
  {
    id: "W22",
    rule: "a sort on a hidden column sorts by that column, not the first one shown",
    edits: [
      [
        ORDER_CALL,
        `const order = orderSql(schema, sorts.map((s) => (${VISIBLE} ? s : { ...s, columnId: state.visibleColumnIds[0] as string })));`,
      ],
    ],
  },
  {
    id: "W23",
    rule: "a filter on a hidden column still holds",
    edits: [
      [
        CONDITIONS,
        'const conditions = state.filters ? [groupSql(schema, { ...state.filters, children: state.filters.children.filter((child) => child.type === "group" || state.visibleColumnIds.includes((child as FilterPredicate).columnId)) }, params)] : [];',
      ],
    ],
  },
  // --- Class 4: sorts beside filters ---
  {
    id: "W24",
    rule: "a sort still orders the rows when a filter is set",
    edits: [[ORDER_CALL, "const order = orderSql(schema, state.filters ? [] : sorts);"]],
  },
  {
    id: "W25",
    rule: "a sort still orders the rows when the filters hold an or group",
    edits: [[ORDER_CALL, 'const order = orderSql(schema, JSON.stringify(state.filters).includes(\'"combinator":"or"\') ? [] : sorts);']],
  },
  {
    id: "W26",
    rule: "a second sort on an enum still orders the rows",
    edits: [
      [KEYS, 'const keys = sorts.filter((s, i) => i === 0 || usableColumn(schema, s.columnId, "sort").kind !== "enum").map((s) => {'],
    ],
  },
  {
    id: "W27",
    rule: "a sort on an enum keeps its direction",
    edits: [[DIRECTION, 'const direction = DIRECTIONS[(column.kind === "enum" ? "asc" : s.direction) as keyof typeof DIRECTIONS];']],
  },
  {
    id: "W28",
    rule: "a second sort on text still orders the rows",
    edits: [
      [KEYS, 'const keys = sorts.filter((s, i) => i === 0 || usableColumn(schema, s.columnId, "sort").kind !== "string").map((s) => {'],
    ],
  },
  // --- Class 5: enum order (R4) ---
  {
    id: "W29",
    rule: "an enum sorts by its values' IDs, not the order they are declared in",
    edits: [
      [
        KEY,
        'return `${column.kind === "enum" ? `CASE ${quoted(column.id)} ${(column.enumValues ?? []).map((e, i) => `WHEN \'${e.id.replaceAll("\'", "\'\'")}\' THEN ${i}`).join(" ")} END` : `${quoted(column.id)}${TEXT_KINDS.has(column.kind) ? " COLLATE NOCASE" : ""}`} ${direction}`;',
      ],
    ],
  },
  {
    id: "W30",
    rule: "an enum sorts by its values' IDs, not their labels",
    edits: [
      [
        KEY,
        'return `${column.kind === "enum" ? `CASE ${quoted(column.id)} ${(column.enumValues ?? []).map((e) => `WHEN \'${e.id.replaceAll("\'", "\'\'")}\' THEN \'${e.label.replaceAll("\'", "\'\'")}\'`).join(" ")} END` : `${quoted(column.id)}${TEXT_KINDS.has(column.kind) ? " COLLATE NOCASE" : ""}`} ${direction}`;',
      ],
    ],
  },
  {
    id: "W31",
    rule: "an enum sorts by its values' IDs as text, not their length",
    edits: [
      [
        KEY,
        'return `${column.kind === "enum" ? `length(${quoted(column.id)})` : `${quoted(column.id)}${TEXT_KINDS.has(column.kind) ? " COLLATE NOCASE" : ""}`} ${direction}`;',
      ],
    ],
  },
  // --- Class 6: accents. Core folds case only, so é is not e ---
  {
    id: "W32",
    rule: "equal keeps accents (é is not e)",
    edits: [FOLD_FUNCTIONS, [EQ, "return text ? `fold(${cell}) = fold(?)` : `${cell} = ?`;"]],
  },
  {
    id: "W33",
    rule: "in a list keeps accents",
    edits: [
      FOLD_FUNCTIONS,
      [
        IN,
        'return text ? `fold(${cell}) IN (${value.map(() => "fold(?)").join(", ")})` : `${cell} IN (${value.map(() => "?").join(", ")})`;',
      ],
    ],
  },
  {
    id: "W34",
    rule: "not equal keeps accents",
    edits: [FOLD_FUNCTIONS, [NEQ, "return text ? `fold(${cell}) <> fold(?)` : `(${c} IS NULL OR ${c} <> ?)`;"]],
  },
  { id: "W35", rule: "contains keeps accents", edits: [FOLD_FUNCTIONS, [CONTAINS, "return `instr(fold(${cell}), fold(?)) > 0`;"]] },
  { id: "W36", rule: "starts with keeps accents", edits: [FOLD_FUNCTIONS, [STARTS, "return `instr(fold(${cell}), fold(?)) = 1`;"]] },
  {
    // A Swedish or Finnish collation keeps å, ä and ö apart and folds every other accent.
    id: "W37",
    rule: "equal keeps é and e apart (a collation that keeps only å, ä and ö)",
    edits: [FOLD_FUNCTIONS, [EQ, "return text ? `fold_sv(${cell}) = fold_sv(?)` : `${cell} = ?`;"]],
  },
  {
    id: "W38",
    rule: "contains keeps é and e apart (a collation that keeps only å, ä and ö)",
    edits: [FOLD_FUNCTIONS, [CONTAINS, "return `instr(fold_sv(${cell}), fold_sv(?)) > 0`;"]],
  },
  {
    id: "W39",
    rule: "not equal keeps é and e apart (a collation that keeps only å, ä and ö)",
    edits: [FOLD_FUNCTIONS, [NEQ, "return text ? `fold_sv(${cell}) <> fold_sv(?)` : `(${c} IS NULL OR ${c} <> ?)`;"]],
  },
  // --- Class 7: other habits ---
  {
    id: "W40",
    rule: "a count keeps the first rows of the filtered rows (cut after the filter, not before)",
    edits: cutInSql(
      'SELECT * FROM (SELECT *, rowid AS rowid FROM ${TABLE}${hasValue ? ` WHERE ${hasValue}` : ""} ORDER BY ${order} LIMIT ?)${state.filters ? ` WHERE ${conditions[0]}` : ""}',
      "limit, ...params",
    ),
  },
  {
    id: "W41",
    rule: "a count is cut before paging (not on each page)",
    edits: [[ON_PAGE, "const rowsOnPage = limit === undefined ? page.size : Math.min(page.size, limit);"]],
  },
  {
    id: "W42",
    rule: "numbers sort as numbers",
    edits: [
      [
        KEY,
        'return `${NUMBER_KINDS.has(column.kind) ? `CAST(${quoted(column.id)} AS TEXT)` : quoted(column.id)}${TEXT_KINDS.has(column.kind) ? " COLLATE NOCASE" : ""} ${direction}`;',
      ],
    ],
  },
  { id: "W43", rule: "text sorts ignoring case (not by character code)", edits: [[KEY, "return `${quoted(column.id)} ${direction}`;"]] },
  {
    id: "W44",
    rule: "a paged result is the whole result cut in pieces (no random tie-break)",
    edits: [[ORDER, 'return [...keys, "random()"].join(", ");']],
  },
  {
    // A filter on a hidden column is left out only inside an or group.
    id: "W45",
    rule: "a filter on a hidden column still holds in an or group",
    edits: [
      [JOINS, `let shownColumns: readonly string[] = [];\n${JOINS}`],
      [
        PARTS,
        'const parts = group.children.filter((child) => group.combinator !== "or" || child.type === "group" || shownColumns.includes((child as FilterPredicate).columnId)).map((child) =>',
      ],
      [CONDITIONS, `shownColumns = state.visibleColumnIds;\n  ${CONDITIONS}`],
    ],
  },
];

const later = (asc: "FIRST" | "LAST", desc: "FIRST" | "LAST"): Mutant["edits"] => [
  [DIRECTIONS, `${DIRECTIONS}\nconst LATER = { asc: "ASC NULLS ${asc}", desc: "DESC NULLS ${desc}" } as const;`],
  [KEYS, "const keys = sorts.map((s, i) => {"],
  [DIRECTION, "const direction = (i === 0 ? DIRECTIONS : LATER)[s.direction as keyof typeof DIRECTIONS];"],
];

/** Right Data Queries: what rulings R1 to R4 leave to the Host. `rule` says the choice each one makes. */
export const RIGHT: readonly Mutant[] = [
  { id: "V1", rule: "ties are broken by the rows' own key, going up", edits: [[ORDER, `return [...keys, ${ID}].join(", ");`]] },
  {
    id: "V2",
    rule: "ties are broken by the rows' own key, going down",
    edits: [[ORDER, `return [...keys, \`\${${ID}} DESC\`].join(", ");`]],
  },
  {
    id: "V3",
    rule: "ties are broken by another column, which is no sort in the View State",
    edits: [
      [
        ORDER,
        'return [...keys, quoted(schema.columns.find((c) => NUMBER_KINDS.has(c.kind) && c.sensitivity !== "restricted")?.id ?? "rowid"), "rowid"].join(", ");',
      ],
    ],
  },
  { id: "V4", rule: "an empty cell always sorts first (NULLS FIRST)", edits: [[DIRECTIONS, directions("FIRST", "FIRST")]] },
  { id: "V5", rule: "an empty cell always sorts last (NULLS LAST)", edits: [[DIRECTIONS, directions("LAST", "LAST")]] },
  {
    id: "V6",
    rule: "an empty cell sorts first going up and last going down, as SQLite has it",
    edits: [[DIRECTIONS, directions("FIRST", "LAST")]],
  },
  { id: "V7", rule: "an empty cell in a later sorted column sorts first in its group, each way", edits: later("FIRST", "FIRST") },
  { id: "V8", rule: "an empty cell in a later sorted column sorts last in its group, each way", edits: later("LAST", "LAST") },
  { id: "V9", rule: "an empty cell in a later sorted column sorts first going up and last going down", edits: later("FIRST", "LAST") },
  {
    id: "V10",
    rule: "an empty number in a later sorted column sorts as zero",
    edits: [
      [KEYS, "const keys = sorts.map((s, i) => {"],
      [
        KEY,
        'return `${i > 0 && NUMBER_KINDS.has(column.kind) ? `coalesce(${quoted(column.id)}, 0)` : quoted(column.id)}${TEXT_KINDS.has(column.kind) ? " COLLATE NOCASE" : ""} ${direction}`;',
      ],
    ],
  },
  {
    id: "V11",
    rule: "a row with no value in the first sorted column is put last by a CASE",
    edits: [
      [
        ORDER,
        'return [...(sorts[0] ? [`CASE WHEN ${quoted(sorts[0].columnId)} IS NULL OR ${quoted(sorts[0].columnId)} = \'\' THEN 1 ELSE 0 END`] : []), ...keys, "rowid"].join(", ");',
      ],
    ],
  },
  {
    id: "V12",
    rule: "ties are broken by the rows' own key, written ASC",
    edits: [[ORDER, `return [...keys, \`\${${ID}} ASC\`].join(", ");`]],
  },
  {
    id: "V13",
    rule: "ties are broken in the reverse of the order the rows were stored in",
    edits: [[ORDER, 'return [...keys, "rowid DESC"].join(", ");']],
  },
  {
    id: "V14",
    rule: "a count is ROW_NUMBER over the sorts and the rows' own key",
    edits: cutInSql(
      "SELECT * FROM (SELECT *, rowid AS rowid, ROW_NUMBER() OVER (ORDER BY ${keysOnly}, ${idKey}) AS rn FROM ${TABLE}${where}) WHERE rn <= ?",
      "...params, limit",
    ),
  },
  {
    id: "V15",
    rule: "a count breaks ties by the rows' own key going down, and its pages by the same key going up",
    edits: cutInSql(
      "SELECT *, rowid AS rowid FROM ${TABLE}${where} ORDER BY ${keysOnly}, ${idKey} DESC LIMIT ?",
      "...params, limit",
      "${keysOnly}, ${idKey} ASC",
    ),
  },
  // V16, text sorted with COLLATE NOCASE, is the example's own query: no edit.
  { id: "V16", rule: "text sorts with COLLATE NOCASE (the example's own query)", edits: [] },
  {
    id: "V17a",
    rule: "text sorts by lower(), then by its letter case going down",
    edits: [
      [
        KEY,
        'return column.kind === "string" ? `lower(${quoted(column.id)}) ${direction}, ${quoted(column.id)} DESC` : `${quoted(column.id)}${TEXT_KINDS.has(column.kind) ? " COLLATE NOCASE" : ""} ${direction}`;',
      ],
    ],
  },
  {
    id: "V17b",
    rule: "text sorts by upper()",
    edits: [
      [
        KEY,
        'return column.kind === "string" ? `upper(${quoted(column.id)}) ${direction}` : `${quoted(column.id)}${TEXT_KINDS.has(column.kind) ? " COLLATE NOCASE" : ""} ${direction}`;',
      ],
    ],
  },
  {
    id: "V18",
    rule: "an enum sorts by lower() of its IDs",
    edits: [
      [
        KEY,
        'return column.kind === "enum" ? `lower(${quoted(column.id)}) ${direction}` : `${quoted(column.id)}${TEXT_KINDS.has(column.kind) ? " COLLATE NOCASE" : ""} ${direction}`;',
      ],
    ],
  },
  {
    id: "V19",
    rule: "the rows' own key is the last sort key, before the load order",
    edits: [[ORDER, `return [...keys, ${ID}, "rowid"].join(", ");`]],
  },
];

/**
 * V20 is no Data Query of its own: at a cut between two values, RANK (W1), DENSE_RANK (W2) and "ahead of the next
 * row's value" (W4) keep the right rows. These are the cases whose names say the cut falls between two values.
 */
export const CLEAN_CUT_CASES = [
  "a count keeps the first rows of the sorted, filtered rows",
  "a count keeps a row with no value in a later sorted column",
  "a count never keeps a row with no value in the first sorted column",
] as const;

/**
 * Runs every case of the Query Check through `query`, as query-check-run.ts does, with `limit.set` listed or not. It
 * reads each case whole, and in pages of 7. A case the query throws on fails.
 */
export const runCheck = (
  schema: ViewSchema,
  id: string,
  query: DataQueryModule,
  counts: boolean,
): { cases: number; failures: Failure[]; ids: Map<string, string> } => {
  const listed = createQueryAdapter({ schema, countBeforePaging: true }).getCapabilities().operations;
  const operations = counts ? listed : listed.filter((op) => op !== "limit.set");
  const check = queryCheck(schema, { id, operations });
  const db = query.openRowsDatabase(schema, check.rows);
  const failures: Failure[] = [];
  /** Each case's ids, whole, as text: to tell whether two Data Queries differ. */
  const ids = new Map<string, string>();
  const fail = (name: string, message: string) => failures.push({ name, message });
  /** Each case's read, whole. A Data Query that throws on a View State the grid could hold fails that case. */
  const readWhole = (c: (typeof check.cases)[number]) => {
    try {
      return query.readRows(db, schema, c.state, { offset: 0, size: check.rows.length });
    } catch (error) {
      fail(c.name, `${c.name}: the Data Query threw “${error instanceof Error ? error.message : String(error)}”`);
      ids.set(c.name, "threw");
      return undefined;
    }
  };
  try {
    for (const c of check.cases) {
      const whole = readWhole(c);
      if (!whole) continue;
      const got = whole.rows.map((row) => row[id] as string | number);
      ids.set(c.name, got.join(","));
      const result = c.compare(got);
      if (!result.ok) fail(c.name, result.message);
      if (whole.total !== whole.rows.length) fail(c.name, `${c.name}: total is ${whole.total}, ${whole.rows.length} rows came back`);
      const paged: Array<string | number> = [];
      for (let offset = 0; offset < whole.total + 7; offset += 7) {
        const page = query.readRows(db, schema, c.state, { offset, size: 7 });
        if (page.total !== whole.total) fail(c.name, `${c.name}: the total changed from page to page`);
        paged.push(...page.rows.map((row) => row[id] as string | number));
      }
      const byPage = c.compare(paged);
      if (!byPage.ok) fail(c.name, `in pages of 7, ${byPage.message}`);
    }
  } finally {
    db.close();
  }
  return { cases: check.cases.length, failures, ids };
};
