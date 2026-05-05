# setup.ps1
# Chạy script này sau khi clone repo về để cài đặt môi trường
# Usage: .\setup.ps1

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " TNBIKE Pipeline — Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 1. Tạo các thư mục cần thiết
Write-Host "`n[1/5] Tạo thư mục..." -ForegroundColor Yellow
$dirs = @("staging", "staging\pdf", "data", "data\eml", "logs")
foreach ($dir in $dirs) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Write-Host "  + Tạo: $dir" -ForegroundColor Green
    } else {
        Write-Host "  ✓ Đã có: $dir" -ForegroundColor Gray
    }
}

# 2. Tạo file .env từ .env.example
Write-Host "`n[2/5] Cấu hình môi trường..." -ForegroundColor Yellow
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "  + Đã tạo .env từ .env.example" -ForegroundColor Green
    Write-Host "  ! Nhớ mở .env và điền PG_PASSWORD trước khi chạy pipeline" -ForegroundColor Red
} else {
    Write-Host "  ✓ .env đã tồn tại" -ForegroundColor Gray
}

# 3. Tạo virtual environment
Write-Host "`n[3/5] Tạo virtual environment..." -ForegroundColor Yellow
if (-not (Test-Path "venv")) {
    python -m venv venv
    Write-Host "  + Đã tạo venv" -ForegroundColor Green
} else {
    Write-Host "  ✓ venv đã tồn tại" -ForegroundColor Gray
}

# 4. Cài thư viện
Write-Host "`n[4/5] Cài đặt thư viện Python..." -ForegroundColor Yellow
& "venv\Scripts\pip.exe" install -r requirements.txt --quiet
Write-Host "  ✓ Đã cài xong requirements.txt" -ForegroundColor Green

# 5. Hướng dẫn tiếp theo
Write-Host "`n[5/5] Hướng dẫn tiếp theo:" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Bước 1: Điền password PostgreSQL vào .env" -ForegroundColor White
Write-Host "          notepad .env" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Bước 2: Tạo bảng email_log trong DB" -ForegroundColor White
Write-Host "          psql -U postgres -d tnbike_db -f sql\00_email_log_table.sql" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Bước 3: Copy 1.132 file .eml vào thư mục data\eml\" -ForegroundColor White
Write-Host "          copy C:\path\to\eml\*.eml data\eml\" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Bước 4: Kích hoạt venv và chạy pipeline" -ForegroundColor White
Write-Host "          venv\Scripts\activate" -ForegroundColor Cyan
Write-Host "          python src\run_pipeline.py" -ForegroundColor Cyan
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Setup hoàn tất!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
