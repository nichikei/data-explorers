"""
run_pipeline.py — Orchestrator
==============================
Chạy đầy đủ 5 stages của pipeline Phương án A.

Sử dụng:
    python src/run_pipeline.py            # chạy hết
    python src/run_pipeline.py --stage 2  # chỉ chạy stage 2 (extract PDF)
    python src/run_pipeline.py --skip-fact  # bỏ qua stage 5

Mỗi stage có thể chạy độc lập (idempotent) — re-run an toàn.
"""
import argparse
import logging
import time

from config import get_conn
import extract_email
import extract_pdf
import validate
import load_db
import refresh_fact

log = logging.getLogger("orchestrator")

STAGES = [
    ("1-EML",       extract_email.run, "Parse .eml + tách PDF đính kèm"),
    ("2-PDF",       extract_pdf.run,   "Trích xuất nội dung PDF"),
    ("3-VALIDATE",  validate.run,      "Kiểm tra hợp lệ"),
    ("4-LOAD",      load_db.run,       "Insert sales_order + order_line"),
    ("5-FACT",      refresh_fact.run,  "Refresh bảng fact_sales"),
]


def print_summary():
    """In bảng summary cuối pipeline."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT processing_status, COUNT(*)
                FROM email_log
                GROUP BY processing_status
                ORDER BY processing_status
            """)
            log.info("=== email_log summary ===")
            for status, n in cur.fetchall():
                log.info("  %-12s : %d", status, n)

            cur.execute("SELECT * FROM v_email_processing_kpi")
            cols = [c.name for c in cur.description]
            kpi = dict(zip(cols, cur.fetchone()))
            log.info("=== KPI vận hành ===")
            for k, v in kpi.items():
                log.info("  %-25s : %s", k, v)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", type=int, choices=[1, 2, 3, 4, 5],
                        help="Chỉ chạy 1 stage cụ thể")
    parser.add_argument("--skip-fact", action="store_true",
                        help="Bỏ qua stage 5 (refresh fact_sales)")
    args = parser.parse_args()

    t0 = time.time()
    if args.stage:
        name, fn, desc = STAGES[args.stage - 1]
        log.info(">>> Chạy riêng stage %s — %s", name, desc)
        fn()
    else:
        for i, (name, fn, desc) in enumerate(STAGES, start=1):
            if args.skip_fact and name == "5-FACT":
                log.info(">>> Skip stage %s", name)
                continue
            log.info("=" * 60)
            log.info(">>> STAGE %s — %s", name, desc)
            log.info("=" * 60)
            fn()

    print_summary()
    log.info("Pipeline xong sau %.1fs", time.time() - t0)


if __name__ == "__main__":
    main()
