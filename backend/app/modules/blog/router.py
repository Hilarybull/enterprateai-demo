from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

import anyio
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from app.core.supabase import get_supabase_client, sb_delete, sb_insert, sb_select, sb_update
from app.shared.auth.deps import get_current_user

ADMIN_EMAIL = "tech.support@enterprateai.com"
BUCKET = "blog-images"

router = APIRouter(prefix="/blog", tags=["blog"])


def _require_admin(user=Depends(get_current_user)):
    if user.get("email") != ADMIN_EMAIL:
        raise HTTPException(status_code=403, detail="Admin only.")
    return user


def _slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    return re.sub(r"-+", "-", text).strip("-")


def _ensure_bucket() -> None:
    """Create the bucket if it doesn't exist yet (idempotent)."""
    client = get_supabase_client()
    try:
        buckets = client.storage.list_buckets()
        names = [b.name for b in (buckets or [])]
        if BUCKET not in names:
            client.storage.create_bucket(BUCKET, options={"public": True})
    except Exception:
        pass  # bucket may already exist or storage may not be configured


# ── Schemas ───────────────────────────────────────────────────────────────────

class CategoryIn(BaseModel):
    name: str
    slug: Optional[str] = None
    description: Optional[str] = None


class TagIn(BaseModel):
    name: str
    slug: Optional[str] = None


class ArticleIn(BaseModel):
    title: str
    slug: Optional[str] = None
    excerpt: Optional[str] = None
    content: Optional[str] = None
    cover_image_url: Optional[str] = None
    status: str = "draft"
    author_name: str = "EnterprateAI Team"
    category_id: Optional[str] = None
    tag_ids: list[str] = []


# ── Image upload ──────────────────────────────────────────────────────────────

@router.post("/admin/upload-image")
async def upload_image(file: UploadFile = File(...), _=Depends(_require_admin)):
    ext = (file.filename or "").rsplit(".", 1)[-1].lower()
    if ext not in {"jpg", "jpeg", "png", "webp", "gif", "avif"}:
        raise HTTPException(status_code=400, detail="Only jpg, png, webp, gif, avif are allowed.")
    data = await file.read()
    path = f"{uuid4()}.{ext}"
    mime = file.content_type or f"image/{ext}"

    def _upload():
        _ensure_bucket()
        client = get_supabase_client()
        client.storage.from_(BUCKET).upload(path, data, file_options={"content-type": mime, "upsert": "true"})
        return client.storage.from_(BUCKET).get_public_url(path)

    url = await anyio.to_thread.run_sync(_upload)
    return {"url": url}


# ── Public endpoints ──────────────────────────────────────────────────────────

@router.get("/categories")
async def list_categories():
    return await sb_select("blog_categories", order="name")


@router.get("/tags")
async def list_tags():
    return await sb_select("blog_tags", order="name")


@router.get("/articles")
async def list_articles(category: Optional[str] = None, tag: Optional[str] = None):
    rows = await sb_select(
        "blog_articles",
        columns="id,title,slug,excerpt,cover_image_url,author_name,category_id,published_at,created_at",
        filters=[("status", "eq", "published")],
        order="published_at",
        desc=True,
    )
    if category:
        cats = await sb_select("blog_categories", filters=[("slug", "eq", category)])
        if cats:
            rows = [r for r in rows if r.get("category_id") == cats[0]["id"]]
    if tag:
        tags = await sb_select("blog_tags", filters=[("slug", "eq", tag)])
        if tags:
            tag_id = tags[0]["id"]
            links = await sb_select("blog_article_tags", filters=[("tag_id", "eq", tag_id)])
            linked_ids = {lnk["article_id"] for lnk in links}
            rows = [r for r in rows if r["id"] in linked_ids]
    cats_all = await sb_select("blog_categories")
    cat_map = {c["id"]: c["name"] for c in cats_all}
    for r in rows:
        r["category_name"] = cat_map.get(r.get("category_id"))
    return rows


@router.get("/articles/{slug}")
async def get_article(slug: str):
    rows = await sb_select("blog_articles", filters=[("slug", "eq", slug), ("status", "eq", "published")])
    if not rows:
        raise HTTPException(status_code=404, detail="Article not found.")
    article = rows[0]
    links = await sb_select("blog_article_tags", filters=[("article_id", "eq", article["id"])])
    tag_ids = [lnk["tag_id"] for lnk in links]
    tags = []
    if tag_ids:
        all_tags = await sb_select("blog_tags")
        tags = [t for t in all_tags if t["id"] in tag_ids]
    article["tags"] = tags
    if article.get("category_id"):
        cats = await sb_select("blog_categories", filters=[("id", "eq", article["category_id"])])
        article["category"] = cats[0] if cats else None
    return article


# ── Admin endpoints ───────────────────────────────────────────────────────────

@router.get("/admin/articles")
async def admin_list_articles(_=Depends(_require_admin)):
    rows = await sb_select("blog_articles", order="created_at", desc=True)
    cats = await sb_select("blog_categories")
    cat_map = {c["id"]: c["name"] for c in cats}
    for r in rows:
        r["category_name"] = cat_map.get(r.get("category_id"))
    return rows


@router.post("/admin/articles", status_code=201)
async def admin_create_article(body: ArticleIn, _=Depends(_require_admin)):
    slug = body.slug or _slugify(body.title)
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "id": str(uuid4()),
        "title": body.title,
        "slug": slug,
        "excerpt": body.excerpt,
        "content": body.content,
        "cover_image_url": body.cover_image_url,
        "status": body.status,
        "author_name": body.author_name,
        "category_id": body.category_id or None,
        "published_at": now if body.status == "published" else None,
        "created_at": now,
        "updated_at": now,
    }
    result = await sb_insert("blog_articles", row)
    article_id = result[0]["id"] if result else row["id"]
    for tag_id in body.tag_ids:
        try:
            await sb_insert("blog_article_tags", {"article_id": article_id, "tag_id": tag_id})
        except Exception:
            pass
    return result[0] if result else row


@router.put("/admin/articles/{article_id}")
async def admin_update_article(article_id: str, body: ArticleIn, _=Depends(_require_admin)):
    existing = await sb_select("blog_articles", filters=[("id", "eq", article_id)])
    if not existing:
        raise HTTPException(status_code=404, detail="Not found.")
    now = datetime.now(timezone.utc).isoformat()
    published_at = existing[0].get("published_at")
    if body.status == "published" and not published_at:
        published_at = now
    updates = {
        "title": body.title,
        "slug": body.slug or _slugify(body.title),
        "excerpt": body.excerpt,
        "content": body.content,
        "cover_image_url": body.cover_image_url,
        "status": body.status,
        "author_name": body.author_name,
        "category_id": body.category_id or None,
        "published_at": published_at,
        "updated_at": now,
    }
    result = await sb_update("blog_articles", payload=updates, filters=[("id", "eq", article_id)])
    await sb_delete("blog_article_tags", filters=[("article_id", "eq", article_id)])
    for tag_id in body.tag_ids:
        try:
            await sb_insert("blog_article_tags", {"article_id": article_id, "tag_id": tag_id})
        except Exception:
            pass
    return result[0] if result else updates


@router.delete("/admin/articles/{article_id}", status_code=204)
async def admin_delete_article(article_id: str, _=Depends(_require_admin)):
    await sb_delete("blog_articles", filters=[("id", "eq", article_id)])


@router.post("/admin/categories", status_code=201)
async def admin_create_category(body: CategoryIn, _=Depends(_require_admin)):
    row = {
        "id": str(uuid4()),
        "name": body.name,
        "slug": body.slug or _slugify(body.name),
        "description": body.description,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    result = await sb_insert("blog_categories", row)
    return result[0] if result else row


@router.put("/admin/categories/{cat_id}")
async def admin_update_category(cat_id: str, body: CategoryIn, _=Depends(_require_admin)):
    updates = {"name": body.name, "slug": body.slug or _slugify(body.name), "description": body.description}
    result = await sb_update("blog_categories", payload=updates, filters=[("id", "eq", cat_id)])
    return result[0] if result else updates


@router.delete("/admin/categories/{cat_id}", status_code=204)
async def admin_delete_category(cat_id: str, _=Depends(_require_admin)):
    await sb_delete("blog_categories", filters=[("id", "eq", cat_id)])


@router.post("/admin/tags", status_code=201)
async def admin_create_tag(body: TagIn, _=Depends(_require_admin)):
    row = {
        "id": str(uuid4()),
        "name": body.name,
        "slug": body.slug or _slugify(body.name),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    result = await sb_insert("blog_tags", row)
    return result[0] if result else row


@router.put("/admin/tags/{tag_id}")
async def admin_update_tag(tag_id: str, body: TagIn, _=Depends(_require_admin)):
    updates = {"name": body.name, "slug": body.slug or _slugify(body.name)}
    result = await sb_update("blog_tags", payload=updates, filters=[("id", "eq", tag_id)])
    return result[0] if result else updates


@router.delete("/admin/tags/{tag_id}", status_code=204)
async def admin_delete_tag(tag_id: str, _=Depends(_require_admin)):
    await sb_delete("blog_tags", filters=[("id", "eq", tag_id)])
