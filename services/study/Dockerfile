# Study Service Dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy root package files
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./

# Copy shared packages
COPY shared ./shared

# Copy service package
COPY services/study ./services/study

# Install pnpm
RUN npm install -g pnpm

# Install dependencies
RUN pnpm install --frozen-lockfile || pnpm install

WORKDIR /app/services/study

# Expose port
EXPOSE 3003

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3003/health || exit 1

# Start the service
CMD ["node", "src/server.js"]
