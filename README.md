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

## Yêu cầu hệ thống

- Python **3.10+**
- PostgreSQL **14+**
- Database `tnbike_db` đã được khởi tạo với `01_create_tables.sql` và import dữ liệu lịch sử từ `02_import_data.sql`

---

## Cài đặt nhanh (sau khi clone)

```powershell
git clone https://github.com/nichikei/data-explorers.git
cd data-explorers/phase_a

# Chạy script setup tự động
.\setup.ps1
```

Script `setup.ps1` sẽ tự động:
- Tạo đủ các thư mục cần thiết (`staging/`, `staging/pdf/`, `data/eml/`, `logs/`)
- Tạo file `.env` từ `.env.example`
- Tạo virtual environment
- Cài đặt toàn bộ thư viện từ `requirements.txt`
- In hướng dẫn các bước tiếp theo

Sau khi script chạy xong, thực hiện thêm **3 bước thủ công**:

**Bước 1 — Điền password PostgreSQL:**
```powershell
notepad .env
# Sửa dòng: PG_PASSWORD=your_password
```

**Bước 2 — Tạo bảng email_log:**
```powershell
psql -U postgres -d tnbike_db -f sql\00_email_log_table.sql
```

**Bước 3 — Copy dữ liệu đầu vào:**
```powershell
copy C:\path\to\eml_files\*.eml data\eml\
(Get-ChildItem data\eml\*.eml).Count   # phải ra 1132
```

---

## Chạy pipeline

```powershell
venv\Scripts\activate
python src\run_pipeline.py
```

Thời gian ước tính: **4–6 phút**. Output mong đợi:

```
[STAGE 1] Parsing 1132 .eml files...    OK=1132
[STAGE 2] Extracting PDFs...            OK=1132
[STAGE 3] Validating...                 VALIDATED=1132
[STAGE 4] Loading to DB...              LOADED=1132
[STAGE 5] Refreshing fact_sales...      inserted 8723 rows
pass_rate_pct: 100.00
```

### Reset và chạy lại từ đầu

```powershell
psql -U postgres -d tnbike_db -c "SET search_path TO tnbike,public; DELETE FROM fact_sales WHERE fiscal_year=2026 AND fiscal_month=3; DELETE FROM order_line WHERE so_number LIKE 'BH26.%'; DELETE FROM sales_order WHERE so_number LIKE 'BH26.%'; DELETE FROM email_log; DELETE FROM customer WHERE customer_code > 'KH-00702';"

del staging\extracted.jsonl
del staging\errors.csv
python src\run_pipeline.py
```

---

## Kiểm tra và validation

```powershell
# Test parser PDF nhanh (không cần DB)
python smoke_test.py staging\pdf\BH26_0935.pdf

# Verify dữ liệu sau import
psql -U postgres -d tnbike_db -f sql\verify_after_import.sql

# Cross-check email body vs DB (MST + tổng tiền)
python crosscheck.py
# Expected: OK: 1132, Mismatch: 0

# Deep validate — so sánh PDF gốc vs DB field-by-field
python deep_validate.py
# Expected: OK: 1132/1132, FAIL: 0/1132

# Final audit — 10 checks tổng hợp
python final_audit.py
# Expected: OK: 9, WARN: 1, FAIL: 0
```

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
├── sql/
│   ├── 00_email_log_table.sql
│   ├── verify_after_import.sql
│   └── refresh_fact_sales.sql
├── data/eml/               # ← Đặt 1.132 file .eml vào đây
├── staging/                # Auto-generated khi chạy pipeline
├── smoke_test.py
├── crosscheck.py
├── deep_validate.py
├── final_audit.py
├── setup.ps1               # Script setup tự động (Windows)
├── requirements.txt
├── .env.example
└── README.md
```

---

## Kiến trúc pipeline

```
1.132 .eml
    │
    ▼ Stage 1 — extract_email.py
    Parse header, tách PDF từ MIME → staging/pdf/
    email_log: PENDING
    │
    ▼ Stage 2 — extract_pdf.py
    pdfplumber: so_number, order_date, MST, bảng SP, footer
    → staging/extracted.jsonl | email_log: EXTRACTED
    │
    ▼ Stage 3 — validate.py
    V1 so_number · V2 ngày · V3 SKU (auto-insert mới) 
    V4 qty/price · V5 line_total ±200đ · V7 chống trùng
    email_log: VALIDATED / FAILED
    │
    ▼ Stage 4 — load_db.py
    Resolve customer theo MST → INSERT sales_order + order_line
    Trigger auto-fill total_amount | email_log: LOADED
    │
    ▼ Stage 5 — refresh_fact.py
    INSERT fact_sales (denormalized) → sẵn sàng cho dashboard
```

---

## Các vấn đề kỹ thuật đã xử lý

| Vấn đề | Giải pháp |
|--------|-----------|
| Font PDF vỡ chữ tiếng Việt (■) | Regex match partial pattern, không exact string |
| Mã hàng 4 format khác nhau | Regex union 3 pattern, phân biệt với số tiền VN |
| SKU mới chưa có trong DB | Auto-INSERT placeholder thay vì fail đơn |
| Customer resolver fuzzy match sai | Chỉ fuzzy khi không có MST; có MST → tạo mới |
| Sai lệch làm tròn đơn giá (~200 VND) | TOTAL_TOLERANCE = 200 |

---

## Thành viên nhóm

| Tên | Vai trò |
|-----|---------|
| | |
| | |
| | |

---

*Data Explorers 2026 · Học viện Chính sách và Phát triển*