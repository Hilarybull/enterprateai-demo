-- NOTE: Also create a public Supabase Storage bucket named "blog-images" in the
-- Supabase dashboard (Storage → New bucket → name: blog-images → Public: ON).
-- The backend will attempt to create it automatically on first upload, but
-- manual creation ensures the correct public policy is applied.

-- Blog categories
CREATE TABLE IF NOT EXISTS blog_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  created_at timestamptz DEFAULT now()
);

-- Blog tags
CREATE TABLE IF NOT EXISTS blog_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

-- Blog articles
CREATE TABLE IF NOT EXISTS blog_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  excerpt text,
  content text,
  cover_image_url text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  author_name text NOT NULL DEFAULT 'EnterprateAI Team',
  category_id uuid REFERENCES blog_categories(id) ON DELETE SET NULL,
  published_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Article <-> Tag junction
CREATE TABLE IF NOT EXISTS blog_article_tags (
  article_id uuid NOT NULL REFERENCES blog_articles(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES blog_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, tag_id)
);

-- RLS (public read for published; no auth needed)
ALTER TABLE blog_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_article_tags ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically; these policies allow anon read of published content
CREATE POLICY "public read categories" ON blog_categories FOR SELECT USING (true);
CREATE POLICY "public read tags" ON blog_tags FOR SELECT USING (true);
CREATE POLICY "public read published articles" ON blog_articles FOR SELECT USING (status = 'published');
CREATE POLICY "public read article tags" ON blog_article_tags FOR SELECT USING (true);
