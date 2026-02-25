# Notification Service Dockerfile
FROM node:20-alpine

WORKDIR /app

# Install curl for health checks
RUN apk add --no-cache curl

# Copy root package files
COPY package.json package-lock.json* ./

# Copy shared packages
COPY shared ./shared

# Copy service package
COPY services/notification ./services/notification

# Install all dependencies from root (includes workspace packages)
RUN npm install

# Change to service directory
WORKDIR /app/services/notification

# Expose port
EXPOSE 3007

# Start the service
CMD ["node", "src/server.js"]
