# Study Partner API - Backend Microservices

Express.js microservices backend for Study Partner application.

## 🚀 Quick Start

### Prerequisites
- Node.js >= 20.0.0
- npm >= 10.0.0
- Docker & Docker Compose (for containerized deployment)

### Installation

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Start development server
npm run dev
```

### Using Docker

```bash
# Build and run all services
docker-compose up -d

# View logs
docker-compose logs -f api

# Stop services
docker-compose down
```

## 📁 Project Structure

```
study-partner-api/
├── src/
│   ├── index.js              # Application entry point
│   ├── app.js                # Express app configuration
│   ├── middleware/           # Custom middleware
│   │   ├── auth.js
│   │   ├── errorHandler.js
│   │   └── notFoundHandler.js
│   ├── routes/               # API routes
│   │   ├── auth.routes.js
│   │   ├── task.routes.js
│   │   ├── session.routes.js
│   │   └── health.routes.js
│   └── utils/                # Utilities
│       └── logger.js
├── tests/                    # Test files
├── .github/workflows/        # CI/CD workflows
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## 🔌 API Endpoints

### Health Check
- `GET /health` - Service health status
- `GET /health/db` - Database connectivity
- `GET /health/redis` - Redis connectivity

### Authentication
- `POST /api/v1/auth/login` - User login
- `POST /api/v1/auth/register` - User registration
- `POST /api/v1/auth/validate` - Validate token

### Tasks
- `GET /api/v1/tasks` - Get all tasks
- `GET /api/v1/tasks/:id` - Get task by ID
- `POST /api/v1/tasks` - Create task
- `PUT /api/v1/tasks/:id` - Update task
- `DELETE /api/v1/tasks/:id` - Delete task

### Sessions
- `GET /api/v1/sessions` - Get all sessions
- `GET /api/v1/sessions/:id` - Get session by ID
- `POST /api/v1/sessions` - Create session
- `PATCH /api/v1/sessions/:id/end` - End session

## 🧪 Testing

```bash
# Run all tests
npm test

# Run unit tests
npm run test:unit

# Run integration tests
npm run test:integration

# Run with coverage
npm test -- --coverage
```

## 🔧 Development

```bash
# Run linter
npm run lint

# Format code
npm run format

# Check formatting
npm run format:check
```

## 🐳 Docker Commands

```bash
# Build image
npm run docker:build

# Run container
npm run docker:run

# Using docker-compose
docker-compose up -d        # Start all services
docker-compose down         # Stop all services
docker-compose logs -f api  # View logs
```

## 🌍 Environment Variables

See `.env.example` for all available configuration options.

## 📊 Monitoring

The API includes:
- Winston logging
- Morgan HTTP request logging
- Health check endpoints
- Error tracking

## 🔒 Security Features

- Helmet.js for security headers
- CORS configuration
- Rate limiting
- JWT authentication
- Input validation
- Password hashing with bcrypt

## 📝 License

MIT
