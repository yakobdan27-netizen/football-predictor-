export function ManualDataBanner() {
  return (
    <div
      className="card"
      style={{
        marginBottom: "1rem",
        padding: "0.65rem 1rem",
        borderColor: "var(--border)",
        background: "rgba(76, 175, 80, 0.06)",
        fontSize: "0.8125rem",
        color: "var(--muted)",
      }}
    >
      All data is entered manually by the user. No football APIs or external data sources are used.
    </div>
  );
}
