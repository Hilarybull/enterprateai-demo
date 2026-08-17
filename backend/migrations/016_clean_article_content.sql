-- Remove AI icons, symbol bullets, and em dashes from all article content.
-- Safe to run multiple times.

UPDATE blog_articles
SET content = content
-- remove sparkle emoji header icon
  , content = replace(content, '✨ ',       '')
  , content = replace(content, '✨',        '')
-- remove ⊙ span bullets (full HTML element)
  , content = replace(content, '<span style="color:#6366f1;flex-shrink:0">⊙</span>', '')
  , content = replace(content, '<span style="color:#6366f1;flex-shrink:0">⊙</span> ', '')
-- remove bare ⊙ characters
  , content = replace(content, '⊙ ', '')
  , content = replace(content, '⊙',   '')
-- simplify li flex style left over from icon alignment
  , content = replace(content,
      'display:flex;align-items:flex-start;gap:10px;color:#334155',
      'color:#334155;padding-left:4px')
-- replace em dashes with plain dash
  , content = replace(content, ' — ', ' - ')
  , content = replace(content, '—',   '-')
WHERE content IS NOT NULL
  AND (
    content LIKE '%✨%'
    OR content LIKE '%⊙%'
    OR content LIKE '%—%'
    OR content LIKE '%display:flex;align-items:flex-start;gap:10px%'
  );
