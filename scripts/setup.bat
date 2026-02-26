@echo off
REM Portavio - Windows Setup Script

echo ╔════════════════════════════════════════════════════╗
echo ║   Portavio - Setup Wizard         ║
echo ╚════════════════════════════════════════════════════╝
echo.

REM Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Node.js is not installed. Please install Node.js 16+ first.
    echo    Visit: https://nodejs.org/
    pause
    exit /b 1
)

echo ✅ Node.js found
node --version

REM Check PostgreSQL
where psql >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ PostgreSQL is not installed. Please install PostgreSQL 13+ first.
    echo    Visit: https://www.postgresql.org/download/
    pause
    exit /b 1
)

echo ✅ PostgreSQL found
psql --version
echo.

echo 📝 Database Configuration
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━
set /p DB_NAME="Database name [portavio]: "
if "%DB_NAME%"=="" set DB_NAME=portavio

set /p DB_USER="Database user [postgres]: "
if "%DB_USER%"=="" set DB_USER=postgres

set /p DB_PASSWORD="Database password: "

set /p DB_HOST="Database host [localhost]: "
if "%DB_HOST%"=="" set DB_HOST=localhost

set /p DB_PORT="Database port [5432]: "
if "%DB_PORT%"=="" set DB_PORT=5432

echo.
echo 🔨 Creating database...

REM Create database
set PGPASSWORD=%DB_PASSWORD%
psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -lqt | findstr /C:"%DB_NAME%" >nul
if %ERRORLEVEL% EQU 0 (
    echo ⚠️  Database '%DB_NAME%' already exists. Skipping creation.
) else (
    createdb -h %DB_HOST% -p %DB_PORT% -U %DB_USER% %DB_NAME%
    echo ✅ Database '%DB_NAME%' created
)

REM Run schema
echo 📊 Setting up database schema...
psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% -f ..\database\schema.sql >nul 2>&1
echo ✅ Database schema created

REM Generate keys
echo.
echo 🔐 Generating security keys...
for /f %%i in ('node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"') do set JWT_SECRET=%%i
for /f %%i in ('node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"') do set ENCRYPTION_KEY=%%i

REM Create .env file
(
echo # Database Configuration
echo DB_HOST=%DB_HOST%
echo DB_PORT=%DB_PORT%
echo DB_NAME=%DB_NAME%
echo DB_USER=%DB_USER%
echo DB_PASSWORD=%DB_PASSWORD%
echo.
echo # JWT Configuration
echo JWT_SECRET=%JWT_SECRET%
echo JWT_EXPIRES_IN=7d
echo.
echo # Encryption Key
echo ENCRYPTION_KEY=%ENCRYPTION_KEY%
echo.
echo # Server Configuration
echo PORT=3001
echo NODE_ENV=development
echo.
echo # CORS
echo CORS_ORIGIN=http://localhost:3000
) > .env

echo ✅ Environment file created (.env)

REM Install dependencies
echo.
echo 📦 Installing dependencies...
call npm install

echo.
echo ╔════════════════════════════════════════════════════╗
echo ║   ✅ Setup Complete!                              ║
echo ╚════════════════════════════════════════════════════╝
echo.
echo 🚀 To start the application:
echo.
echo    Backend:  cd backend ^&^& npm start
echo    Frontend: Open frontend\index.html in your browser
echo              or run: cd frontend ^&^& python -m http.server 3000
echo.
echo 📚 Next steps:
echo    1. Start the backend server
echo    2. Open the frontend in your browser
echo    3. Register a new account
echo    4. Connect to your Jira instance
echo    5. Sync your data and enjoy!
echo.
echo 📖 Documentation: See README.md for more details
echo.
pause
