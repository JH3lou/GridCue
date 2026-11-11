const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const dollarsAndCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

/**
 * Formats an amount for people by its kind, the same way in previews and in questions: "$1,000,000", "10%", "5".
 * Cents are shown whenever the amount has them: a Preview states the filter exactly, so $1.50 is never "$2".
 */
export const formatAmount = (value: number, kind: string | undefined): string =>
  kind === "currency"
    ? (Number.isInteger(value) ? dollars : dollarsAndCents).format(value)
    : kind === "percent"
      ? `${Number((value * 100).toPrecision(12))}%`
      : value.toLocaleString("en-US", { maximumFractionDigits: 20 });
