# User Profile Service Dockerfile
FROM node:20-alpine

WORKDIR /app

# Install curl for health checks
RUN apk add --no-cache curl

# Copy root package files
COPY package.json package-lock.json* ./

# Copy shared packages
COPY shared ./shared

# Copy service package
COPY services/user-profile ./services/user-profile

# Install all dependencies from root
RUN npm install

# Change to service directory
WORKDIR /app/services/user-profile

# Expose port
EXPOSE 3002

# Start the service
CMD ["node", "src/server.js"]
