// In-app dialogs, in place of the browser's confirm() and alert().
//
//   if (await confirmDialog("Remove this member from the workspace?", { confirmLabel: "Remove", danger: true })) { ... }
//   alertDialog("Unable to generate PDF. Please try again.");
//
// <DialogHost /> (mounted once in App) draws them. Requests made before it mounts wait in a queue.

let present = null;      // set by DialogHost
const waiting = [];

function open(request) {
  return new Promise((resolve) => {
    const item = { ...request, resolve };
    if (present) present(item);
    else waiting.push(item);
  });
}

/** Resolves true when confirmed, false when cancelled or dismissed. */
export function confirmDialog(message, { title, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false } = {}) {
  return open({ kind: "confirm", message: String(message ?? ""), title, confirmLabel, cancelLabel, danger });
}

/** A message with one button. Resolves when it is closed. `tone`: "error" (default) | "info". */
export function alertDialog(message, { title, okLabel = "OK", tone = "error" } = {}) {
  return open({ kind: "alert", message: String(message ?? ""), title, confirmLabel: okLabel, tone });
}

// For DialogHost only.
export function attachDialogHost(fn) {
  present = fn;
  if (fn) while (waiting.length) fn(waiting.shift());
  return () => { if (present === fn) present = null; };
}
