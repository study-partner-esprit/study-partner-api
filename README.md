# Study Partner API - Microservices Backend

Express.js microservices architecture for the Study Partner platform.

## Architecture

### Services

1. **API Gateway** (Port 8000) - Request routing and load balancing
2. **Auth Service** (Port 8001) - Authentication and authorization (JWT, RBAC)
3. **User Profile Service** (Port 8002) - User settings, preferences, goals, stats
4. **Study Management Service** (Port 8003) - Tasks, topics, study sessions
5. **AI Orchestrator Service** (Port 8004) - Integrates Course Ingestion, Planner, Scheduler, Coach agents
6. **Signal Processing Service** (Port 8005) - Focus tracking, eye tracking, biometric analysis
7. **Analytics Service** (Port 8006) - Data analytics, reporting, insights

### Tech Stack

- **Runtime**: Node.js with Express.js (JavaScript)
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JWT with bcryptjs
- **Logging**: Winston
- **Rate Limiting**: express-rate-limit
- **Orchestration**: Docker + docker-compose

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
- `POST /api/v1/ai/plan` - Generate study plan
- `POST /api/v1/ai/schedule` - Schedule tasks
- `POST /api/v1/ai/coach` - Get coach advice
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

## Authentication

All protected endpoints require a JWT token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

Get a token by registering or logging in via the Auth Service.

## Health Checks

Each service exposes a health check endpoint:
- `/api/v1/health`

## Shared Utilities

Located in `/shared` directory:

- **auth.js** - JWT and password hashing utilities
- **database.js** - MongoDB connection management
- **middleware.js** - CORS, logging, rate limiting, error handling
- **logger.js** - Winston logger configuration

## Integration with AI Agents

The AI Orchestrator service communicates with the Python AI agents via HTTP at `http://localhost:5000`.

## Development

### Testing
```bash
npm test
```

### Linting
```bash
npm run lint
```

## License

MIT
