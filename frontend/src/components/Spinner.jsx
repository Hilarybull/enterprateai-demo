export default function Spinner({ size = 16, className = "" }) {
  return (
    <span
      className={"inline-block animate-spin rounded-full border-2 border-slate-200 border-t-brand-600 " + className}
      style={{ width: size, height: size }}
      aria-label="Loading"
      role="status"
    />
  );
}

