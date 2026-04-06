# Study Partner API - Microservices Backend

Express.js microservices architecture for the Study Partner platform.

## Architecture

### Services

| Service              | Port | Description                                    |
| -------------------- | ---- | ---------------------------------------------- |
| API Gateway          | 3000 | Request routing, rate limiting, monitoring     |
| Auth Service         | 3001 | JWT authentication & RBAC                      |
| User Profile Service | 3002 | Profiles, availability, gamification           |
| Study Service        | 3003 | Tasks, topics, sessions, courses, plans        |
| AI Orchestrator      | 3004 | Proxies to Python AI (planner, coach, signals) |
| Signal Processing    | 3005 | Focus session tracking                         |
| Analytics Service    | 3006 | Event tracking & insights                      |
| Notification Service | 3007 | In-app notifications                           |
| Python AI Service    | 8000 | ML models, course ingestion, coaching          |

### Tech Stack

- **Runtime**: Node.js 20+ / Express.js
- **Database**: MongoDB 7 with Mongoose ODM
- **Authentication**: JWT (bcryptjs + jsonwebtoken)
- **Logging**: Winston (structured JSON, request IDs via UUID)
- **Rate Limiting**: express-rate-limit (via `@study-partner/shared`)
- **CORS**: cors package (via `@study-partner/shared`)
- **Orchestration**: Docker Compose (9 containers on `study-partner-network`)

## Getting Started

### Prerequisites

- Node.js 18+
- Docker and Docker Compose
- npm or pnpm

### Installation

1. Install shared dependencies:

```bash
cd shared
npm install
cd ..
```

2. Install service dependencies:

```bash
# Install for each service
cd services/api-gateway && npm install && cd ../..
cd services/auth && npm install && cd ../..
cd services/user-profile && npm install && cd ../..
cd services/study && npm install && cd ../..
cd services/ai-orchestrator && npm install && cd ../..
cd services/signal-processing && npm install && cd ../..
cd services/analytics && npm install && cd ../..
```

### Running with Docker Compose

Start all services:

```bash
cd /home/vanitas/Desktop/study-partner
docker-compose up
```

Start specific services:

```bash
docker-compose up mongo api-gateway auth-service
```

### Running Locally (Development)

1. Start MongoDB:

```bash
docker-compose up mongo
```

2. Run individual services:

```bash
# API Gateway
cd services/api-gateway
npm run dev

# Auth Service
cd services/auth
npm run dev

# ... repeat for other services
```

### Environment Variables

Create `.env` files in each service directory:

```env
# Common variables for all services
PORT=800X
MONGODB_URI=mongodb://admin:admin123@localhost:27017/study_partner
JWT_SECRET=your-super-secret-jwt-key-change-in-production
NODE_ENV=development

# AI Orchestrator specific
AI_SERVICE_URL=http://localhost:5000
```

## API Endpoints

### API Gateway

All requests go through the gateway at `http://localhost:8000`

### Auth Service

- `POST /api/v1/auth/register` - Register new user
- `POST /api/v1/auth/login` - Login user
- `GET /api/v1/auth/me` - Get current user (protected)

### User Profile Service

- `GET /api/v1/users/profile` - Get user profile
- `PUT /api/v1/users/profile` - Update profile
- `GET /api/v1/users/profile/stats` - Get user stats
- `GET /api/v1/users/profile/goals` - Get user goals
- `POST /api/v1/users/profile/goals` - Add new goal

### Study Management Service

- `GET /api/v1/study/tasks` - Get all tasks
- `POST /api/v1/study/tasks` - Create task
- `PUT /api/v1/study/tasks/:id` - Update task
- `DELETE /api/v1/study/tasks/:id` - Delete task
- `GET /api/v1/study/topics` - Get all topics
- `POST /api/v1/study/topics` - Create topic
- `GET /api/v1/study/sessions` - Get study sessions
- `POST /api/v1/study/sessions` - Log study session

### AI Orchestrator Service

- `POST /api/v1/ai/ingest` - Ingest course content
- `POST /api/v1/ai/plan/create` - Create study plan (fetches user availability, calls Python AI)
- `GET /api/v1/ai/plan/list` - Get user's study plans
- `POST /api/v1/ai/schedule` - Schedule tasks
- `POST /api/v1/ai/coach` - Get coach advice
- `GET /api/v1/ai/coach/history/:userId` - Get coach history
- `POST /api/v1/ai/signals/analyze-frame` - Analyse video frame (proxy → Python AI)
- `GET /api/v1/ai/signals/current/:userId` - Current signal snapshot
- `GET /api/v1/ai/signals/history/:userId` - Signal history
- `POST /api/v1/ai/signals/process` - Trigger signal processing
- `GET /api/v1/ai/signals/latest/:userId` - Latest analysed signals
- `GET /api/v1/ai/status` - Check AI agents status

### Signal Processing Service

- `POST /api/v1/signals/focus/start` - Start focus tracking
- `POST /api/v1/signals/focus/:id/data` - Add focus data point
- `POST /api/v1/signals/focus/:id/end` - End focus session
- `GET /api/v1/signals/focus/:id` - Get focus session details
- `GET /api/v1/signals/focus/stats/summary` - Get focus statistics

### Analytics Service

- `POST /api/v1/analytics/track` - Track event
- `GET /api/v1/analytics/timeline` - Get activity timeline
- `GET /api/v1/analytics/summary` - Get activity summary
- `GET /api/v1/analytics/insights` - Get insights

### Notification Service

- `GET /api/v1/notifications` - Get user notifications
- `POST /api/v1/notifications` - Create notification
- `PATCH /api/v1/notifications/:id/read` - Mark as read
- `POST /api/v1/notifications/mark-all-read` - Mark all as read
- `DELETE /api/v1/notifications/:id` - Delete notification
- `GET /api/v1/notifications/unread-count` - Get unread count

## Authentication

All protected endpoints require a JWT token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

Get a token by registering or logging in via the Auth Service.

## Health Checks

Each service exposes a health check endpoint:

- `/api/v1/health` — individual service

Aggregate monitoring (via API Gateway):

- `GET /api/v1/monitoring/health` — pings all services, returns combined status
- `GET /api/v1/monitoring/metrics` — request count, error rate, uptime

Run the health check script from the project root:

```bash
./health-check.sh
```

## Shared Utilities (`@study-partner/shared`)

All services import from the shared package (`file:../../shared`):

| Module          | Exports                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| `auth.js`       | `hashPassword`, `verifyPassword`, `generateToken`, `verifyToken`, `authenticate` (JWT middleware), `requireRole`  |
| `middleware.js` | `corsMiddleware()`, `loggingMiddleware`, `errorHandler`, `rateLimiter(max, windowMs)`, `healthCheck(serviceName)` |
| `database.js`   | `connectDatabase`, `disconnectDatabase`                                                                           |
| `logger.js`     | Winston logger instance (structured JSON, console + file transports)                                              |

## Integration with AI Service

The AI Orchestrator communicates with the Python AI service at `AI_SERVICE_URL` (default: `http://study-partner-ai:8000` in Docker, `http://localhost:8000` locally).

**All frontend AI calls are routed through the gateway** — the frontend never contacts the Python service directly.

## Development

### Testing

```bash
npm test
```

### Linting

```bash
npm run lint
```
