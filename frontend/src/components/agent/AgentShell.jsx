import { useRef } from "react";
import { useInView, usePageVisible } from "../../lib/motion";

// The Agent's look, in one place: the homepage launcher and the dashboard's Agent card are both
// built from this, so they can never drift apart. A slowly turning purple to pink border (a still
// gradient with reduced motion) around a deep indigo panel. The styles are .m-agent-card and
// .m-agent-border in index.css.

/** The Agent's mark: a gradient circle with a spark. `working`: a soft ring pulses around it. */
export function AgentAvatar({ size = 32, working = false, className = "" }) {
  return (
    <span aria-hidden="true" data-agent-avatar data-working={working || undefined} style={{ width: size, height: size }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 via-purple-500 to-pink-500 text-white shadow-md shadow-purple-900/30 ${working ? "m-pulse-ring" : ""} ${className}`}>
      <svg style={{ width: size * 0.55, height: size * 0.55 }} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.9 5.6a3 3 0 001.9 1.9L21.4 11.4a.6.6 0 010 1.2l-5.6 1.9a3 3 0 00-1.9 1.9L12 22l-1.9-5.6a3 3 0 00-1.9-1.9L2.6 12.6a.6.6 0 010-1.2l5.6-1.9a3 3 0 001.9-1.9L12 2z" /></svg>
    </span>
  );
}

/** Who it is: the avatar, the name, "Online" in words beside its green dot, and one line on what it does. `as`: the heading's tag. */
export function AgentIdentity({ subtitle, working = false, as: Title = "p" }) {
  return (
    <div className="flex min-w-0 items-start gap-3" data-agent-identity>
      <AgentAvatar size={32} working={working} />
      <div className="min-w-0">
        <Title className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-bold text-white">
          EnterprateAI Agent
          <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-300"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-400" />Online</span>
        </Title>
        {subtitle && <p className="mt-0.5 text-[13px] text-white/70" data-agent-subtitle>{subtitle}</p>}
      </div>
    </div>
  );
}

/**
 * The frame. `as`: the outer tag ("div", or "section" for a labelled region). `bodyClassName`: the
 * panel's padding. Everything else (data attributes, aria-label, handlers) goes on the outer tag.
 * The border stops turning while the card is off screen or the tab is in the background.
 */
export default function AgentShell({ as: Tag = "div", className = "", bodyClassName = "p-4 sm:p-6", children, ...rest }) {
  const box = useRef(null);
  const seen = useInView(box, { once: false, amount: 0.01 });
  const visible = usePageVisible();
  return (
    <Tag ref={box} data-agent-shell data-m-idle={!seen || !visible} {...rest}
      className={`m-agent-card relative overflow-hidden rounded-2xl p-[2px] text-left shadow-[0_20px_60px_rgba(108,92,231,0.25)] ${className}`}>
      <span aria-hidden="true" className="m-agent-border" />
      <div data-agent-panel className={`relative h-full rounded-[14px] bg-gradient-to-br from-[#1e1b4b] via-[#312e81] to-[#4c1d95] ${bodyClassName}`}>
        {children}
      </div>
    </Tag>
  );
}
