"""
smoke_test.py — Verify pipeline trên 3 PDF mẫu KHÔNG cần DB

Chạy:  python smoke_test.py /path/to/sample.pdf
Hoặc:  python smoke_test.py        # dùng PDF trong staging/pdf/
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from extract_pdf import extract_one


def main():
    if len(sys.argv) > 1:
        pdfs = [Path(sys.argv[1])]
    else:
        pdfs = sorted(Path("staging/pdf").glob("*.pdf"))[:5]

    if not pdfs:
        print("Không có PDF nào để test")
        return

    for pdf in pdfs:
        print("=" * 70)
        print(f"PDF: {pdf}")
        print("=" * 70)
        payload = extract_one(str(pdf))
        print(json.dumps(payload, indent=2, ensure_ascii=False, default=str))
        print()


if __name__ == "__main__":
    main()
