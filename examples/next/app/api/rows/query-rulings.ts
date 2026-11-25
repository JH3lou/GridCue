// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the strings are query.ts source text, which holds template literals.
/**
 * Data Queries for the rulings on what is the Host's own (more grids spec 5.5, `compare`), for the Query Check's own
 * tests (see query-rulings.test.ts). Each is the example's query (query.ts) with one choice made another way, written
 * as the text it finds in query.ts and the text it puts in its place. Test code only: nothing outside the tests imports
 * this file.
 *
 * `RIGHT_CHOICES` are right Data Queries: each breaks ties, or sorts an empty cell, another way than `applyView` does,
 * and the Query Check must pass every one. `WRONG_CHOICES` go past what the rulings leave to the Host, and the Query
 * Check must fail each on a case whose name states the rule.
 */
import type { Mutant } from "./query-mutants";

// The pieces of query.ts these change, exactly as the file has them.
const ORDER = 'return [...keys, "rowid"].join(", ");';
const DIRECTIONS = 'const DIRECTIONS = { asc: "ASC NULLS LAST", desc: "DESC NULLS FIRST" } as const;';
const KEYS = "const keys = sorts.map((s) => {";
const ORDER_CALL = "const order = orderSql(schema, sorts);";
const ON_PAGE = "const rowsOnPage = limit === undefined ? page.size : Math.max(0, Math.min(page.size, limit - page.offset));";
const ROWS_SQL = "sql: `SELECT ${columns} FROM ${TABLE}${where} ORDER BY ${order} LIMIT ? OFFSET ?`,";
const ROWS_PARAMS = "params: [...params, rowsOnPage, page.offset],";
const TOTAL =
  "total:\n      limit === undefined\n        ? { sql: `SELECT count(*) AS total FROM ${TABLE}${where}`, params: [...params] }\n        : { sql: `SELECT min(count(*), ?) AS total FROM ${TABLE}${where}`, params: [limit, ...params] },";
const LOWER = '(value) => (typeof value === "string" ? value.toLowerCase() : value)';
const BOUND_TEXT = 'if (column.kind === "string" && typeof value === "string") return value.toLowerCase(); // compared ignoring case';

/** The rows' own key: the first column of both schemas the tests run on holds the ids. */
const ID = "quoted(returnedColumns(schema)[0]?.id as string)";
const directions = (asc: "FIRST" | "LAST", desc: "FIRST" | "LAST") =>
  `const DIRECTIONS = { asc: "ASC NULLS ${asc}", desc: "DESC NULLS ${desc}" } as const;`;

/** Right Data Queries: what rulings R1 to R3 leave to the Host. `rule` says the choice each one makes. */
export const RIGHT_CHOICES: readonly Mutant[] = [
  // Rows that tie, and the tied rows a count keeps for its last places (R1, R2).
  { id: "T1", rule: "ties are broken by the rows' own key, going up", edits: [[ORDER, `return [...keys, ${ID}].join(", ");`]] },
  {
    id: "T2",
    rule: "ties are broken by the rows' own key, going down",
    edits: [[ORDER, `return [...keys, \`\${${ID}} DESC\`].join(", ");`]],
  },
  {
    id: "T3",
    rule: "ties are broken in the reverse of the order the rows were stored in",
    edits: [[ORDER, 'return [...keys, "rowid DESC"].join(", ");']],
  },
  // Where an empty cell sorts, on every column in every direction (R3).
  {
    id: "N1",
    rule: "an empty cell sorts first going up and last going down, as SQLite has it",
    edits: [[DIRECTIONS, directions("FIRST", "LAST")]],
  },
  { id: "N2", rule: "an empty cell always sorts first (NULLS FIRST)", edits: [[DIRECTIONS, directions("FIRST", "FIRST")]] },
  { id: "N3", rule: "an empty cell always sorts last (NULLS LAST)", edits: [[DIRECTIONS, directions("LAST", "LAST")]] },
  // Both at once.
  {
    id: "TN1",
    rule: "an empty cell always sorts first, and ties are broken by the rows' own key, going down",
    edits: [
      [DIRECTIONS, directions("FIRST", "FIRST")],
      [ORDER, `return [...keys, \`\${${ID}} DESC\`].join(", ");`],
    ],
  },
  {
    id: "TN2",
    rule: "an empty cell sorts first going up and last going down, and ties are broken in reverse",
    edits: [
      [DIRECTIONS, directions("FIRST", "LAST")],
      [ORDER, 'return [...keys, "rowid DESC"].join(", ");'],
    ],
  },
];

/**
 * "a IS NULL OR b IS NULL", over the sorted columns: whether a row has an empty cell in any of them. With no sorts it
 * is a test that is never true, since a bare number in ORDER BY names a column by its place.
 */
const ANY_EMPTY = '(sorts.map((s) => `${quoted(s.columnId)} IS NULL`).join(" OR ") || "1 = 0")';
/** The sorted columns, as a window's PARTITION BY: the rows that tie on every one of them. */
const TIED = '${sorts.map((s) => quoted(s.columnId)).join(", ")}';

/** Wrong Data Queries: each goes past what the rulings leave to the Host. `rule` says what it breaks. */
export const WRONG_CHOICES: readonly Mutant[] = [
  // --- A count that cuts inside tied rows (R2). Round 3's M17 is the third: RANK keeps every row that ties. ---
  {
    // "Keep a group of tied rows only when the whole group fits": the rows that tie at the cut all go, so fewer rows
    // come back than the count asks for. The count is taken from a ranked subquery in place of LIMIT, as M17 takes it.
    id: "W1",
    rule: "a count keeps its number of rows, and never drops the rows that tie at its cut",
    edits: [
      [
        ON_PAGE,
        `const rowsOnPage = page.size;\n  const ranked = limit === undefined ? \`\${TABLE}\${where}\` : \`(SELECT *, rowid AS rowid, RANK() OVER (ORDER BY \${order.replace(/, rowid$/, "")}) AS r, COUNT(*) OVER (PARTITION BY ${TIED}) AS n FROM \${TABLE}\${where}) WHERE r + n - 1 <= ?\`;\n  const rankParams = limit === undefined ? [] : [limit];`,
      ],
      [ROWS_SQL, "sql: `SELECT ${columns} FROM ${ranked} ORDER BY ${order} LIMIT ? OFFSET ?`,"],
      [ROWS_PARAMS, "params: [...params, ...rankParams, rowsOnPage, page.offset],"],
      [TOTAL, "total: { sql: `SELECT count(*) AS total FROM ${ranked}`, params: [...params, ...rankParams] },"],
    ],
  },
  {
    // "SELECT DISTINCT ON (value)": one row for each value, then the count. Rows from behind the tie fill its places.
    id: "W2",
    rule: "a count keeps no row from behind the tied rows at its cut",
    edits: [
      [
        ROWS_SQL,
        `sql: \`SELECT \${columns} FROM \${limit === undefined ? \`\${TABLE}\${where}\` : \`(SELECT *, rowid AS rowid, ROW_NUMBER() OVER (PARTITION BY ${TIED} ORDER BY rowid) AS r FROM \${TABLE}\${where}) WHERE r = 1\`} ORDER BY \${order} LIMIT ? OFFSET ?\`,`,
      ],
    ],
  },
  // --- A row with no value in a later sorted column (R3) ---
  {
    id: "W3",
    rule: "a row with an empty sort cell keeps its place by the columns before it (not after every other row)",
    edits: [[ORDER, `return [${ANY_EMPTY}, ...keys, "rowid"].join(", ");`]],
  },
  {
    id: "W4",
    rule: "a row with an empty sort cell keeps its place by the columns before it (not before every other row)",
    edits: [[ORDER, `return [\`\${${ANY_EMPTY}} DESC\`, ...keys, "rowid"].join(", ");`]],
  },
  {
    // The right rows, cut and paged in the right place, then put in order again by an outer query: after the count's
    // cut when the page holds every row, and on each page otherwise.
    id: "W5",
    rule: "a row with an empty sort cell keeps its place by the columns before it (after the cut, and on each page)",
    edits: [
      [
        ROWS_SQL,
        `sql: \`SELECT \${columns} FROM (SELECT *, rowid AS rid FROM \${TABLE}\${where} ORDER BY \${order} LIMIT ? OFFSET ?) ORDER BY \${${ANY_EMPTY}}, \${order.replace(/rowid$/, "rid")}\`,`,
      ],
    ],
  },
  // --- Sorts beside other things ---
  {
    id: "W6",
    rule: "a sort still orders the rows when a filter is set",
    edits: [[ORDER_CALL, "const order = orderSql(schema, state.filters ? [] : sorts);"]],
  },
  {
    // Only a number, date or yes/no column sorts after the first.
    id: "W7",
    rule: "a second sort on an enum or text column still orders the rows",
    edits: [
      [KEYS, 'const keys = sorts.filter((s, i) => i === 0 || !TEXT_KINDS.has(usableColumn(schema, s.columnId, "sort").kind)).map((s) => {'],
    ],
  },
  // --- Accents ---
  {
    // A collation that keeps å, ä and ö as letters of their own and reads every other accented letter as its plain one.
    id: "W8",
    rule: "text is compared with its accents: é is not e",
    edits: [
      [
        LOWER,
        '(value) => (typeof value === "string" ? [...value.toLowerCase()].map((letter) => ("åäö".includes(letter) ? letter : letter.normalize("NFD").replace(/\\p{M}/gu, ""))).join("") : value)',
      ],
      [
        BOUND_TEXT,
        'if (column.kind === "string" && typeof value === "string") return [...value.toLowerCase()].map((letter) => ("åäö".includes(letter) ? letter : letter.normalize("NFD").replace(/\\p{M}/gu, ""))).join("");',
      ],
    ],
  },
];
