import { Fragment } from "react";

/**
 * What was read from the owner's own first message, shown once (QA P5-1): one compact line,
 * "From what you said: dog walking · Bristol · March · 3 mates who said they'd pay (Edit)".
 * Never a reply bubble, and never asked again. The same line on the homepage chat, in the Agent's
 * forms and in the quick checks. `items`: [{ key, text }]. `onEdit`: open them to change.
 * `children`: shown under the line while editing (each answer, to pick the one to change).
 */
export default function SaidLine({ items, onEdit = null, editing = false, children = null, title = "From what you said" }) {
  const shown = (items || []).filter((it) => it && String(it.text ?? "").trim());
  if (!shown.length) return null;
  if (shown.some((it) => it.label)) {
    // E3: every field read from the message, each on its own line with its own Edit.
    return (
      <div data-said className="rounded-xl bg-slate-50 px-3 py-2 text-[12.5px] leading-relaxed text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
        <p className="font-semibold text-slate-500 dark:text-slate-400">{title}</p>
        <ul className="mt-1 space-y-0.5" data-said-lines>
          {shown.map((it) => (
            <li key={it.key} data-said-chip={it.key} className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="text-slate-500 dark:text-slate-400">{it.label}</span>
              <span aria-hidden="true" className="text-slate-400">·</span>
              <span className="font-medium text-slate-800 dark:text-slate-100">{it.text}</span>
              {onEdit && !editing && (
                <button type="button" data-said-edit onClick={() => onEdit(it.key)} className="ml-1 text-[12px] font-semibold text-brand-700 underline-offset-2 hover:underline dark:text-brand-300">Edit</button>
              )}
            </li>
          ))}
        </ul>
        {editing && children}
      </div>
    );
  }
  return (
    <div data-said className="rounded-xl bg-slate-50 px-3 py-2 text-[12.5px] leading-relaxed text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
      <p data-said-line>
        <span className="font-semibold text-slate-500 dark:text-slate-400">{title}: </span>
        {shown.map((it, n) => (
          <Fragment key={it.key}>
            {n > 0 && <span aria-hidden="true" className="text-slate-400"> · </span>}
            <span data-said-chip={it.key} className="font-medium text-slate-800 dark:text-slate-100">{it.text}</span>
          </Fragment>
        ))}
        {onEdit && !editing && (
          <>
            {" "}
            <button type="button" data-said-edit onClick={onEdit} className="font-semibold text-brand-700 underline-offset-2 hover:underline dark:text-brand-300">(Edit)</button>
          </>
        )}
      </p>
      {editing && children}
    </div>
  );
}
