export function formatCurrency(amount: number | string | undefined | null): string {
  const numericAmount = typeof amount === "string" ? parseFloat(amount) : amount;
  if (numericAmount === undefined || numericAmount === null || isNaN(numericAmount)) {
    return "₹0.00";
  }
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(numericAmount);
}
