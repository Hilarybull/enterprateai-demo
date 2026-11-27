const normalise = value => String(value || "").toLowerCase().replace(/[’']/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

export function composerSuggestions({ last, answered, hasUser, draft = "", blocked = false, starters = [] }) {
  if (blocked || (last?.failed && !answered)) return [];
  const options = last?.prompts?.length && !answered ? last.prompts : hasUser ? [] : starters;
  const typed = normalise(draft).replace(/^(?:please|can you|could you|would you|i want to|id like to)\s+/, "");
  if (!typed) return options;
  return options.filter(option => {
    const candidates = [option.label, option.prompt];
    if (/^(apply|yes|confirm)$/i.test(option.prompt || "")) candidates.push("yes", "confirm", "go ahead");
    if (/^(cancel|no|not now)$/i.test(option.prompt || "")) candidates.push("no", "cancel", "not now");
    return candidates.some(candidate => normalise(candidate).includes(typed));
  });
}
