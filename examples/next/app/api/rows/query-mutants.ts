// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the strings are query.ts source text, which holds template literals.
/**
 * Wrong Data Queries, for the Query Check's own tests (see query-mutants.test.ts). Each one is the example's query
 * (query.ts) with one rule translated the way a Host often gets it wrong: the smallest change to the real query's
 * source, written as the text it finds and the text it puts in its place. Test code only: nothing outside the tests
 * imports this file.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

export interface Mutant {
  /** The held-out mutant's number, as the round-1 list names it. */
  id: string;
  /** The rule the mutant breaks, in plain words. */
  rule: string;
  /** Pairs of the text found in query.ts, exactly once each, and the text put in its place. */
  edits: ReadonlyArray<readonly [find: string, replace: string]>;
}

// The pieces of query.ts the mutants change, exactly as the file has them.
const NEQ = "return text ? `${cell} <> ?` : `(${c} IS NULL OR ${c} <> ?)`;";
const EQ = "return `${cell} = ?`;";
const EQ_PUSH = 'case "eq":\n      params.push(bound(column, value));';
const IN = 'return `${cell} IN (${value.map(() => "?").join(", ")})`;';
const IN_PUSH = "params.push(...value.map((v) => bound(column, v)));";
const CONTAINS = "return `instr(${cell}, ?) > 0`;";
const STARTS = "return `instr(${cell}, ?) = 1`;";
const COMPARE = "return `${c} ${SQL_COMPARISON[p.operator]} ?`;";
const BETWEEN = "return `(${c} >= ? AND ${c} <= ?)`;";
const IS_EMPTY = "      return empty;\n";
const JOINS = 'const JOINS = { and: " AND ", or: " OR " } as const;';
const CONDITIONS = "const conditions = state.filters ? [groupSql(schema, state.filters, params)] : [];";
const PARTS = "const parts = group.children.map((child) =>";
const DAY_PARAMS = "params.push(...{ eq: [start, after], gt: [after], gte: [start], lt: [start], lte: [after] }[operator]);";
const DAY_OPERATOR = 'return `${c} ${{ gt: ">=", gte: ">=", lt: "<", lte: "<" }[operator]} ?`;';
const DAY_EQ = 'if (operator === "eq") return `(${c} >= ? AND ${c} < ?)`;';
const DAY_BOUNDS = "const [start, after] = [startOfDay(day, timeZone), startOfDay(nextDay(day), timeZone)];";
const NO_OFFSET = "if (zulu === undefined && sign === undefined) return instantOfClock(clock, timeZone);";
const DATE_COLUMN = "params.push(dayText(day));\n    return `${c} ${SQL_COMPARISON[operator]} ?`;";
const BETWEEN_MAX = 'dateEnd(column, "lte", range.max, params, zone)';
const ORDER = 'return [...keys, "rowid"].join(", ");';
const DIRECTIONS = 'const DIRECTIONS = { asc: "ASC NULLS LAST", desc: "DESC NULLS FIRST" } as const;';
const KEYS = "const keys = sorts.map((s) => {";
const DIRECTION = "const direction = DIRECTIONS[s.direction as keyof typeof DIRECTIONS];";
const KEY = 'return `${quoted(column.id)}${TEXT_KINDS.has(column.kind) ? " COLLATE NOCASE" : ""} ${direction}`;';
const ON_PAGE = "const rowsOnPage = limit === undefined ? page.size : Math.max(0, Math.min(page.size, limit - page.offset));";
const TOTAL = "total:\n      limit === undefined\n";
const ROWS =
  "sql: `SELECT ${columns} FROM ${TABLE}${where} ORDER BY ${order} LIMIT ? OFFSET ?`,\n      params: [...params, rowsOnPage, page.offset],";
const HAS_VALUE = "const hasValue = limit === undefined ? undefined : hasValueSql(schema, sorts);";
const HAS_VALUE_SQL = "return TEXT_KINDS.has(column.kind) ? `(${c} IS NOT NULL AND ${c} <> '')` : `${c} IS NOT NULL`;";
const LOWER = '(value) => (typeof value === "string" ? value.toLowerCase() : value)';
const SELECTED = "returnedColumns(schema)\n    .map((c) => quoted(c.id))";

/** A LIKE pattern from the operand, with `!` as the escape character, escaping only the characters named. */
const like = (escaped: string[], before: string, after: string) =>
  `\${cell} LIKE ${before}${escaped.reduce((sql, ch) => `replace(${sql}, '${ch}', '!${ch}')`, "replace(?, '!', '!!')")}${after} ESCAPE '!'`;

export const MUTANTS: readonly Mutant[] = [
  // --- not equal ---
  { id: "M1", rule: "not equal keeps empty cells (text)", edits: [[NEQ, NEQ.replace("`${cell} <> ?`", "`lower(${c}) <> ?`")]] },
  {
    id: "M2",
    rule: "not equal keeps empty cells (enum)",
    edits: [
      [NEQ, NEQ.replace("`(${c} IS NULL OR ${c} <> ?)`", 'column.kind === "enum" ? `NOT (${c} = ?)` : `(${c} IS NULL OR ${c} <> ?)`')],
    ],
  },
  {
    id: "M3",
    rule: "not equal keeps null and empty text alike",
    edits: [[NEQ, NEQ.replace("`${cell} <> ?`", "`(${c} IS NULL OR (${c} <> '' AND ${cell} <> ?))`")]],
  },
  {
    id: "M5",
    rule: "not equal ignores case on text",
    edits: [[NEQ, NEQ.replace("`${cell} <> ?`", "`coalesce(${c}, '') <> ?`")]],
  },
  {
    id: "M6",
    rule: "not equal to empty text leaves out empty text",
    edits: [[NEQ, NEQ.replace("`${cell} <> ?`", "value === \"\" ? `${c} IS NOT NULL AND ? = ''` : `${cell} <> ?`")]],
  },
  // --- equal, in ---
  { id: "M8", rule: "equal ignores case on text", edits: [[EQ, "return `${text ? `coalesce(${c}, '')` : cell} = ?`;"]] },
  {
    id: "M9",
    rule: "equal ignores case on text (the operand too)",
    edits: [[EQ_PUSH, EQ_PUSH.replace("bound(column, value)", "text ? (value as string) : bound(column, value)")]],
  },
  {
    id: "M10",
    rule: "in a list ignores case on text",
    edits: [[IN, IN.replace("${cell} IN", "${text ? `coalesce(${c}, '')` : cell} IN")]],
  },
  {
    id: "M11",
    rule: "in a list ignores case on text (the operands too)",
    edits: [[IN_PUSH, "params.push(...value.map((v) => (text ? v : bound(column, v))));"]],
  },
  { id: "M12", rule: "equal does not trim the cell", edits: [[EQ, "return `${text ? `lower(trim(coalesce(${c}, '')))` : cell} = ?`;"]] },
  { id: "M13", rule: "equal does not trim the operand", edits: [[EQ, 'return `${cell} = ${text ? "trim(?)" : "?"}`;']] },
  { id: "M14", rule: "equal reads _ as plain text", edits: [[EQ, "return text ? `coalesce(${c}, '') LIKE ?` : `${cell} = ?`;"]] },
  { id: "M15", rule: "equal on text leaves out empty cells", edits: [[EQ, "return text ? `(${empty} OR ${cell} = ?)` : `${cell} = ?`;"]] },
  {
    id: "M16",
    rule: "equal to empty text keeps exactly the empty cells (not every row)",
    edits: [[EQ, 'return text && value === "" ? "? = \'\'" : `${cell} = ?`;']],
  },
  {
    id: "M17",
    rule: "equal to empty text keeps exactly the empty cells (null too)",
    edits: [[EQ, "return `${text ? `lower(${c})` : cell} = ?`;"]],
  },
  {
    id: "M18",
    rule: "equal to empty text keeps exactly the empty cells (empty text too)",
    edits: [[EQ, "return text && value === \"\" ? `${c} IS NULL AND ? = ''` : `${cell} = ?`;"]],
  },
  {
    id: "M19",
    rule: "in a list of empty text keeps exactly the empty cells",
    edits: [[IN, IN.replace("${cell} IN", "${text ? `lower(${c})` : cell} IN")]],
  },
  {
    id: "M20",
    rule: "equal on an enum leaves out empty cells",
    edits: [[EQ, 'return column.kind === "enum" ? `(${c} = ? OR ${c} IS NULL)` : `${cell} = ?`;']],
  },
  { id: "M21", rule: "no leaves out empty cells", edits: [[EQ, "return value === false ? `${c} IS NOT (1 - ?)` : `${cell} = ?`;"]] },
  // --- contains, starts with ---
  { id: "M23", rule: "contains ignores case", edits: [[CONTAINS, "return `instr(coalesce(${c}, ''), ?) > 0`;"]] },
  { id: "M24", rule: "starts with ignores case", edits: [[STARTS, "return `instr(coalesce(${c}, ''), ?) = 1`;"]] },
  { id: "M25", rule: "contains reads % as plain text", edits: [[CONTAINS, `return \`${like(["_"], "'%' || ", " || '%'")}\`;`]] },
  { id: "M26", rule: "contains reads _ as plain text", edits: [[CONTAINS, `return \`${like(["%"], "'%' || ", " || '%'")}\`;`]] },
  { id: "M27", rule: "starts with reads % as plain text", edits: [[STARTS, `return \`${like(["_"], "", " || '%'")}\`;`]] },
  { id: "M28", rule: "starts with looks only at the start", edits: [[STARTS, "return `instr(${cell}, ?) > 0`;"]] },
  {
    id: "M29",
    rule: "contains empty text keeps every row, empty cells included",
    edits: [[CONTAINS, "return `instr(lower(${c}), ?) > 0`;"]],
  },
  {
    id: "M30",
    rule: "contains empty text keeps every row (not none)",
    edits: [[CONTAINS, 'return value === "" ? "? <> \'\'" : `instr(${cell}, ?) > 0`;']],
  },
  {
    id: "M31",
    rule: "starts with empty text keeps every row, empty cells included",
    edits: [[STARTS, "return `instr(lower(${c}), ?) = 1`;"]],
  },
  { id: "M32", rule: "contains does not trim the operand", edits: [[CONTAINS, "return `instr(${cell}, trim(?)) > 0`;"]] },
  { id: "M33", rule: "contains leaves out empty cells", edits: [[CONTAINS, "return `(${c} IS NULL OR instr(${cell}, ?) > 0)`;"]] },
  // --- comparisons, between ---
  {
    id: "M34",
    rule: "greater than leaves out the value itself",
    edits: [[COMPARE, 'return `${c} ${p.operator === "gt" ? ">=" : SQL_COMPARISON[p.operator]} ?`;']],
  },
  {
    id: "M35",
    rule: "less than leaves out the value itself",
    edits: [[COMPARE, 'return `${c} ${p.operator === "lt" ? "<=" : SQL_COMPARISON[p.operator]} ?`;']],
  },
  {
    id: "M36",
    rule: "greater than or equal includes the value itself",
    edits: [[COMPARE, 'return `${c} ${p.operator === "gte" ? ">" : SQL_COMPARISON[p.operator]} ?`;']],
  },
  {
    id: "M37",
    rule: "less than or equal includes the value itself",
    edits: [[COMPARE, 'return `${c} ${p.operator === "lte" ? "<" : SQL_COMPARISON[p.operator]} ?`;']],
  },
  {
    id: "M38",
    rule: "a comparison leaves out empty cells",
    edits: [[COMPARE, "return `(${c} ${SQL_COMPARISON[p.operator]} ? OR ${c} IS NULL)`;"]],
  },
  {
    id: "M39",
    rule: "a comparison leaves out empty cells (not read as zero)",
    edits: [[COMPARE, "return `COALESCE(${c}, 0) ${SQL_COMPARISON[p.operator]} ?`;"]],
  },
  { id: "M41", rule: "between includes both ends (the high end)", edits: [[BETWEEN, "return `(${c} >= ? AND ${c} < ?)`;"]] },
  { id: "M42", rule: "between includes both ends (the low end)", edits: [[BETWEEN, "return `(${c} > ? AND ${c} <= ?)`;"]] },
  { id: "M43", rule: "between includes both ends", edits: [[BETWEEN, "return `(${c} > ? AND ${c} < ?)`;"]] },
  {
    id: "M44",
    rule: "between leaves out empty cells",
    edits: [[BETWEEN, "return `(COALESCE(${c}, 0) >= ? AND COALESCE(${c}, 0) <= ?)`;"]],
  },
  {
    id: "M45",
    rule: "between compares negative numbers as numbers",
    edits: [[BETWEEN, "return `(ABS(${c}) >= ABS(?) AND ABS(${c}) <= ABS(?))`;"]],
  },
  {
    id: "M46",
    rule: "numbers compare as numbers",
    edits: [[COMPARE, "return `CAST(${c} AS TEXT) ${SQL_COMPARISON[p.operator]} CAST(? AS TEXT)`;"]],
  },
  // --- is empty ---
  {
    id: "M47",
    rule: "is empty keeps empty text too",
    edits: [[IS_EMPTY, "      return TEXT_KINDS.has(column.kind) ? `${c} IS NULL` : empty;\n"]],
  },
  { id: "M48", rule: "is empty keeps null too", edits: [[IS_EMPTY, "      return TEXT_KINDS.has(column.kind) ? `${c} = ''` : empty;\n"]] },
  {
    id: "M49",
    rule: "is empty leaves out whitespace-only text",
    edits: [[IS_EMPTY, "      return TEXT_KINDS.has(column.kind) ? `(${c} IS NULL OR trim(${c}) = '')` : empty;\n"]],
  },
  {
    id: "M51",
    rule: "is empty on a number: zero is a value",
    edits: [[IS_EMPTY, "      return NUMBER_KINDS.has(column.kind) ? `COALESCE(${c}, 0) = 0` : empty;\n"]],
  },
  {
    id: "M53",
    rule: "is empty keeps only empty cells (placeholder text is a value)",
    edits: [
      [IS_EMPTY, "      return TEXT_KINDS.has(column.kind) ? `(${c} IS NULL OR ${c} = '' OR ${c} = 'N/A' OR ${c} = '-')` : empty;\n"],
    ],
  },
  // --- combining filters ---
  {
    id: "M54",
    rule: "an or group keeps a row that either filter keeps",
    edits: [[JOINS, 'const JOINS = { and: " AND ", or: " AND " } as const;']],
  },
  { id: "M55", rule: "filters joined with and must both hold", edits: [[JOINS, 'const JOINS = { and: " OR ", or: " OR " } as const;']] },
  {
    id: "M56",
    rule: "in a list is one filter (brackets)",
    edits: [[IN, 'return text ? value.map(() => `${cell} = ?`).join(" OR ") : `${cell} IN (${value.map(() => "?").join(", ")})`;']],
  },
  {
    id: "M57",
    rule: "is empty is one filter (brackets)",
    edits: [[IS_EMPTY, "      return TEXT_KINDS.has(column.kind) ? `${c} IS NULL OR ${c} = ''` : empty;\n"]],
  },
  {
    id: "M58",
    rule: "not equal is one filter (brackets)",
    edits: [[NEQ, NEQ.replace("`(${c} IS NULL OR ${c} <> ?)`", "`${c} IS NULL OR ${c} <> ?`")]],
  },
  { id: "M59", rule: "no filters keep every row", edits: [[CONDITIONS, CONDITIONS.replace(": [];", ': ["0"];')]] },
  {
    id: "M60",
    rule: "every filter applies, not only the first",
    edits: [[PARTS, "const parts = group.children.slice(0, 1).map((child) =>"]],
  },
  {
    id: "M61",
    rule: "two filters on one column both apply",
    edits: [
      [
        PARTS,
        'const parts = group.children.filter((child, i, all) => child.type === "group" || !all.slice(i + 1).some((later) => later.type !== "group" && (later as FilterPredicate).columnId === (child as FilterPredicate).columnId)).map((child) =>',
      ],
    ],
  },
  // --- dates ---
  {
    id: "M62",
    rule: "after a date leaves out that whole day (date and time)",
    edits: [
      [DAY_PARAMS, DAY_PARAMS.replace("gt: [after]", "gt: [start]")],
      [DAY_OPERATOR, DAY_OPERATOR.replace('gt: ">="', 'gt: ">"')],
    ],
  },
  {
    id: "M63",
    rule: "a date means the whole day (date and time)",
    edits: [[DAY_EQ, 'if (operator === "eq") return `(${c} = ? AND ? IS NOT NULL)`;']],
  },
  {
    id: "M64",
    rule: "on or before a date includes that whole day (date and time)",
    edits: [
      [DAY_PARAMS, DAY_PARAMS.replace("lte: [after]", "lte: [start]")],
      [DAY_OPERATOR, DAY_OPERATOR.replace('lte: "<"', 'lte: "<="')],
    ],
  },
  {
    id: "M65",
    rule: "between includes both ends, each a whole day (date and time)",
    edits: [[BETWEEN_MAX, 'dateEnd(column, "lt", range.max, params, zone).replace("<", "<=")']],
  },
  {
    id: "M66",
    rule: "after a date: the day is in the calendar's time zone, not UTC",
    edits: [
      [
        DAY_BOUNDS,
        DAY_BOUNDS.replace("startOfDay(nextDay(day), timeZone)", 'startOfDay(nextDay(day), operator === "gt" ? "UTC" : timeZone)'),
      ],
    ],
  },
  {
    id: "M67",
    rule: "on a date: the day is in the calendar's time zone, not UTC",
    edits: [[DAY_BOUNDS, DAY_BOUNDS.replaceAll(", timeZone)", ', operator === "eq" ? "UTC" : timeZone)')]],
  },
  {
    id: "M68",
    rule: "the time zone is a zone, not a fixed offset",
    edits: [
      [
        DAY_BOUNDS,
        "const [start, after] = [day, nextDay(day)].map((d) => clockMs(d, 0, 0, 0, 0) - offsetAt(Date.UTC(d.y, 0, 1), timeZone)) as [number, number];",
      ],
    ],
  },
  {
    id: "M69",
    rule: "a time with no offset is on its own date",
    edits: [[NO_OFFSET, "if (zulu === undefined && sign === undefined) return clock;"]],
  },
  {
    id: "M70",
    rule: "a date is that day (not shifted by a time zone)",
    edits: [[DATE_COLUMN, "params.push(dayText(day));\n    return `date(${c}, '-5 hours') ${SQL_COMPARISON[operator]} ?`;"]],
  },
  {
    id: "M71",
    rule: "after a date leaves out that whole day (date)",
    edits: [[DATE_COLUMN, 'params.push(dayText(day));\n    return `${c} ${operator === "gt" ? ">=" : SQL_COMPARISON[operator]} ?`;']],
  },
  {
    id: "M72",
    rule: "between includes both ends (date)",
    edits: [[BETWEEN_MAX, 'dateEnd(column, column.kind === "date" ? "lt" : "lte", range.max, params, zone)']],
  },
  // --- sorts ---
  {
    id: "M75",
    rule: "sorts by each column in turn (the second too)",
    edits: [[ORDER, 'return [...keys.slice(0, 1), "rowid"].join(", ");']],
  },
  {
    id: "M76",
    rule: "each sort in its direction",
    edits: [[DIRECTIONS, 'const DIRECTIONS = { asc: "ASC NULLS LAST", desc: "ASC NULLS LAST" } as const;']],
  },
  {
    id: "M77",
    rule: "each sort in its direction (the second)",
    edits: [
      [KEYS, "const keys = sorts.map((s, i) => {"],
      [DIRECTION, 'const direction = DIRECTIONS[(i === 1 ? "asc" : s.direction) as keyof typeof DIRECTIONS];'],
    ],
  },
  {
    id: "M78",
    rule: "each sort in its direction (the first)",
    edits: [
      [KEYS, "const keys = sorts.map((s, i) => {"],
      [DIRECTION, 'const direction = DIRECTIONS[(i === 0 ? "asc" : s.direction) as keyof typeof DIRECTIONS];'],
    ],
  },
  { id: "M79", rule: "the first sort column is the main key", edits: [[ORDER, 'return [...keys.reverse(), "rowid"].join(", ");']] },
  {
    id: "M80",
    rule: "numbers sort as numbers",
    edits: [[KEY, "return `${NUMBER_KINDS.has(column.kind) ? `CAST(${quoted(column.id)} AS TEXT)` : quoted(column.id)} ${direction}`;"]],
  },
  { id: "M81", rule: "text sorts as core sorts it (case only breaks ties)", edits: [[KEY, "return `${quoted(column.id)} ${direction}`;"]] },
  // --- counts and pages ---
  {
    id: "M84",
    rule: "a count is cut before paging (not on each page)",
    edits: [[ON_PAGE, "const rowsOnPage = limit === undefined ? page.size : Math.min(page.size, limit);"]],
  },
  {
    id: "M85",
    rule: "a count keeps only the first rows",
    edits: [
      [ON_PAGE, "const rowsOnPage = page.size;"],
      [TOTAL, "total:\n      true\n"],
    ],
  },
  { id: "M86", rule: "a count is not the page size", edits: [[ON_PAGE, "const rowsOnPage = limit === undefined ? page.size : limit;"]] },
  {
    id: "M87",
    rule: "a count keeps the first rows of the sorted rows",
    edits: [
      [
        ROWS,
        'sql: limit === undefined ? `SELECT ${columns} FROM ${TABLE}${where} ORDER BY ${order} LIMIT ? OFFSET ?` : `SELECT ${columns} FROM (SELECT *, rowid AS rid FROM ${TABLE}${where} ORDER BY rowid LIMIT ?) ORDER BY ${order.replace(/rowid$/, "rid")} LIMIT ? OFFSET ?`,\n      params: [...params, ...(limit === undefined ? [] : [limit]), rowsOnPage, page.offset],',
      ],
    ],
  },
  {
    id: "M88",
    rule: "a count keeps the first rows of the filtered rows",
    edits: [
      [
        ROWS,
        'sql: limit === undefined ? `SELECT ${columns} FROM ${TABLE}${where} ORDER BY ${order} LIMIT ? OFFSET ?` : `SELECT ${columns} FROM (SELECT *, rowid AS rid FROM ${TABLE}${hasValue ? ` WHERE ${hasValue}` : ""} ORDER BY ${order} LIMIT ?)${state.filters ? ` WHERE ${conditions[0]}` : ""} ORDER BY ${order.replace(/rowid$/, "rid")} LIMIT ? OFFSET ?`,\n      params: limit === undefined ? [...params, rowsOnPage, page.offset] : [limit, ...params, rowsOnPage, page.offset],',
      ],
    ],
  },
  {
    id: "M89",
    rule: "a count never keeps a row with no value in the first sorted column",
    edits: [[HAS_VALUE, "const hasValue = undefined;"]],
  },
  {
    id: "M91",
    rule: "a count never keeps a row with empty text in the first sorted column",
    edits: [[HAS_VALUE_SQL, "return `${c} IS NOT NULL`;"]],
  },
  {
    id: "M92",
    rule: "a count's guard is on the first sorted column only",
    edits: [
      [
        HAS_VALUE,
        'const hasValue = limit === undefined ? undefined : sorts.map((s) => hasValueSql(schema, [s])).join(" AND ") || undefined;',
      ],
    ],
  },
  {
    id: "M93",
    rule: "with no count, rows with no value in the sort column stay",
    edits: [[HAS_VALUE, "const hasValue = hasValueSql(schema, sorts);"]],
  },
  {
    id: "M95",
    rule: "a page is the page asked for",
    edits: [[ROWS, ROWS.replace("rowsOnPage, page.offset]", "rowsOnPage, page.offset + page.size]")]],
  },
  // --- other habits ---
  {
    id: "M96",
    rule: "a hidden column still filters",
    edits: [
      [
        CONDITIONS,
        'const conditions = state.filters ? [groupSql(schema, { ...state.filters, children: state.filters.children.filter((child) => child.type === "group" || state.visibleColumnIds.includes((child as FilterPredicate).columnId)) }, params)] : [];',
      ],
    ],
  },
  {
    id: "M97",
    rule: "case is ignored for every letter, not only A to Z",
    edits: [[LOWER, '(value) => (typeof value === "string" ? value.replace(/[A-Z]+/g, (s) => s.toLowerCase()) : value)']],
  },
  {
    id: "M98",
    rule: "the ids returned are the rows' ids",
    edits: [[SELECTED, "returnedColumns(schema)\n    .map((c, i) => (i === 0 ? `rowid AS ${quoted(c.id)}` : quoted(c.id)))"]],
  },
];

/** query.ts with the mutant's edits. Throws when an edit's text is not in the file exactly once. */
export const mutatedSource = (source: string, mutant: Mutant): string =>
  mutant.edits.reduce((text, [find, replace]) => {
    const count = text.split(find).length - 1;
    if (count !== 1) throw new Error(`${mutant.id}: the text to change is in query.ts ${count} times, not once: ${find}`);
    return text.replace(find, () => replace);
  }, source);

/**
 * Writes each mutant as its own module in `dir`, importing the same gridcue build the tests use, and returns the paths
 * by mutant ID.
 */
export const writeMutants = (dir: string, mutants: readonly Mutant[] = MUTANTS): Map<string, string> => {
  const source = readFileSync(new URL("./query.ts", import.meta.url), "utf8");
  const gridcue = createRequire(import.meta.url).resolve("gridcue");
  mkdirSync(dir, { recursive: true });
  return new Map(
    mutants.map((mutant) => {
      const path = join(dir, `${mutant.id}.ts`);
      writeFileSync(
        path,
        mutatedSource(source, mutant).replace('from "gridcue";', () => `from ${JSON.stringify(gridcue)};`),
      );
      return [mutant.id, path];
    }),
  );
};
