# Data Explorers 2026 — Thống Nhất Bike

> **From Data to Decision by MEXC Ventures** · Vòng 2 · Hạng mục A — Pipeline xử lý đơn hàng tự động (25đ)

---

## Kết quả Hạng mục A

| Chỉ số | Giá trị |
|---|---|
| Email xử lý thành công | **1.132 / 1.132 (100%)** |
| Doanh thu T3/2026 đã load | **40,804,047,133 đồng** |
| Đơn hàng ghi vào DB | **1.132 đơn** (BH26.0935 → BH26.2066) |
| Dòng sản phẩm ghi vào DB | **8.723 dòng** |
| Đại lý mới phát sinh T3/2026 | **96 đại lý** (KH-00703 → KH-00798) |
| SKU mới phát sinh T3/2026 | **18 SKU** |
| Sai số học order_line | **0** |
| Chênh lệch fact_sales vs order_line | **0 đồng** |

---

## Yêu cầu hệ thống

| Thành phần | Phiên bản |
|---|---|
| Python | 3.10+ |
| PostgreSQL | 14+ |
| Database | `tnbike_db` (đã có schema + dữ liệu lịch sử BH25 + BH26.0001–0934) |

---

## Cài đặt

```powershell
git clone https://github.com/PhamNhatKhanhs/data-explorers.git
cd data-explorers/phase_a

# Tạo virtual environment và cài thư viện
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

**Tạo file `.env`** từ template:

```powershell
copy .env.example .env
notepad .env
# Sửa dòng: PG_PASSWORD=<mật_khẩu_postgres_của_bạn>
```

**Tạo bảng `email_log`** (chạy 1 lần):

```powershell
psql -U postgres -d tnbike_db -f sql\00_email_log_table.sql
```

**Đặt file .eml vào thư mục input:**

```powershell
# Copy 1.132 file .eml vào:
data\eml\
```

---

## Chạy pipeline

```powershell
venv\Scripts\activate
python src\run_pipeline.py
```

Thời gian ước tính: **4–6 phút**. Output mong đợi:

```
[STAGE 1] Parsing 1132 .eml files...          OK=1132  SKIP=0
[STAGE 2] Extracting PDF content...           OK=1132  FAIL=0
[STAGE 3] Validating...                       VALIDATED=1132  FAILED=0
[STAGE 4] Loading to database...              LOADED=1132
[STAGE 5] Refreshing fact_sales...            inserted 8723 rows
pass_rate_pct: 100.00
```

### Reset và chạy lại từ đầu

```powershell
psql -U postgres -d tnbike_db -c "
  SET search_path TO tnbike,public;
  DELETE FROM fact_sales  WHERE fiscal_year=2026 AND fiscal_month=3;
  DELETE FROM order_line  WHERE so_number LIKE 'BH26.%';
  DELETE FROM sales_order WHERE so_number LIKE 'BH26.%';
  DELETE FROM email_log;
  DELETE FROM customer    WHERE customer_code > 'KH-00702';
  DELETE FROM product     WHERE created_at >= '2026-03-01';
"

del staging\extracted.jsonl
python src\run_pipeline.py
```

---

## Kiểm tra và xác nhận kết quả

### 1. Smoke test — Parser PDF nhanh (không cần DB)

```powershell
python smoke_test.py staging\pdf\BH26_0935.pdf
```

### 2. Cross-check — Email body vs DB (MST + tổng tiền)

```powershell
python crosscheck.py
# Expected: OK: 1132, Mismatch: 0
```

### 3. Deep validate — So sánh PDF gốc vs DB field-by-field

```powershell
python deep_validate.py
# Expected: PASS: 1132/1132, FAIL: 0/1132
```

### 4. Audit pipeline — 10 checks tổng hợp

```powershell
python audit_pipeline.py
# Expected: PASS 9/10, WARN 1/10 (avg_processing_seconds — xem ghi chú bên dưới)
```

### 5. Integrity check — 21 checks hai chiều (EML/PDF → DB → Excel)

```powershell
python integrity_check.py
# Expected: PASS: 21/21
```

### 6. Export dữ liệu ra Excel + CSV

```powershell
python export_tnbike.py
# Tạo ra: tnbike_export_YYYYMMDD.xlsx (10 sheet) + csv/*.csv
```

---

## Sửa lỗi chất lượng dữ liệu (chạy sau pipeline)

### Fix font tiếng Việt + làm tròn đơn giá

```powershell
python fix_data.py
```

Sửa 2 vấn đề:
- **18 sản phẩm** tên bị vỡ font do PDF dùng custom encoding (ký tự dấu → `n`)
- **16 dòng** `order_line.unit_price` lưu nguyên (int) thay vì thập phân

### Fix color và line_id cho SKU mới

```powershell
python fix_product_color.py
```

Điền `color` và `line_id` cho 18 SKU T3/2026: 8 SKU fix được từ tên + sibling, 10 SKU mã TP không có thông tin màu.

---

## Cấu trúc project

```
phase_a/
│
├── src/                        # Core pipeline modules
│   ├── config.py               # Kết nối DB từ .env
│   ├── extract_email.py        # Stage 1 — Parse .eml, tách PDF đính kèm
│   ├── extract_pdf.py          # Stage 2 — Trích xuất nội dung PDF → extracted.jsonl
│   ├── validate.py             # Stage 3 — Kiểm tra hợp lệ, auto-insert SKU mới
│   ├── load_db.py              # Stage 4 — Insert sales_order + order_line
│   ├── refresh_fact.py         # Stage 5 — Refresh bảng fact_sales (idempotent)
│   └── run_pipeline.py         # Orchestrator — chạy Stage 1–5 tuần tự
│
├── sql/
│   ├── 00_email_log_table.sql  # Tạo bảng email_log (chạy 1 lần trước pipeline)
│   ├── verify_after_import.sql # Kiểm tra nhanh sau import
│   └── 99_refresh_fact_sales.sql # SQL refresh fact_sales thủ công
│
├── smoke_test.py               # Test parser PDF đơn lẻ
├── crosscheck.py               # Cross-check email body vs DB
├── deep_validate.py            # Validate field-by-field PDF vs DB
├── final_audit.py              # Audit 9 checks sau pipeline
├── audit_pipeline.py           # 10 checks tổng hợp chất lượng dữ liệu
├── integrity_check.py          # 21 checks hai chiều EML/PDF → DB → Excel
├── fix_data.py                 # Fix font vỡ + làm tròn unit_price
├── fix_product_color.py        # Fill color + line_id cho 18 SKU mới
├── export_tnbike.py            # Export tất cả bảng → Excel + CSV
├── csv_to_excel.py             # Gộp CSV thành 1 file Excel
│
├── data/eml/                   # ← Đặt 1.132 file .eml vào đây
├── staging/                    # Auto-generated khi chạy pipeline
│   ├── extracted.jsonl         # Output Stage 2
│   ├── pdf/                    # PDF tách từ .eml
│   └── errors.csv              # Các dòng bị lỗi validate
│
├── requirements.txt
├── .env.example
├── setup.ps1
└── README.md
```

---

## Kiến trúc pipeline

```
1.132 file .eml
       │
       ▼  Stage 1 — extract_email.py
  Parse MIME header (From/Subject/Date)
  Tách file PDF đính kèm → staging/pdf/
  Ghi email_log: PENDING
       │
       ▼  Stage 2 — extract_pdf.py
  pdfplumber đọc PDF: so_number, order_date
  MST khách hàng, bảng sản phẩm, footer tổng
  Output: staging/extracted.jsonl
  email_log: EXTRACTED
       │
       ▼  Stage 3 — validate.py
  V1 so_number format   V2 ngày hợp lệ
  V3 SKU tồn tại        V4 qty/price > 0
  V5 line_total ±200đ   V6 footer khớp tổng
  V7 chống trùng lặp    V8 auto-insert SKU mới
  email_log: VALIDATED / FAILED
       │
       ▼  Stage 4 — load_db.py
  Resolve customer theo MST (fuzzy fallback)
  INSERT sales_order + order_line
  Trigger tự động tính total_amount
  email_log: LOADED
       │
       ▼  Stage 5 — refresh_fact.py
  INSERT INTO fact_sales (idempotent)
  JOIN: order_line × sales_order × customer
        × product × product_line × product_group × province
  → Bảng flat sẵn sàng cho dashboard & ML
```

---

## Schema database

### Dimension tables

| Bảng | Rows | Mô tả |
|---|---|---|
| `product_group` | 5 | Nhóm SP: CITYBIKE_P, KIDBIKE_1, KIDBIKE_2, SPORTBIKE_S, SPORTBIKE_A |
| `product_line` | 77 | Dòng xe: GN 06-27, New 26, MTB 20-04... |
| `product` | 265 | SKU: mã + tên + màu + line_id |
| `product_price` | 1.016 | Lịch sử giá list theo thời kỳ |
| `province` | 75 | Tỉnh/thành phố + vùng (Miền Bắc/Trung/Nam) |
| `customer` | 798 | Đại lý: mã KH, tên, MST, địa chỉ, tỉnh |

### Fact / Transaction tables

| Bảng | Rows | Mô tả |
|---|---|---|
| `sales_order` | 1.825 | Đầu phiếu (BH25 + BH26.0935–2066) |
| `order_line` | 16.138 | Chi tiết dòng hàng hóa |
| `fact_sales` | 25.754 | Flat denormalized — dùng cho analytics |
| `email_log` | 1.132 | Log pipeline từng email |

### Phân bổ dữ liệu trong fact_sales

| Nhóm | Đơn hàng | Dòng | Doanh thu |
|---|---|---|---|
| BH25 (lịch sử 2025) | 693 | 7.415 | 28,1 tỷ đ |
| BH26.0001–0934 (lịch sử Jan-Feb 2026) | 934 | 9.616 | 40,5 tỷ đ |
| BH26.0935–2066 (T3/2026 — pipeline) | 1.132 | 8.723 | 40,8 tỷ đ |
| **Tổng** | **2.759** | **25.754** | **~109,4 tỷ đ** |

> **Lưu ý:** BH26.0001–0934 (Jan-Feb 2026) là dữ liệu lịch sử được load trực tiếp vào `fact_sales` (không qua pipeline). Bảng `sales_order` và `order_line` chỉ chứa BH25 và BH26.0935+. Khi query analytics toàn bộ 2025–2026, sử dụng `fact_sales`.

---

## Các vấn đề kỹ thuật đã xử lý

| Vấn đề | Nguyên nhân gốc | Giải pháp |
|---|---|---|
| Font PDF vỡ chữ tiếng Việt | PDF custom encoding: ký tự dấu → `n` | Word-level regex substitution map + manual dict cho 6 tên phức tạp |
| Đơn giá lưu sai (int thay vì float) | Giá lẻ như 2.129.629,63đ bị cắt phần thập phân | `unit_price = ROUND(line_total / quantity, 6)` |
| Mã hàng 4 format khác nhau | Không nhất quán trong PDF nguồn | Regex union 4 pattern, phân biệt với số tiền VND |
| SKU mới chưa có trong DB | 18 sản phẩm T3/2026 chưa tồn tại | Auto-INSERT placeholder → đơn không bị reject |
| Customer fuzzy match sai | Tên đại lý viết khác nhau giữa DB và PDF | MST → tra cứu chính xác; không có MST → fuzzy; mới hoàn toàn → tạo mới |
| Tolerance tổng tiền ±200đ | Làm tròn VND trong PDF | `TOTAL_TOLERANCE = 200` trong validate |

---

## Ghi chú

**`avg_processing_seconds ≈ 4.180.751s` (~48 ngày) trong `v_email_processing_kpi`:**
Giá trị này đúng về mặt SQL — tính `AVG(processed_at − received_at)` per email. Cao vì email nhận tháng 3/2026 nhưng pipeline chạy tháng 5/2026. Đây là delay thực tế, không phải lỗi tính toán.

---

## Thành viên nhóm

| Tên | Vai trò |
|---|---|
| | |
| | |
| | |

---

*Data Explorers 2026 · Học viện Chính sách và Phát triển*
