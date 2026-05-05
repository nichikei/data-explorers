# Data Explorers 2026 — Thống Nhất Bike

> **From Data to Decision** · Cuộc thi Data Explorers 2026 · Hạng mục A — Pipeline xử lý đơn hàng tự động

---

## Tổng quan

Repository này chứa toàn bộ source code cho giải pháp phân tích dữ liệu kinh doanh của **Công ty Cổ phần Xe đạp Thống Nhất**, bao gồm:

- **Hạng mục A** — Pipeline tự động xử lý 1.132 email đặt hàng tháng 3/2026
- **Hạng mục B** — Dashboard phân tích kinh doanh đa chiều *(đang phát triển)*
- **Hạng mục C** — Mô hình dự báo nhu cầu Q2/2026 *(đang phát triển)*

---

## Kết quả Hạng mục A

| Chỉ số | Giá trị |
|--------|---------|
| Pass rate | **100%** (1132/1132 đơn) |
| Doanh thu T3/2026 | **40.8 tỷ đồng** |
| Đơn hàng load vào DB | **1.132 đơn** |
| Dòng sản phẩm | **8.723 dòng** |
| Đại lý mới phát sinh | **96 đại lý** |
| SKU mới phát sinh | **18 SKU** |
| deep_validate 1132/1132 | **0 lỗi** |

---

## Cấu trúc project

```
phase_a/
├── src/
│   ├── config.py           # DB connection, biến môi trường
│   ├── extract_email.py    # Stage 1: parse .eml, tách PDF
│   ├── extract_pdf.py      # Stage 2: trích xuất nội dung PDF
│   ├── validate.py         # Stage 3: kiểm tra hợp lệ dữ liệu
│   ├── load_db.py          # Stage 4: insert sales_order + order_line
│   ├── refresh_fact.py     # Stage 5: refresh bảng fact_sales
│   └── run_pipeline.py     # Orchestrator chạy toàn bộ pipeline
│
├── sql/
│   ├── 00_email_log_table.sql   # DDL bảng email_log (bổ sung)
│   ├── verify_after_import.sql  # Queries kiểm tra sau import
│   └── refresh_fact_sales.sql   # SQL refresh fact_sales
│
├── data/
│   └── eml/               # Đặt 1.132 file .eml vào đây
│
├── staging/               # Tự động sinh ra khi chạy pipeline
│   ├── pdf/               # PDF tách từ email
│   ├── extracted.jsonl    # Dữ liệu đã extract
│   └── errors.csv         # Đơn lỗi (nếu có)
│
├── smoke_test.py          # Test parser PDF nhanh
├── crosscheck.py          # Kiểm tra email ↔ DB khớp nhau
├── deep_validate.py       # Validate field-by-field PDF vs DB
├── final_audit.py         # Bộ 10 checks tổng hợp
├── requirements.txt
└── .env.example
```

---

## Yêu cầu hệ thống

- Python **3.10+**
- PostgreSQL **14+**
- Database `tnbike_db` đã được khởi tạo với schema từ `01_create_tables.sql` và import dữ liệu lịch sử từ `02_import_data.sql`

---

## Cài đặt

### 1. Clone repo và tạo môi trường ảo

```bash
git clone https://github.com/nichikei/data-explorers.git
cd data-explorers/phase_a

python -m venv venv

# Windows
venv\Scripts\activate

# Linux / Mac
source venv/bin/activate

pip install -r requirements.txt
```

### 2. Cấu hình biến môi trường

```bash
cp .env.example .env
```

Mở `.env` và điền thông tin:

```env
PG_HOST=localhost
PG_PORT=5432
PG_DB=tnbike_db
PG_USER=postgres
PG_PASSWORD=your_password   # ← đổi dòng này

EML_DIR=./data/eml/
PDF_OUT_DIR=./staging/pdf/
EXTRACTED_JSONL=./staging/extracted.jsonl
ERRORS_CSV=./staging/errors.csv

TOTAL_TOLERANCE=200
BATCH_FISCAL_YEAR=2026
```

### 3. Tạo bảng email_log

```bash
psql -U postgres -d tnbike_db -f sql/00_email_log_table.sql
```

### 4. Đặt dữ liệu đầu vào

```bash
# Copy 1.132 file .eml vào thư mục data/eml/
cp /path/to/eml_files/*.eml data/eml/

# Kiểm tra đủ số lượng
ls data/eml/ | wc -l   # phải ra 1132
```

---

## Chạy pipeline

### Chạy toàn bộ (khuyến nghị)

```bash
python src/run_pipeline.py
```

Thời gian ước tính: **4–6 phút**. Pipeline sẽ in log từng stage:

```
[STAGE 1] Parsing 1132 .eml files...    ✓ OK=1132
[STAGE 2] Extracting PDFs...            ✓ OK=1132
[STAGE 3] Validating...                 ✓ VALIDATED=1132
[STAGE 4] Loading to DB...              ✓ LOADED=1132
[STAGE 5] Refreshing fact_sales...      ✓ inserted 8723 rows
pass_rate_pct: 100.00
```

### Chạy từng stage riêng lẻ

```bash
python src/extract_email.py   # Stage 1
python src/extract_pdf.py     # Stage 2
python src/validate.py        # Stage 3
python src/load_db.py         # Stage 4
python src/refresh_fact.py    # Stage 5
```

### Reset và chạy lại từ đầu

```bash
psql -U postgres -d tnbike_db -c "
  SET search_path TO tnbike, public;
  DELETE FROM fact_sales WHERE fiscal_year=2026 AND fiscal_month=3;
  DELETE FROM order_line WHERE so_number LIKE 'BH26.%';
  DELETE FROM sales_order WHERE so_number LIKE 'BH26.%';
  DELETE FROM email_log;
  DELETE FROM customer WHERE customer_code > 'KH-00702';
"
rm -f staging/extracted.jsonl staging/errors.csv
python src/run_pipeline.py
```

---

## Kiểm tra và validation

### Test parser PDF nhanh (không cần DB)

```bash
python smoke_test.py staging/pdf/BH26_0935.pdf
```

### Verify dữ liệu sau khi import

```bash
psql -U postgres -d tnbike_db -f sql/verify_after_import.sql
```

### Cross-check email body ↔ DB (MST + tổng tiền)

```bash
python crosscheck.py
# Expected: OK: 1132, Mismatch: 0
```

### Deep validate — so sánh PDF gốc vs DB field-by-field

```bash
python deep_validate.py
# Expected: OK: 1132/1132, FAIL: 0/1132
```

### Final audit — 10 checks tổng hợp

```bash
python final_audit.py
# Expected: OK: 9, WARN: 1, FAIL: 0
```

---

## Kiến trúc pipeline

```
1.132 .eml
    │
    ▼
[STAGE 1] extract_email.py
Parse email header (From, Subject, Date, Message-ID)
Tách file PDF đính kèm từ MIME structure
→ Lưu PDF vào staging/pdf/
→ Ghi email_log (status: PENDING)
    │
    ▼
[STAGE 2] extract_pdf.py
Đọc PDF bằng pdfplumber
Trích xuất: so_number, order_date, MST đại lý, bảng sản phẩm, footer total
→ Lưu staging/extracted.jsonl
→ Cập nhật email_log (status: EXTRACTED)
    │
    ▼
[STAGE 3] validate.py
V1: so_number hợp lệ
V2: order_date trong T3/2026
V3: product_code tồn tại trong DB (auto-insert SKU mới)
V4: quantity > 0, unit_price >= 0
V5: line_total ≈ qty × price (tolerance 200 VND)
V6: footer warning only
V7: chống trùng so_number
→ Cập nhật email_log (status: VALIDATED / FAILED)
    │
    ▼
[STAGE 4] load_db.py
Resolve customer (MST exact → tạo mới nếu chưa có)
INSERT sales_order
INSERT order_line
Trigger tự động cập nhật total_amount
→ Cập nhật email_log (status: LOADED)
    │
    ▼
[STAGE 5] refresh_fact.py
INSERT INTO fact_sales (denormalized) từ order_line mới
→ fact_sales sẵn sàng cho dashboard và dự báo
```

---

## Các vấn đề kỹ thuật đã xử lý

**Font PDF vỡ chữ** — PDF dùng font đặc biệt khiến tiếng Việt render thành ký tự `■`. Giải pháp: viết regex linh hoạt match partial pattern thay vì exact string.

**Mã hàng nhiều format** — 4 format khác nhau: số thuần (`000219002001000`), chữ+số (`TP0099.0000571`), số+dấu chấm nhiều tầng (`156.01.12.0003`), chữ+số+dấu chấm nhiều tầng (`TP0017.06.27.04`). Giải pháp: regex union 3 pattern, cẩn thận không nhầm với giá tiền VN (`1.100.000`).

**SKU mới T3/2026** — Một số mã hàng chưa có trong DB lịch sử. Giải pháp: validate.py tự động INSERT SKU mới với tên placeholder thay vì fail đơn.

**Customer resolver fuzzy match sai** — Ban đầu fuzzy match theo tên dù đã có MST, dẫn đến ghép nhầm 169 đơn sang công ty khác. Giải pháp: chỉ fuzzy match khi PDF không đọc được MST; nếu có MST mà không tìm thấy trong DB thì tạo mới.

**Làm tròn đơn giá** — PDF hiển thị đơn giá đã làm tròn, gây lệch tối đa ~200 VND khi tính lại. Giải pháp: nới `TOTAL_TOLERANCE = 200`.

---

## Thành viên nhóm

| Tên | Vai trò |
|-----|---------|
|  |  |
|  |  |
|  |  |

---

## License

Internal · Data Explorers 2026 · Học viện Chính sách và Phát triển