#!/bin/bash

# Portavio - Automated Setup Script
# This script helps you set up the entire application

set -e

echo "╔════════════════════════════════════════════════════╗"
echo "║   Portavio - Setup Wizard         ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""

# Function to generate random key
generate_key() {
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
}

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 16+ first."
    echo "   Visit: https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js found: $(node --version)"

# Check if PostgreSQL is installed
if ! command -v psql &> /dev/null; then
    echo "❌ PostgreSQL is not installed. Please install PostgreSQL 13+ first."
    echo "   Visit: https://www.postgresql.org/download/"
    exit 1
fi

echo "✅ PostgreSQL found: $(psql --version)"
echo ""

# Get database credentials
echo "📝 Database Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━"
read -p "Database name [portavio]: " DB_NAME
DB_NAME=${DB_NAME:-portavio}

read -p "Database user [postgres]: " DB_USER
DB_USER=${DB_USER:-postgres}

read -sp "Database password: " DB_PASSWORD
echo ""

read -p "Database host [localhost]: " DB_HOST
DB_HOST=${DB_HOST:-localhost}

read -p "Database port [5432]: " DB_PORT
DB_PORT=${DB_PORT:-5432}

echo ""
echo "🔨 Creating database..."

# Create database
export PGPASSWORD=$DB_PASSWORD
if psql -h $DB_HOST -p $DB_PORT -U $DB_USER -lqt | cut -d \| -f 1 | grep -qw $DB_NAME; then
    echo "⚠️  Database '$DB_NAME' already exists. Skipping creation."
else
    createdb -h $DB_HOST -p $DB_PORT -U $DB_USER $DB_NAME
    echo "✅ Database '$DB_NAME' created"
fi

# Run schema
echo "📊 Setting up database schema..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f ../database/schema.sql > /dev/null 2>&1
echo "✅ Database schema created"

# Create .env file
echo ""
echo "🔐 Generating security keys..."
JWT_SECRET=$(generate_key)
ENCRYPTION_KEY=$(generate_key)

cat > .env << EOF
# Database Configuration
DB_HOST=$DB_HOST
DB_PORT=$DB_PORT
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD

# JWT Configuration
JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=7d

# Encryption Key
ENCRYPTION_KEY=$ENCRYPTION_KEY

# Server Configuration
PORT=3001
NODE_ENV=development

# CORS
CORS_ORIGIN=http://localhost:3000
EOF

echo "✅ Environment file created (.env)"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install --silent

echo ""
echo "╔════════════════════════════════════════════════════╗"
echo "║   ✅ Setup Complete!                              ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""
echo "🚀 To start the application:"
echo ""
echo "   Backend:  cd backend && npm start"
echo "   Frontend: Open frontend/index.html in your browser"
echo "             or run: cd frontend && python3 -m http.server 3000"
echo ""
echo "📚 Next steps:"
echo "   1. Start the backend server"
echo "   2. Open the frontend in your browser"
echo "   3. Register a new account"
echo "   4. Connect to your Jira instance"
echo "   5. Sync your data and enjoy!"
echo ""
echo "📖 Documentation: See README.md for more details"
echo ""
