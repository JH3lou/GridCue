/**
 * The arithmetic of a Total (operation set spec, 5.4; ADR 0030). One copy for every Grid Adapter, so both give the
 * same number to the last digit.
 *
 * A sum is the exact sum of the values as they are written in decimal, rounded once at the end. A cell that shows 0.1
 * is one tenth, though the number the computer keeps for it is a hair more. Adding those numbers one after another keeps
 * each hair: 0.1 + 0.2 comes to 0.30000000000000004, and the last digit depends on the order of the rows. Money is
 * written in decimal, so the total a User adds up by hand from the cells is the decimal one. And two Grid Adapters add
 * the same rows in different orders, so only a sum that doesn't depend on order gives both the same number.
 *
 * How: each value is scaled to a whole number by the fewest powers of ten that give it back exactly (cents by 100), and
 * whole numbers add exactly while they stay below 2^50. Past that, for a value with more than nine decimals, and for one
 * that scales past 2^50 (16 or 17 significant digits), the decimals each value prints as are added as big integers.
 * Either way the result is divided once, so it is the number nearest the exact decimal sum.
 *
 * An average is that exact sum divided once by the count of values: three cells of 0.117 average 0.117. Only finite numbers count: `null`, a missing value, an
 * empty string, `NaN`, an infinity and text are skipped. With no value to count, a total is empty (`null`), never 0.
 */

/** The functions a Grid Adapter applies by default: a sum and an average (ADR 0030). */
export type TotalFunction = "sum" | "avg";

/** Whether a cell counts in a total: a finite number. */
export const countsInTotal = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const POW10 = Array.from({ length: 10 }, (_, i) => 10 ** i);
const FAST_BOUND = 2 ** 50;

/** The fewest decimals, 0 to 9, that give `value` back exactly when scaled to a whole number; -1 when it needs more. */
const decimalsOf = (value: number): number => {
  for (let d = 0; d < POW10.length; d++) {
    const p = POW10[d] as number;
    if (Math.round(value * p) / p === value) return d;
  }
  return -1;
};

/** The decimal a number prints as, as whole digits and a scale: value = digits / 10^scale. */
const toScaled = (value: number): [bigint, number] => {
  const [mantissa = "0", exponent] = String(value).split("e");
  const negative = mantissa.startsWith("-");
  const bare = negative ? mantissa.slice(1) : mantissa;
  const dot = bare.indexOf(".");
  const whole = dot < 0 ? bare : bare.slice(0, dot);
  const fraction = dot < 0 ? "" : bare.slice(dot + 1);
  let digits = whole + fraction;
  let scale = fraction.length - (exponent ? Number(exponent) : 0);
  if (scale < 0) {
    digits += "0".repeat(-scale);
    scale = 0;
  }
  return [BigInt((negative ? "-" : "") + digits), scale];
};

/** The number nearest `digits / 10^scale`. */
const fromScaled = (digits: bigint, scale: number): number => {
  if (scale === 0) return Number(digits);
  const negative = digits < 0n;
  const s = (negative ? -digits : digits).toString().padStart(scale + 1, "0");
  return Number(`${negative ? "-" : ""}${s.slice(0, -scale)}.${s.slice(-scale)}`);
};

/**
 * A total of `cells`: their sum, or their average over the cells that hold a value. Cells with no value are skipped.
 * `null` when no cell holds a value. The order of the cells never changes it.
 *
 * One pass. Each value with up to nine decimals is added, as a whole number, to the sum for its own number of decimals.
 * Below 2^50 scaling is off by less than a quarter, so rounding finds the whole number, and each addition is exact. A
 * sum that would pass 2^50 moves to a big integer first. A value with more decimals, or one that scales past 2^50, is kept
 * as the decimal it prints as. At the end the sums are brought to one scale and divided once, by the count too for an
 * average.
 */
export const totalOf = (cells: readonly unknown[], fn: TotalFunction): number | null =>
  new TotalCells(cells.length, (i) => cells[i]).total(cells.keys(), fn);

/** Not read yet, no value, and more than nine decimals: the markers `TotalCells` keeps beside a cell's decimals. */
const UNREAD = -3;
const NO_VALUE = -2;
const PRINTED = -1;

/**
 * The cells of one column, each read once, for many totals over sets of them: the whole view's, each group's, and the
 * totals that order the groups. `cell(i)` gives the cell of row `i`, for `i` from 0 to `size - 1`.
 */
export class TotalCells {
  private readonly decimals: Int8Array;
  private readonly wholes: Float64Array;
  constructor(
    size: number,
    private readonly cell: (i: number) => unknown,
  ) {
    this.decimals = new Int8Array(size).fill(UNREAD);
    this.wholes = new Float64Array(size);
  }

  private read(i: number): number {
    const known = this.decimals[i] as number;
    if (known !== UNREAD) return known;
    const value = this.cell(i);
    let d = NO_VALUE;
    if (countsInTotal(value)) {
      d = decimalsOf(value);
      const whole = d < 0 ? value : Math.round(value * (POW10[d] as number));
      // Past 2^50 the scaling itself may be off by a unit ("123456789012.34567" scales to …568), so such a value is kept
      // as the decimal it prints as, like one with more than nine decimals.
      if (d < 0 || Math.abs(whole) > FAST_BOUND) d = PRINTED;
      this.wholes[i] = d === PRINTED ? value : whole;
    }
    this.decimals[i] = d;
    return d;
  }

  /** The total of the cells of `rows`: see `totalOf`. */
  total(rows: Iterable<number>, fn: TotalFunction): number | null {
    const sums = new Array<number>(POW10.length).fill(0);
    const bounds = new Array<number>(POW10.length).fill(0);
    let big: bigint[] | undefined;
    const printed: number[] = [];
    let count = 0;
    let top = 0;
    for (const i of rows) {
      const d = this.read(i);
      if (d === NO_VALUE) continue;
      count++;
      const whole = this.wholes[i] as number;
      if (d === PRINTED) {
        printed.push(whole);
        continue;
      }
      if (d > top) top = d;
      const size = Math.abs(whole);
      if ((bounds[d] as number) + size > FAST_BOUND) {
        big ??= new Array<bigint>(POW10.length).fill(0n);
        big[d] = (big[d] as bigint) + BigInt(sums[d] as number);
        sums[d] = 0;
        bounds[d] = 0;
      }
      sums[d] = (sums[d] as number) + whole;
      bounds[d] = (bounds[d] as number) + size;
    }
    return count === 0 ? null : finish(sums, bounds, big, printed, top, count, fn);
  }
}

const finish = (
  sums: number[],
  bounds: number[],
  big: bigint[] | undefined,
  printed: readonly number[],
  top: number,
  count: number,
  fn: TotalFunction,
): number => {
  // The sum is a whole number of 10^-scale, and an average that sum over the count: each is divided once.
  if (!big && printed.length === 0) {
    // Brought to one scale, the sums still add exactly while the bound stays below 2^50.
    let total = 0;
    let bound = 0;
    for (let d = 0; d <= top; d++) {
      const p = (POW10[top - d] as number) ?? 1;
      total += (sums[d] as number) * p;
      bound += (bounds[d] as number) * p;
    }
    const divisor = (POW10[top] as number) * (fn === "sum" ? 1 : count);
    if (bound <= FAST_BOUND && divisor <= Number.MAX_SAFE_INTEGER) return total / divisor;
  }
  const extra = printed.map(toScaled);
  const scale = extra.reduce((max, [, k]) => Math.max(max, k), top);
  let total = 0n;
  for (let d = 0; d <= top; d++) {
    total += ((big?.[d] ?? 0n) + BigInt(sums[d] as number)) * 10n ** BigInt(scale - d);
  }
  for (const [digits, k] of extra) total += digits * 10n ** BigInt(scale - k);
  if (fn === "sum") return fromScaled(total, scale);
  // The average to 60 more decimals, and a last digit 1 where the division leaves a remainder, so the one rounding to a
  // number falls on the side of the exact average.
  const shifted = total * 10n ** 60n;
  const quotient = shifted / BigInt(count);
  const sticky = shifted % BigInt(count) === 0n ? 0n : quotient < 0n || (quotient === 0n && shifted < 0n) ? -1n : 1n;
  return fromScaled(quotient * 10n + sticky, scale + 61);
};
