import { useEffect, useRef, useState } from "react";

export function CardIcon({ tone = "bg-brand-50 text-brand-600", children }) {
    return (
      <div className={`flex h-9 w-9 items-center justify-center rounded-2xl ${tone}`}>
        {children}
      </div>
    );
  }

export function ActionMenu({ items, label = "More actions", disabled = false }) {
    const [open, setOpen] = useState(false);
    const menuRef = useRef(null);

    useEffect(() => {
      if (!open) return;
      function handleClickOutside(event) {
        if (!menuRef.current || menuRef.current.contains(event.target)) return;
        setOpen(false);
      }
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [open]);

    return (
      <div ref={menuRef} className="relative shrink-0">
        <button
          type="button"
          aria-label={label}
          aria-expanded={open}
          aria-haspopup="menu"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        </button>
        {open ? (
          <div role="menu" onKeyDown={event => { if (event.key === "Escape") setOpen(false); }} className="absolute right-0 top-full z-30 mt-2 w-44 rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-lg">
            {items.map((item) => (
              <button
                key={item.label}
                role="menuitem"
                type="button"
                onClick={() => {
                  setOpen(false);
                  item.onClick?.();
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${
                  item.tone === "danger"
                    ? "text-rose-600 hover:bg-rose-50"
                    : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

