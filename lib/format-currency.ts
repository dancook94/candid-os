export function formatGbp(value: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(value);
}

export function formatQuoteCount(count: number) {
  return count === 1 ? "1 quote" : `${count} quotes`;
}
