function sanitizeNumberString(next) {
  if (typeof next !== "string") return "";
  // Keep digits and a single decimal point. Remove everything else.
  let out = "";
  let hasDot = false;
  for (const ch of next) {
    if (ch >= "0" && ch <= "9") out += ch;
    else if (ch === "." && !hasDot) {
      out += ".";
      hasDot = true;
    }
  }
  return out;
}

export function parseNumber(value, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  const s = String(value ?? "").trim();
  if (!s) return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

export function parseIntSafe(value, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : fallback;
  const s = String(value ?? "").trim();
  if (!s) return fallback;
  const n = Number(s);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

export default function NumberInput({ value, onChange, className = "", placeholder, ...props }) {
  return (
    <input
      {...props}
      placeholder={value ? null : placeholder}
      value={value ?? ""}
      onChange={(e) => onChange(sanitizeNumberString(e.target.value))}
      inputMode="decimal"
      autoComplete="off"
      className={"ea-input " + className}
    />
  );
}

