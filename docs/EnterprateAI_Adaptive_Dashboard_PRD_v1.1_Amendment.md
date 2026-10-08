# EnterprateAI Adaptive Dashboard PRD: Amendment 1.1 (stage-aware composition)

| Field | Value |
|---|---|
| Amends | PRD-AD-001, Adaptive Dashboard, Version 1.0 Draft (1 October 2026) |
| Date | 4 October 2026 |
| Status | Draft, for adoption with the PRD |
| Sections replaced | 7 (pathways), 8.1 (page hierarchy), 8.2 (wireframe), 8.3 (reports), 9.2 (Agent panel content), 10 (insight families) |
| Sections added to | 6 (context model), 17 (MVP scope), 18 (acceptance criteria), 20 (open decisions) |

This amendment brings the PRD into line with the product as built and tested. Where it differs
from Version 1.0, this document is the current requirement. Everything in Version 1.0 that is not
mentioned here still stands.

## 1. What changed, in short

1. The dashboard is composed for a **business stage** (Idea, Pre-launch, Operating, Growth), not
   only for a pathway. The page skeleton is fixed; each surface is filled from a per-stage
   configuration.
2. There are **four action cards**, not three. Business Plan was added by product decision.
3. The **figures row** and the **report entry** depend on the stage. Version 1.0 described one KPI
   row and one Business Health Report for everyone.
4. Insights fill **four slots** (critical, time-sensitive, goal or scenario, supporting), with the
   families chosen per stage. The five-card limit is unchanged.
5. The stage is **detected from the business's records** and shown in the header with "Not right?
   Change it".
6. Empty surfaces **collapse to one line**.

## 2. Business stage (adds to section 6, replaces section 7)

The four dimensions of section 6 are unchanged. Business stage now drives composition directly.
"Startup" in Version 1.0 means Pre-launch here.

| Stage | Pathway | Detected when |
|---|---|---|
| Idea | Startup | No invoice issued and no payment received; idea not validated, no product listed, no plan started |
| Pre-launch | Startup | No invoice issued and no payment received; idea validated, or a product listed, or a plan started |
| Operating | Small Business | At least one invoice issued (not a draft) or one payment received |
| Growth | Small Business | Operating, with at least 5 payments and money received in the last 90 days at least 20% above the 90 days before |
| Multi-entity | Multi-Entity | Deferred (section 17) |

Rules:

- The stage is read from the records every time the dashboard is composed. Nothing is stored.
- The header shows the stage and "Not right? Change it". The user may choose a stage or return to
  detection. A chosen stage changes what the dashboard shows; it changes no business record.
  Every change is recorded in the audit log (who, when, from, to).
- For **30 days after the first payment**, a business that has just become Operating keeps its
  launch blocker card, with a banner saying when it will go.
- The **current goal reorders insights within the stage**. It never brings in another stage's cards,
  action cards, figures or report.
- Changing stage never recreates or duplicates the business (unchanged from Version 1.0).

## 3. Page hierarchy (replaces section 8.1)

1. Persistent left navigation with Dashboard and Tool Library as primary access points.
2. Page header, then the context row: stage, headline metric, "Not right? Change it", last
   updated time with Refresh, current goal.
3. EnterprateAI Agent, with Needs Approval beside it (or one line beneath it when empty).
4. Four action cards for the stage.
5. Figures row for the stage (or one line when no figure has data).
6. Adaptive Insights for Your Business (up to five cards).
7. One report entry for the stage.

## 4. Wireframe (replaces section 8.2)

```
HEADER   | Your Adaptive Business Dashboard
CONTEXT  | [Stage] [Headline metric]  Not right? Change it · Updated 07:41 · Refresh     Current goal [v]

ENTERPRATEAI AGENT                                         | NEEDS APPROVAL
Up to 4 suggestions · prompt input · stage shortcuts       | Items waiting for the user
(no fixed workflow timeline)                               | (one line under the Agent when there are none)

ACTION CARD 1     | ACTION CARD 2     | ACTION CARD 3     | ACTION CARD 4

FIGURES ROW       | 4 or 5 tiles for the stage (one line when none has data)

INSIGHT 1         | INSIGHT 2         | INSIGHT 3         | INSIGHT 4          (+ a fifth when needed)
critical          | time-sensitive    | goal or scenario  | supporting

REPORT ENTRY      | one report for the stage
```

There is no Tool Library card on the dashboard. The Tool Library is the left-navigation item
directly under Dashboard (section 8.4, unchanged).

## 5. What each stage shows (replaces the tables in sections 7 and 10; amends 8.3 and 9.2)

| Surface | Idea | Pre-launch | Operating | Growth |
|---|---|---|---|---|
| Header context | Idea stage · Validation 40% | Pre-launch stage · Launch readiness 3 of 7 | Operating stage · Health: Stable | Growth stage · Health: Stable · Growth +24% |
| Agent suggestions | Validate idea, draft business plan, size the market | Clear launch blockers, prepare funding pack, register the business | From the records: quotes, follow-ups, receipts, risk responses | Pricing, capacity, new offer, expansion scenario |
| Agent shortcuts | Validate Idea, Business Plan, Market Sizing, Scenario Help | Launch Checklist, Funding Pack, Registration, Scenario Help | Enquiry to Quote, Quote to Invoice, Payment Follow-up, Receipt Sending, Risk & Concentration, Scenario Help | Pricing Scenario, Quote to Invoice, Risk & Concentration, Opportunities |
| Agent prompt hint | "…validate your idea, plan or market…" | "…your launch, funding or registration…" | "…quotes, payments, risks or scenarios…" | "…pricing, capacity, new offers or expansion…" |
| Action cards (4) | Validate My Idea, Business Plan, Run Scenarios, Business Registration | Business Plan, Funding Readiness, Business Registration, Run Scenarios | Essentials, Validate My Idea, Business Plan, Run Scenarios | Essentials, Run Scenarios, Marketplace, Business Plan |
| Figures row | Validation score, Market size, Startup costs, Funding needed | Launch readiness %, Runway, Planned costs, Funding secured | Total revenue, Cash, Expenses & CoS, Receivables, Active risks | Revenue growth %, Gross margin, Cash, Receivables, Top-customer share |
| Insight 1, critical | Idea weakness (lowest validation factor) | Launch / funding blocker | Risk or fragility alert | Concentration risk |
| Insight 2, time-sensitive | Next step after validation (for example "Size your market") | Next launch action (first unfinished checklist item) | Overdue receivables / follow-up | Approval or contract action |
| Insight 3, goal or scenario | Test pricing | Cash runway scenario | Suggested scenario | Growth scenario (price, hiring) |
| Insight 4, supporting | Similar businesses on the Marketplace | Funding readiness gaps | Cash position | Opportunities (open requests for quotation, Marketplace) |
| Report entry | Idea Validation Report | Launch Readiness Report | Business Health Report | Business Health Report |

Rules that apply at every stage:

- **Overdue money.** When any invoice is overdue, the overdue receivables card takes the
  time-sensitive slot, whatever the stage, Growth included.
- **Approvals.** An approval that will expire within 24 hours gets a time-sensitive card, shown
  only to someone who may approve it.
- **Agent suggestions.** "N tasks need attention" is one line at the top. At most two items come
  from the records; the rest are the stage's own. Approvals and tasks needing attention are
  counted and linked separately, and the approvals count matches the Needs Approval panel.
- **No suggestion before its time.** Payment follow-up, receipt sending, concentration and
  quote-to-invoice are not suggested before the first invoice.
- **Card actions.** A card's main button and its "Why am I seeing this?" control open a page or
  the explanation. They never start an Agent task. Agent help is a separate button, labelled
  "Ask Agent to … · uses AI Credits".
- **Missing data.** A figure or card with no data says what is missing and where to add it. It
  never shows a value. Gross margin needs cost records; revenue growth needs a prior 90 days.
- **Launch readiness** is a checklist of seven items: business name, business email, validated
  idea, a priced product or service, a business plan, business registration, planned costs and
  funding figures. An eighth, income and expense records, is added when the goal is funding.

Section 8.3 (reports simplification) now reads: the main dashboard has one report entry, and
which report it is depends on the stage. Specialist reports remain in their modules.

## 6. Empty surfaces (adds to section 12)

| Surface | When empty |
|---|---|
| Needs Approval | One line under the Agent panel: "Nothing is waiting for you", with a link to the Agent Centre |
| Figures row | One line naming what to add (for example "Validate your idea to see its score, market size and the money it needs") |
| Insights | "Nothing needs your attention right now." |

## 7. Configuration and preview (adds to section 11)

- Composition is configuration data on the server: a registry of widgets (`WidgetDefinition`,
  with `eligible_business_stages`, `supported_pathways` and `priority_class`) and one layout per
  stage naming the widgets for each surface. A layout that names a widget not eligible for its
  stage is rejected when the service starts.
- `GET /businesses/{id}/dashboard` returns the composed surfaces. The page renders them and holds
  no stage logic of its own.
- `PUT /businesses/{id}/dashboard/stage` sets or clears the chosen stage (audited).
- For QA, `/dashboard?stage=idea|pre_launch|operating|growth` shows another stage's dashboard for
  the current business. It is labelled "Preview", changes nothing, and is ignored in production.

## 8. MVP scope (amends section 17)

| Included in V1 | Deferred |
|---|---|
| Idea, Pre-launch, Operating and Growth stages | Multi-entity stage and its portfolio surfaces |
| Four action cards per stage | |
| Stage-specific figures row and report entry | Portfolio Health Report |
| Stage detection with user override and audit | |
| 30-day transition after the first payment | |

## 9. Acceptance criteria (amends section 18)

Replaces criterion 14 and adds 18 to 26. Criteria 1 to 13 and 15 to 17 are unchanged.

14. Exactly one report entry appears on the main dashboard, and it is the report for the
    business's stage.
18. The stage is detected from the records, shown in the header, can be changed by an authorised
    user, and every change is audited.
19. Each stage shows its own four action cards, figures row and insight families, as in section 5.
20. The current goal reorders insights within the stage and never adds a card from another stage.
21. For 30 days after the first payment the launch blocker remains, with a banner.
22. An overdue invoice puts the overdue receivables card in the time-sensitive slot at every stage.
23. Opening a card or its explanation never starts an Agent task; Agent help is separately labelled.
24. No figure is shown without its inputs: gross margin without cost records and revenue growth
    without a prior period read "needs data".
25. Needs Approval with no items, and a figures row with no data, each collapse to one line.
26. Composition is driven by configuration; an invalid layout fails at start-up.

## 10. Open decisions (adds to section 20)

| Decision | Note |
|---|---|
| Launch Readiness and Funding Readiness engines | Neither exists yet. The launch checklist and funding gaps are read from the business's records. The Funding Readiness card opens Business Plans. Rewire when the engines are built. |
| Capacity risk (Growth, critical slot) | There is no capacity data in the product. The slot shows concentration risk only. |
| Growth thresholds | 5 payments and 20% quarter-on-quarter are engineering defaults. Product to confirm. |
| Approval types for Idea and Pre-launch | The table lists funding documents and registration filings. No Agent workflow produces these approvals yet. |
| Source fields for idea and pre-launch figures | Market size, startup costs, funding needed, planned costs and funding secured are looked up by name in validation results and plan inputs. Confirm the authoritative fields. |
| Live Business Plan summary | Still shown below the report entry for plans that include it. Decide whether it stays on the dashboard. |
