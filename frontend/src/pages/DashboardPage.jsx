import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import Badge from "../components/Badge";
import Button from "../components/Button";
import PageHeader from "../components/PageHeader";
import InfoTip from "../components/InfoTip";
import SectionCard from "../components/SectionCard";
import SegmentedTabs from "../components/SegmentedTabs";
import StatTile from "../components/StatTile";
import { useWorkspaceStore } from "../store/workspace";
import { formatCurrency, formatNumber, formatPercent } from "../lib/format";
import { buildActionPlan, dedupeText } from "../lib/insights";
import { pctWidth, shortExplanation, toneForScore } from "../lib/score";
import { apiRequest } from "../api/client";
import WorkspacePrompt from "../components/WorkspacePrompt";

/* ─── Inline styles: scoped CSS-in-JS using a style tag injected once ─── */
const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,300&display=swap');

  .ea-dash {
    --ink: #0f1117;
    --ink-2: #3a3d4a;
    --ink-3: #6b7280;
    --surface: #ffffff;
    --surface-2: #f8f8fb;
    --surface-3: #f1f1f6;
    --border: #e4e4ef;
    --brand: #2a6ff4;
    --brand-light: #e8f0fe;
    --brand-mid: #4f86f7;
    --accent: #00c48c;
    --accent-light: #e0faf2;
    --warn: #f59e0b;
    --warn-light: #fef3c7;
    --danger: #ef4444;
    --danger-light: #fee2e2;
    --radius: 16px;
    --radius-sm: 10px;
    --shadow-sm: 0 1px 3px rgba(15,17,23,.06), 0 1px 2px rgba(15,17,23,.04);
    --shadow-md: 0 4px 16px rgba(15,17,23,.08), 0 1px 3px rgba(15,17,23,.06);
    --shadow-lg: 0 12px 40px rgba(15,17,23,.12), 0 4px 12px rgba(15,17,23,.08);
    font-family: 'DM Sans', system-ui, sans-serif;
    color: var(--ink);
    background: var(--surface-2);
    min-height: 100vh;
    width: 100%;
  }

  .ea-container {
    max-width: 1120px;
    margin: 0 auto;
    padding: 18px 18px 64px;
  }
  @media (max-width: 640px) { .ea-container { padding: 14px 14px 72px; } }

  /* ── Typography ── */
  .ea-display {
    font-family: 'DM Sans', system-ui, sans-serif;
    font-style: normal;
    letter-spacing: -0.01em;
  }
  .ea-mono {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 0.75rem;
    letter-spacing: 0.05em;
  }

  /* ── Page header ── */
  .ea-page-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 28px;
  }
  .ea-page-header-right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .ea-score-pill {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: rgba(255,255,255,.72);
    backdrop-filter: blur(10px);
    box-shadow: var(--shadow-sm);
  }
  .ea-score-pill-num {
    font-family: 'DM Serif Display', Georgia, serif;
    font-size: 1.2rem;
    letter-spacing: -0.03em;
    line-height: 1;
  }
  .ea-score-pill-sub {
    display: flex;
    flex-direction: column;
    line-height: 1.1;
  }
  .ea-score-pill-sub .label {
    font-size: 0.62rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-3);
  }
  .ea-score-pill-sub .cls {
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--ink);
  }
  .ea-page-title {
    font-family: 'DM Sans', system-ui, sans-serif;
    font-size: 1.5rem;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--brand);
    line-height: 1.1;
  }
  .ea-page-sub {
    font-size: 0.875rem;
    color: var(--ink-3);
    margin-top: 4px;
    font-weight: 400;
  }
  .ea-page-sub strong { color: var(--ink-2); font-weight: 500; }

  /* ── Score ring (hero) ── */
  .ea-score-hero {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 28px 20px 20px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface);
    box-shadow: var(--shadow-md);
    overflow: hidden;
    gap: 0;
  }
  .ea-score-hero::before {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse 80% 60% at 50% 0%, rgba(42,111,244,.07) 0%, transparent 70%);
    pointer-events: none;
  }
  .ea-score-ring-wrap {
    position: relative;
    width: 120px;
    height: 120px;
  }
  .ea-score-ring-wrap svg { transform: rotate(-90deg); }
  .ea-score-ring-track { fill: none; stroke: var(--surface-3); stroke-width: 8; }
  .ea-score-ring-fill {
    fill: none;
    stroke-width: 8;
    stroke-linecap: round;
    transition: stroke-dashoffset .8s cubic-bezier(.4,0,.2,1);
  }
  .ea-score-center {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .ea-score-number {
    font-family: 'DM Serif Display', Georgia, serif;
    font-size: 2rem;
    font-weight: 400;
    letter-spacing: -0.04em;
    color: var(--ink);
    line-height: 1;
  }
  .ea-score-denom {
    font-size: 0.65rem;
    color: var(--ink-3);
    font-weight: 400;
    letter-spacing: 0.04em;
    margin-top: 1px;
  }
  .ea-score-label {
    margin-top: 12px;
    font-size: 1rem;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--ink);
  }
  .ea-score-sublabel {
    margin-top: 4px;
    font-size: 0.75rem;
    color: var(--ink-3);
    text-align: center;
    max-width: 160px;
    line-height: 1.4;
  }
  .ea-outcome-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 14px;
    padding: 5px 12px;
    border-radius: 999px;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .ea-outcome-chip-dot { width: 6px; height: 6px; border-radius: 50%; }
  .ea-chip-success { background: var(--accent-light); color: #059669; }
  .ea-chip-success .ea-outcome-chip-dot { background: var(--accent); }
  .ea-chip-warn { background: var(--warn-light); color: #b45309; }
  .ea-chip-warn .ea-outcome-chip-dot { background: var(--warn); }
  .ea-chip-danger { background: var(--danger-light); color: #b91c1c; }
  .ea-chip-danger .ea-outcome-chip-dot { background: var(--danger); }

  /* ── Stat tiles ── */
  .ea-stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 12px;
  }
  /* auto-fit handles responsiveness; no special breakpoint needed */
  .ea-stat {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 14px 16px;
    box-shadow: var(--shadow-sm);
    transition: box-shadow .15s;
    position: relative;
    overflow: hidden;
  }
  .ea-stat:hover { box-shadow: var(--shadow-md); }
  .ea-stat::after {
    content: '';
    position: absolute;
    left: 0; top: 0; bottom: 0;
    width: 3px;
    border-radius: 3px 0 0 3px;
    background: var(--brand);
    opacity: 0;
    transition: opacity .15s;
  }
  .ea-stat:hover::after { opacity: 1; }
  .ea-stat-label {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--ink-3);
  }
  .ea-stat-value {
    font-family: 'DM Serif Display', Georgia, serif;
    font-size: 1.5rem;
    font-weight: 400;
    letter-spacing: -0.03em;
    color: var(--ink);
    margin-top: 4px;
    line-height: 1.1;
  }
  .ea-stat-value.negative { color: var(--danger); }
  .ea-stat-value.positive { color: var(--accent); }

  /* ── Dimension score cards ── */
  .ea-dim-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .ea-dim-card {
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface);
    padding: 14px;
    box-shadow: var(--shadow-sm);
    transition: transform .15s, box-shadow .15s;
  }
  .ea-dim-card:hover { transform: translateY(-1px); box-shadow: var(--shadow-md); }
  .ea-dim-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .ea-dim-label { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: var(--ink-3); }
  .ea-dim-score { font-family: 'DM Serif Display', Georgia, serif; font-size: 1.25rem; color: var(--ink); letter-spacing: -0.02em; }
  .ea-dim-score span { font-family: 'DM Sans', sans-serif; font-size: 0.7rem; color: var(--ink-3); }
  .ea-dim-bar-track { height: 4px; border-radius: 4px; background: var(--surface-3); overflow: hidden; margin-bottom: 8px; }
  .ea-dim-bar-fill { height: 100%; border-radius: 4px; transition: width .6s cubic-bezier(.4,0,.2,1); }
  .bar-success { background: linear-gradient(90deg, var(--accent), #34d399); }
  .bar-warn { background: linear-gradient(90deg, var(--warn), #fbbf24); }
  .bar-danger { background: linear-gradient(90deg, var(--danger), #f87171); }
  .bar-neutral { background: linear-gradient(90deg, var(--brand), var(--brand-mid)); }
  .ea-dim-explain { font-size: 0.68rem; color: var(--ink-3); line-height: 1.4; }

  /* ── Insight panels ── */
  .ea-insight-panel {
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface);
    overflow: hidden;
    box-shadow: var(--shadow-sm);
  }
  .ea-insight-header {
    padding: 14px 18px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--surface-2);
  }
  .ea-insight-title {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--ink-3);
  }
  .ea-insight-body { padding: 16px 18px; }
  .ea-insight-item {
    display: flex;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid var(--surface-3);
    align-items: flex-start;
  }
  .ea-insight-item:last-child { border-bottom: none; padding-bottom: 0; }
  .ea-insight-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    margin-top: 6px;
    flex-shrink: 0;
  }
  .dot-risk { background: var(--danger); }
  .dot-action { background: var(--brand); }
  .ea-insight-text { font-size: 0.8rem; color: var(--ink-2); line-height: 1.5; }

  /* ── Keyword chips ── */
  .ea-kw-chip {
    display: inline-flex;
    align-items: center;
    padding: 4px 12px;
    border-radius: 999px;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    background: var(--surface-2);
    color: var(--ink-2);
    border: 1px solid var(--border);
    transition: background .12s, border-color .12s;
  }
  .ea-kw-chip:hover { background: var(--brand-light); border-color: var(--brand); color: var(--brand); }

  /* ── Section wrapper ── */
  .ea-section {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
  }
  .ea-section-head {
    padding: 18px 22px 14px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .ea-section-title { font-size: 0.875rem; font-weight: 600; color: var(--brand); }
  .ea-section-sub { font-size: 0.75rem; color: var(--ink-3); margin-top: 2px; font-weight: 300; }
  .ea-section-body { padding: 18px 22px; }

  /* ── View toggle ── */
  .ea-toggle {
    display: inline-flex;
    background: var(--surface-3);
    border-radius: 8px;
    padding: 3px;
    gap: 2px;
  }
  .ea-toggle-btn {
    padding: 5px 14px;
    border-radius: 6px;
    font-size: 0.75rem;
    font-weight: 500;
    border: none;
    cursor: pointer;
    transition: background .12s, color .12s, box-shadow .12s;
    background: transparent;
    color: var(--ink-3);
  }
  .ea-toggle-btn.active {
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 1px 3px rgba(15,17,23,.1);
  }

  /* ── CTA buttons ── */
  .ea-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 18px;
    border-radius: 10px;
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    transition: all .15s;
    border: none;
    letter-spacing: -0.01em;
  }
  .ea-btn-primary { background: var(--ink); color: #fff; }
  .ea-btn-primary:hover { background: var(--ink-2); transform: translateY(-1px); box-shadow: 0 4px 12px rgba(15,17,23,.2); }
  .ea-btn-secondary { background: var(--surface); color: var(--ink-2); border: 1px solid var(--border); }
  .ea-btn-secondary:hover { border-color: var(--ink-3); color: var(--ink); }
  .ea-btn-danger { background: #ef4444; color: #fff; }
  .ea-btn-danger:hover { background: #dc2626; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(239,68,68,.25); }
  .ea-btn-ghost { background: transparent; color: var(--brand); padding: 4px 0; font-size: 0.8rem; }
  .ea-btn-ghost:hover { text-decoration: underline; }

  /* ── Empty state ── */
  .ea-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 56px 32px;
    text-align: center;
    gap: 16px;
  }
  .ea-empty-icon {
    width: 56px;
    height: 56px;
    border-radius: 16px;
    background: var(--brand-light);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .ea-empty-title { font-family: 'DM Serif Display', Georgia, serif; font-size: 1.25rem; color: var(--ink); }
  .ea-empty-sub { font-size: 0.875rem; color: var(--ink-3); max-width: 300px; line-height: 1.5; }

  /* ── Layout ── */
  .ea-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(280px, 340px);
    gap: 24px;
    align-items: start;
  }
  @media (max-width: 1200px) { .ea-layout { grid-template-columns: 1fr; } }
  .ea-sidebar { display: flex; flex-direction: column; gap: 20px; position: static; min-width: 0; }
  .ea-main { display: flex; flex-direction: column; gap: 20px; min-width: 0; }

  /* --- Skeletons --- */
  .ea-skeleton {
    position: relative;
    overflow: hidden;
    background: #eef2f7;
    border-radius: 12px;
  }
  .ea-skeleton::after {
    content: "";
    position: absolute;
    inset: 0;
    transform: translateX(-100%);
    background: linear-gradient(90deg, transparent, rgba(255,255,255,.6), transparent);
    animation: eaShimmer 1.4s infinite;
  }
  @keyframes eaShimmer {
    100% { transform: translateX(100%); }
  }
  .ea-skeleton-line { height: 12px; border-radius: 10px; }
  .ea-skeleton-card { height: 140px; }
  .ea-skeleton-stat { height: 78px; }
  .ea-skeleton-tall { height: 220px; }

  /* --- Module chooser (dashboard) --- */
  .ea-module-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }
  @media (max-width: 980px) { .ea-module-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 520px) { .ea-module-grid { grid-template-columns: 1fr; } }
  .ea-module-card {
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface);
    padding: 14px 14px 12px;
    box-shadow: var(--shadow-sm);
    display: flex;
    flex-direction: column;
    gap: 10px;
    cursor: pointer;
    transition: transform .15s, box-shadow .15s, border-color .15s;
  }
  .ea-module-card:hover { transform: translateY(-1px); box-shadow: var(--shadow-md); border-color: rgba(42,111,244,.25); }
  .ea-module-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .ea-module-title { font-weight: 700; letter-spacing: -0.01em; color: var(--ink); }
  .ea-module-sub { font-size: 0.78rem; color: var(--ink-3); line-height: 1.35; }
  .ea-module-chip {
    font-size: 0.62rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 4px 8px;
    border-radius: 999px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--ink-3);
    white-space: nowrap;
  }

  /* --- Spinner (used by Market Fit + async sections) --- */
  .ea-spinner {
    width: 14px;
    height: 14px;
    border-radius: 999px;
    border: 2px solid rgba(15,17,23,.15);
    border-top-color: rgba(42,111,244,.9);
    animation: eaSpin .8s linear infinite;
  }
  @keyframes eaSpin { to { transform: rotate(360deg); } }

  /* --- Market Fit card (sidebar-friendly) --- */
  .ea-mf-section {
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface);
    box-shadow: var(--shadow-md);
    overflow: hidden;
  }
  .ea-mf-hero {
    padding: 14px 16px 12px;
    background: radial-gradient(ellipse 80% 80% at 40% 0%, rgba(42,111,244,.22) 0%, rgba(15,17,23,.92) 55%, rgba(15,17,23,.98) 100%);
    color: rgba(255,255,255,.92);
  }
  .ea-mf-hero-label {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(255,255,255,.65);
  }
  .ea-mf-loading {
    display: flex;
    align-items: center;
  }
  .ea-mf-score-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding-top: 8px;
  }
  .ea-mf-score-num {
    font-family: 'DM Serif Display', Georgia, serif;
    font-size: 1.75rem;
    letter-spacing: -0.04em;
    color: #fff;
    line-height: 1;
  }
  .ea-mf-score-denom {
    font-size: 0.7rem;
    color: rgba(255,255,255,.55);
    letter-spacing: 0.06em;
  }
  .ea-mf-class-chip {
    display: inline-flex;
    align-items: center;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 0.65rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    border: 1px solid rgba(255,255,255,.14);
    background: rgba(255,255,255,.06);
    color: rgba(255,255,255,.9);
  }
  .ea-mf-bar-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 10px;
  }
  .ea-mf-bar-track {
    flex: 1;
    height: 6px;
    border-radius: 999px;
    background: rgba(255,255,255,.14);
    overflow: hidden;
  }
  .ea-mf-bar-fill {
    height: 100%;
    border-radius: 999px;
  }
  .ea-mf-signal-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
    padding: 12px 16px 14px;
  }
  .ea-mf-signal {
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    padding: 10px 12px;
    box-shadow: var(--shadow-sm);
  }
  .ea-mf-signal-label {
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-3);
  }
  .ea-mf-signal-value {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin-top: 6px;
    font-weight: 700;
    color: var(--ink);
  }
  .ea-mf-signal-sub {
    font-size: 0.7rem;
    font-weight: 500;
    color: var(--ink-3);
  }
  .ea-mf-advisory {
    padding: 0 16px 14px;
    display: grid;
    gap: 10px;
  }
  .ea-mf-advisory-title {
    font-size: 0.65rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-3);
  }
  .ea-mf-advisory-item {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }

  /* ── Divider label ── */
  .ea-divider {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 4px 0;
  }
  .ea-divider-line { flex: 1; height: 1px; background: var(--border); }
  .ea-divider-text { font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ink-3); white-space: nowrap; }

  /* ── Animated entry ── */
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(12px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .ea-anim { animation: fadeUp .4s ease both; }
  .ea-anim-1 { animation-delay: .05s; }
  .ea-anim-2 { animation-delay: .1s; }
  .ea-anim-3 { animation-delay: .15s; }
  .ea-anim-4 { animation-delay: .2s; }
  .ea-anim-5 { animation-delay: .25s; }

  /* ── Trend placeholder ── */
  .ea-trend-placeholder {
    border-radius: var(--radius-sm);
    border: 1px dashed var(--border);
    background: var(--surface-2);
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    justify-content: center;
  }
  .ea-coming-soon {
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    background: var(--surface-3);
    color: var(--ink-3);
    padding: 2px 8px;
    border-radius: 999px;
  }
`;

/* ─── Helpers ─── */
function riskMeta(classification) {
  if (classification === "STRONG")    return { label: "Low Risk",          chipClass: "ea-chip-success", ringColor: "#00c48c" };
  if (classification === "PROMISING") return { label: "Moderate Risk",     chipClass: "ea-chip-warn",    ringColor: "#f59e0b" };
  if (classification === "RISKY")     return { label: "High Risk",         chipClass: "ea-chip-warn",    ringColor: "#f59e0b" };
  return                                     { label: "High Failure Risk", chipClass: "ea-chip-danger",  ringColor: "#ef4444" };
}

function barClass(score) {
  if (score >= 70) return "bar-success";
  if (score >= 45) return "bar-warn";
  return "bar-danger";
}

function ScoreRing({ score, color }) {
  const r = 52;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score ?? 0)) / 100;
  const offset = circ * (1 - pct);
  return (
    <svg width="120" height="120" viewBox="0 0 120 120">
      <circle className="ea-score-ring-track" cx="60" cy="60" r={r} />
      <circle
        className="ea-score-ring-fill"
        cx="60" cy="60" r={r}
        stroke={color}
        strokeDasharray={circ}
        strokeDashoffset={offset}
      />
    </svg>
  );
}

  const DIMENSION_META = {
    runway:         { label: "Cash runway",     help: "How long your current cash can keep the business going." },
    cash_timing:    { label: "Payment timing",  help: "How fast you get paid after a sale." },
    capacity:       { label: "Delivery capacity", help: "Whether your team can meet expected demand." },
    unit_economics: { label: "Profit per sale", help: "How much profit you keep on each sale." },
    break_even:     { label: "Break-even time", help: "How long it takes to cover your fixed costs." },
    market_fit:     { label: "Market fit",  help: "Demand, sector stability, and local competition combined." },
    proof:          { label: "Customer proof",  help: "How much real-world demand evidence you have so far." },
    sales_cycle:    { label: "Sales speed",     help: "How long it takes to close a sale." },
    concentration:  { label: "Client reliance", help: "How dependent you are on a single customer." },
  };

function dimLabel(key) {
  return DIMENSION_META[key]?.label ?? key.replaceAll("_", " ");
}


/* ─── Market Fit Section component ─── */
function MarketFitSection({ marketFit, mfLoading, mfError, onRetry }) {
  function mfChipClass(cls) {
    if (!cls) return "ea-mf-weak";
    const c = cls.toUpperCase();
    if (c === "STRONG")    return "ea-mf-strong";
    if (c === "PROMISING") return "ea-mf-promising";
    if (c === "MODERATE")  return "ea-mf-moderate";
    return "ea-mf-weak";
  }

  function mfBarColor(score) {
    if (score >= 70) return "linear-gradient(90deg,#00c48c,#34d399)";
    if (score >= 45) return "linear-gradient(90deg,#f59e0b,#fbbf24)";
    return "linear-gradient(90deg,#ef4444,#f87171)";
  }

  function trendIcon(dir) {
    if (dir === "growing")   return "↑";
    if (dir === "declining") return "↓";
    return "→";
  }
  function trendColor(dir) {
    if (dir === "growing")   return "#00c48c";
    if (dir === "declining") return "#ef4444";
    return "#f59e0b";
  }

  const mfScore = marketFit?.market_fit_score ?? null;
  const mfClass = marketFit?.market_fit_classification ?? null;
  const ds      = marketFit?.dimension_scores ?? {};
  const demand  = marketFit?.demand ?? null;
  const sector  = marketFit?.sector ?? null;
  const comp    = marketFit?.competition ?? null;
  const notes   = marketFit?.advisory_notes ?? [];

  return (
    <div className="ea-mf-section ea-anim ea-anim-5">

      {/* Dark hero header */}
      <div className="ea-mf-hero">
        <div className="ea-mf-hero-label">Market Fit</div>

        {mfLoading ? (
          <div className="ea-mf-loading" style={{ padding: "20px 0", justifyContent: "flex-start", gap: 10 }}>
            <div className="ea-spinner" />
            <span style={{ color: "rgba(255,255,255,.5)", fontSize: "0.8rem" }}>Loading market signals…</span>
          </div>
        ) : mfError ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 4 }}>
            <span style={{ color: "#f87171", fontSize: "0.8rem" }}>{mfError}</span>
            <button
              onClick={onRetry}
              style={{ background: "rgba(255,255,255,.1)", border: "none", borderRadius: 6, padding: "4px 10px", color: "#fff", fontSize: "0.72rem", cursor: "pointer" }}
            >
              Retry
            </button>
          </div>
        ) : mfScore === null ? (
          <div style={{ color: "rgba(255,255,255,.4)", fontSize: "0.8rem", paddingTop: 4 }}>
            Add a business name and industry to load market signals.
          </div>
        ) : (
          <>
            <div className="ea-mf-score-row">
              <div className="ea-mf-score-num">{mfScore}</div>
              <div className="ea-mf-score-denom">/100</div>
              <div style={{ marginBottom: 8 }}>
                <span className={`ea-mf-class-chip ${mfChipClass(mfClass)}`}>
                  {mfClass ?? "—"}
                </span>
              </div>
            </div>
            <div className="ea-mf-bar-row">
              <div className="ea-mf-bar-track">
                <div
                  className="ea-mf-bar-fill"
                  style={{ width: `${mfScore}%`, background: mfBarColor(mfScore) }}
                />
              </div>
              <span style={{ fontSize: "0.65rem", color: "rgba(255,255,255,.35)", whiteSpace: "nowrap" }}>
                Demand · Sector · Competition
              </span>
            </div>
          </>
        )}
      </div>

      {/* Signal grid — 3 columns */}
      {!mfLoading && !mfError && mfScore !== null && (
        <div className="ea-mf-signal-grid">

          {/* Demand signal */}
          <div className="ea-mf-signal">
            <div className="ea-mf-signal-label">Demand interest</div>
            <div className="ea-mf-signal-value">
              {ds.market_demand ?? "—"}
              <span style={{ fontSize: "0.7rem", color: "var(--ink-3)", fontFamily: "inherit" }}>/100</span>
            </div>
            {demand && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
                  <span style={{ fontSize: "0.9rem", color: trendColor(demand.trend_direction), fontWeight: 700 }}>
                    {trendIcon(demand.trend_direction)}
                  </span>
                  <span className="ea-mf-signal-sub" style={{ color: trendColor(demand.trend_direction) }}>
                    {demand.trend_direction}
                  </span>
                </div>
                <div className="ea-mf-signal-sub">
                  Avg interest: {Math.round(demand.avg_interest)}/100
                </div>
                <div className="ea-mf-signal-sub">
                  {demand.trend_delta_pct > 0 ? "+" : ""}{demand.trend_delta_pct?.toFixed(1)}% over 12m
                </div>
              </>
            )}
          </div>

          {/* Sector survival */}
          <div className="ea-mf-signal">
            <div className="ea-mf-signal-label">Sector stability</div>
            <div className="ea-mf-signal-value">
              {ds.sector_survival ?? "—"}
              <span style={{ fontSize: "0.7rem", color: "var(--ink-3)", fontFamily: "inherit" }}>/100</span>
            </div>
            {sector && (
              <>
                <div className="ea-mf-signal-sub" style={{ marginTop: 4 }}>
                  SIC {sector.sic_code}
                </div>
                <div className="ea-mf-signal-sub">
                  {sector.incorporations_12m} new · {sector.dissolutions_12m} closed
                </div>
                <div className="ea-mf-signal-sub">
                  Survival: {sector.survival_ratio != null ? `${(sector.survival_ratio * 100).toFixed(0)}%` : "—"}
                </div>
              </>
            )}
          </div>

          {/* Local competition */}
          <div className="ea-mf-signal">
            <div className="ea-mf-signal-label">Local competition</div>
            <div className="ea-mf-signal-value">
              {ds.local_competition ?? "—"}
              <span style={{ fontSize: "0.7rem", color: "var(--ink-3)", fontFamily: "inherit" }}>/100</span>
            </div>
            {comp && (
              <>
                <div className="ea-mf-signal-sub" style={{ marginTop: 4 }}>
                  {comp.competitor_count} nearby
                </div>
                <div className="ea-mf-signal-sub">
                  within {(comp.radius_metres / 1000).toFixed(0)} km
                </div>
                <div
                  className="ea-mf-signal-sub"
                  style={{
                    color: comp.competition_level === "low" ? "#00c48c"
                         : comp.competition_level === "moderate" ? "#f59e0b"
                         : "#ef4444",
                    fontWeight: 600,
                    textTransform: "capitalize",
                  }}
                >
                  {comp.competition_level}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Advisory notes */}
      {!mfLoading && !mfError && notes.length > 0 && (
        <div className="ea-mf-advisory">
          <div className="ea-mf-advisory-title">What this means</div>
          {notes.slice(0, 4).map((note, i) => {
            const [reason, rec] = note.split(" → ");
            return (
              <div key={i} className="ea-mf-advisory-item">
                <span className="ea-insight-dot" style={{ background: "#f59e0b", marginTop: 6, flexShrink: 0 }} />
                <div>
                  <div className="ea-insight-text" style={{ fontWeight: 500 }}>{reason}</div>
                  {rec && <div className="ea-insight-text" style={{ color: "var(--ink-3)", marginTop: 2 }}>{rec}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Refresh footer */}
      {!mfLoading && mfScore !== null && (
        <div style={{ padding: "10px 18px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "0.68rem", color: "var(--ink-3)" }}>
            {marketFit?.fetched_at
              ? `Updated ${new Date(marketFit.fetched_at * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
              : "Live signals"}
          </span>
          <button className="ea-btn ea-btn-ghost" onClick={onRetry} style={{ fontSize: "0.72rem" }}>
            Refresh →
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Main component ─── */
export default function DashboardPage() {
  const validation     = useWorkspaceStore((s) => s.validation);
  const currency       = useWorkspaceStore((s) => s.currency);
  const ideaValidation = useWorkspaceStore((s) => s.ideaValidation);
  const workspaceId    = useWorkspaceStore((s) => s.workspaceId);
  const setWorkspaceId = useWorkspaceStore((s) => s.setWorkspaceId);
  const setWorkspaceName = useWorkspaceStore((s) => s.setWorkspaceName);
  const setIdeaValidation = useWorkspaceStore((s) => s.setIdeaValidation);
  const setValidation = useWorkspaceStore((s) => s.setValidation);
  const setCurrency = useWorkspaceStore((s) => s.setCurrency);
  const setDecisionStatus = useWorkspaceStore((s) => s.setDecisionStatus);
  const decisionStatus = useWorkspaceStore((s) => s.decisionStatus);
  const workspaceLoadedAt = useWorkspaceStore((s) => s.workspaceLoadedAt);
  const navigate       = useNavigate();
  const hasLoadedRef   = useRef(false);
  const [decisionSaving, setDecisionSaving] = useState(false);
  const [decisionNotice, setDecisionNotice] = useState(null);
  const [decisionError, setDecisionError] = useState(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [needsEvaluation, setNeedsEvaluation] = useState(false);
  const [evaluationLoading, setEvaluationLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    async function loadWorkspace() {
      if (validation && workspaceId && ideaValidation) {
        hasLoadedRef.current = true;
        return;
      }
      if (workspaceId && ideaValidation && !validation) {
        hasLoadedRef.current = true;
        setNeedsEvaluation(true);
        return;
      }
      if (hasLoadedRef.current) return;
      try {
        setWorkspaceLoading(true);
        const ws = workspaceId
          ? await apiRequest(`/validation/${workspaceId}`, "GET")
          : await apiRequest("/validation/me", "GET");
        if (!alive || !ws) return;
        hasLoadedRef.current = true;
        setWorkspaceId(ws.id || workspaceId);
        setWorkspaceName(ws.name || null);
        setDecisionStatus(ws?.data?.decision?.status || null);
        const iv = ws?.data?.idea_validation;
        if (iv) setIdeaValidation(iv);
        const cur = iv?.context?.currency || ws?.data?.business_profile?.currency;
        if (cur) setCurrency(cur);
        const cachedValidation =
          ws?.data?.validation ||
          ws?.data?.validation_result ||
          ws?.data?.validation_snapshot ||
          ws?.data?.last_validation;
        if (!validation && cachedValidation) {
          setValidation(cachedValidation);
          setNeedsEvaluation(false);
          return;
        }
        if (!validation) {
          setNeedsEvaluation(true);
        }
      } catch (e) {
        // If no workspace yet, keep dashboard empty state.
        if (String(e?.message || "").includes("HTTP 404")) return;
      } finally {
        if (alive) setWorkspaceLoading(false);
      }
    }
    loadWorkspace();
    return () => {
      alive = false;
    };
  }, [workspaceId, validation, ideaValidation, workspaceLoadedAt, setWorkspaceId, setWorkspaceName, setDecisionStatus, setIdeaValidation, setValidation, setCurrency]);

  const runEvaluation = useCallback(async () => {
    if (!workspaceId || evaluationLoading) return;
    setEvaluationLoading(true);
    try {
      const result = await apiRequest("/validation/evaluate", "POST", { workspace_id: workspaceId });
      setValidation(result);
      setNeedsEvaluation(false);
    } catch {
      // handled by empty state prompt
    } finally {
      setEvaluationLoading(false);
    }
  }, [workspaceId, evaluationLoading, setValidation]);

  async function handleDecision(status) {
    if (!workspaceId) return;
    setDecisionSaving(true);
    setDecisionError(null);
    setDecisionNotice(null);
    try {
      await apiRequest(`/validation/${workspaceId}`, "PATCH", {
        data: { decision: { status, decided_at: new Date().toISOString() } }
      });
      setDecisionStatus(status);
      setDecisionNotice(status === "accepted" ? "Validation accepted." : "Validation rejected.");
    } catch (e) {
      setDecisionError(e instanceof Error ? e.message : "Failed to save decision");
    } finally {
      setDecisionSaving(false);
    }
  }

  const [viewMode,   setViewMode]   = useState("simple");
  const [signalsTab, setSignalsTab] = useState("trend");

  const m              = validation?.metrics ?? {};
  const revenue        = typeof m.revenue_monthly  === "number" ? m.revenue_monthly  : null;
  const costs          = typeof m.costs_monthly    === "number" ? m.costs_monthly    : null;
  const net            = typeof m.net_monthly      === "number" ? m.net_monthly      : null;
  const margin         = typeof m.margin           === "number" ? m.margin           : null;
  const be             = typeof m.break_even_months=== "number" ? m.break_even_months: null;
  const runway         = typeof m.runway_months    === "number" ? m.runway_months    : null;
  const score          = typeof validation?.score  === "number" ? validation.score   : null;
  const classification = String(validation?.classification || "").toUpperCase() || null;
  const risk           = riskMeta(classification);
  const dimScores      = validation?.dimension_scores && typeof validation.dimension_scores === "object"
                           ? validation.dimension_scores : null;

  const businessName    = String(ideaValidation?.context?.business_name    || "").trim() || null;
  const primaryIndustry = String(ideaValidation?.context?.primary_industry || "").trim() || null;
  const businessType    = String(ideaValidation?.context?.business_type    || "").trim() || null;
  const offerName       = String(ideaValidation?.offer?.service_type       || "").trim() || null;

  const reasons    = useMemo(() => dedupeText(validation?.reasons), [validation?.reasons]);
  const actionPlan = useMemo(() => buildActionPlan({ validation, ideaValidation, maxItems: 10 }), [ideaValidation, validation]);

  const orderedDimensions = useMemo(() => {
    if (!dimScores) return [];
    const preferred = ["unit_economics", "break_even", "runway", "capacity", "market_fit", "cash_timing", "proof", "sales_cycle", "concentration"];
    const present   = new Set(Object.keys(dimScores));
    const base      = preferred.filter((k) => present.has(k));
    const rest      = Object.keys(dimScores).filter((k) => !base.includes(k));
    return [...base, ...rest].slice(0, 8);
  }, [dimScores]);

  const topDimensions = useMemo(() => {
    if (!dimScores) return [];
    return Object.entries(dimScores)
      .map(([k, v]) => [k, typeof v === "number" ? v : 0])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
  }, [dimScores]);

  const keywordsToTrack = useMemo(() => {
    const out = [];
    if (businessName)    out.push(businessName);
    if (primaryIndustry) out.push(primaryIndustry);
    if (offerName)       out.push(offerName);
    if (!primaryIndustry && businessType) out.push(businessType);
    return dedupeText(out).slice(0, 6);
  }, [businessName, businessType, offerName, primaryIndustry]);

  const isLoadingView = workspaceLoading;


  // ── Market Fit state ──────────────────────────────────────────────
  const [marketFit, setMarketFit]       = useState(null);   // MarketFitResult | null
  const [mfLoading, setMfLoading]       = useState(false);
  const [mfError,   setMfError]         = useState(null);
  const [mfFetched, setMfFetched]       = useState(false);

  const fetchMarketFit = useCallback(async () => {
    if (!businessName && !primaryIndustry) return;
    setMfLoading(true);
    setMfError(null);
    try {
      const params = new URLSearchParams({
        keyword:   [businessName, primaryIndustry].filter(Boolean).join(" "),
        industry:  primaryIndustry || businessType || "general",
        location:  String(ideaValidation?.context?.uk_region || ideaValidation?.context?.location || "London"),
        uk_region: String(ideaValidation?.context?.uk_region || "GB-ENG"),
      });
      const data = await apiRequest(`/validation/market-fit?${params.toString()}`, "GET", null, { timeoutMs: 12000 });
      setMarketFit(data);
      setMfFetched(true);
    } catch (err) {
      setMfError(String(err?.message || "Could not load market fit data."));
    } finally {
      setMfLoading(false);
    }
  }, [businessName, primaryIndustry, businessType, ideaValidation]);

  // Use cached market fit from validation if available
  useEffect(() => {
    const cached = validation?.metrics?.market_fit;
    if (cached && !marketFit) {
      setMarketFit(cached);
      setMfFetched(true);
    }
  }, [validation, marketFit]);

  // Auto-fetch once when detailed view is shown
  useEffect(() => {
    if (validation && viewMode === "detailed" && !mfFetched && !mfLoading && !marketFit) {
      fetchMarketFit();
    }
  }, [validation, viewMode, mfFetched, mfLoading, marketFit, fetchMarketFit]);

  const dimHelp = (key) => {
    const fromBackend = validation?.dimension_explanations?.[key];
    return fromBackend || DIMENSION_META[key]?.help || "Dimension score (0–100).";
  };

  const validationExplanation =
    String(validation?.validation_explanation || "").trim() ||
    "Overall score blends profit per sale, break-even time, cash runway, delivery capacity, payment timing, customer proof, sales speed, client reliance, and market fit.";

  function statValueClass(val, field) {
    if (field === "net" && val !== null) return val < 0 ? " negative" : val > 0 ? " positive" : "";
    return "";
  }

  return (
    <div className="ea-dash">
      {/* Inject scoped styles once */}
      <style>{STYLES}</style>
      <div className="ea-container">

      {/* ── Page header ── */}
      <PageHeader
        title="Dashboard"
        description={
          businessName
            ? `${businessName} · Overview & analytics`
            : "Overview and analytics across your workspace."
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {validation && workspaceId ? (
              <>
                <Button variant="secondary" onClick={() => navigate(`/validation?workspace_id=${workspaceId}`)}>
                  Modify
                </Button>
                <Button variant="danger" disabled={decisionSaving || decisionStatus === "rejected"} onClick={() => handleDecision("rejected")}>
                  {decisionStatus === "rejected" ? "Rejected" : "Reject"}
                </Button>
                <Button disabled={decisionSaving || decisionStatus === "accepted"} onClick={() => handleDecision("accepted")}>
                  {decisionStatus === "accepted" ? "Accepted" : "Accept"}
                </Button>
              </>
            ) : null}
            <Button variant="secondary" onClick={() => navigate("/simulation")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
              Run simulation
            </Button>
          </div>
        }
      />

      {/* ── Empty state ── */}
      {!workspaceId ? (
        <div className="ea-anim ea-anim-1">
          <WorkspacePrompt />
        </div>
      ) : !validation && needsEvaluation ? (
        <div className="ea-layout">
          <div className="ea-main">
            <div className="ea-section ea-anim ea-anim-1">
              <div className="ea-section-head">
                <div>
                  <div className="ea-section-title">Run your evaluation</div>
                  <div className="ea-section-sub">Generate a fresh snapshot to populate your dashboard.</div>
                </div>
              </div>
              <div className="ea-section-body" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                <div className="ea-caption" style={{ maxWidth: 420 }}>
                  Your workspace is ready. Run the evaluation to compute your metrics and unlock the full dashboard view.
                </div>
                <Button onClick={runEvaluation} disabled={evaluationLoading}>
                  {evaluationLoading ? "Evaluating..." : "Evaluate now"}
                </Button>
              </div>
            </div>
          </div>
          <aside className="ea-sidebar">
            <div className="ea-skeleton ea-skeleton-card" />
          </aside>
        </div>
      ) : isLoadingView ? (
        <div className="ea-layout">
          <div className="ea-main">
            <div className="ea-section ea-anim ea-anim-1">
              <div className="ea-section-head">
                <div>
                  <div className="ea-section-title">Preparing your dashboard</div>
                  <div className="ea-section-sub">Loading your workspace and validation results.</div>
                </div>
              </div>
              <div className="ea-section-body">
                <div className="ea-stat-grid">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="ea-skeleton ea-skeleton-stat" />
                  ))}
                </div>
                <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
                  <div className="ea-skeleton ea-skeleton-card" />
                  <div className="ea-skeleton ea-skeleton-card" />
                  <div className="ea-skeleton ea-skeleton-tall" style={{ gridColumn: "1 / -1" }} />
                </div>
              </div>
            </div>
          </div>
          <aside className="ea-sidebar">
            <div className="ea-skeleton ea-skeleton-tall" />
            <div className="ea-skeleton ea-skeleton-card" />
          </aside>
        </div>
      ) : (
        <div className="ea-layout">

          {/* ════════════════ MAIN COLUMN ════════════════ */}
          <div className="ea-main">

            {/* ── Baseline model ── */}
            <div className="ea-section ea-anim ea-anim-1">
              <div className="ea-section-head">
                <div>
                  <div className="ea-section-title">Your business snapshot</div>
                  <div className="ea-section-sub">Based on the numbers you entered.</div>
                </div>
                <div className="ea-toggle">
                  <button className={`ea-toggle-btn ${viewMode === "simple" ? "active" : ""}`} onClick={() => setViewMode("simple")}>Simple</button>
                  <button className={`ea-toggle-btn ${viewMode === "detailed" ? "active" : ""}`} onClick={() => setViewMode("detailed")}>Detailed</button>
                </div>
              </div>
              <div className="ea-section-body">
                {/* Stat grid */}
                <div className="ea-stat-grid">
                  {[
                    { label: "Monthly revenue", value: formatCurrency(revenue, currency), field: null,  info: "Estimated revenue per month." },
                    { label: "Monthly net",      value: formatCurrency(net, currency),     field: "net", info: "Revenue minus all costs." },
                    { label: "Margin",           value: formatPercent(margin),             field: null,  info: "(Revenue − costs) / revenue." },
                    { label: "Monthly costs",    value: formatCurrency(costs, currency),   field: null,  info: "Fixed + variable costs per month." },
                    { label: "Break-even",       value: be === null ? "—" : `${formatNumber(be)} mo`, field: null, info: "Months to cover fixed costs." },
                    { label: "Runway",           value: runway === null ? "∞" : `${formatNumber(runway)} mo`, field: null, info: "Months of cash at current burn." },
                  ].map(({ label, value, field, info }) => (
                    <div key={label} className="ea-stat">
                      <div className="ea-stat-label">{label}</div>
                      <div className={`ea-stat-value${statValueClass(field === "net" ? net : null, field)}`}>
                        {value ?? "—"}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Simple view: risks + actions + keywords */}
                {viewMode === "simple" && (
                  <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
                    <div className="ea-insight-panel">
                      <div className="ea-insight-header">
                        <span className="ea-insight-title">Key risks</span>
                      </div>
                      <div className="ea-insight-body" style={{ paddingTop: 8, paddingBottom: 8 }}>
                        {(reasons.length ? reasons : ["Run a validation to see risks."]).slice(0, 4).map((r) => (
                          <div key={r} className="ea-insight-item">
                            <span className="ea-insight-dot dot-risk" />
                            <span className="ea-insight-text">{r}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="ea-insight-panel">
                      <div className="ea-insight-header">
                        <span className="ea-insight-title">Recommendations</span>
                      </div>
                      <div className="ea-insight-body" style={{ paddingTop: 8, paddingBottom: 8 }}>
                        {(actionPlan.length ? actionPlan : ["Run simulation and validate assumptions."]).slice(0, 4).map((r) => (
                          <div key={r} className="ea-insight-item">
                            <span className="ea-insight-dot dot-action" />
                            <span className="ea-insight-text">{r}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Keyword trend (simple view) */}
                    <div className="ea-insight-panel" style={{ gridColumn: "1 / -1" }}>
                      <div className="ea-insight-header">
                        <span className="ea-insight-title">Keyword trend</span>
                        <span className="ea-coming-soon">Coming soon</span>
                      </div>
                      <div className="ea-insight-body">
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                          {(keywordsToTrack.length ? keywordsToTrack : ["Add business name and industry"]).map((k) => (
                            <span key={k} className="ea-kw-chip">{k}</span>
                          ))}
                        </div>
                        <div className="ea-trend-placeholder">
                          <span className="ea-section-sub" style={{ fontSize: "0.75rem" }}>No trend data yet. Connect a market data source to display search interest.</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                    {/* Detailed view: full dimension breakdown + insights */}
                    {viewMode === "detailed" && (
                      <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 16 }}>
                    <div className="ea-divider">
                      <div className="ea-divider-line" />
                      <span className="ea-divider-text">Validation scores</span>
                      <div className="ea-divider-line" />
                    </div>

                    {dimScores ? (
                      <div className="ea-dim-grid">
                        {orderedDimensions.map((k) => {
                          const v = typeof dimScores[k] === "number" ? dimScores[k] : 0;
                          return (
                            <div key={k} className="ea-dim-card">
                              <div className="ea-dim-header">
                                <span className="ea-dim-label">{dimLabel(k)}</span>
                                <span className="ea-dim-score">{formatNumber(v)}<span>/100</span></span>
                              </div>
                              <div className="ea-dim-bar-track">
                                <div className={`ea-dim-bar-fill ${barClass(v)}`} style={{ width: `${v}%` }} />
                              </div>
                              <div className="ea-dim-explain">{shortExplanation(dimHelp(k), 120)}</div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="ea-section-sub">No score breakdown available.</div>
                    )}

                    <div className="ea-divider">
                      <div className="ea-divider-line" />
                      <span className="ea-divider-text">Insights</span>
                      <div className="ea-divider-line" />
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
                      <div className="ea-insight-panel">
                        <div className="ea-insight-header"><span className="ea-insight-title">Reasons</span></div>
                        <div className="ea-insight-body" style={{ paddingTop: 8, paddingBottom: 8 }}>
                          {(reasons.length ? reasons : ["Run a validation to generate insights."]).slice(0, 8).map((r) => (
                            <div key={r} className="ea-insight-item">
                              <span className="ea-insight-dot dot-risk" />
                              <span className="ea-insight-text">{r}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="ea-insight-panel">
                        <div className="ea-insight-header"><span className="ea-insight-title">Actions</span></div>
                        <div className="ea-insight-body" style={{ paddingTop: 8, paddingBottom: 8 }}>
                          {(actionPlan.length ? actionPlan : ["Update inputs to generate actions."]).slice(0, 8).map((r) => (
                            <div key={r} className="ea-insight-item">
                              <span className="ea-insight-dot dot-action" />
                              <span className="ea-insight-text">{r}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 4 }}>
                      <button className="ea-btn ea-btn-ghost" onClick={() => navigate("/validation")}>Update inputs →</button>
                    </div>
                      </div>
                    )}

              </div>
            </div>

          </div>

          {/* ════════════════ SIDEBAR ════════════════ */}
          <aside className="ea-sidebar">

            {/* ── Score hero ── */}
            <div className="ea-score-hero ea-anim ea-anim-2">
              <div className="ea-score-ring-wrap">
                <ScoreRing score={score} color={risk.ringColor} />
                <div className="ea-score-center">
                  <div className="ea-score-number">{score ?? "—"}</div>
                  <div className="ea-score-denom">/ 100</div>
                </div>
              </div>
              <div className="ea-score-label">{risk.label}</div>
              <div className="ea-score-sublabel">Address major risks before launch.</div>
              <div className={`ea-outcome-chip ${risk.chipClass}`}>
                <span className="ea-outcome-chip-dot" />
                {classification || "—"}
              </div>
              <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 10, background: "var(--surface-2)", border: "1px solid var(--border)", fontSize: "0.7rem", color: "var(--ink-3)", lineHeight: 1.5, maxWidth: 220, textAlign: "center" }}>
                {shortExplanation(validationExplanation, 160)}
              </div>
            </div>

            {/* ── Top dimensions (simple) ── */}
            {viewMode === "detailed" ? (
              <MarketFitSection
                marketFit={marketFit}
                mfLoading={mfLoading}
                mfError={mfError}
                onRetry={fetchMarketFit}
              />
            ) : null}

            {viewMode === "simple" && (
              <div className="ea-section ea-anim ea-anim-3">
                <div className="ea-section-head">
                  <div>
                  <div className="ea-section-title">Score breakdown</div>
                  <div className="ea-section-sub">Why the score looks this way.</div>
                  </div>
                </div>
                <div className="ea-section-body" style={{ paddingTop: 12 }}>
                  {dimScores ? (
                    <div className="ea-dim-grid">
                      {topDimensions.map(([k, v]) => (
                        <div key={k} className="ea-dim-card">
                          <div className="ea-dim-header">
                            <span className="ea-dim-label">{dimLabel(k)}</span>
                            <span className="ea-dim-score">{formatNumber(v)}<span>/100</span></span>
                          </div>
                          <div className="ea-dim-bar-track">
                            <div className={`ea-dim-bar-fill ${barClass(v)}`} style={{ width: `${v}%` }} />
                          </div>
                          <div className="ea-dim-explain">{shortExplanation(dimHelp(k), 90)}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="ea-section-sub">No breakdown available yet.</div>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
                    <button className="ea-btn ea-btn-ghost" onClick={() => navigate("/validation")}>Update inputs →</button>
                  </div>
                </div>
              </div>
            )}

            {/* Sidebar market signals removed (use main MarketFit card only) */}

          </aside>
        </div>
      )}
      </div>
    </div>
  );
}
