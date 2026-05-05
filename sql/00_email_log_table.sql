-- ============================================================
-- BẢNG email_log — bổ sung cho Phương án A (Email + PDF)
-- Chạy: psql -U postgres -d tnbike_db -f 00_email_log_table.sql
-- ============================================================

SET search_path TO tnbike, public;

CREATE TABLE IF NOT EXISTS email_log (
    log_id              SERIAL          PRIMARY KEY,
    message_id          TEXT            UNIQUE,            -- header Message-ID, dùng để chống trùng
    from_address        TEXT,
    subject             TEXT,
    received_at         TIMESTAMPTZ,
    attachment_name     TEXT,                              -- tên file PDF đính kèm gốc
    so_number           VARCHAR(20),                       -- BH26.xxxx — link tới sales_order
    processing_status   VARCHAR(20)     NOT NULL DEFAULT 'PENDING'
                          CHECK (processing_status IN
                            ('PENDING','EXTRACTED','VALIDATED','LOADED','FAILED','DUPLICATE')),
    error_stage         VARCHAR(20),                       -- EXTRACT/VALIDATE/LOAD — báo lỗi ở stage nào
    error_message       TEXT,
    extracted_payload   JSONB,                             -- snapshot dữ liệu trích xuất (debug)
    processed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ     DEFAULT NOW()
);

COMMENT ON TABLE  email_log                    IS 'Log xử lý từng email đặt hàng T3/2026 (Phương án A)';
COMMENT ON COLUMN email_log.message_id         IS 'Header Message-ID — UNIQUE để re-run idempotent';
COMMENT ON COLUMN email_log.processing_status  IS 'PENDING → EXTRACTED → VALIDATED → LOADED, hoặc FAILED/DUPLICATE';
COMMENT ON COLUMN email_log.error_stage        IS 'Stage gây lỗi: EXTRACT (parse PDF) / VALIDATE / LOAD';
COMMENT ON COLUMN email_log.extracted_payload  IS 'JSON snapshot của dữ liệu trích xuất — phục vụ debug & re-run';

CREATE INDEX IF NOT EXISTS idx_email_log_status   ON email_log(processing_status);
CREATE INDEX IF NOT EXISTS idx_email_log_so       ON email_log(so_number);
CREATE INDEX IF NOT EXISTS idx_email_log_received ON email_log(received_at);

-- KPI hiệu quả vận hành (Hạng mục B yêu cầu)
CREATE OR REPLACE VIEW v_email_processing_kpi AS
SELECT
    COUNT(*)                                                              AS total_emails,
    COUNT(*) FILTER (WHERE processing_status = 'LOADED')                  AS loaded_ok,
    COUNT(*) FILTER (WHERE processing_status = 'FAILED')                  AS failed,
    COUNT(*) FILTER (WHERE processing_status = 'DUPLICATE')               AS duplicates,
    ROUND(100.0 * COUNT(*) FILTER (WHERE processing_status = 'LOADED')
                / NULLIF(COUNT(*),0), 2)                                  AS pass_rate_pct,
    ROUND(EXTRACT(EPOCH FROM AVG(processed_at - received_at))::NUMERIC, 2) AS avg_processing_seconds
FROM email_log;

COMMENT ON VIEW v_email_processing_kpi IS 'KPI cho Hạng mục B.3 — Hiệu quả vận hành: pass rate, avg processing time';
