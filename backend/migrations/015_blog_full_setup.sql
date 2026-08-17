-- ============================================================
-- EnterprateAI -Blog: full setup + seed
-- Run this once in Supabase SQL Editor.
-- Safe to re-run: uses IF NOT EXISTS / ON CONFLICT DO NOTHING.
-- ============================================================

-- ── 1. Tables ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS blog_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  description text,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS blog_tags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS blog_articles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text NOT NULL,
  slug             text NOT NULL UNIQUE,
  excerpt          text,
  content          text,
  cover_image_url  text,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  author_name      text NOT NULL DEFAULT 'EnterprateAI Team',
  category_id      uuid REFERENCES blog_categories(id) ON DELETE SET NULL,
  published_at     timestamptz,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS blog_article_tags (
  article_id uuid NOT NULL REFERENCES blog_articles(id) ON DELETE CASCADE,
  tag_id     uuid NOT NULL REFERENCES blog_tags(id)     ON DELETE CASCADE,
  PRIMARY KEY (article_id, tag_id)
);

-- ── 2. RLS (idempotent -errors on duplicate policy are harmless) ─

DO $$ BEGIN
  ALTER TABLE blog_categories      ENABLE ROW LEVEL SECURITY;
  ALTER TABLE blog_tags            ENABLE ROW LEVEL SECURITY;
  ALTER TABLE blog_articles        ENABLE ROW LEVEL SECURITY;
  ALTER TABLE blog_article_tags    ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "public read categories"          ON blog_categories   FOR SELECT USING (true);
  CREATE POLICY "public read tags"                ON blog_tags         FOR SELECT USING (true);
  CREATE POLICY "public read published articles"  ON blog_articles     FOR SELECT USING (status = 'published');
  CREATE POLICY "public read article tags"        ON blog_article_tags FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 3. Categories ─────────────────────────────────────────────

INSERT INTO blog_categories (name, slug, description) VALUES
  ('Getting Started',       'getting-started',       'Guides and walkthroughs to help you get the most out of EnterprateAI from day one.'),
  ('Business Planning',     'business-planning',     'Expert insights, templates, and strategies to build a solid foundation for your enterprise.'),
  ('Funding Readiness',     'funding-readiness',     'Prepare your business for investment, grants, and lending with confidence.'),
  ('Invoicing & Cashflow',  'invoicing-cashflow',    'Manage your invoices, quotations, expenses, and cashflow with clarity.'),
  ('Business Resilience',   'business-resilience',   'Identify vulnerabilities, mitigate risks, and build a more resilient business.'),
  ('Decision Intelligence', 'decision-intelligence', 'Simulate scenarios and make smarter, data-driven business decisions.'),
  ('Small Business Growth', 'small-business-growth', 'Practical strategies and insights to help your business scale sustainably.'),
  ('Marketplace & Sales',   'marketplace-sales',     'Reach more customers, improve your listings, and grow your sales pipeline.'),
  ('Contract Management',   'contract-management',   'Create, manage, and track contracts and agreements efficiently.')
ON CONFLICT (slug) DO NOTHING;

-- ── 4. Articles -Business Planning ──────────────────────────

INSERT INTO blog_articles (title, slug, excerpt, content, status, author_name, category_id, published_at, created_at, updated_at)
SELECT
  'How to Write a Business Plan That Actually Works',
  'how-to-write-a-business-plan-that-actually-works',
  'Learn the practical structure, avoid common mistakes, and create an actionable business plan that drives real results.',
  $BODY$
<div style="background:#f0f4ff;border:1px solid #c7d2fe;border-radius:12px;padding:20px 24px;margin:24px 0">
  <div style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:1rem;color:#1e293b;margin-bottom:12px">Key Takeaways</div>
  <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px">
    <li style="color:#334155;padding-left:4px">A business plan is a decision-making tool, not just a document for investors.</li>
    <li style="color:#334155;padding-left:4px">Clarity on your target customer is the foundation every other section rests on.</li>
    <li style="color:#334155;padding-left:4px">Financial projections must be grounded in real assumptions, not wishful thinking.</li>
    <li style="color:#334155;padding-left:4px">The best plans are concise, specific, and reviewed regularly.</li>
  </ul>
</div>

<h2>Why Most Business Plans Fail Before They Start</h2>
<p>A business plan that sits in a drawer after being written has already failed. Yet the majority of plans produced by new business owners end up doing exactly that -created to satisfy a bank, an accelerator, or an advisor, then never revisited. The problem is not the idea. It is the approach.</p>
<p>A business plan that actually works is not a polished document written for an external audience. It is a practical, living tool that sharpens your thinking, surfaces gaps in your assumptions, and guides decisions at every stage of your business.</p>

<h2>Start With the Problem, Not the Product</h2>
<p>The most common mistake in writing a business plan is starting with what you want to sell. Instead, start with the problem your customer faces and why solving it matters. This forces you to anchor your entire plan in customer reality rather than founder enthusiasm.</p>
<p>Define your target customer as specifically as possible. Not "small business owners" but "UK-based sole traders in professional services earning between £40,000 and £100,000 who currently manage invoicing in spreadsheets." The narrower your customer definition, the more accurate your revenue assumptions, your marketing strategy, and your pricing model will be.</p>

<h2>The Structure That Actually Gets Read</h2>
<p>A business plan does not need to be 40 pages. Investors and lenders skim; advisors scan; you need to use it quickly. The structure that works is lean and specific:</p>
<ul>
  <li><strong>Executive Summary</strong> -one page maximum. The problem, your solution, your market, your traction, and what you need.</li>
  <li><strong>Market Analysis</strong> -your total addressable market, your specific segment, and evidence that customers exist and will pay.</li>
  <li><strong>Business Model</strong> -how you make money, your pricing, and your key revenue streams.</li>
  <li><strong>Operations Plan</strong> -how you deliver your product or service, your key suppliers, and your team structure.</li>
  <li><strong>Financial Projections</strong> -three-year forecast with clear assumptions for revenue, costs, and cashflow.</li>
  <li><strong>Go-to-Market Strategy</strong> -how you acquire your first 10, 100, and 1,000 customers.</li>
</ul>

<h2>Building Financial Projections You Can Defend</h2>
<p>Financial projections are where most plans lose credibility. The temptation is to work backwards from the revenue you want rather than forwards from the assumptions you can justify. Every number in your forecast needs to trace back to a specific assumption: conversion rate, average order value, churn rate, headcount cost.</p>
<p>Start with your costs. Fixed costs -rent, salaries, software subscriptions -are predictable. Variable costs scale with revenue. Build your cost model first, then build the revenue required to cover it and generate the margin you need. This approach produces a break-even point and a cashflow timeline that you can defend to any stakeholder.</p>

<h2>Common Mistakes to Cut Before You Submit</h2>
<p>Before you share your plan with anyone, check it against these frequent failures:</p>
<ul>
  <li>Vague customer definition ("anyone who needs this") with no evidence of demand</li>
  <li>Revenue projections with no stated assumptions</li>
  <li>Competitive analysis that lists competitors but does not explain why customers will choose you</li>
  <li>A team section that describes titles without explaining relevant experience</li>
  <li>No mention of risks or how you will mitigate them</li>
</ul>

<h2>Make It a Living Document</h2>
<p>The most effective business plans are reviewed at least quarterly. Set a date each quarter to revisit your assumptions. Has your target customer shifted? Is your pricing model holding? Has a competitor emerged that changes your go-to-market approach?</p>
<p>A plan that is updated as your business learns is worth ten times more than a perfect document that was accurate on day one and irrelevant by month six.</p>

<div style="background:#f8faff;border:1px solid #e0e7ff;border-radius:12px;padding:28px 24px;margin:32px 0;text-align:center">
  <p style="font-weight:700;font-size:1.1rem;color:#1e293b;margin:0 0 8px">Ready to take action?</p>
  <p style="color:#475569;margin:0 0 20px;font-size:0.95rem">Build your business plan directly from your workspace data using EnterprateAI's <strong>Business Blueprint</strong> generator.</p>
  <a href="/dashboard" style="display:inline-block;background:#4f46e5;color:#fff;font-weight:700;padding:12px 28px;border-radius:10px;text-decoration:none;font-size:0.95rem">Try Business Blueprint →</a>
</div>
$BODY$,
  'published',
  'EnterprateAI Expert Team',
  (SELECT id FROM blog_categories WHERE slug = 'business-planning'),
  '2026-07-15 09:00:00+00',
  '2026-07-15 09:00:00+00',
  '2026-07-15 09:00:00+00'
WHERE NOT EXISTS (SELECT 1 FROM blog_articles WHERE slug = 'how-to-write-a-business-plan-that-actually-works');

INSERT INTO blog_articles (title, slug, excerpt, content, status, author_name, category_id, published_at, created_at, updated_at)
SELECT
  '5 Critical Sections Every Business Plan Needs',
  '5-critical-sections-every-business-plan-needs',
  'Detailing the Executive Summary, Market Analysis, Operations, Financials, and Management Structure your plan requires.',
  $BODY$
<div style="background:#f0f4ff;border:1px solid #c7d2fe;border-radius:12px;padding:20px 24px;margin:24px 0">
  <div style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:1rem;color:#1e293b;margin-bottom:12px">Key Takeaways</div>
  <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px">
    <li style="color:#334155;padding-left:4px">Five sections account for 90% of what investors and lenders evaluate.</li>
    <li style="color:#334155;padding-left:4px">The Executive Summary is read first and remembered longest -get it right.</li>
    <li style="color:#334155;padding-left:4px">Your Management section is often the deciding factor for early-stage funding.</li>
    <li style="color:#334155;padding-left:4px">Financial projections without stated assumptions will be dismissed immediately.</li>
  </ul>
</div>

<h2>Section 1: Executive Summary</h2>
<p>The Executive Summary is the most important section in your business plan -and the most frequently written last and treated as an afterthought. It should be written last but placed first, and it must be able to stand alone. A reader who reads only the Executive Summary should understand exactly what your business does, who it serves, why it wins, and what you need.</p>
<p>Keep it to one page. Cover: the problem you solve, your solution, your target market, your business model, your current traction, and your ask. If you cannot compress your business into one compelling page, your strategy is not yet clear enough.</p>

<h2>Section 2: Market Analysis</h2>
<p>Market analysis answers the question investors and lenders are really asking: is there a large enough opportunity here, and does this team understand it? A strong market analysis is not a Wikipedia summary of your industry. It is a focused argument that your specific customer segment is underserved, growing, and willing to pay.</p>
<p>Structure your market analysis around three numbers: Total Addressable Market (the full market), Serviceable Addressable Market (the portion you could realistically reach), and Serviceable Obtainable Market (the share you plan to capture in three to five years). Ground each number in a source or a bottom-up calculation, not a top-down percentage.</p>

<h2>Section 3: Operations Plan</h2>
<p>The operations section answers how you will actually deliver what you are selling. For a product business, this means your supply chain, manufacturing or fulfilment process, and quality controls. For a service business, it means your delivery model, your team structure, and your capacity constraints.</p>
<p>This section matters more than founders expect. A compelling product with no credible delivery plan is a red flag for any serious investor. Include your key suppliers or partners, your technology infrastructure, and your plan for scaling operations as revenue grows.</p>

<h2>Section 4: Financial Projections</h2>
<p>Financial projections need to cover at minimum three years, with monthly detail for year one and annual summaries for years two and three. The sections your audience will focus on are: revenue forecast by stream, cost structure broken down by fixed and variable, gross margin, EBITDA, and cashflow month by month for year one.</p>
<p>Every projection must have a stated assumption. Revenue per customer, customer acquisition cost, monthly churn, payroll, and overhead should all appear in an assumptions table. Projections without visible assumptions are considered guesswork and will be dismissed.</p>

<h2>Section 5: Management and Team</h2>
<p>At early stages, investors often back the team more than the idea. Your management section should make a compelling case that the people running this business have the relevant experience, skills, and complementary strengths to execute the plan.</p>
<p>For each key team member, include: their role, their directly relevant experience, and a specific past achievement that demonstrates their ability to do this job. For gaps in your team -areas where you do not yet have the right person -name them and explain your plan to fill them. Honesty about gaps signals self-awareness, which is a positive signal.</p>

<div style="background:#f8faff;border:1px solid #e0e7ff;border-radius:12px;padding:28px 24px;margin:32px 0;text-align:center">
  <p style="font-weight:700;font-size:1.1rem;color:#1e293b;margin:0 0 8px">Ready to take action?</p>
  <p style="color:#475569;margin:0 0 20px;font-size:0.95rem">Generate a complete, structured business plan from your workspace data using EnterprateAI's <strong>Business Blueprint</strong>.</p>
  <a href="/dashboard" style="display:inline-block;background:#4f46e5;color:#fff;font-weight:700;padding:12px 28px;border-radius:10px;text-decoration:none;font-size:0.95rem">Try Business Blueprint →</a>
</div>
$BODY$,
  'published',
  'EnterprateAI Expert Team',
  (SELECT id FROM blog_categories WHERE slug = 'business-planning'),
  '2026-07-18 09:00:00+00',
  '2026-07-18 09:00:00+00',
  '2026-07-18 09:00:00+00'
WHERE NOT EXISTS (SELECT 1 FROM blog_articles WHERE slug = '5-critical-sections-every-business-plan-needs');

INSERT INTO blog_articles (title, slug, excerpt, content, status, author_name, category_id, published_at, created_at, updated_at)
SELECT
  'Business Planning for Startups: A Step-by-Step Guide',
  'business-planning-for-startups-a-step-by-step-guide',
  'Address startup-specific challenges and follow a clear step-by-step process from idea validation to funding needs.',
  $BODY$
<div style="background:#f0f4ff;border:1px solid #c7d2fe;border-radius:12px;padding:20px 24px;margin:24px 0">
  <div style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:1rem;color:#1e293b;margin-bottom:12px">Key Takeaways</div>
  <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px">
    <li style="color:#334155;padding-left:4px">Startups must validate the problem before planning the business.</li>
    <li style="color:#334155;padding-left:4px">An MVP strategy is more valuable in your plan than a fully developed product roadmap.</li>
    <li style="color:#334155;padding-left:4px">Your runway calculation is the most critical number in your startup plan.</li>
    <li style="color:#334155;padding-left:4px">Plan for pivots: a good startup plan anticipates multiple iterations.</li>
  </ul>
</div>

<h2>Step 1: Validate the Problem First</h2>
<p>Startups fail most often not because of poor execution but because they build solutions to problems that do not exist, or that customers will not pay to solve. Before you write a single section of your business plan, you need evidence that your problem is real and that your target customer feels it acutely enough to change their behaviour.</p>
<p>Run at least twenty structured customer discovery conversations. Ask about the problem, not your solution. Understand how they currently address it, what they have tried, what it costs them in time and money, and whether they have looked for alternatives. The answers to these questions will shape every section of your plan.</p>

<h2>Step 2: Define Your MVP Scope</h2>
<p>Startups do not need a full product to begin planning. They need a Minimum Viable Product -the smallest version of their solution that delivers genuine value to a specific customer and produces a usable signal about whether the business model works. Your business plan should articulate your MVP clearly: what it includes, what it explicitly excludes, and what specific question it is designed to answer.</p>
<p>Investors and advisors reading your plan want to see that you understand the difference between building what customers need and building what you find interesting. A tight MVP scope is evidence of commercial discipline.</p>

<h2>Step 3: Build Your Runway Model</h2>
<p>For a startup, the most important financial metric is runway -how many months of operation your available capital can fund at your current burn rate. Your business plan must include a clear runway model that shows: starting capital, monthly fixed costs, monthly variable costs, expected revenue ramp, and the month at which you reach breakeven or need additional funding.</p>
<p>A startup with 18 months of runway and a clear funding plan is in a different position to one with six months and no plan for what happens next. Your runway model should inform every operational decision, including hiring timing, marketing spend, and product investment.</p>

<h2>Step 4: Map Your Go-to-Market for the First 90 Days</h2>
<p>A startup business plan needs a specific, time-bound go-to-market strategy for the first 90 days. Not a general statement about marketing channels, but a concrete plan: which five to ten target customers you will pursue in week one, how you will reach them, what you will offer, and how you will measure whether it is working.</p>
<p>Early traction -even a single paying customer, or a letter of intent -is worth more than any market size statistic in your plan. Build your 90-day plan around acquiring that proof point.</p>

<h2>Step 5: Plan for Iteration</h2>
<p>The best startup business plans acknowledge uncertainty rather than hiding it. Include a section on your key assumptions and the conditions under which you would pivot each one. Which assumptions does your business depend on most? What data would tell you that an assumption was wrong? What is your contingency?</p>
<p>This section demonstrates to any reader that you have thought rigorously about your risks and that you have a framework for learning rather than a rigid attachment to your first idea.</p>

<div style="background:#f8faff;border:1px solid #e0e7ff;border-radius:12px;padding:28px 24px;margin:32px 0;text-align:center">
  <p style="font-weight:700;font-size:1.1rem;color:#1e293b;margin:0 0 8px">Ready to take action?</p>
  <p style="color:#475569;margin:0 0 20px;font-size:0.95rem">Validate your startup idea and generate your first business plan using EnterprateAI's <strong>Idea Validation</strong> engine.</p>
  <a href="/dashboard" style="display:inline-block;background:#4f46e5;color:#fff;font-weight:700;padding:12px 28px;border-radius:10px;text-decoration:none;font-size:0.95rem">Try Idea Validation →</a>
</div>
$BODY$,
  'published',
  'EnterprateAI Expert Team',
  (SELECT id FROM blog_categories WHERE slug = 'business-planning'),
  '2026-07-21 09:00:00+00',
  '2026-07-21 09:00:00+00',
  '2026-07-21 09:00:00+00'
WHERE NOT EXISTS (SELECT 1 FROM blog_articles WHERE slug = 'business-planning-for-startups-a-step-by-step-guide');

INSERT INTO blog_articles (title, slug, excerpt, content, status, author_name, category_id, published_at, created_at, updated_at)
SELECT
  'Why Your Business Plan Matters More Than You Think',
  'why-your-business-plan-matters-more-than-you-think',
  'Discover the strategic value of business planning in reducing risk, aligning teams, and attracting investors.',
  $BODY$
<div style="background:#f0f4ff;border:1px solid #c7d2fe;border-radius:12px;padding:20px 24px;margin:24px 0">
  <div style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:1rem;color:#1e293b;margin-bottom:12px">Key Takeaways</div>
  <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px">
    <li style="color:#334155;padding-left:4px">Business plans are living strategic assets, not just loan prerequisites.</li>
    <li style="color:#334155;padding-left:4px">Documented plans significantly increase business survival rates.</li>
    <li style="color:#334155;padding-left:4px">A clear plan prevents costly inter-departmental misalignment.</li>
    <li style="color:#334155;padding-left:4px">Thorough planning is mandatory for securing external capital.</li>
  </ul>
</div>

<h2>The Myth of the Business Plan as a One-Off Document</h2>
<p>Most small business owners think of a business plan as something you write once -for a bank loan, an accelerator application, or a pitch to investors -and then file away. This framing is the reason most business plans deliver almost no value to the businesses that create them.</p>
<p>A business plan is not a submission document. It is a strategic asset. It is the clearest expression of how your business creates value, who it creates value for, and what you need to happen in the next twelve to thirty-six months to realise that potential. When treated as a living document and revisited regularly, it becomes one of the most powerful tools a business owner has.</p>

<h2>Strategic Value and Risk Reduction</h2>
<p>Planning reduces risk by forcing you to identify challenges early through scenario analysis. Statistics show that businesses with a written plan are 16% more likely to achieve viability than those without one. By utilising EnterprateAI's Business Scenario Simulation, you can digitally test your plan against market shocks before risking real capital.</p>
<p>The act of writing a business plan surfaces assumptions you have never examined. What is your customer acquisition cost? What happens to your cashflow if a major client delays payment by 60 days? What is your breakeven point, and how far away is it? These questions do not have comfortable answers for most businesses -which is precisely why surfacing them in a planning document, rather than encountering them as live crises, is so valuable.</p>

<h2>Team Alignment and Communication</h2>
<p>A business plan is your ultimate communication tool. Consider a software company where the sales team was selling features the product team had not planned to build for a year. This misalignment caused massive customer churn and nearly bankrupted them. A documented plan aligns all departments under a single, unified vision.</p>
<p>When your team, your advisors, your investors, and your key suppliers all have access to the same articulation of where the business is going and what the priorities are, misalignment of this kind becomes far less likely. Everyone is optimising toward the same goals, on the same timeline, with a shared understanding of what trade-offs are acceptable.</p>

<h2>Attracting Investors and Lenders</h2>
<p>Lenders and investors use your plan to gauge your competency. It shows you respect their capital enough to calculate exactly how it will be deployed and returned. Without a comprehensive plan, securing external funding is nearly impossible in today's competitive landscape.</p>
<p>The quality of your business plan signals the quality of your thinking. A plan with specific assumptions, a coherent strategy, and honest risk identification tells a sophisticated reader that you understand your business deeply. A vague plan with unsupported projections tells them the opposite. In a market where capital is competitive, the quality of your planning is often the deciding factor.</p>

<h2>Your Plan as a Decision-Making Tool</h2>
<p>Beyond funding and alignment, a business plan functions as a reference point for every significant decision you make. Should you hire now or wait? Should you expand your service offering? Should you pursue a particular partnership? Each of these decisions can be evaluated against the plan: does this action advance our stated goals? Does it fit within our stated resource constraints? Does it require us to update our assumptions?</p>
<p>Businesses that plan regularly make better decisions not because they predict the future accurately, but because they have a clear framework for evaluating options and recognising when reality has diverged from expectation.</p>

<div style="background:#f8faff;border:1px solid #e0e7ff;border-radius:12px;padding:28px 24px;margin:32px 0;text-align:center">
  <p style="font-weight:700;font-size:1.1rem;color:#1e293b;margin:0 0 8px">Ready to take action?</p>
  <p style="color:#475569;margin:0 0 20px;font-size:0.95rem">Implement the strategies from this article today using EnterprateAI's <strong>Business Scenario Simulation</strong>.</p>
  <a href="/dashboard" style="display:inline-block;background:#4f46e5;color:#fff;font-weight:700;padding:12px 28px;border-radius:10px;text-decoration:none;font-size:0.95rem">Try Business Scenario Simulation →</a>
</div>
$BODY$,
  'published',
  'EnterprateAI Expert Team',
  (SELECT id FROM blog_categories WHERE slug = 'business-planning'),
  '2026-07-25 09:00:00+00',
  '2026-07-25 09:00:00+00',
  '2026-07-25 09:00:00+00'
WHERE NOT EXISTS (SELECT 1 FROM blog_articles WHERE slug = 'why-your-business-plan-matters-more-than-you-think');
