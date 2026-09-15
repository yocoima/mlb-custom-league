// Sort raw numeric values (including pitching outs), never formatted display text.
export function sortStatRows(rows, field, direction = "desc") {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const comparison = ["name", "manager", "team"].includes(field)
      ? String(a[field] ?? "").localeCompare(String(b[field] ?? ""))
      : Number(a[field] ?? 0) - Number(b[field] ?? 0);
    return sign * comparison || String(a.name).localeCompare(String(b.name)) || String(a.manager).localeCompare(String(b.manager));
  });
}
