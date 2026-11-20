// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the strings are query.ts source text, which holds template literals.
/**
 * Wrong Data Queries, held-out round 3, for the Query Check's own tests (see query-mutants-round-3.test.ts). Each is the
 * example's query (query.ts) with one rule translated wrong, written as the text it finds in query.ts and the text it
 * puts in its place. Test code only: nothing outside the tests imports this file.
 *
 * Round 3 numbers its mutants M1 to M25 again, so "round 3 M6" is not round 1's or round 2's M6. The example's query
 * uses instr, not LIKE, so the LIKE mutants (M6 to M9) swap instr for the LIKE or GLOB a Host might write.
 */
import type { Mutant } from "./query-mutants";

// The pieces of query.ts the mutants change, exactly as the file has them.
const VALUE = "const value = p.value;";
const NEQ = "return text ? `${cell} <> ?` : `(${c} IS NULL OR ${c} <> ?)`;";
const EQ = "return `${cell} = ?`;";
const IN = 'return `${cell} IN (${value.map(() => "?").join(", ")})`;';
const IN_PUSH = "params.push(...value.map((v) => bound(column, v)));";
const IN_NONE = 'if (value.length === 0) return "0";';
const CONTAINS = "return `instr(${cell}, ?) > 0`;";
const CONTAINS_PUSH =
  "// instr, not LIKE: % and _ in the value are plain text, and empty text keeps every row.\n      params.push(bound(column, value));";
const STARTS = "return `instr(${cell}, ?) = 1`;";
const BETWEEN_PUSH = "params.push(bound(column, range.min), bound(column, range.max));";
const GROUP = "return `(${parts.join(join)})`;";
const KEY = 'return `${quoted(column.id)}${TEXT_KINDS.has(column.kind) ? " COLLATE NOCASE" : ""} ${direction}`;';
const ORDER = 'return [...keys, "rowid"].join(", ");';
const ORDER_CALL = "const order = orderSql(schema, sorts);";
const SORTS = "const sorts = Array.isArray(state.sorts) ? state.sorts : [];";
const FIRST = "const first = sorts[0];";
const HAS_VALUE_SQL = "return TEXT_KINDS.has(column.kind) ? `(${c} IS NOT NULL AND ${c} <> '')` : `${c} IS NOT NULL`;";
const ON_PAGE = "const rowsOnPage = limit === undefined ? page.size : Math.max(0, Math.min(page.size, limit - page.offset));";
const ROWS_SQL = "sql: `SELECT ${columns} FROM ${TABLE}${where} ORDER BY ${order} LIMIT ? OFFSET ?`,";
const ROWS_PARAMS = "params: [...params, rowsOnPage, page.offset],";
const TOTAL =
  "total:\n      limit === undefined\n        ? { sql: `SELECT count(*) AS total FROM ${TABLE}${where}`, params: [...params] }\n        : { sql: `SELECT min(count(*), ?) AS total FROM ${TABLE}${where}`, params: [limit, ...params] },";

const VISIBLE = "state.visibleColumnIds.includes(s.columnId)";

export const MUTANTS_ROUND_3: readonly Mutant[] = [
  // --- "in" mixed with empty text, and the empty operand ---
  {
    id: "M1",
    rule: "in a list with empty text keeps empty text cells, not only null",
    edits: [
      [
        IN_NONE,
        `${IN_NONE}\n      const listed = value.filter((v) => v !== "");\n      const arm = listed.length < value.length ? \`\${c} IS NULL OR \` : "";`,
      ],
      [IN_PUSH, IN_PUSH.replace("value.map", "listed.map")],
      [IN, 'return `(${arm}${cell} IN (${listed.map(() => "?").join(", ")}))`;'],
    ],
  },
  {
    id: "M2",
    rule: "in a list keeps the empty cells wherever empty text is in the list",
    edits: [
      [IN_NONE, `${IN_NONE}\n      const listed = value[0] === "" ? value : value.filter((v) => v !== "");`],
      [IN_PUSH, IN_PUSH.replace("value.map", "listed.map")],
      [IN, IN.replace("value.map", "listed.map")],
    ],
  },
  {
    id: "M3",
    rule: "in a list with empty text leaves out whitespace-only text",
    edits: [
      [IN, 'return `(${cell} IN (${value.map(() => "?").join(", ")})${text && value.includes("") ? ` OR trim(${cell}) = \'\'` : ""})`;'],
    ],
  },
  {
    id: "M4",
    rule: "equal to empty text leaves out whitespace-only text",
    edits: [[EQ, 'return text && value === "" ? `trim(${cell}) = ?` : `${cell} = ?`;']],
  },
  {
    id: "M5",
    rule: "contains and starts with empty text keep every row",
    edits: [
      [CONTAINS, 'return value === "" ? (params.pop(), empty) : `instr(${cell}, ?) > 0`;'],
      [STARTS, 'return value === "" ? (params.pop(), empty) : `instr(${cell}, ?) = 1`;'],
    ],
  },
  // --- LIKE escaping ---
  {
    // Escapes % and _ with a backslash, but not the backslash itself.
    id: "M6",
    rule: "contains reads a backslash as plain text",
    edits: [[CONTAINS, "return `${cell} LIKE '%' || replace(replace(?, '%', '\\\\%'), '_', '\\\\_') || '%' ESCAPE '\\\\'`;"]],
  },
  {
    id: "M7",
    rule: "starts with reads a backslash as plain text",
    edits: [[STARTS, "return `${cell} LIKE replace(replace(?, '%', '\\\\%'), '_', '\\\\_') || '%' ESCAPE '\\\\'`;"]],
  },
  {
    // Escapes % and _ first, then doubles every backslash, so "100%" becomes a backslash and then a wildcard.
    id: "M8",
    rule: "contains reads % as plain text (escaped in the wrong order)",
    edits: [
      [
        CONTAINS,
        "return `${cell} LIKE '%' || replace(replace(replace(?, '%', '\\\\%'), '_', '\\\\_'), '\\\\', '\\\\\\\\') || '%' ESCAPE '\\\\'`;",
      ],
    ],
  },
  {
    id: "M9",
    rule: "contains reads ?, * and [ as plain text (GLOB)",
    edits: [[CONTAINS, "return `${cell} GLOB '*' || ? || '*'`;"]],
  },
  {
    // The cell is lowered, the value is not.
    id: "M10",
    rule: "contains ignores case in what it asks for",
    edits: [
      [
        CONTAINS_PUSH,
        CONTAINS_PUSH.replace("params.push(bound(column, value));", "params.push(text ? (value as string) : bound(column, value));"),
      ],
    ],
  },
  // --- a sort on a hidden column ---
  {
    id: "M11",
    rule: "a sort on a hidden column still orders the rows",
    edits: [[ORDER_CALL, `const order = orderSql(schema, sorts.filter((s) => ${VISIBLE}));`]],
  },
  {
    id: "M12",
    rule: "a second sort on a hidden column still orders the rows",
    edits: [[ORDER_CALL, `const order = orderSql(schema, sorts.filter((s, i) => i === 0 || ${VISIBLE}));`]],
  },
  {
    id: "M13",
    rule: "a count sorted by a hidden column keeps the first rows of that sort",
    edits: [[SORTS, `const sorts = (Array.isArray(state.sorts) ? state.sorts : []).filter((s) => ${VISIBLE});`]],
  },
  {
    id: "M14",
    rule: "a sort on a hidden column sorts by that column, not the first one shown",
    edits: [
      [
        SORTS,
        `const sorts = (Array.isArray(state.sorts) ? state.sorts : []).map((s) => (${VISIBLE} ? s : { ...s, columnId: state.visibleColumnIds[0] as string }));`,
      ],
    ],
  },
  // --- ties in a count ---
  {
    id: "M15",
    rule: "rows that tie keep the order they were loaded in (sorted going up)",
    edits: [[ORDER, 'return [...keys, sorts[0]?.direction === "asc" ? "rowid DESC" : "rowid"].join(", ");']],
  },
  {
    // Breaks ties by the second text column (Owner on the ledger), "to be deterministic". The first is the id.
    id: "M16",
    rule: "rows that tie keep the order they were loaded in, not another column's",
    edits: [
      [
        ORDER,
        'return [...keys, ...(keys.length > 0 ? [quoted(returnedColumns(schema).filter((c) => c.kind === "string")[1]?.id ?? "")] : []), "rowid"].join(", ");',
      ],
    ],
  },
  {
    // RANK gives every tied row the same rank, so "rank <= N" keeps more than N rows.
    id: "M17",
    rule: "a count keeps N rows, even when rows tie",
    edits: [
      [
        ON_PAGE,
        'const rowsOnPage = page.size;\n  const ranked = limit === undefined ? `${TABLE}${where}` : `(SELECT *, rowid AS rowid, RANK() OVER (ORDER BY ${order.replace(/, rowid$/, "")}) AS r FROM ${TABLE}${where}) WHERE r <= ?`;\n  const rankParams = limit === undefined ? [] : [limit];',
      ],
      [ROWS_SQL, "sql: `SELECT ${columns} FROM ${ranked} ORDER BY ${order} LIMIT ? OFFSET ?`,"],
      [ROWS_PARAMS, "params: [...params, ...rankParams, rowsOnPage, page.offset],"],
      [TOTAL, "total: { sql: `SELECT count(*) AS total FROM ${ranked}`, params: [...params, ...rankParams] },"],
    ],
  },
  // --- the count's guard ---
  {
    id: "M18",
    rule: "a count leaves out only rows with no value in the first sort column, and zero is a value",
    edits: [[HAS_VALUE_SQL, "return TEXT_KINDS.has(column.kind) ? `(${c} IS NOT NULL AND ${c} <> '')` : c;"]],
  },
  {
    id: "M19",
    rule: "a count's guard is on the first sort column only",
    edits: [[FIRST, "const first = sorts[sorts.length - 1];"]],
  },
  // --- other habits ---
  {
    id: "M20",
    rule: "a sort orders by the column, not by its name bound as a value",
    edits: [
      [KEY, "return `? ${direction}`;"],
      [ROWS_PARAMS, "params: [...params, ...sorts.map((s) => s.columnId), rowsOnPage, page.offset],"],
    ],
  },
  { id: "M21", rule: "zero is a filter value", edits: [[VALUE, `${VALUE}\n  if (typeof value === "number" && !value) return "1";`]] },
  { id: "M22", rule: "no (false) is a filter value", edits: [[VALUE, `${VALUE}\n  if (value === false) return "1";`]] },
  {
    id: "M23",
    rule: "not equal keeps empty cells (yes or no)",
    edits: [[NEQ, 'return text ? `${cell} <> ?` : column.kind === "boolean" ? `${c} = 1 - ?` : `(${c} IS NULL OR ${c} <> ?)`;']],
  },
  {
    id: "M24",
    rule: "a nested or group is one filter (brackets)",
    edits: [[GROUP, 'return group.combinator === "or" ? parts.join(join) : `(${parts.join(join)})`;']],
  },
  {
    id: "M25",
    rule: "between keeps both ends, in order",
    edits: [[BETWEEN_PUSH, "params.push(bound(column, range.max), bound(column, range.min));"]],
  },
];
