# TNBIKE PROJECT — CLAUDE.md
> File này chứa toàn bộ context dự án Data Explorers 2026 — Vòng 2.
> Claude Code / Claude Chat đọc file này trước khi làm bất kỳ việc gì liên quan đến project.

---

## 1. TỔNG QUAN DỰ ÁN

| Thông tin | Chi tiết |
|---|---|
| Cuộc thi | Data Explorers 2026 — Vòng 2: "From Data to Decision by MEXC Ventures" |
| Tổ chức | APD, Đại học Thương mại, Học viện Tài chính, iNDA Insight Data |
| Doanh nghiệp | Công ty Cổ phần Xe đạp Thống Nhất (Thống Nhất Bike) |
| Mô hình | B2B — bán buôn xe đạp qua mạng lưới đại lý toàn quốc |
| Phát hành đề | 28/4/2026 |
| Deadline nộp bài | 28/5/2026 |
| Chung kết | 04/6/2026 tại Học viện Chính sách và Phát triển |
| Tổng điểm | 100 điểm (A: 25đ · B: 30đ · C: 30đ · D: 15đ) |

### Mục tiêu hệ thống cần xây dựng
1. Pipeline tự động xử lý đơn hàng từ email/PDF
2. Dashboard phân tích kinh doanh đa chiều
3. Mô hình dự báo nhu cầu Q2/2026
4. Báo cáo insights + đề xuất chiến lược

---

## 2. DATABASE

### Thông tin kết nối
```
Engine   : PostgreSQL 14+
Host     : localhost
Port     : 5432
Database : tnbike_db
Schema   : tnbike
User     : postgres
Password : (tuỳ môi trường)
```

### Kết nối Python
```python
import psycopg2
import pandas as pd

conn = psycopg2.connect(
    host='localhost', port=5432,
    dbname='tnbike_db', user='postgres', password='your_password'
)

# Đọc bảng analytics chính
df = pd.read_sql("SELECT * FROM tnbike.fact_sales", conn)
```

### Quy mô dữ liệu
| Bảng | Số dòng |
|---|---|
| product_group | 5 |
| product_line | 77 |
| product | 247 |
| product_price | 1.016 |
| province | 75 |
| customer | 702 |
| sales_order | 1.627 |
| order_line | 17.031 |
| fact_sales | 17.031 |

---

## 3. DDL — FULL SCHEMA

### 3.1 product_group
```sql
CREATE TABLE product_group (
    group_code  VARCHAR(30)  PRIMARY KEY,
    group_name  VARCHAR(100) NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ  DEFAULT NOW()
);
```
**5 giá trị cố định:**
| group_code | group_name |
|---|---|
| CITYBIKE_P | Xe phổ thông |
| KIDBIKE_1 | Xe trẻ em nhóm 1 |
| KIDBIKE_2 | Xe trẻ em nhóm 2 |
| SPORTBIKE_S | Xe thể thao S |
| SPORTBIKE_A | Xe thể thao A |

---

### 3.2 product_line
```sql
CREATE TABLE product_line (
    line_id    SERIAL       PRIMARY KEY,
    line_name  VARCHAR(100) NOT NULL,
    group_code VARCHAR(30)  NOT NULL REFERENCES product_group(group_code),
    created_at TIMESTAMPTZ  DEFAULT NOW(),
    UNIQUE (line_name, group_code)
);
CREATE INDEX idx_product_line_group ON product_line(group_code);
```
- 77 dòng xe, mỗi dòng thuộc 1 nhóm cấp 1
- Ví dụ: `Xe GN 06-27` → CITYBIKE_P, `Xe MTB 20-04` → SPORTBIKE_S

---

### 3.3 product
```sql
CREATE TABLE product (
    product_code VARCHAR(20)  PRIMARY KEY,
    product_name VARCHAR(200) NOT NULL,
    line_id      INTEGER      REFERENCES product_line(line_id),
    color        VARCHAR(60),
    unit         VARCHAR(20)  DEFAULT 'Chiếc',
    is_active    BOOLEAN      DEFAULT TRUE,
    created_at   TIMESTAMPTZ  DEFAULT NOW()
);
CREATE INDEX idx_product_line   ON product(line_id);
CREATE INDEX idx_product_color  ON product(color);
CREATE INDEX idx_product_active ON product(is_active);
```
- 247 SKU — mỗi SKU = 1 mã hàng + màu sắc cụ thể
- `product_code` format: `000214004000000`, `1030010000080000` (từ ERP)
- **72/247 SKU có `line_id = NULL`** — chưa map được vào danh mục cấp 3
- Màu sắc trích từ tên SP: Đen, Cam, Xanh mint, Café/nâu, Ghi, Hồng, Xanh dương...

---

### 3.4 product_price
```sql
CREATE TABLE product_price (
    price_id       SERIAL        PRIMARY KEY,
    product_code   VARCHAR(20)   NOT NULL REFERENCES product(product_code),
    unit_price     NUMERIC(15,2) NOT NULL CHECK (unit_price > 0),
    effective_from DATE          NOT NULL,
    effective_to   DATE,         -- NULL = giá đang áp dụng hiện tại
    created_at     TIMESTAMPTZ   DEFAULT NOW(),
    CONSTRAINT chk_price_dates CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX idx_price_product ON product_price(product_code);
CREATE INDEX idx_price_dates   ON product_price(effective_from, effective_to);
```
- 1.016 bản ghi — 196/247 SKU có nhiều hơn 1 mức giá trong kỳ
- Đây là giá **list price**, không phải giá giao dịch thực tế
- **Giá thực tế nằm trong `order_line.unit_price`** (có thể thấp hơn do chiết khấu)
- Query giá hiện hành: `WHERE effective_to IS NULL`

---

### 3.5 province
```sql
CREATE TABLE province (
    province_id   SERIAL       PRIMARY KEY,
    province_name VARCHAR(100) NOT NULL UNIQUE,
    region        VARCHAR(50), -- Miền Bắc / Miền Trung / Miền Nam
    created_at    TIMESTAMPTZ  DEFAULT NOW()
);
```
- 75 tỉnh/thành phố
- 3 vùng: `Miền Bắc`, `Miền Trung`, `Miền Nam`

---

### 3.6 customer
```sql
CREATE TABLE customer (
    customer_code VARCHAR(20)  PRIMARY KEY,
    customer_name VARCHAR(200) NOT NULL,
    tax_code      VARCHAR(15),
    address       TEXT,
    province_id   INTEGER      REFERENCES province(province_id),
    customer_tier VARCHAR(20)  DEFAULT 'STANDARD', -- STANDARD / KEY / VIP
    is_active     BOOLEAN      DEFAULT TRUE,
    created_at    TIMESTAMPTZ  DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  DEFAULT NOW()
);
CREATE INDEX idx_customer_province ON customer(province_id);
CREATE INDEX idx_customer_active   ON customer(is_active);
CREATE INDEX idx_customer_tax      ON customer(tax_code);
```
- 702 đại lý — chủ yếu B2B: công ty TNHH, cửa hàng xe đạp, hộ kinh doanh
- `customer_code` format: `KH-00001` đến `KH-00702`
- `tax_code`: MST 10 số giả lập (stable per customer_code)
- `address`: đã ẩn danh hóa (bỏ số nhà, giữ đường/phường/quận)
- **`customer_tier` hiện toàn bộ là `STANDARD`** — cần chạy RFM rồi UPDATE lại

---

### 3.7 sales_order
```sql
CREATE TABLE sales_order (
    order_id       SERIAL        PRIMARY KEY,
    so_number      VARCHAR(20)   NOT NULL UNIQUE, -- BH25.0001 / BH26.0001
    invoice_symbol VARCHAR(15),                   -- C25TTN / C26TTN
    invoice_number VARCHAR(20),                   -- Số HĐ gốc (không unique)
    order_date     DATE          NOT NULL,
    customer_code  VARCHAR(20)   NOT NULL REFERENCES customer(customer_code),
    total_amount   NUMERIC(15,2),   -- Auto-update qua trigger
    total_quantity INTEGER,         -- Auto-update qua trigger
    line_count     INTEGER,         -- Auto-update qua trigger
    fiscal_year    SMALLINT GENERATED ALWAYS AS (EXTRACT(YEAR  FROM order_date)::SMALLINT) STORED,
    fiscal_month   SMALLINT GENERATED ALWAYS AS (EXTRACT(MONTH FROM order_date)::SMALLINT) STORED,
    fiscal_quarter SMALLINT GENERATED ALWAYS AS (EXTRACT(QUARTER FROM order_date)::SMALLINT) STORED,
    created_at     TIMESTAMPTZ   DEFAULT NOW()
);
CREATE INDEX idx_so_date         ON sales_order(order_date);
CREATE INDEX idx_so_customer     ON sales_order(customer_code);
CREATE INDEX idx_so_year_month   ON sales_order(fiscal_year, fiscal_month);
CREATE INDEX idx_so_year_quarter ON sales_order(fiscal_year, fiscal_quarter);
CREATE INDEX idx_so_invoice      ON sales_order(invoice_number);
```
- 1.627 phiếu — trung bình 10,5 dòng/phiếu, dao động 1–82 dòng
- `so_number` format: `BH25.XXXX` (2025), `BH26.XXXX` (2026)
- `invoice_symbol`: `C25TTN` (2025), `C26TTN` (2026)
- `fiscal_year`, `fiscal_month`, `fiscal_quarter`: **GENERATED ALWAYS — KHÔNG ghi trực tiếp**
- `total_amount`, `total_quantity`, `line_count`: **auto-update qua trigger sau INSERT order_line**

---

### 3.8 order_line
```sql
CREATE TABLE order_line (
    line_id      SERIAL        PRIMARY KEY,
    order_id     INTEGER       NOT NULL REFERENCES sales_order(order_id) ON DELETE CASCADE,
    so_number    VARCHAR(20)   NOT NULL, -- Denormalized để tránh JOIN
    product_code VARCHAR(20)   NOT NULL REFERENCES product(product_code),
    quantity     NUMERIC(10,2) NOT NULL CHECK (quantity > 0),
    unit_price   NUMERIC(15,2) NOT NULL CHECK (unit_price >= 0),
    line_total   NUMERIC(15,2) NOT NULL, -- = quantity x unit_price
    created_at   TIMESTAMPTZ   DEFAULT NOW()
);
CREATE INDEX idx_ol_order     ON order_line(order_id);
CREATE INDEX idx_ol_product   ON order_line(product_code);
CREATE INDEX idx_ol_so_number ON order_line(so_number);
```
- 17.031 dòng giao dịch — bảng gốc chi tiết nhất
- `unit_price` là giá **thực tế giao dịch** — có thể khác `product_price` do chiết khấu
- `line_total = quantity x unit_price` (đã làm tròn VND)

---

### 3.9 fact_sales (Analytics Fact Table)
```sql
CREATE TABLE fact_sales (
    fact_id        BIGSERIAL     PRIMARY KEY,
    -- Time
    order_date     DATE          NOT NULL,
    fiscal_year    SMALLINT      NOT NULL,
    fiscal_quarter SMALLINT      NOT NULL,
    fiscal_month   SMALLINT      NOT NULL,
    week_of_year   SMALLINT,
    -- Order
    so_number      VARCHAR(20)   NOT NULL,
    order_id       INTEGER       NOT NULL,
    line_id        INTEGER       NOT NULL,
    -- Customer
    customer_code  VARCHAR(20)   NOT NULL,
    customer_name  VARCHAR(200),
    province_id    INTEGER,
    province_name  VARCHAR(100),
    region         VARCHAR(50),
    -- Product
    product_code   VARCHAR(20)   NOT NULL,
    product_name   VARCHAR(200),
    color          VARCHAR(60),
    line_id_fk     INTEGER,
    line_name      VARCHAR(100),
    group_code     VARCHAR(30),
    group_name     VARCHAR(100),
    -- Measures
    quantity       NUMERIC(10,2) NOT NULL,
    unit_price     NUMERIC(15,2) NOT NULL,
    line_total     NUMERIC(15,2) NOT NULL
);
```
- **Bảng ưu tiên cho mọi query analytics** — JOIN sẵn tất cả dimension
- Được INSERT từ: `order_line x sales_order x customer x product x product_line x product_group x province`
- Sau khi import T3/2026, phải INSERT thêm vào `fact_sales`

---

### 3.10 email_log (Bảng mới — tạo thêm cho Phase A)
```sql
CREATE TABLE tnbike.email_log (
    log_id            SERIAL       PRIMARY KEY,
    message_id        VARCHAR(255) UNIQUE,
    from_address      VARCHAR(255),
    received_at       TIMESTAMPTZ,
    attachment_name   VARCHAR(255),
    so_number         VARCHAR(20)  REFERENCES tnbike.sales_order(so_number),
    processing_status VARCHAR(20)  DEFAULT 'PENDING',
    -- Status values: PENDING / SUCCESS / ERROR / DUPLICATE
    error_message     TEXT,
    processed_at      TIMESTAMPTZ  DEFAULT NOW()
);
```

---

## 4. VIEWS — SQL ĐẦY ĐỦ

### v_monthly_by_group
```sql
CREATE VIEW tnbike.v_monthly_by_group AS
SELECT
    fiscal_year,
    fiscal_month,
    group_code,
    group_name,
    COUNT(DISTINCT so_number) AS order_count,
    SUM(quantity)             AS total_qty,
    SUM(line_total)           AS total_revenue,
    ROUND(AVG(unit_price), 0) AS avg_unit_price
FROM tnbike.fact_sales
GROUP BY fiscal_year, fiscal_month, group_code, group_name;
```
Dùng cho: trend chart theo tháng, seasonality, YoY comparison

---

### v_customer_period
```sql
CREATE VIEW tnbike.v_customer_period AS
SELECT
    fiscal_year,
    fiscal_quarter,
    customer_code,
    customer_name,
    province_name,
    region,
    COUNT(DISTINCT so_number) AS order_count,
    SUM(quantity)             AS total_qty,
    SUM(line_total)           AS total_revenue,
    MAX(order_date)           AS last_order_date,
    MIN(order_date)           AS first_order_date
FROM tnbike.fact_sales
GROUP BY fiscal_year, fiscal_quarter, customer_code, customer_name, province_name, region;
```
Dùng cho: RFM analysis, churn detection

---

### v_sku_monthly
```sql
CREATE VIEW tnbike.v_sku_monthly AS
SELECT
    fiscal_year,
    fiscal_month,
    product_code,
    product_name,
    color,
    line_name,
    group_code,
    SUM(quantity)             AS total_qty,
    SUM(line_total)           AS total_revenue,
    COUNT(DISTINCT so_number) AS order_count
FROM tnbike.fact_sales
GROUP BY fiscal_year, fiscal_month, product_code, product_name, color, line_name, group_code;
```
Dùng cho: color trend, slow-moving SKU detection

---

### v_customer_activity
```sql
CREATE VIEW tnbike.v_customer_activity AS
SELECT
    c.customer_code,
    c.customer_name,
    c.province_id,
    p.province_name,
    p.region,
    COUNT(DISTINCT so.so_number)      AS total_orders,
    SUM(ol.line_total)                AS total_revenue,
    MIN(so.order_date)                AS first_order_date,
    MAX(so.order_date)                AS last_order_date,
    CURRENT_DATE - MAX(so.order_date) AS days_since_last_order
FROM tnbike.customer c
LEFT JOIN tnbike.sales_order so ON so.customer_code = c.customer_code
LEFT JOIN tnbike.order_line  ol ON ol.order_id = so.order_id
LEFT JOIN tnbike.province     p ON p.province_id = c.province_id
GROUP BY c.customer_code, c.customer_name, c.province_id, p.province_name, p.region;
```
Dùng cho: churn detection (`days_since_last_order > 45`), phân tầng VIP/KEY

---

## 5. TRIGGER

```sql
CREATE OR REPLACE FUNCTION tnbike.fn_update_order_totals()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    UPDATE tnbike.sales_order
    SET
        total_amount   = (SELECT COALESCE(SUM(line_total), 0)
                          FROM tnbike.order_line WHERE order_id = NEW.order_id),
        total_quantity = (SELECT COALESCE(SUM(quantity)::INTEGER, 0)
                          FROM tnbike.order_line WHERE order_id = NEW.order_id),
        line_count     = (SELECT COUNT(*)
                          FROM tnbike.order_line WHERE order_id = NEW.order_id)
    WHERE order_id = NEW.order_id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_order_line_after_insert
AFTER INSERT OR UPDATE OR DELETE ON tnbike.order_line
FOR EACH ROW EXECUTE FUNCTION tnbike.fn_update_order_totals();
```
- Trigger tự chạy sau mỗi INSERT/UPDATE/DELETE trên `order_line`
- Tự động cập nhật `total_amount`, `total_quantity`, `line_count` trên `sales_order`

---

## 6. ERD — QUAN HỆ BẢNG

```
product_group (1) ──────< (N) product_line (1) ──────< (N) product (1) ──< (N) product_price
      │                              │                         │
      │                              │                   (line_id FK)
      │                              │                         │
      └──────────────────────────────┴──────────── fact_sales ─┘
                                                       │
province (1) ──< (N) customer (1) ──< (N) sales_order  │
                          │                  │          │
                          │             (1) │          │
                          │                  └───< (N) order_line
                          │                               │
                          └───────────────── (province_id FK)
```

**fact_sales** = denormalized JOIN của:
`order_line` × `sales_order` × `customer` × `province` × `product` × `product_line` × `product_group`

---

## 7. DỮ LIỆU NGUỒN BỘ 2 — EMAIL + PDF T3/2026

### Quy mô
- 1.132 file `.eml` — email đặt hàng từ đại lý tháng 3/2026
- 1.132 file `.pdf` — đơn đặt hàng chi tiết đính kèm trong email

### Cấu trúc file .eml
```
From:       email@daily.vn          ← địa chỉ đại lý
To:         info@thongnhat.vn
Subject:    BH26.XXXX               ← số đơn hàng
Date:       01 Mar 2026 ...
Body:       thông tin đại lý, tổng đơn, yêu cầu giao hàng
Attachment: BH26_XXXX.pdf           ← 1 file PDF đính kèm (MIME)
```

### Cấu trúc file PDF đơn hàng
```
── HEADER ──────────────────────────────────────────────────
CÔNG TY CỔ PHẦN XE ĐẠP THỐNG NHẤT
43 Nguyễn Văn Cừ, P. Nguyễn Cư Trinh, Q.1, TP.HCM
Tel: (028) 3837 0100 | Email: info@thongnhat.vn | MST: 0300397904

ĐƠN ĐẶT HÀNG / PURCHASE ORDER
Số đơn hàng : BH26.XXXX          Ngày: DD/MM/2026
Đại lý      : [Tên công ty]      MST: [Mã số thuế 9-10 số]
Địa chỉ     : [Địa chỉ đại lý]

── BẢNG SẢN PHẨM ────────────────────────────────────────────
STT | Mã hàng          | Tên sản phẩm      | ĐVT   | SL | Đơn giá (đ) | Thành tiền (đ)
  1 | 000XXXXXXXXXX000 | Xe đạp TN ...     | Chiếc |  N | X.XXX.XXX   | X.XXX.XXX

── FOOTER ───────────────────────────────────────────────────
Tổng: [tổng SL] | [tổng thành tiền]
Tổng giá trị đơn hàng: X.XXX.XXX đồng (chưa bao gồm VAT)
```

### 3 đơn hàng mẫu thực tế
```
BH26.0935 | 01/03/2026
  Đại lý : Công ty TNHH TM Long Phú | MST: 167397253
  Địa chỉ: phố Tràng Thi, P. Hàng Trống, Q. Hoàn Kiếm, Hà Nội
  → 000104002009000 | Xe đạp TN Tom & Jerry 14 Hồng | 1 chiếc | 1.898.148đ
  TỔNG   : 1.898.148đ

BH26.0936 | 01/03/2026
  Đại lý : Công ty TNHH TM Long Phú | MST: 167397253
  Địa chỉ: phố Tràng Thi, P. Hàng Trống, Q. Hoàn Kiếm, Hà Nội
  → 000230002013000 | Xe đạp TN LD 26 Pastel Xanh | 1 chiếc | 2.861.111đ
  TỔNG   : 2.861.111đ

BH26.0938 | 01/03/2026
  Đại lý : Công ty Cổ phần Nam Tiến | MST: 111014028
  Địa chỉ: Phường Phú Diễn, TP Hà Nội
  → 000331002008000 | Xe đạp TN MTB 26-02 Ghi | 1 chiếc | 2.953.704đ
  TỔNG   : 2.953.704đ
```

### Logic xử lý PDF → Database
```python
# Bước 1: Đọc PDF, trích xuất thông tin
so_number    = extract_so_number(pdf)       # "BH26.XXXX"
order_date   = extract_date(pdf)            # datetime.date(2026, 3, 1)
customer_mst = extract_tax_code(pdf)        # "167397253"
lines        = extract_product_lines(pdf)   # [{mã hàng, tên, SL, đơn giá, thành tiền}]

# Bước 2: Lookup customer_code từ MST
cur.execute("SELECT customer_code FROM tnbike.customer WHERE tax_code = %s", (customer_mst,))
row = cur.fetchone()
if not row:
    log_error(so_number, f"Không tìm thấy đại lý MST={customer_mst}")
    continue
customer_code = row[0]

# Bước 3: Check duplicate
cur.execute("SELECT 1 FROM tnbike.sales_order WHERE so_number = %s", (so_number,))
if cur.fetchone():
    log_error(so_number, "DUPLICATE")
    continue

# Bước 4: INSERT sales_order (KHÔNG ghi fiscal_year/month/quarter)
cur.execute("""
    INSERT INTO tnbike.sales_order
        (so_number, invoice_symbol, order_date, customer_code)
    VALUES (%s, 'C26TTN', %s, %s)
    RETURNING order_id
""", (so_number, order_date, customer_code))
order_id = cur.fetchone()[0]

# Bước 5: INSERT order_line
for line in lines:
    cur.execute("""
        INSERT INTO tnbike.order_line
            (order_id, so_number, product_code, quantity, unit_price, line_total)
        VALUES (%s, %s, %s, %s, %s, %s)
    """, (order_id, so_number, line['product_code'],
          line['quantity'], line['unit_price'], line['line_total']))
# Trigger tự động cập nhật sales_order totals

# Bước 6 (Phase A): INSERT email_log
cur.execute("""
    INSERT INTO tnbike.email_log
        (message_id, from_address, received_at, attachment_name, so_number, processing_status)
    VALUES (%s, %s, %s, %s, %s, 'SUCCESS')
""", (msg_id, from_addr, received_at, attachment_name, so_number))
```

### Validation rules trước khi ghi DB
```python
assert so_number not in existing_so_numbers               # Không duplicate
assert order_date.month == 3 and order_date.year == 2026  # Đúng tháng T3/2026
assert product_code in existing_product_codes             # SKU tồn tại trong DB
assert quantity > 0
assert unit_price > 0
assert abs(line_total - round(quantity * unit_price, 0)) <= 1  # Thành tiền khớp (sai số < 1đ)
```

### INSERT fact_sales sau khi import xong T3/2026
```sql
INSERT INTO tnbike.fact_sales (
    order_date, fiscal_year, fiscal_quarter, fiscal_month, week_of_year,
    so_number, order_id, line_id,
    customer_code, customer_name, province_id, province_name, region,
    product_code, product_name, color,
    line_id_fk, line_name, group_code, group_name,
    quantity, unit_price, line_total
)
SELECT
    so.order_date,
    so.fiscal_year, so.fiscal_quarter, so.fiscal_month,
    EXTRACT(WEEK FROM so.order_date)::SMALLINT,
    ol.so_number, ol.order_id, ol.line_id,
    c.customer_code, c.customer_name, c.province_id, p.province_name, p.region,
    ol.product_code, pr.product_name, pr.color,
    pr.line_id, pl.line_name, pg.group_code, pg.group_name,
    ol.quantity, ol.unit_price, ol.line_total
FROM tnbike.order_line ol
JOIN tnbike.sales_order     so ON so.order_id    = ol.order_id
JOIN tnbike.customer         c ON c.customer_code = so.customer_code
LEFT JOIN tnbike.province    p ON p.province_id   = c.province_id
JOIN tnbike.product         pr ON pr.product_code = ol.product_code
LEFT JOIN tnbike.product_line  pl ON pl.line_id    = pr.line_id
LEFT JOIN tnbike.product_group pg ON pg.group_code = pl.group_code
WHERE so.fiscal_year = 2026 AND so.fiscal_month = 3
  AND ol.so_number NOT IN (
      SELECT DISTINCT so_number FROM tnbike.fact_sales
      WHERE fiscal_year = 2026 AND fiscal_month = 3
  );
```

---

## 8. SAMPLE QUERIES ANALYTICS

### Tổng doanh số theo năm
```sql
SELECT fiscal_year, SUM(line_total) AS revenue, COUNT(*) AS rows
FROM tnbike.fact_sales
GROUP BY fiscal_year ORDER BY fiscal_year;
```

### Top 10 đại lý theo doanh số
```sql
SELECT customer_code, customer_name, province_name,
       SUM(line_total) AS revenue, COUNT(DISTINCT so_number) AS orders
FROM tnbike.fact_sales
GROUP BY customer_code, customer_name, province_name
ORDER BY revenue DESC LIMIT 10;
```

### Doanh số theo nhóm SP × tháng
```sql
SELECT fiscal_year, fiscal_month, group_name,
       SUM(line_total) AS revenue, SUM(quantity) AS qty
FROM tnbike.fact_sales
GROUP BY fiscal_year, fiscal_month, group_name
ORDER BY fiscal_year, fiscal_month, revenue DESC;
```

### Đại lý churn (không đặt hàng > 45 ngày)
```sql
SELECT customer_code, customer_name, province_name,
       last_order_date, days_since_last_order, total_revenue
FROM tnbike.v_customer_activity
WHERE days_since_last_order > 45
ORDER BY days_since_last_order DESC;
```

### Phân tích màu sắc theo dòng xe
```sql
SELECT line_name, color,
       SUM(quantity) AS total_qty,
       SUM(line_total) AS revenue,
       ROUND(100.0 * SUM(quantity) / SUM(SUM(quantity)) OVER (PARTITION BY line_name), 1) AS pct
FROM tnbike.fact_sales
WHERE line_name IS NOT NULL
GROUP BY line_name, color
ORDER BY line_name, total_qty DESC;
```

### RFM base query
```sql
WITH rfm_raw AS (
    SELECT
        customer_code, customer_name, province_name, region,
        MAX(order_date)               AS last_order_date,
        CURRENT_DATE - MAX(order_date) AS recency_days,
        COUNT(DISTINCT so_number)     AS frequency,
        SUM(line_total)               AS monetary
    FROM tnbike.fact_sales
    GROUP BY customer_code, customer_name, province_name, region
)
SELECT *,
    NTILE(5) OVER (ORDER BY recency_days ASC)  AS r_score,  -- 5=best (recent)
    NTILE(5) OVER (ORDER BY frequency DESC)   AS f_score,  -- 5=best (frequent)
    NTILE(5) OVER (ORDER BY monetary DESC)    AS m_score   -- 5=best (high value)
FROM rfm_raw;
```

### Pareto 80/20
```sql
WITH customer_rev AS (
    SELECT customer_code, SUM(line_total) AS revenue
    FROM tnbike.fact_sales GROUP BY customer_code
),
ranked AS (
    SELECT *,
        RANK() OVER (ORDER BY revenue DESC) AS rnk,
        SUM(revenue) OVER () AS total_rev,
        SUM(revenue) OVER (ORDER BY revenue DESC ROWS UNBOUNDED PRECEDING) AS cum_rev
    FROM customer_rev
)
SELECT rnk, customer_code, revenue,
       ROUND(100.0 * cum_rev / total_rev, 1) AS cumulative_pct
FROM ranked
WHERE rnk <= 20;
```

### YoY comparison Q1
```sql
SELECT
    group_name,
    SUM(CASE WHEN fiscal_year = 2025 AND fiscal_quarter = 1 THEN line_total END) AS q1_2025,
    SUM(CASE WHEN fiscal_year = 2026 AND fiscal_quarter = 1 THEN line_total END) AS q1_2026,
    ROUND(100.0 *
        (SUM(CASE WHEN fiscal_year = 2026 AND fiscal_quarter = 1 THEN line_total END) -
         SUM(CASE WHEN fiscal_year = 2025 AND fiscal_quarter = 1 THEN line_total END)) /
        NULLIF(SUM(CASE WHEN fiscal_year = 2025 AND fiscal_quarter = 1 THEN line_total END), 0)
    , 1) AS yoy_pct
FROM tnbike.fact_sales
GROUP BY group_name ORDER BY q1_2026 DESC NULLS LAST;
```

---

## 9. YÊU CẦU KỸ THUẬT CHI TIẾT

### Hạng mục A — Xử lý đơn hàng tự động (25đ)

**Phương án A — Email + PDF (25đ tối đa):**
```
.eml → parse MIME headers (From, Subject, Date, Message-ID)
     → extract PDF attachment (base64 decode)
     → parse PDF content (pdfplumber / pypdf / LLM Vision)
     → validate data
     → INSERT email_log + sales_order + order_line
     → INSERT fact_sales
```

**Phương án B — Chỉ đọc PDF (20đ tối đa):**
```
.pdf → parse table content (pdfplumber / pypdf / LLM Vision)
     → validate data
     → INSERT sales_order + order_line
     → INSERT fact_sales
     (bỏ qua email_log)
```

**Output bắt buộc:** 1.132 đơn hàng T3/2026 có trong database

---

### Hạng mục B — Dashboard & Insights (30đ)

**6 màn hình bắt buộc:**

| # | Màn hình | Nội dung bắt buộc |
|---|---|---|
| 1 | Tổng quan KPI | Doanh số, đơn hàng, SL bán, đại lý hoạt động, phễu pipeline T3/2026 |
| 2 | Phân tích thời gian | Trend line 01/25→03/26, YoY Q1, phân tích mùa vụ |
| 3 | Phân tích sản phẩm | Drill-down 3 cấp, BCG matrix, heatmap màu × dòng xe |
| 4 | Phân tích đại lý | RFM scatter, top/bottom dealers, danh sách churn |
| 5 | Phân tích địa lý | Map hoặc treemap tỉnh/thành, phân tích 3 vùng miền |
| 6 | Trạng thái vận hành | Pipeline T3/2026: đã xử lý / lỗi / chờ (từ email_log) |

**KPI bắt buộc + công thức:**

| Nhóm | Chỉ số | Công thức SQL |
|---|---|---|
| Sản lượng | Tổng SL bán | `SUM(quantity)` |
| Sản lượng | Số đơn hàng | `COUNT(DISTINCT so_number)` |
| Sản lượng | Dòng TB/đơn | `COUNT(*) / COUNT(DISTINCT so_number)` |
| Doanh thu | Tổng doanh thu | `SUM(line_total)` |
| Doanh thu | Giá bán TB | `AVG(unit_price)` |
| Doanh thu | DT TB/đại lý | `SUM(line_total) / COUNT(DISTINCT customer_code)` |
| Tăng trưởng | MoM | `(cur - prev) / prev * 100` |
| Tăng trưởng | YoY | `(cur_period - same_ly) / same_ly * 100` |
| Cơ cấu SP | Tỷ trọng nhóm | `SUM(group_rev) / SUM(total_rev) * 100` |
| Khách hàng | Đại lý hoạt động | `COUNT WHERE days_since_last_order <= 45` |
| Khách hàng | Pareto top 20% | `% doanh số của top 20% đại lý` |

**BCG Matrix:**
```
Trục X: Tổng doanh số (thị phần tương đối trong danh mục)
Trục Y: Tốc độ tăng trưởng YoY (%)
  Stars         : tăng trưởng > 15%  + doanh số cao (trên median)
  Cash Cows     : tăng trưởng < 5%   + doanh số cao
  Question Marks: tăng trưởng > 15%  + doanh số thấp
  Dogs          : tăng trưởng < 5%   + doanh số thấp
```

**Format insight chuẩn (≥ 5 insights):**
```
Phát hiện : [số liệu cụ thể, so sánh có %]
Ý nghĩa   : [tác động kinh doanh]
Hành động : [khuyến nghị cụ thể, có thể thực hiện được]
```

---

### Hạng mục C — Dự báo nhu cầu (30đ)

**Câu hỏi 1 — Doanh số Q2/2026:**
- Tổng doanh số tháng 4, 5, 6/2026 (theo tháng hoặc tuần)
- Breakdown: 5 nhóm SP + top 20 SKU dự kiến bán chạy nhất
- Train set: 2025-01-01 → 2026-03-31

**Câu hỏi 2 — Màu sắc:**
- Màu nào tăng nhu cầu theo mùa trong Q2/2026?
- Cơ cấu màu (% mỗi màu) dự kiến Q2/2026
- SKU nào có dấu hiệu nhu cầu giảm / nguy cơ tồn kho?

**Câu hỏi 3 — Đại lý:**
- Xác suất mỗi đại lý đặt hàng trong 30 ngày tới
- Danh sách đại lý churn probability > 70%
- Điểm ưu tiên tiếp thị theo xu hướng

**Bonus:** Tích hợp LLM để trả lời câu hỏi phân tích bằng ngôn ngữ tự nhiên

**Gợi ý models:**
```python
# Time series forecasting
from prophet import Prophet
from statsmodels.tsa.statespace.sarimax import SARIMAX

# Churn prediction
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression

# Features cho churn model
features = [
    'recency_days',           # Số ngày kể từ đơn hàng cuối
    'frequency_90d',          # Số đơn trong 90 ngày gần nhất
    'monetary_90d',           # Doanh số trong 90 ngày gần nhất
    'avg_order_value',        # Giá trị đơn hàng trung bình
    'order_interval_avg',     # Khoảng cách TB giữa các đơn (ngày)
    'months_active',          # Số tháng có giao dịch
    'pct_change_last_quarter' # % thay đổi doanh số so với quý trước
]
```

---

## 10. SETUP & INSTALL

### Tạo và import database
```bash
# Bước 1: Tạo database
psql -U postgres -c "CREATE DATABASE tnbike_db ENCODING 'UTF8';"

# Bước 2: Tạo schema, bảng, views, triggers
psql -U postgres -d tnbike_db -f 01_create_tables.sql

# Bước 3: Import dữ liệu lịch sử 2025-T2/2026
psql -U postgres -d tnbike_db -f 02_import_data.sql
# Thời gian ước tính: 30-90 giây
```

### Python dependencies
```bash
pip install psycopg2-binary pandas openpyxl \
            pdfplumber pypdf2 \
            scikit-learn prophet statsmodels \
            plotly dash streamlit \
            python-dotenv tqdm
```

### Kiểm tra sau import
```sql
SELECT 'product_group' AS tbl, COUNT(*) FROM tnbike.product_group  -- 5
UNION ALL SELECT 'product_line',  COUNT(*) FROM tnbike.product_line  -- 77
UNION ALL SELECT 'product',       COUNT(*) FROM tnbike.product        -- 247
UNION ALL SELECT 'product_price', COUNT(*) FROM tnbike.product_price  -- 1016
UNION ALL SELECT 'province',      COUNT(*) FROM tnbike.province        -- 75
UNION ALL SELECT 'customer',      COUNT(*) FROM tnbike.customer        -- 702
UNION ALL SELECT 'sales_order',   COUNT(*) FROM tnbike.sales_order     -- 1627
UNION ALL SELECT 'order_line',    COUNT(*) FROM tnbike.order_line      -- 17031
UNION ALL SELECT 'fact_sales',    COUNT(*) FROM tnbike.fact_sales;     -- 17031
```

---

## 11. LƯU Ý KỸ THUẬT — CRITICAL

```
CRITICAL — KHÔNG làm những điều sau:

  ✗ KHÔNG ghi trực tiếp vào fiscal_year / fiscal_month / fiscal_quarter
    → GENERATED ALWAYS columns, PostgreSQL tự tính từ order_date
    → Ghi sẽ bị lỗi: "cannot insert a non-DEFAULT value into column"

  ✗ KHÔNG bỏ qua bước INSERT fact_sales sau khi import T3/2026
    → Dashboard và dự báo đọc từ fact_sales — thiếu T3 sẽ sai toàn bộ kết quả

  ✗ KHÔNG dùng order_line.unit_price để phân tích price list
    → Đây là giá thực tế (có chiết khấu), dùng product_price cho price analysis

SAFE — Những điều cần biết:

  ✓ Trigger tự cập nhật sales_order totals sau INSERT order_line
    → Không cần tính lại total_amount / total_quantity / line_count

  ✓ Ưu tiên dùng fact_sales cho mọi query analytics
    → Nhanh hơn 10-50x so với JOIN từ order_line

  ✓ 72/247 SKU có line_id = NULL → line_name / group_name = NULL trong fact_sales
    → Thêm WHERE line_name IS NOT NULL khi phân tích theo dòng xe

  ✓ customer_tier toàn bộ = 'STANDARD' trong DB gốc
    → Sau RFM: UPDATE tnbike.customer SET customer_tier = 'VIP' WHERE ...

  ✓ so_number là UNIQUE key — dùng để detect duplicate khi import PDF
    → Luôn check trước INSERT: SELECT 1 FROM sales_order WHERE so_number = ?

  ✓ invoice_symbol cho T3/2026 = 'C26TTN' (pattern: C{YY}TTN)
```

---

## 12. LỊCH TRÌNH & NỘP BÀI

| Mốc | Ngày |
|---|---|
| Nhận đề + dữ liệu | 28/4/2026 |
| Hướng dẫn làm bài online | 05/5/2026 |
| **Deadline nộp bài** | **28/5/2026** |
| Chung kết + trao giải | 04/6/2026 |

### Hồ sơ nộp
| # | Hạng mục | Yêu cầu |
|---|---|---|
| 1 | GitHub repo | Public — README đầy đủ: cài đặt, kiến trúc, cách chạy |
| 2 | Báo cáo kỹ thuật | PDF, 10–15 trang |
| 3 | Slide trình bày | 10–15 slides |
| 4 | Video tóm tắt | 5–7 phút |

### Cấu trúc điểm
| Hạng mục | Nội dung | Điểm |
|---|---|---|
| A | Vận hành: Xử lý đơn hàng tự động | 25 |
| B | Phân tích: Dashboard & Insights | 30 |
| C | Dự báo nhu cầu & Chiến lược | 30 |
| D | Trình bày & Bảo vệ (demo 10' + Q&A 10') | 15 |
| **Tổng** | | **100** |
