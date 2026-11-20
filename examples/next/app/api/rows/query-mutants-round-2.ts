// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the strings are query.ts source text, which holds template literals.
/**
 * Wrong Data Queries, held-out round 2, for the Query Check's own tests (see query-mutants-round-2.test.ts). Each is the
 * example's query (query.ts) with one rule translated wrong, written as the text it finds in query.ts and the text it
 * puts in its place. Test code only: nothing outside the tests imports this file.
 *
 * Round 2 numbers its mutants M1 to M20 again, so "round 2 M6" is not round 1's M6. Two are left out, because this
 * query can't hold them: M3 (no date column takes "not equal") and M12 (a number column stores empty text as an empty
 * cell, so reading it as zero changes no row).
 */
import type { Mutant } from "./query-mutants";

// The pieces of query.ts the mutants change, exactly as the file has them.
const NEQ = "return text ? `${cell} <> ?` : `(${c} IS NULL OR ${c} <> ?)`;";
const NEQ_NUMBER = "`(${c} IS NULL OR ${c} <> ?)`";
const EQ = "return `${cell} = ?`;";
const IN = 'return `${cell} IN (${value.map(() => "?").join(", ")})`;';
const IN_PUSH = "params.push(...value.map((v) => bound(column, v)));";
const IN_NONE = 'if (value.length === 0) return "0";';
const CONTAINS = "return `instr(${cell}, ?) > 0`;";
const STARTS = "return `instr(${cell}, ?) = 1`;";
const COMPARE = "return `${c} ${SQL_COMPARISON[p.operator]} ?`;";
const IS_EMPTY = "      return empty;\n";
const PARTS = "const parts = group.children.map((child) =>";
const GROUP = "return `(${parts.join(join)})`;";
const ORDER_CALL = "const order = orderSql(schema, sorts);";
const ORDER = 'return [...keys, "rowid"].join(", ");';
const ON_PAGE = "Math.min(page.size, limit - page.offset)";
const TOTAL_LIMIT = "params: [limit, ...params] }";

export const MUTANTS_ROUND_2: readonly Mutant[] = [
  // --- not equal and empty ---
  {
    id: "M1",
    rule: "not equal to empty text keeps whitespace-only text",
    edits: [[NEQ, NEQ.replace("`${cell} <> ?`", 'value === "" ? `trim(${cell}) <> ?` : `${cell} <> ?`')]],
  },
  {
    id: "M2",
    rule: "not equal keeps empty cells (number)",
    edits: [[NEQ, NEQ.replace(NEQ_NUMBER, `NUMBER_KINDS.has(column.kind) ? \`\${c} <> ?\` : ${NEQ_NUMBER}`)]],
  },
  {
    id: "M4",
    rule: "is empty leaves out placeholder text",
    edits: [
      [
        IS_EMPTY,
        "      return TEXT_KINDS.has(column.kind) ? `(${c} IS NULL OR ${c} = '' OR lower(${c}) IN ('null', 'none', 'n/a', '-', '--', 'unknown'))` : empty;\n",
      ],
    ],
  },
  {
    id: "M5",
    rule: "is empty on a number: zero is a value",
    edits: [[IS_EMPTY, "      return NUMBER_KINDS.has(column.kind) ? `NOT ${c}` : empty;\n"]],
  },
  // --- in, equal, starts with, contains ---
  {
    id: "M6",
    rule: "in a list with empty text among other values keeps the empty cells too",
    edits: [
      [IN_NONE, `${IN_NONE}\n      const listed = value.length > 1 ? value.filter((v) => v !== "") : value;`],
      [IN_PUSH, IN_PUSH.replace("value.map", "listed.map")],
      [IN, IN.replace("value.map", "listed.map")],
    ],
  },
  {
    id: "M7",
    rule: "equal to whitespace-only text keeps only that text, not the empty cells",
    edits: [[EQ, 'return text && typeof value === "string" && value.trim() === "" ? `${cell} = trim(?)` : `${cell} = ?`;']],
  },
  { id: "M8", rule: "starts with keeps the spaces in what it asks for", edits: [[STARTS, "return `instr(${cell}, trim(?)) = 1`;"]] },
  {
    id: "M9",
    rule: "starts with reads _ as plain text",
    edits: [[STARTS, "return `${cell} LIKE replace(replace(?, '!', '!!'), '%', '!%') || '%' ESCAPE '!'`;"]],
  },
  {
    // The escape character is a backslash, and a backslash in what the filter asks for is not escaped.
    id: "M10",
    rule: "contains reads a backslash as plain text",
    edits: [[CONTAINS, "return `${cell} LIKE '%' || replace(replace(?, '%', '\\\\%'), '_', '\\\\_') || '%' ESCAPE '\\\\'`;"]],
  },
  {
    // SQLite's LIKE folds only the letters A to Z.
    id: "M11",
    rule: "starts with ignores case for every letter, not only A to Z",
    edits: [[STARTS, "return `${c} LIKE replace(replace(replace(?, '!', '!!'), '%', '!%'), '_', '!_') || '%' ESCAPE '!'`;"]],
  },
  // --- numbers ---
  {
    id: "M13",
    rule: "greater than compares the number as written, not rounded",
    edits: [[COMPARE, 'return `${p.operator === "gt" ? `ROUND(${c})` : c} ${SQL_COMPARISON[p.operator]} ?`;']],
  },
  {
    id: "M14",
    rule: "not equal on a number is one filter (brackets)",
    edits: [[NEQ, NEQ.replace(NEQ_NUMBER, `NUMBER_KINDS.has(column.kind) ? \`\${c} IS NULL OR \${c} <> ?\` : ${NEQ_NUMBER}`)]],
  },
  {
    id: "M15",
    rule: "in a list on an enum is one filter (brackets)",
    edits: [[IN, `return column.kind === "enum" ? value.map(() => \`\${cell} = ?\`).join(" OR ") : ${IN.slice("return ".length, -1)};`]],
  },
  // --- two filters on one column ---
  {
    id: "M16",
    rule: "two filters on one column joined with and both apply (not either)",
    edits: [
      [
        GROUP,
        'const runs: string[][] = [];\n  group.children.forEach((child, i) => {\n    const prev = group.children[i - 1];\n    const sameColumn = group.combinator === "and" && i > 0 && child.type !== "group" && prev?.type !== "group" && (prev as FilterPredicate).columnId === (child as FilterPredicate).columnId;\n    if (sameColumn) runs[runs.length - 1]?.push(parts[i] as string);\n    else runs.push([parts[i] as string]);\n  });\n  return `(${runs.map((run) => (run.length > 1 ? `(${run.join(" OR ")})` : run[0])).join(join)})`;',
      ],
    ],
  },
  {
    id: "M17",
    rule: "two filters on one column both apply (not only the first)",
    edits: [
      [
        PARTS,
        'const parts = group.children.filter((child, i, all) => child.type === "group" || !all.slice(0, i).some((earlier) => earlier.type !== "group" && (earlier as FilterPredicate).columnId === (child as FilterPredicate).columnId)).map((child) =>',
      ],
    ],
  },
  // --- hidden columns, sorts and counts ---
  {
    id: "M18",
    rule: "a sort on a hidden column still orders the rows",
    edits: [[ORDER_CALL, "const order = orderSql(schema, sorts.filter((s) => state.visibleColumnIds.includes(s.columnId)));"]],
  },
  {
    id: "M19",
    rule: "rows that tie keep the order they were loaded in",
    edits: [[ORDER, 'return [...keys, "rowid DESC"].join(", ");']],
  },
  {
    id: "M20",
    rule: "a count keeps the first N rows, not N - 1",
    edits: [
      [ON_PAGE, "Math.min(page.size, limit - 1 - page.offset)"],
      [TOTAL_LIMIT, "params: [limit - 1, ...params] }"],
    ],
  },
];
