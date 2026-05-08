# TNBIKE PROJECT — Context for Claude Code

## 1. Tổng quan dự án

**Cuộc thi:** Data Explorers 2026 — Vòng 2 "From Data to Decision by MEXC Ventures"
**Doanh nghiệp:** Công ty Cổ phần Xe đạp Thống Nhất (Thống Nhất Bike)
**Mô hình:** B2B — bán buôn xe đạp cho đại lý trên toàn quốc
**Mục tiêu:** Xây dựng hệ thống phân tích dữ liệu gồm pipeline xử lý đơn hàng, dashboard, mô hình dự báo

---

## 2. Database

| Thông số | Giá trị |
|---|---|
| Engine | PostgreSQL 14+ |
| Database | tnbike_db |
| Schema | tnbike |
| Phạm vi dữ liệu | 02/01/2025 – 28/02/2026 (lịch sử) + T3/2026 (từ email/PDF) |
| Quy mô | 17.031 dòng giao dịch, 702 đại lý, 247 SKU |

### Kết nối mẫu (Python)
```python
import psycopg2, pandas as pd

conn = psycopg2.connect(
    host='localhost', port=5432,
    dbname='tnbike_db', user='postgres', password='your_password'
)
```

---

## 3. Schema — Danh sách bảng

### Dimension tables
| Bảng | Rows | Mô tả |
|---|---|---|
| `product_group` | 5 | Nhóm SP cấp 1: CITYBIKE_P, KIDBIKE_1, KIDBIKE_2, SPORTBIKE_S, SPORTBIKE_A |
| `product_line` | 77 | Dòng xe cấp 3: GN 06-27, New 26, MTB 20-04... |
| `product` | 247 | SKU: mã hàng + tên + màu sắc |
| `product_price` | 1.016 | Lịch sử giá list theo thời kỳ |
| `province` | 75 | Tỉnh/thành phố + vùng (Miền Bắc / Trung / Nam) |
| `customer` | 702 | Đại lý: mã KH, tên, MST, địa chỉ, tỉnh |

### Fact tables
| Bảng | Rows | Mô tả |
|---|---|---|
| `sales_order` | 1.627 | Đầu phiếu bán hàng (1 phiếu = 1 khách hàng) |
| `order_line` | 17.031 | Dòng hàng hóa: SKU × qty × đơn giá |
| `fact_sales` | 17.031 | Bảng flat denormalized — dùng cho analytics/ML |

### Views
| View | Mô tả |
|---|---|
| `v_monthly_by_group` | Doanh số tháng × nhóm SP cấp 1 |
| `v_customer_period` | Tổng hợp đại lý theo quý (RFM base) |
| `v_sku_monthly` | Doanh số SKU × màu × tháng |
| `v_customer_activity` | Hoạt động tổng hợp đại lý + days_since_last_order |

---

## 4. Chi tiết cột quan trọng

### fact_sales (bảng chính cho mọi query analytics)
```
order_date, fiscal_year, fiscal_quarter, fiscal_month, week_of_year
so_number, order_id, line_id
customer_code, customer_name, province_id, province_name, region
product_code, product_name, color, line_id_fk, line_name, group_code, group_name
quantity, unit_price, line_total   ← 3 measure chính
```

### sales_order
```
order_id (PK), so_number (UNIQUE: BH25.xxxx / BH26.xxxx)
invoice_symbol (C25TTN / C26TTN), invoice_number
order_date, customer_code
total_amount, total_quantity, line_count   ← auto-update qua trigger
fiscal_year, fiscal_month, fiscal_quarter  ← computed columns
```

### order_line
```
line_id (PK), order_id (FK), so_number (denormalized)
product_code (FK), quantity, unit_price, line_total
```

### customer
```
customer_code (PK: KH-00001 → KH-00702)
customer_name, tax_code, address, province_id
customer_tier (STANDARD / KEY / VIP — hiện tất cả STANDARD, cần RFM để update)
is_active
```

### product
```
product_code (PK: dạng 000214004000000)
product_name, line_id (FK, NULL = chưa map), color, unit, is_active
```
> Lưu ý: 72/247 SKU có line_id = NULL

### product_price
```
product_code, unit_price, effective_from, effective_to (NULL = đang áp dụng)
```
> Lưu ý: unit_price trong order_line là giá thực tế giao dịch, có thể khác product_price (do chiết khấu)

---

## 5. Quan hệ bảng (ERD tóm tắt)

```
product_group (1) ──< (N) product_line (1) ──< (N) product
                                                      │
                                               product_price

province (1) ──< (N) customer (1) ──< (N) sales_order (1) ──< (N) order_line
                                                                        │
                                                                    product

fact_sales ← JOIN của: order_line × sales_order × customer × product × product_line × product_group × province
```

---

## 6. Cấu trúc dữ liệu nguồn (Bộ 2 — Email + PDF T3/2026)

**Quy mô:** 1.132 file .eml + 1.132 file .pdf (đơn đặt hàng tháng 3/2026)

### Cấu trúc file PDF đơn hàng
```
Header: Số đơn hàng (BH26.xxxx), Ngày, Tên đại lý, MST, Địa chỉ
Bảng:   STT | Mã hàng | Tên sản phẩm | ĐVT | SL | Đơn giá | Thành tiền
Footer: Tổng giá trị (chưa VAT)
```

### Cấu trúc file .eml
```
From:    email đại lý
To:      Thống Nhất
Subject: số đơn hàng
Date:    ngày gửi
Body:    thông tin đại lý, tổng đơn, yêu cầu giao hàng
Attachment: 1 file PDF
```

### Ví dụ đơn hàng thực tế (từ PDF mẫu)
```
BH26.0935 | 01/03/2026 | Công ty TNHH TM Long Phú | MST: 167397253
  → 000104002009000 | Xe đạp TN Tom & Jerry 14 Hồng | 1 chiếc | 1.898.148đ

BH26.0936 | 01/03/2026 | Công ty TNHH TM Long Phú | MST: 167397253
  → 000230002013000 | Xe đạp TN LD 26 Pastel Xanh | 1 chiếc | 2.861.111đ

BH26.0938 | 01/03/2026 | Công ty Cổ phần Nam Tiến | MST: 111014028
  → 000331002008000 | Xe đạp TN MTB 26-02 Ghi | 1 chiếc | 2.953.704đ
```

---

## 7. Yêu cầu kỹ thuật — 4 hạng mục thi

### Hạng mục A — Xử lý đơn hàng tự động (25đ)
- Pipeline đọc 1.132 email (.eml) → tách PDF đính kèm → trích xuất dữ liệu
- Ghi vào: `email_log` (tạo mới), `sales_order`, `order_line`
- Cập nhật `fact_sales` sau khi import xong
- Bảng `email_log` cần tạo thêm: `message_id, from_address, received_at, attachment_name, processing_status`

### Hạng mục B — Dashboard & Insights (30đ)
6 màn hình bắt buộc:
1. Tổng quan KPI (doanh số, đơn hàng, SL bán, đại lý hoạt động)
2. Phân tích thời gian (trend tháng, YoY, mùa vụ)
3. Phân tích sản phẩm (3 cấp drill-down, BCG matrix, heatmap màu sắc)
4. Phân tích đại lý (RFM scatter, top/bottom dealers, churn signal)
5. Phân tích địa lý (map hoặc treemap theo tỉnh/vùng)
6. Trạng thái vận hành (pipeline T3/2026: đã xử lý / lỗi / chờ)

Cần ≥ 5 business insights theo format: Phát hiện → Ý nghĩa → Khuyến nghị

### Hạng mục C — Dự báo nhu cầu (30đ)
- **Câu hỏi 1:** Dự báo doanh số Q2/2026 theo tháng, theo 5 nhóm SP, top 20 SKU
- **Câu hỏi 2:** Dự báo màu sắc ưa chuộng, cơ cấu màu Q2/2026, SKU bán chậm
- **Câu hỏi 3:** Xác suất đại lý đặt hàng 30 ngày tới, danh sách nguy cơ churn
- Bonus: tích hợp LLM để trả lời câu hỏi phân tích

### Hạng mục D — Trình bày & Bảo vệ (15đ)
- Demo live 10 phút + Q&A 10 phút

---

## 8. Lịch trình

| Mốc | Thời gian |
|---|---|
| Nhận đề + dữ liệu | 28/4/2026 |
| Nộp sản phẩm hoàn chỉnh | 28/5/2026 |
| Chung kết + trao giải | 04/6/2026 |

---

## 9. Nộp bài

| # | Hạng mục | Yêu cầu |
|---|---|---|
| 1 | GitHub repo | Public, có README hướng dẫn cài đặt + chạy |
| 2 | Báo cáo kỹ thuật | PDF, 10–15 trang |
| 3 | Slide | 10–15 slides |
| 4 | Video tóm tắt | 5–7 phút |

---

## 10. Ghi chú kỹ thuật quan trọng

- `so_number` format: `BH25.XXXX` (2025) và `BH26.XXXX` (2026)
- `invoice_symbol`: `C25TTN` / `C26TTN`
- `customer_tier` hiện toàn bộ là STANDARD — cần chạy RFM rồi UPDATE
- `fact_sales` là bảng ưu tiên cho mọi query analytics (tránh JOIN nhiều bảng)
- Trigger `trg_order_line_after_insert` tự động update `total_amount`, `total_quantity`, `line_count` trên `sales_order`
- `order_line.unit_price` ≠ `product_price.unit_price` (giá thực tế vs giá list)
- 72/247 SKU có `line_id = NULL` — vẫn có đầy đủ dữ liệu giao dịch
