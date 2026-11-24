// Presentation metadata is never part of the visible, copied or spoken reply.
export function replyMarkup(value) {
  const actions = [];
  let text = String(value || "").replace(/<invoke\s+name=["']quick_actions["']\s*>([\s\S]*?)(?:<\/invoke>|$)/gi, (_, body) => {
    const parameter = body.match(/<parameter\s+name=["']actions["']\s*>([\s\S]*?)(?:<\/parameter>|$)/i);
    try {
      const values = JSON.parse(parameter?.[1] || "null");
      if (Array.isArray(values)) actions.push(...values.filter(x => typeof x === "string"));
    } catch { /* Hide incomplete metadata too. */ }
    return "";
  }).replace(/<quick_actions>([\s\S]*?)(?:<\/quick_actions>|$)/gi, (_, body) => {
    actions.push(...body.split("\n").map(x => x.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")));
    return "";
  }).trim();
  const options = [];
  text = text.replace(/<reply_options>([\s\S]*?)(?:<\/reply_options>|$)/gi, (_, body) => {
    options.push(...body.split("\n").map(x => x.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")));
    return "";
  }).trim();
  const answersQuestion = options.some(x => x.trim());
  const choices = answersQuestion ? options : text.includes("?") ? [] : actions;
  return { text, answersQuestion, prompts: [...new Set(choices.map(x => x.trim()).filter(x => x && !/[<>]/.test(x)))].slice(0, 3)
    .map(x => ({ label: x.slice(0, 80), prompt: x.slice(0, 300) })) };
}
