// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the strings are query.ts source text, which holds template literals.
/**
 * Data Queries from the second held-out check of the Query Check, round 2, for the Query Check's own tests (see
 * query-mutants-second-2.test.ts). Each is the example's query (query.ts) with one choice made another way, written as
 * the text it finds in query.ts and the text it puts in its place. Test code only: nothing outside the tests imports
 * this file.
 *
 * `WRONG` are wrong translations: each keeps rows, or an order, that `applyView` doesn't, past what rulings R1 to R3
 * (more grids spec 5.5, `compare`) leave to the Host. `RIGHT` are right Data Queries: each makes a choice the rulings
 * leave to the Host, and the Query Check must pass every one. The ids are this held-out list's (W101 to W122, V101 to
 * V107).
 */
import type { Mutant } from "./query-mutants";

// The pieces of query.ts these change, exactly as the file has them.
const ORDER = 'return [...keys, "rowid"].join(", ");';
const KEYS = "const keys = sorts.map((s) => {";
const KEY = 'return `${quoted(column.id)}${TEXT_KINDS.has(column.kind) ? " COLLATE NOCASE" : ""} ${direction}`;';
const ORDER_CALL = "const order = orderSql(schema, sorts);";
const LIMIT = "const limit = state.limit;";
const ON_PAGE = "const rowsOnPage = limit === undefined ? page.size : Math.max(0, Math.min(page.size, limit - page.offset));";
const ROWS_SQL = "sql: `SELECT ${columns} FROM ${TABLE}${where} ORDER BY ${order} LIMIT ? OFFSET ?`,";
const ROWS_PARAMS = "params: [...params, rowsOnPage, page.offset],";
const TOTAL =
  "total:\n      limit === undefined\n        ? { sql: `SELECT count(*) AS total FROM ${TABLE}${where}`, params: [...params] }\n        : { sql: `SELECT min(count(*), ?) AS total FROM ${TABLE}${where}`, params: [limit, ...params] },";
const HAS_VALUE = "const hasValue = limit === undefined ? undefined : hasValueSql(schema, sorts);";
const CONDITIONS = "const conditions = state.filters ? [groupSql(schema, state.filters, params)] : [];";
const PARTS = "const parts = group.children.map((child) =>";
const JOINS = 'const JOINS = { and: " AND ", or: " OR " } as const;';
const NEQ = "return text ? `${cell} <> ?` : `(${c} IS NULL OR ${c} <> ?)`;";
const IN = 'return `${cell} IN (${value.map(() => "?").join(", ")})`;';
const STARTS = "return `instr(${cell}, ?) = 1`;";
const LOWER_FN = 'db.function("lower", { deterministic: true }, (value) => (typeof value === "string" ? value.toLowerCase() : value));';

/** The rows' own key: the first column of both schemas the tests run on holds the ids. */
const ID = "quoted(returnedColumns(schema)[0]?.id as string)";
const VISIBLE = "state.visibleColumnIds.includes(s.columnId)";
/** Whether the View State's filters hold an or group anywhere. */
const HAS_OR = 'JSON.stringify(state.filters ?? null).includes(\'"combinator":"or"\')';
/** The example's own sort key for a column, after `KEY`'s `return`. */
const OWN_KEY = '`${quoted(column.id)}${TEXT_KINDS.has(column.kind) ? " COLLATE NOCASE" : ""} ${direction}`';

/**
 * A count made in SQL, not by the page's LIMIT: with a count, the rows come from `source` (a query over the table),
 * with `sourceParams` bound to its `?`s, and each page reads them in the example's order. `before` is code run first.
 */
const cutInSql = (before: string, source: string, sourceParams: string): Mutant["edits"] => [
  [
    ON_PAGE,
    `${ON_PAGE}\n  ${before}\n  const cut = limit === undefined ? \`\${TABLE}\${where}\` : \`(${source})\`;\n  const cutParams: SQLInputValue[] = limit === undefined ? [...params] : [${sourceParams}];`,
  ],
  [ROWS_SQL, "sql: `SELECT ${columns} FROM ${cut} ORDER BY ${order} LIMIT ? OFFSET ?`,"],
  [ROWS_PARAMS, "params: [...cutParams, limit === undefined ? rowsOnPage : page.size, page.offset],"],
  [TOTAL, "total: { sql: `SELECT count(*) AS total FROM ${cut}`, params: [...cutParams] },"],
];

/** With a count, rows with no value in a later sorted column of `kinds` are left out. */
const dropLaterEmpty = (kinds: string): Mutant["edits"] => [
  [
    HAS_VALUE,
    `const hasValue = limit === undefined ? undefined : [hasValueSql(schema, sorts), ...sorts.slice(1).filter((s) => ${kinds}.includes(usableColumn(schema, s.columnId, "sort").kind)).map((s) => \`\${quoted(s.columnId)} IS NOT NULL\`)].filter(Boolean).join(" AND ") || undefined;`,
  ],
];

/** Registers `fold_sv`: folds case and accents, but keeps å, ä and ö apart (a Swedish or Finnish collation). */
const FOLD_SV: Mutant["edits"][number] = [
  LOWER_FN,
  `${LOWER_FN}\n  db.function("fold_sv", { deterministic: true }, (value) => (typeof value === "string" ? [...value.toLowerCase()].map((ch) => ("åäö".includes(ch) ? ch : ch.normalize("NFD").replace(/[\\u0300-\\u036f]/g, ""))).join("") : value));`,
];

/** Wrong translations. `rule` is the rule each one breaks. */
export const WRONG: readonly Mutant[] = [
  // --- Class 1: a count cut by too few sort columns ---
  {
    id: "W101",
    rule: "a count cuts by every sorted column, not the first two of three",
    edits: cutInSql(
      'const firstTwo = order.split(", ").slice(0, 2).filter((k) => k !== "rowid").join(", ");',
      "SELECT *, rowid AS rowid FROM ${TABLE}${where} ORDER BY ${firstTwo}, rowid LIMIT ?",
      "...params, limit",
    ),
  },
  {
    id: "W102",
    rule: "a count cuts by every sorted column, not the first and then the rows' own key",
    edits: cutInSql(
      `const idKey = ${ID};`,
      'SELECT *, rowid AS rowid FROM ${TABLE}${where} ORDER BY ${order.split(", ")[0]}, ${idKey} LIMIT ?',
      "...params, limit",
    ),
  },
  {
    id: "W103",
    rule: "a count cuts by every sorted column in its own direction (not the later ones all descending)",
    edits: cutInSql(
      'const flipped = order.split(", ").map((k, i) => (i === 0 ? k : k.replace("ASC NULLS LAST", "DESC NULLS FIRST"))).join(", ");',
      "SELECT *, rowid AS rowid FROM ${TABLE}${where} ORDER BY ${flipped} LIMIT ?",
      "...params, limit",
    ),
  },
  // --- Class 2: a count that drops rows with no value in a later sort column (R3) ---
  {
    id: "W104",
    rule: "a count keeps a row with no value in a later sorted text column by its place by the columns before it",
    edits: dropLaterEmpty('["string"]'),
  },
  {
    id: "W105",
    rule: "a count keeps a row with no value in a later sorted number column by its place by the columns before it",
    edits: dropLaterEmpty('["number", "currency", "percent"]'),
  },
  {
    id: "W106",
    rule: "a count keeps a row with no value in a later sorted date column by its place by the columns before it",
    edits: dropLaterEmpty('["date", "datetime"]'),
  },
  // --- Class 3: sorts and a count beside an or group ---
  {
    id: "W107",
    rule: "a sort still orders the rows when an or group sits inside an and",
    edits: [
      [
        ORDER_CALL,
        'const order = orderSql(schema, (state.filters?.children ?? []).some((c) => c.type === "group" && JSON.stringify(c).includes(\'"combinator":"or"\')) ? [] : sorts);',
      ],
    ],
  },
  {
    id: "W108",
    rule: "every sort orders the rows beside an or group, not the first alone",
    edits: [[ORDER_CALL, `const order = orderSql(schema, ${HAS_OR} ? sorts.slice(0, 1) : sorts);`]],
  },
  {
    id: "W109",
    rule: "a sort beside an or group keeps its direction",
    edits: [[ORDER_CALL, `const order = orderSql(schema, ${HAS_OR} ? sorts.map((s) => ({ ...s, direction: "asc" as const })) : sorts);`]],
  },
  {
    id: "W110",
    rule: "a count caps the rows beside an or group",
    edits: [[LIMIT, `const limit = ${HAS_OR} ? undefined : state.limit;`]],
  },
  // --- Class 4: accents, and a lower case that folds only A to Z ---
  {
    id: "W111",
    rule: "in a list keeps é and e apart (a collation that keeps only å, ä and ö)",
    edits: [
      FOLD_SV,
      [
        IN,
        'return text ? `fold_sv(${cell}) IN (${value.map(() => "fold_sv(?)").join(", ")})` : `${cell} IN (${value.map(() => "?").join(", ")})`;',
      ],
    ],
  },
  {
    id: "W112",
    rule: "starts with keeps é and e apart (a collation that keeps only å, ä and ö)",
    edits: [FOLD_SV, [STARTS, "return `instr(fold_sv(${cell}), fold_sv(?)) = 1`;"]],
  },
  {
    // The same edit as second-1's W39; this list asks for it on a name with é.
    id: "W113",
    rule: "not equal keeps é and e apart (a collation that keeps only å, ä and ö)",
    edits: [FOLD_SV, [NEQ, "return text ? `fold_sv(${cell}) <> fold_sv(?)` : `(${c} IS NULL OR ${c} <> ?)`;"]],
  },
  {
    // SQLite's own lower(), which folds only A to Z: Å and å are different text.
    id: "W114",
    rule: "text compares ignoring case as core does, past A to Z (Å is å)",
    edits: [[LOWER_FN, ""]],
  },
  // --- Class 5: a filter or sort on a hidden column, in new places ---
  {
    id: "W115",
    rule: "a filter on a hidden column still holds when it is not the first in its group",
    edits: [
      [JOINS, `let shownColumns: readonly string[] = [];\n${JOINS}`],
      [
        PARTS,
        'const parts = group.children.filter((child, i) => i === 0 || child.type === "group" || shownColumns.includes((child as FilterPredicate).columnId)).map((child) =>',
      ],
      [CONDITIONS, `shownColumns = state.visibleColumnIds;\n  ${CONDITIONS}`],
    ],
  },
  {
    id: "W116",
    rule: "a filter on a hidden column still holds in an or group inside an and",
    edits: [
      [JOINS, `let shownColumns: readonly string[] = [];\nlet rootGroup: unknown;\n${JOINS}`],
      [
        PARTS,
        'const parts = group.children.filter((child) => group === rootGroup || group.combinator !== "or" || child.type === "group" || shownColumns.includes((child as FilterPredicate).columnId)).map((child) =>',
      ],
      [CONDITIONS, `shownColumns = state.visibleColumnIds;\n  rootGroup = state.filters;\n  ${CONDITIONS}`],
    ],
  },
  {
    id: "W117",
    rule: "a count still sorts by a hidden column",
    edits: [[ORDER_CALL, `const order = orderSql(schema, limit === undefined ? sorts : sorts.filter((s) => ${VISIBLE}));`]],
  },
  // --- Class 6: other habits about sorting and counting ---
  {
    id: "W118",
    rule: "numbers sort by their value, negatives first (not by their size)",
    edits: [[KEY, `return NUMBER_KINDS.has(column.kind) ? \`abs(\${quoted(column.id)}) \${direction}\` : ${OWN_KEY};`]],
  },
  {
    id: "W119",
    rule: "numbers sort by their value in a count too (not as text)",
    edits: [
      [JOINS, `let counting = false;\n${JOINS}`],
      [ORDER_CALL, `counting = limit !== undefined;\n  ${ORDER_CALL}`],
      [KEY, `return counting && NUMBER_KINDS.has(column.kind) ? \`CAST(\${quoted(column.id)} AS TEXT) \${direction}\` : ${OWN_KEY};`],
    ],
  },
  {
    id: "W120",
    rule: "a paged result is the whole result cut in pieces (no page starts a row early)",
    edits: [[ROWS_PARAMS, "params: [...params, rowsOnPage, Math.max(page.offset - 1, 0)],"]],
  },
  {
    id: "W121",
    rule: "a count caps the whole result, not each page (the cut does not start at the page)",
    edits: cutInSql(
      "",
      "SELECT *, rowid AS rowid FROM ${TABLE}${where} ORDER BY ${order} LIMIT ? OFFSET ?",
      "...params, limit, page.offset",
    ),
  },
  {
    id: "W122",
    rule: "text sorts by its letters, ignoring case (not by its length first)",
    edits: [[KEY, `return (column.kind === "string" ? \`length(\${quoted(column.id)}) \${direction}, \` : "") + ${OWN_KEY};`]],
  },
];

/** Right Data Queries: what rulings R1 to R4 leave to the Host. `rule` says the choice each one makes. */
export const RIGHT: readonly Mutant[] = [
  {
    id: "V101",
    rule: "numbers sort by their negation, the other way",
    edits: [
      [
        KEY,
        `return NUMBER_KINDS.has(column.kind) ? \`-\${quoted(column.id)} \${s.direction === "asc" ? "DESC NULLS LAST" : "ASC NULLS FIRST"}\` : ${OWN_KEY};`,
      ],
    ],
  },
  {
    id: "V102",
    rule: "a count is taken on each page by arithmetic in SQL, ties broken by the rows' own key",
    edits: [
      [ORDER, `return [...keys, ${ID}].join(", ");`],
      [
        ROWS_SQL,
        'sql: `SELECT ${columns} FROM ${TABLE}${where} ORDER BY ${order} LIMIT ${limit === undefined ? "?" : "max(0, min(?, ? - ?))"} OFFSET ?`,',
      ],
      [
        ROWS_PARAMS,
        "params: limit === undefined ? [...params, page.size, page.offset] : [...params, page.size, limit, page.offset, page.offset],",
      ],
    ],
  },
  {
    id: "V103",
    rule: "text sorts by a Host function that folds case, ties broken by the rows' own key",
    edits: [
      [KEY, `return column.kind === "string" ? \`lower(\${quoted(column.id)}) \${direction}\` : ${OWN_KEY};`],
      [ORDER, `return [...keys, ${ID}].join(", ");`],
    ],
  },
  {
    // In this query's shape it is the same edit as second-1's V1: every sort is kept whatever the filters hold.
    id: "V104",
    rule: "beside an or group every sort is kept, ties broken by the rows' own key",
    edits: [[ORDER, `return [...keys, ${ID}].join(", ");`]],
  },
  {
    id: "V105",
    rule: "a row with no value in a later sorted column sorts last among the rows that tie on the columns before it",
    edits: [
      [KEYS, "const keys = sorts.map((s, i) => {"],
      [
        KEY,
        `return (i > 0 ? \`(\${quoted(column.id)} IS NULL\${TEXT_KINDS.has(column.kind) ? \` OR \${quoted(column.id)} = ''\` : ""}), \` : "") + ${OWN_KEY};`,
      ],
    ],
  },
  {
    id: "V106",
    rule: "not equal on text by IS NOT, which keeps empty cells",
    edits: [[NEQ, "return text ? `lower(${c}) IS NOT ?` : `(${c} IS NULL OR ${c} <> ?)`;"]],
  },
  // V107, a hidden sort column inside the cut, is the example's own query: no edit.
  { id: "V107", rule: "a count sorts by a hidden column too (the example's own query)", edits: [] },
];
