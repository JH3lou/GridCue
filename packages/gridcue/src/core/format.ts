const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const dollarsAndCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 20,
});

/**
 * An amount as GridCue shows it in previews and questions, by the column's kind. Exact: a filter on $1.50, $0.0004 or
 * 12.34% is never shown as $2, $0.00 or 12.3%. The 15 significant digits drop only the noise a scale leaves behind
 * ("$1.1m" is stored as 1100000.0000000002).
 */
export const formatAmount = (value: number, kind: string | undefined): string => {
  if (kind === "currency") {
    const amount = Number(value.toPrecision(15));
    return (Number.isInteger(amount) ? dollars : dollarsAndCents).format(amount);
  }
  return kind === "percent" ? `${Number((value * 100).toPrecision(12))}%` : value.toLocaleString("en-US", { maximumFractionDigits: 20 });
};
