export default function Card({
  title,
  children,
  className = ""
}) {
  return (
    <div className={`ea-card p-5 ${className}`}>
      {title ? <div className="mb-3 text-sm font-semibold text-slate-900">{title}</div> : null}
      {children}
    </div>
  );
}
