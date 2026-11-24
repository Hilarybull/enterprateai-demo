export function carriedText(session) {
  const said = String(session?.resolution?.original_goal || session?.original_goal || "").trim().replace(/[.!?]+$/, "");
  const answers = { ...Object.fromEntries((session?.summary || []).filter(row => row?.key && row.value != null).map(row => [row.key, row.value])), ...(session?.proposed || {}), ...(session?.inputs || {}) };
  const asked = Object.fromEntries((session?.questions || []).map((q) => [q.key, q]));
  const currency = String(session?.currency || "").toUpperCase();
  // Each answer in plain words: a choice by its own words, an amount with its currency (the owner, 28 Oct: "this is not smart")
  const word = (k) => {
    const v = answers[k];
    if (v === undefined || v === null || !String(v).trim() || String(k).startsWith("_")) return "";
    const q = asked[k] || {};
    const option = (q.options || q.chips || []).find((o) => String(o?.value) === String(v));
    if (option?.label) return String(option.label);
    if (typeof v === "number" && (q.type === "number" || q.prefix || ["amount", "price", "cost"].includes(k)) && v >= 1000) return `${currency ? `${currency} ` : ""}${v.toLocaleString("en-GB")}`;
    return String(v).trim();
  };
  const low = (t) => (t ? t[0].toLowerCase() + t.slice(1) : t);
  const join = (...parts) => parts.filter(Boolean).join(", ");
  let sentence = "";
  if (session?.goal_key === "need_funding") {
    // "I need funding: ₦5m for stock, a grant, in 3 to 6 months. The business is trading, no traction yet."
    const need = join([word("amount"), word("use") && `for ${low(word("use"))}`].filter(Boolean).join(" "), low(word("route")), low(word("timing")));
    const now = join(word("stage") && `The business is ${low(word("stage"))}`, word("traction") && `Traction reported for this funding request: ${word("traction")}`, word("where") && `based in ${word("where")}`);
    sentence = [need && `${said}: ${need}`, now].filter(Boolean).join(". ");
  } else if (session?.goal_key === "launch") {
    // "I want to launch a mobile car wash, for office workers, in Abuja, at ₦15,000, by March."
    const what = join(word("sell"), word("customer") && `for ${low(word("customer"))}`, word("where") && `in ${word("where")}`,
      word("price") && `at ${word("price")}`, word("cost") && `costing ${word("cost")} to deliver`, word("target_date") && `by ${word("target_date")}`);
    sentence = [`${said}${what ? `: ${what}` : ""}`, word("stage") && `The business is ${low(word("stage"))}`].filter(Boolean).join(". ");
  } else {
    const rest = Object.keys(answers).map(word).filter(Boolean).map(low);
    sentence = rest.length ? `${said}: ${rest.join(", ")}` : said;
  }
  return `${(sentence || said).replace(/\.\./g, ".").trim()}${/[.!?]$/.test(sentence || said) ? "" : "."}`.slice(0, 600);
}

