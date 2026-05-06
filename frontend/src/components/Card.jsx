export default function Card({
  title,
  children,
  className = ""
}) {
  return (
    <div className={`ea-card p-4 sm:p-5 ${className}`}>
      {title ? <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</div> : null}
      {children}
    </div>
  );
}
