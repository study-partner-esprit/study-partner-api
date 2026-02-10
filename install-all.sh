#!/bin/bash

# Study Partner API - Install All Dependencies

echo "📦 Installing Study Partner API Dependencies..."

# Install shared package
echo "Installing shared utilities..."
cd shared
npm install
cd ..

# Install service dependencies
services=(
  "api-gateway"
  "auth"
  "user-profile"
  "study"
  "ai-orchestrator"
  "signal-processing"
  "analytics"
)

for service in "${services[@]}"; do
  echo "Installing $service dependencies..."
  cd "services/$service"
  npm install
  cd ../..
done

echo "✅ All dependencies installed successfully!"
echo ""
echo "🚀 To start the services:"
echo "   docker-compose up"
echo ""
echo "Or run individual services in dev mode:"
echo "   cd services/<service-name>"
echo "   npm run dev"
