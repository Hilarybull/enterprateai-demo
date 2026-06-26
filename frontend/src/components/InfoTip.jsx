import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

function Tooltip({ anchorRef, text }) {
  const [style, setStyle] = useState({ opacity: 0 });
  const tipRef = useRef(null);

  useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const width = 256;
    const gap = 8;
    const top = rect.bottom + gap + window.scrollY;
    // Center on icon, then clamp so tooltip stays within viewport
    const centeredLeft = rect.left + rect.width / 2 - width / 2;
    const left = Math.max(8, Math.min(centeredLeft, window.innerWidth - width - 8));
    setStyle({ position: "absolute", top, left, width, zIndex: 9999, opacity: 1 });
  }, [anchorRef]);

  return createPortal(
    <div
      ref={tipRef}
      style={style}
      className="rounded-xl bg-slate-900 px-3 py-2 text-left text-xs leading-snug text-white shadow-lg pointer-events-none"
    >
      <span
        style={{
          position: "absolute",
          top: -4,
          left: "50%",
          transform: "translateX(-50%) rotate(45deg)",
          width: 8,
          height: 8,
          background: "#0f172a",
        }}
      />
      {text}
    </div>,
    document.body
  );
}

export default function InfoTip({ text, className = "" }) {
  const [visible, setVisible] = useState(false);
  const btnRef = useRef(null);

  if (!text) return null;

  return (
    <span className={"relative inline-flex " + className}>
      <button
        ref={btnRef}
        type="button"
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
        aria-label="Info"
      >
        <span className="text-[9px] font-extrabold leading-none">i</span>
      </button>
      {visible ? <Tooltip anchorRef={btnRef} text={text} /> : null}
    </span>
  );
}
