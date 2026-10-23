// One toast system for the whole app (22 Oct). Any page calls `toast({...})`; the one host in Layout shows it.
//   kind:    "success" | "pending" | "error" (also "warn" and "info")
//   title:   the bold line; detail: the grey line ("Score 80 → 86")
//   actions: [{ label: "Undo", onClick }] on the right
//   id:      a toast already on screen with the same id is replaced in place (a pending toast turning into its result)
// Success and pending close after 5 s (paused on hover or focus); errors stay until closed. At most 2 are shown.
let counter = 0;

export function toast(t) {
  const id = t.id || `t${Date.now().toString(36)}${(counter += 1)}`;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("ea:toast", { detail: { ...t, id, message: t.detail ?? t.message } }));
  }
  return id;
}

/** "Score 80 → 86", or "" when the score didn't move or isn't known. */
export function scoreChange(before, after) {
  if (before === null || before === undefined || before === "" || after === null || after === undefined || after === "") return "";
  const b = Number(before);
  const a = Number(after);
  if (!Number.isFinite(b) || !Number.isFinite(a) || Math.round(a) === Math.round(b)) return "";
  return `Score ${Math.round(b)} → ${Math.round(a)}`;
}

/** Runs an action with a pending toast that turns into its result in place: success (with the score change) or error. */
export async function withToast({ pending = "Saved. Checking your score…", title, detail = "", run, score, undo = null, see = null, retry = null }) {
  const id = toast({ kind: "pending", title: pending });
  try {
    const before = score ? score() : null;
    await run();
    const after = score ? await Promise.resolve(score(true)) : null;
    const moved = scoreChange(before, after);
    toast({ id, kind: "success", title, detail: [detail, moved].filter(Boolean).join(". "),
      actions: [...(undo ? [{ label: "Undo", onClick: undo }] : []), ...(see ? [{ label: "See it", onClick: see }] : [])] });
    return true;
  } catch {
    toast({ id, kind: "error", title: "That couldn't be saved.", detail: "Nothing was changed.", actions: retry ? [{ label: "Try again", onClick: retry }] : [] });
    return false;
  }
}
