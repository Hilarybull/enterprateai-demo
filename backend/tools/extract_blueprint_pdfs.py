from __future__ import annotations

import argparse
from pathlib import Path


def _extract_text(pdf_path: Path) -> str:
    try:
        from pypdf import PdfReader  # type: ignore
    except Exception as e:  # pragma: no cover
        raise SystemExit("Missing dependency: pypdf. Install with `python -m pip install pypdf`.") from e

    reader = PdfReader(str(pdf_path))
    parts: list[str] = []
    for i, page in enumerate(reader.pages):
        txt = page.extract_text() or ""
        txt = txt.strip()
        if not txt:
            continue
        parts.append(f"\n\n--- PAGE {i + 1} ---\n\n{txt}")
    return "\n".join(parts).strip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extract text from blueprint PDFs into backend/app/shared/data/blueprint/ for implementation.",
    )
    parser.add_argument("pdf", nargs="*", help="Path(s) to PDF files to extract. If omitted, scans the repo docs/ folder for PDFs.")
    parser.add_argument(
        "--out",
        default="backend/app/shared/data/blueprint",
        help="Output folder (default: backend/app/shared/data/blueprint)",
    )
    args = parser.parse_args()

    pdf_paths = [Path(p).expanduser().resolve() for p in args.pdf]
    if not pdf_paths:
        repo_root = Path(__file__).resolve().parents[2]
        docs_dir = repo_root / "docs"
        if not docs_dir.exists() or not docs_dir.is_dir():
            raise SystemExit("No PDF paths provided and docs/ folder not found.")
        pdf_paths = sorted(docs_dir.glob("*.pdf"))
        if not pdf_paths:
            raise SystemExit("No PDF files found in docs/. Provide explicit PDF paths.")

    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    for p in args.pdf:
        pdf_path = Path(p).expanduser().resolve()
        if not pdf_path.exists():
            raise SystemExit(f"PDF not found: {pdf_path}")
        text = _extract_text(pdf_path)
        out_file = out_dir / f"{pdf_path.stem}.txt"
        out_file.write_text(text, encoding="utf-8")
        print(f"Wrote {out_file}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

