export function LeaveLegend() {
  const items = [
    { label: "Approved leave", className: "bg-emerald-50 ring-emerald-600/20" },
    { label: "Pending leave", className: "bg-amber-50 ring-amber-600/20" },
    { label: "Additional paid leave", className: "bg-cyan-50 ring-cyan-600/25" },
    { label: "Bank holiday", className: "bg-sky-50 ring-sky-600/15" },
    { label: "Compulsory closure", className: "bg-violet-50 ring-violet-600/15" },
    { label: "Paid gift closure", className: "bg-teal-50 ring-teal-600/15" },
  ];

  return (
    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
      {items.map((item) => (
        <span
          key={item.label}
          className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 ring-1 ${item.className}`}
        >
          {item.label}
        </span>
      ))}
    </div>
  );
}
