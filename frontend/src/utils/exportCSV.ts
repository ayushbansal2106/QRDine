/**
 * Client-side CSV export utility.
 * Generates a CSV file from an array of objects and triggers a browser download.
 */
export function exportToCSV(
  data: Record<string, any>[],
  filename: string = "export"
): void {
  if (!data || data.length === 0) return;

  // Get all unique keys across all objects
  const headers = Array.from(
    new Set(data.flatMap((row) => Object.keys(row)))
  );

  // Escape CSV values (handle commas, quotes, newlines)
  const escapeCSV = (value: any): string => {
    if (value === null || value === undefined) return "";
    const str = String(value);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  // Build CSV string
  const csvRows = [
    headers.map(escapeCSV).join(","), // Header row
    ...data.map((row) =>
      headers.map((h) => escapeCSV(row[h])).join(",")
    ),
  ];

  const csvContent = csvRows.join("\n");

  // Create blob and trigger download
  const blob = new Blob(["\uFEFF" + csvContent], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.csv`;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
