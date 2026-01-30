# Study Partner API - Backend Microservices

A scalable microservices architecture for the Study Partner application built with Express.js.

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        API Gateway                               │
│                      (Future: Kong/Nginx)                        │
└─────────────────────────────┬───────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐   ┌─────────────────┐   ┌───────────────┐
│ Auth Service  │   │  User Profile   │   │Study Service  │
│   (3001)      │   │   (3002)        │   │   (3003)      │
├───────────────┤   ├─────────────────┤   ├───────────────┤
│  PostgreSQL   │   │   PostgreSQL    │   │  PostgreSQL   │
└───────────────┘   └─────────────────┘   └───────────────┘
```

## 📦 Services

| Service         | Port | Database             | Description                                  |
| --------------- | ---- | -------------------- | -------------------------------------------- |
| Auth Service    | 3001 | PostgreSQL           | JWT authentication, RBAC, user credentials   |
| User Profile    | 3002 | PostgreSQL           | User profiles, preferences, learning goals   |
| Study Service   | 3003 | PostgreSQL           | Subjects, topics, sessions, tasks, materials |
| AI Orchestrator | 3004 | PostgreSQL + MongoDB | AI agent coordination (planned)              |
| Notification    | 3005 | PostgreSQL           | Email, push notifications (planned)          |
| Analytics       | 3006 | PostgreSQL + MongoDB | Learning analytics (planned)                 |

## 🚀 Quick Start

### Prerequisites

- Node.js >= 20.0.0
- pnpm (recommended) or npm >= 10.0.0
- Docker & Docker Compose
- PostgreSQL 16+

### Installation

```bash
# Install pnpm if not installed
npm install -g pnpm

# Install all dependencies
pnpm install

# Copy environment files for each service
cp services/auth/.env.example services/auth/.env
cp services/user-profile/.env.example services/user-profile/.env
cp services/study/.env.example services/study/.env

# Start all services in development
pnpm run dev:auth &
pnpm run dev:user &
pnpm run dev:study &
```

### Using Docker Compose

```bash
# Start all services with databases
docker-compose up -d

# Start with pgAdmin for database management
docker-compose --profile dev up -d

# View logs
docker-compose logs -f auth-service

# Stop all services
docker-compose down

# Stop and remove volumes (⚠️ destroys data)
docker-compose down -v
```

## 📁 Project Structure

```
study-partner-api/
├── services/
│   ├── auth/                     # Auth & Identity Service
│   │   ├── src/
│   │   │   ├── config/           # Configuration
│   │   │   ├── controllers/      # Route handlers
│   │   │   ├── middlewares/      # Auth, RBAC, validation
│   │   │   ├── models/           # Sequelize models
│   │   │   ├── routes/           # Express routes
│   │   │   ├── services/         # Business logic
│   │   │   ├── utils/            # JWT, password utilities
│   │   │   ├── app.js            # Express app
│   │   │   └── server.js         # Entry point
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── user-profile/             # User Profile Service
│   │   └── (same structure)
│   │
│   └── study/                    # Study Management Service
│       └── (same structure)
│
├── shared/
│   └── utils/                    # Shared utilities
│       ├── logger.js             # Winston logger
│       ├── errors.js             # Error classes
│       └── validation.js         # Joi validation
│
├── docker-compose.yml
├── pnpm-workspace.yaml
└── package.json
```

## 🔌 API Endpoints

### Auth Service (Port 3001)

| Method | Endpoint               | Description                   |
| ------ | ---------------------- | ----------------------------- |
| POST   | `/auth/register`       | Register new user             |
| POST   | `/auth/login`          | Login, get tokens             |
| POST   | `/auth/refresh`        | Refresh access token          |
| POST   | `/auth/logout`         | Logout (revoke refresh token) |
| POST   | `/auth/logout-all`     | Logout from all devices       |
| GET    | `/auth/me`             | Get current user info         |
| GET    | `/roles`               | Get all roles                 |
| POST   | `/roles`               | Create role (admin)           |
| GET    | `/users/:userId/roles` | Get user roles                |
| POST   | `/users/:userId/roles` | Assign role (admin)           |

### User Profile Service (Port 3002)

| Method | Endpoint                       | Description              |
| ------ | ------------------------------ | ------------------------ |
| GET    | `/profile`                     | Get user profile         |
| PUT    | `/profile`                     | Update profile           |
| POST   | `/profile/onboarding/complete` | Mark onboarding complete |
| GET    | `/preferences`                 | Get preferences          |
| PUT    | `/preferences`                 | Update preferences       |
| POST   | `/preferences/reset`           | Reset to defaults        |
| GET    | `/goals`                       | List learning goals      |
| POST   | `/goals`                       | Create goal              |
| PUT    | `/goals/:goalId`               | Update goal              |
| DELETE | `/goals/:goalId`               | Delete goal              |

### Study Service (Port 3003)

| Method | Endpoint              | Description         |
| ------ | --------------------- | ------------------- |
| GET    | `/subjects`           | List subjects       |
| POST   | `/subjects`           | Create subject      |
| GET    | `/subjects/:id/stats` | Get subject stats   |
| GET    | `/sessions`           | List study sessions |
| POST   | `/sessions`           | Create session      |
| POST   | `/sessions/:id/start` | Start session       |
| POST   | `/sessions/:id/end`   | End session         |
| GET    | `/sessions/active`    | Get active session  |
| GET    | `/tasks`              | List tasks          |
| POST   | `/tasks`              | Create task         |
| POST   | `/tasks/:id/complete` | Complete task       |
| GET    | `/tasks/due-soon`     | Get tasks due soon  |
| GET    | `/tasks/overdue`      | Get overdue tasks   |

### Health Checks (All Services)

| Method | Endpoint        | Description             |
| ------ | --------------- | ----------------------- |
| GET    | `/health`       | Basic health check      |
| GET    | `/health/ready` | Readiness (includes DB) |

## 🔐 Authentication

All protected endpoints require a Bearer token:

```bash
# Login to get tokens
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "password123"}'

# Use access token for requests
curl http://localhost:3002/profile \
  -H "Authorization: Bearer <access_token>"

# Refresh token when expired
curl -X POST http://localhost:3001/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "<refresh_token>"}'
```

## 🧪 Testing

```bash
# Run all tests
pnpm test

# Run tests for specific service
pnpm test -w @study-partner/auth-service

# Run with coverage
pnpm test -- --coverage
```

## 🔧 Environment Variables

Each service has its own `.env` file. Key variables:

```bash
# Common
NODE_ENV=development
JWT_SECRET=your-super-secret-key  # Must be same across services

# Auth Service
PORT=3001
DB_HOST=localhost
DB_PORT=5432
DB_NAME=study_partner_auth
DB_USER=postgres
DB_PASSWORD=password
BCRYPT_ROUNDS=12

# User Profile Service
PORT=3002
DB_NAME=study_partner_user_profile
AUTH_SERVICE_URL=http://localhost:3001

# Study Service
PORT=3003
DB_NAME=study_partner_study
```

## 📊 Database Schema

### Auth Service

- `users` - User accounts (id, email, status)
- `credentials` - Password storage (hashed)
- `roles` - Role definitions
- `user_roles` - User-role assignments
- `refresh_tokens` - Token management

### User Profile Service

- `user_profiles` - Profile information
- `user_preferences` - App settings
- `learning_goals` - User goals

### Study Service

- `subjects` - Study subjects
- `topics` - Topics within subjects
- `study_sessions` - Study session records
- `tasks` - Tasks/assignments
- `study_materials` - Notes, resources

## 📝 License

MIT
npm test -- --coverage

````

## 🔧 Development

```bash
# Run linter
npm run lint

# Format code
npm run format

# Check formatting
npm run format:check
````

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
