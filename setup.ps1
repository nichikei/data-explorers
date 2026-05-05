Write-Host "TNBIKE Pipeline - Setup" -ForegroundColor Cyan

Write-Host "[1/3] Cau hinh moi truong..." -ForegroundColor Yellow
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "  + Da tao .env tu .env.example" -ForegroundColor Green
    Write-Host "  ! Nho mo .env va dien PG_PASSWORD truoc khi chay pipeline" -ForegroundColor Red
} else {
    Write-Host "  OK: .env da ton tai" -ForegroundColor Gray
}

Write-Host "[2/3] Tao virtual environment..." -ForegroundColor Yellow
if (-not (Test-Path "venv")) {
    python -m venv venv
    Write-Host "  + Da tao venv" -ForegroundColor Green
} else {
    Write-Host "  OK: venv da ton tai" -ForegroundColor Gray
}

Write-Host "[3/3] Cai dat thu vien Python..." -ForegroundColor Yellow
& "venv\Scripts\pip.exe" install -r requirements.txt --quiet
Write-Host "  OK: Da cai xong requirements.txt" -ForegroundColor Green

Write-Host ""
Write-Host "Setup xong! Lam them 3 buoc sau:" -ForegroundColor Green
Write-Host ""
Write-Host "  1. Dien password PostgreSQL vao .env"
Write-Host "     notepad .env"
Write-Host ""
Write-Host "  2. Tao bang email_log trong DB"
Write-Host "     psql -U postgres -d tnbike_db -f sql\00_email_log_table.sql"
Write-Host ""
Write-Host "  3. Copy 1132 file .eml vao data\eml\ roi chay:"
Write-Host "     venv\Scripts\activate"
Write-Host "     python src\run_pipeline.py"