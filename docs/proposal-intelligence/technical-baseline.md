# PI-000 — Technical Baseline

## 1. Framework, Runtime, Package Manager and Deployment

| Item | Value |
|---|---|
| Framework | React 18.3.1 (SPA) |
| Build tool | Vite 5.4.11, ESM modules (`"type": "module"`) |
| Package manager | npm (package-lock.json present) |
| CSS | Tailwind CSS 3.4.14 + PostCSS + Autoprefixer |
| Routing | react-router-dom 6.26.2 |
| State | Zustand 4.5.5 with `persist` middleware |
| Charting | Recharts 3.9.0 |
| Export | html2pdf.js 0.10.1, xlsx 0.18.5 |
| Payments | @stripe/react-stripe-js 6.3.0 + @stripe/stripe-js 9.4.0 |
| PDF export | jsPDF (loaded via cdnjs CDN in BusinessOperationsPage) |
| Deployment | Static SPA; API_URL via `VITE_API_URL` env var (default `http://localhost:8000`) |

## 2. Module / Navigation Architecture

Navigation is defined in `frontend/src/components/Layout.jsx` (NAV array, lines 20–31):

| Route | Module key | Component |
|---|---|---|
| `/dashboard` | `dashboard` | DashboardPage |
| `/validation` | `validation` | ValidationWizardPage |
| `/simulation` | `simulation` | SimulationPage |
| `/registration` | `registration` | RegistrationPage |
| `/blueprint` | `blueprint` | BlueprintPage (LivePlanPage) |
| `/catalogue` | `catalogue` | CataloguePage |
| `/operations` | `operations` | BusinessOperationsPage |
| `/integrations` | `integrations` | IntegrationsPage |
| `/marketplace` | null (public) | MarketplacePage |
| `/referrals` | null (public) | ReferralPage |

**New Proposal route**: `/proposals` with module key `proposals`. Tabs: Inbox (recipient), Activity (proposer), Settings.

Route protection uses `Protected` wrapper + `RequireWorkspace` for workspace-bound features.

## 3. Database / ORM / Schema / Migrations

This is a **frontend-only** repository. There is no ORM, migration runner or schema file here. The backend is a separate service at `VITE_API_URL`.

API conventions (from `frontend/src/api/client.js`):
- Bearer token auth (`Authorization: Bearer <token>`)
- Token stored in `localStorage` under key `ea_token`
- JSON request/response
- Error format: `{ detail: string | [{msg: string}] }`
- 401 fires `ea:unauthorized` CustomEvent

For Proposal Intelligence, all new API calls follow the same pattern: `apiRequest(path, method, body)`.

## 4. Authentication / Tenant Resolution / Roles / Permissions

- `useAuthStore` (`frontend/src/store/auth.js`) — persisted token, email, name, picture, subscription, platformRestrictions, platformGrants
- `useWorkspaceStore` (`frontend/src/store/workspace.js`) — workspaceId, isMemberMode, memberPermissions, currency
- Permissions checked via `frontend/src/lib/permissions.js`: `hasModuleAccess`, `isPlatformModuleGranted`, `isPlatformModuleRestricted`
- Plan tier checked via `frontend/src/lib/plans.js`: `planHasModuleAccess`, `planLabel`
- Subscription fetched at login/hydrate from `/plans/my`; plan_key values: `explorer`, `starter`, `starter_insight`, higher tiers

**Paid access rule** (PI-000 note): `starter_insight` or higher required to generate/submit proposals. Check: `['starter_insight', 'growth', 'scale'].includes(subscription.plan_key)`.

## 5. Catalogue Offering / Customer / Vendor and Contract Models

All live in `frontend/src/pages/CataloguePage.jsx`. Tabs: Offerings, Customers, Vendors. Data fetched from:
- `GET /catalogue/offerings` — user's Offerings
- `GET /catalogue/customers`
- `GET /catalogue/vendors`

Contracts are in `BusinessOperationsPage.jsx` under Contracts tab: `GET /operations/contracts`.

For Proposal → Contract link (Phase 5), the UI will navigate to `/operations` and open the Contracts tab with pre-filled data.

## 6. Marketplace / Blueprints / Operations / Payments / Saved Documents

**Marketplace** (`MarketplacePage.jsx`):
- Fetches `GET /marketplace/listings` for company/service cards
- Company cards have `workspace_id`, `company_name`, `logo_data_url`, industry, location, services
- "Request Quotation" flow → `POST /marketplace/quotes`
- New: company cards with `open_for_proposals: true` show "Open for Proposals" badge

**Business Blueprints** (`BlueprintPage.jsx`):
- Plans, Business Plans (LivePlanPage), Saved Documents tabs
- Generated documents stored under `/blueprint/saved-documents`

**Business Operations** (`BusinessOperationsPage.jsx`):
- Tabs: Sales, Procurement, Contracts, Transactions, Reports
- Procurement: `GET /operations/procurement` — existing RFQ/PO items
- New Proposal Requests sub-tab in Procurement

**Payments / Entitlements**:
- Stripe integration via `/plans/` routes
- Credit system via `/credits/` routes; `useAuthStore.creditBalance`
- Entitlement guard: check `subscription.plan_key` before proposal generate/submit

**Saved Documents**:
- Proposal drafts live in Business Blueprints → Saved Documents
- `GET /blueprint/saved-documents?type=proposal`

## 7. Object Storage / Uploads / Malware Scan / AI Jobs / Queues / Events

No existing file upload or job queue infrastructure is visible in this frontend repo. All proposal uploads will go to:
- `POST /proposals/upload-session` (create anonymous session)
- `PUT /proposals/upload-session/:token/file` (file upload with multipart)

For scan status polling: `GET /proposals/upload-session/:token/status`.

AI generation will use: `POST /proposals/generate` (async, returns job_id) → `GET /proposals/jobs/:job_id`.

No outbox mechanism exists in the frontend; all state changes are reflected via API re-fetches.

## 8. Test / Lint / Type-check / Build / Security Commands

```bash
# Build (from frontend/)
npm run build

# Lint (no-op currently)
npm run lint

# Dev server
npm run dev

# No type-check (plain JSX, no TypeScript)
```

No existing test framework configured. The pack's test requirements are aspirational for a future backend/integration test suite.

## 9. Reusable Components and Gaps

**Available reusable components** (`frontend/src/components/`):

| Component | Use |
|---|---|
| `Spinner.jsx` | Loading states |
| `Toast.jsx` | Success/error notifications |
| `ConfirmDialog.jsx` | Destructive action confirmation |
| `InlineAlert.jsx` | Inline error/warning banners |
| `Input.jsx` | Controlled text input |
| `Button.jsx` | Primary/secondary/danger buttons |
| `Card.jsx`, `SectionCard.jsx` | Content containers |
| `Badge.jsx` | Status pills |
| `StatTile.jsx` | Metric cards |
| `SegmentedTabs.jsx` | Tab navigation |
| `AISuggestButton.jsx` | AI-powered suggestion trigger |
| `DocumentEditor.jsx` | Rich text editing |
| `DocumentPreview.jsx` | Document render |
| `DocumentShareModal.jsx` | Share dialog |
| `CreditConfirmModal.jsx` | Credit spend confirmation |
| `ReportTable.jsx` | Sortable data tables |
| `TableControls.jsx` | Table filter/sort controls |
| `InfoTip.jsx` | Tooltip/popover help |
| `WorkspaceProfileCard.jsx` | Business profile display |

**Identified gaps for Proposal Intelligence**:
- No file upload component (drag-drop + file picker)
- No status timeline/stepper component
- No multi-step wizard component
- No message thread / chat component
- No evaluation scorecard component

These will be implemented inline in the proposal pages rather than as shared components, following the existing pattern of self-contained pages.

## 10. Proposed File / Module Placement for Phase 1

```
frontend/src/
├── store/
│   └── proposal.js                    # Zustand store: preferences, requests, submissions, inbox
├── pages/
│   └── ProposalsPage.jsx              # /proposals — Inbox + Activity + Settings tabs
├── components/
│   └── (no new shared components)     # Phase 1 keeps components inline per page
```

**Modified files:**
- `App.jsx` — add `/proposals` route under Protected + RequireWorkspace
- `components/Layout.jsx` — add "Proposals" nav item
- `pages/MarketplacePage.jsx` — add Open for Proposals badge + Apply modal
- `pages/BusinessOperationsPage.jsx` — add Proposal Requests sub-tab in Procurement

**API endpoint namespace** (all new):
```
GET    /proposals/preferences           # my proposal preferences
PUT    /proposals/preferences           # save preferences
GET    /proposals/requests              # my Procurement proposal requests
POST   /proposals/requests             # create request
PATCH  /proposals/requests/:id         # update request
POST   /proposals/requests/:id/publish # publish request
POST   /proposals/requests/:id/close   # close request
GET    /proposals/inbox                 # received proposals (recipient view)
GET    /proposals/activity              # submitted proposals (proposer view)
GET    /proposals/:id                   # proposal detail
POST   /proposals/:id/status            # transition status
POST   /proposals/upload-session        # create anon upload session
PUT    /proposals/upload-session/:token/file  # upload file
GET    /proposals/upload-session/:token/status # scan status
POST   /proposals/submit               # submit proposal
```
