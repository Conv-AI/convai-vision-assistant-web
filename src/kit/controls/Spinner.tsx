export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  const r = 8 - 0.75;
  const circumference = 2 * Math.PI * r;
  return (
    <svg
      className={['convai-spinner', className].filter(Boolean).join(' ')}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="convai-spinner__ring" cx="8" cy="8" r={r} />
      <circle
        className="convai-spinner__arc"
        cx="8"
        cy="8"
        r={r}
        strokeDasharray={`${String(circumference / 4)} ${String(circumference)}`}
      />
    </svg>
  );
}
