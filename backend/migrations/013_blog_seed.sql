-- Blog category seed (upsert safe)
INSERT INTO blog_categories (name, slug, description) VALUES
  ('Getting Started', 'getting-started', 'Guides and walkthroughs to help you get the most out of EnterprateAI from day one.')
ON CONFLICT (slug) DO NOTHING;

-- Article seed
INSERT INTO blog_articles (
  title,
  slug,
  excerpt,
  content,
  cover_image_url,
  status,
  author_name,
  category_id,
  published_at
)
SELECT
  'From Idea to Investment Ready: How EnterprateAI Works for You',
  'from-idea-to-investment-ready-how-enterprateai-works',
  'Most small business owners spend months piecing together a business plan, pitch deck, and financial model across a dozen different tools. EnterprateAI changes that completely. Input your business idea once and our platform generates everything you need to start, operate, sell, simulate decisions, and attract investment.',
  '
<h2>One Input. Five Powerful Outputs.</h2>
<p>Most small business owners spend months piecing together a business plan, a pitch deck, and a financial model across a dozen different tools. EnterprateAI changes that completely.</p>
<p>You input your business idea once. Our platform then generates everything you need to start, operate, sell, simulate decisions, and attract investment. Here is exactly how it works.</p>

<h2>Step 1: Idea Validation</h2>
<p>Before you commit time and money to a business idea, you need to know whether it has real potential. EnterprateAI begins with a structured idea validation engine that analyses your concept across multiple dimensions.</p>
<p>You describe the problem you solve, your target market, your unique value, and your revenue model. Our AI powered engine evaluates the strength of each component and delivers a Readiness Score out of 100. A score of 82 with a High Potential rating means your concept has strong market fit and a compelling proposition worth building on.</p>
<p>This is not guesswork. It is a structured assessment that surfaces gaps before you invest further, so you can refine your idea with confidence rather than discover problems after launch.</p>

<h2>Step 2: Business Plan Generated</h2>
<p>Once your idea is validated, EnterprateAI generates a complete business plan from the same inputs you already provided. No starting from scratch. No blank page.</p>
<p>The generated plan includes a full executive summary, a market analysis grounded in your target sector, a go to market strategy tailored to your customer profile, and financial projections built on your revenue model. Every section draws directly from your workspace data, which means the plan is coherent, consistent, and specific to your business rather than a generic template.</p>
<p>You can refine any section, save the plan to your workspace, and share it with advisors, lenders, or potential partners.</p>

<h2>Step 3: Marketplace Launch</h2>
<p>Getting your first clients is often the hardest part of starting a service business. EnterprateAI removes the friction by turning your workspace data into a live marketplace listing with a single action.</p>
<p>Your service is published to the EnterprateAI marketplace, where potential clients can discover, review, and contact you. With visibility ratings, live status indicators, and client reviews built in, your listing builds credibility from day one. A 4.9 out of 5 rating with 128 reviews is the kind of social proof that would ordinarily take years to accumulate. With EnterprateAI, your listing is professionally structured and search optimised from the moment it goes live.</p>

<h2>Step 4: Decision Simulation</h2>
<p>Growth requires decisions. Hiring, pricing, expanding, cutting costs. Every one of those decisions carries risk, and most small business owners make them with incomplete information.</p>
<p>EnterprateAI gives you a decision simulation engine that models the financial impact of any business scenario before you commit. You can compare two paths side by side on a single chart: the projected revenue with the action taken versus the projected revenue without it.</p>
<p>The AI recommendation engine goes further. Rather than just showing you numbers, it gives you a clear, actionable recommendation. For example: delay a full time hire by two months and use a contractor instead to preserve cashflow. It also identifies the optimal window for scaling, so you are not growing too early or waiting too long.</p>
<p>This is scenario intelligence designed for small business owners who want clarity before they act, not regret after.</p>

<h2>Step 5: Funding Readiness</h2>
<p>When you are ready to raise investment or approach a lender, EnterprateAI generates a Funding Readiness report from your existing workspace data. No additional inputs required.</p>
<p>The report gives you a Funding Score out of 100, a clear picture of the capital your business needs, your current runway in months, and an Investor Readiness rating. A score of 87, a capital requirement of 250,000, a runway of 9.2 months, and a High investor readiness rating tells both you and potential investors that your business is structured, sustainable, and worth backing.</p>
<p>This is the kind of business intelligence summary that would normally require a financial advisor and several weeks of preparation. EnterprateAI produces it from the data you have already entered.</p>

<h2>Why It Matters</h2>
<p>The traditional approach to building a business involves a separate tool for validation, another for planning, another for invoicing, another for listings, and a spreadsheet for scenario modelling. The result is scattered information, repeated data entry, inconsistent outputs, and decisions made on incomplete pictures.</p>
<p>EnterprateAI unifies all of it into one intelligent workspace. Your business data lives in one place, updates in one place, and generates everything you need from that single source of truth.</p>
<p>That means less time managing tools and more time running your business. Less guesswork and more clarity. Less risk and more confidence.</p>

<h2>Get Started Today</h2>
<p>The Explorer plan is free to start with no credit card required. You get access to idea validation, business plan generation, financial tools, and a marketplace listing from day one.</p>
<p>When you are ready for scenario simulation, funding readiness reports, and adaptive business intelligence, the Starter plan gives you everything the platform has to offer for your growing business.</p>
<p>Input your business idea once. Let EnterprateAI generate the rest.</p>
',
  '/hero-section-1.png',
  'published',
  'EnterprateAI Team',
  (SELECT id FROM blog_categories WHERE slug = 'getting-started'),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM blog_articles WHERE slug = 'from-idea-to-investment-ready-how-enterprateai-works'
);
