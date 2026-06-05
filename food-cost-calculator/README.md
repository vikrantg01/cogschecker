# Food Cost Calculator

A multi-tenant SaaS application for restaurant food cost management with real-time cost propagation, recipe costing, and subscription-based tiers.

## 🚀 Quick Start

### Prerequisites
- **Java 21** (required)
- **Docker Desktop** (for PostgreSQL and Redis)
- **Node.js 18+** (for frontend)

### 1. Start Database Services

**Important**: Start Docker Desktop first!

```bash
./start-services.sh
```

This will start:
- PostgreSQL on `localhost:5432`
- Redis on `localhost:6379`

### 2. Start Backend API

```bash
./gradlew :modules:api:bootRun
```

Backend will be available at: **http://localhost:8080**

- API base: http://localhost:8080/api/v1
- Health check: http://localhost:8080/actuator/health

### 3. Start Frontend

Open a new terminal:

```bash
cd frontend
npm install     # First time only
npm run dev
```

Frontend will be available at: **http://localhost:5173**

## ✨ Features

### ✅ Currently Implemented

#### Authentication & User Management
- Email/password registration with validation
- Email/password login
- Password reset flow (request + confirm)
- Google and Apple social login (OAuth via Cognito)
- JWT-based authentication
- Session management and logout
- 402 Payment Required handling with upgrade prompts

#### Core Features
- **Ingredients**: CRUD operations with cost calculation
- **Recipes**: Multi-level recipes with sub-recipes
- **Cost Calculation**: Automatic cost propagation through recipe hierarchy
- **UOM Conversion**: Weight, volume, and count conversions
- **Reports**: Sortable costing reports with CSV export
- **Data Export/Import**: JSON-based venue data backup/restore
- **Multi-Venue**: Support for multiple venues per organization
- **RBAC**: Role-based access control (Admin, Manager, Staff)
- **Subscription Tiers**: Free, Pro, Pro+ with feature gates

### 🔧 Requires Configuration

#### Pro/Pro+ Features
- **Square POS Integration**: Requires Square OAuth setup
- **Invoice OCR**: Requires AWS Textract configuration
- **AI Insights**: Requires AWS Bedrock configuration
- **Stripe Payments**: Requires Stripe API keys

## 🏗️ Architecture

### Tech Stack

**Backend:**
- Java 21 + Spring Boot 3.3
- PostgreSQL 15 (Aurora in production)
- Redis 7 (ElastiCache in production)
- AWS Cognito (authentication)
- AWS SQS (async processing)
- Flyway (database migrations)

**Frontend:**
- React 18 + TypeScript
- Vite (build tool)
- Zustand (state management)
- React Query (data fetching)
- TailwindCSS (styling)
- React Router (routing)

**Infrastructure (Production):**
- Amazon EKS (Kubernetes)
- Aurora PostgreSQL Serverless v2
- ElastiCache Redis
- Amazon SQS FIFO queues
- Amazon S3 (file storage)
- AWS CDK (Infrastructure as Code)

### Project Structure

```
food-cost-calculator/
├── modules/
│   ├── api/          # Spring Boot REST API
│   ├── workers/      # Background workers (SQS consumers)
│   └── shared/       # Shared domain logic
├── frontend/         # React + Vite frontend
├── infra/           # AWS CDK infrastructure (TypeScript)
├── .kiro/           # Spec and requirements
└── build.gradle     # Root Gradle configuration
```

## 📖 Usage Guide

### Register a New Account

1. Go to http://localhost:5173/register
2. Fill in:
   - Display Name
   - Email
   - Password (min 8 chars, uppercase, lowercase, number)
   - Confirm Password
3. Click "Create account"
4. You'll be logged in automatically (auto-confirm in development)

### Login

1. Go to http://localhost:5173/login
2. Enter email and password
3. Click "Sign in"

### Password Reset

1. Click "Forgot your password?"
2. Enter your email
3. Check backend logs for the reset code (since AWS SES isn't configured locally)
4. Go to "I have a reset code"
5. Enter email, code, and new password

### Social Login (Requires Cognito Setup)

1. Click "Continue with Google" or "Continue with Apple"
2. Authenticate through Cognito Hosted UI
3. Automatically redirected back and logged in

### Create Ingredients

1. Navigate to Ingredients page
2. Click "Add Ingredient"
3. Fill in:
   - Name
   - Purchase Price
   - Purchase Quantity
   - Purchase UOM (unit of measure)
   - Yield percentage (usable portion)
4. Save

### Create Recipes

1. Navigate to Recipes page
2. Click "New Recipe"
3. Fill in:
   - Recipe name
   - Portion count
   - Add ingredient lines:
     - Select ingredient
     - Enter quantity
     - Select UOM
4. View cost breakdown in real-time
5. Save

### View Reports

1. Navigate to Reports page
2. View costing report with:
   - Recipe name
   - Food cost per portion
   - Menu selling price (if set)
   - Food cost percentage
3. Sort by any column
4. Filter recipes exceeding threshold
5. Export to CSV

## 🔐 Authentication Flow

### Email/Password Flow

```
Register → Email sent (auto-confirmed in dev) → Login → Dashboard
```

### Social Login Flow

```
Click "Continue with Google/Apple"
  ↓
Redirect to Cognito Hosted UI
  ↓
User authenticates with provider
  ↓
Cognito creates/links account
  ↓
Redirect back with auth code
  ↓
Exchange code for JWT tokens
  ↓
Store tokens → Dashboard
```

### Token Management

- Access token: 1 hour expiry
- Refresh token: 30 days expiry
- Auto-refresh on 401 errors
- Logout invalidates all sessions

## 🎯 Subscription Tiers

### Free Tier (Default)
- ✅ 2 venues maximum
- ✅ 25 recipes per venue
- ✅ All core features
- ✅ Email/password auth
- ✅ Data export/import

### Pro Tier
- ✅ Unlimited venues
- ✅ Unlimited recipes
- ✅ Square POS integration
- ✅ Invoice OCR
- 💰 $29/month

### Pro+ Tier
- ✅ All Pro features
- ✅ AI-powered insights
- ✅ Advanced analytics
- 💰 $99/month

## 🧪 Testing

### Run Backend Tests

```bash
# All tests
./gradlew test

# Specific module
./gradlew :modules:api:test
./gradlew :modules:shared:test

# Property-based tests only
./gradlew :modules:shared:test --tests "*PropertyTest"
```

### Run Frontend Tests

```bash
cd frontend
npm test
```

### Manual Testing Checklist

Authentication:
- [ ] Register new account
- [ ] Login with email/password
- [ ] Request password reset
- [ ] Confirm password reset
- [ ] Logout

Core Features:
- [ ] Create ingredient
- [ ] Edit ingredient (triggers cost propagation)
- [ ] Delete ingredient (shows affected recipes)
- [ ] Create recipe with ingredients
- [ ] Create recipe with sub-recipes
- [ ] View recipe cost breakdown
- [ ] Export venue data to JSON
- [ ] Import venue data from JSON
- [ ] View costing report
- [ ] Sort report by columns
- [ ] Export report to CSV

## 🛠️ Development

### Backend Development

```bash
# Run with hot reload (Spring DevTools)
./gradlew :modules:api:bootRun

# Build
./gradlew build

# Clean build
./gradlew clean build

# Run specific tests
./gradlew :modules:api:test --tests "AuthControllerTest"
```

### Frontend Development

```bash
cd frontend

# Start dev server with hot reload
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Lint
npm run lint
```

### Database Migrations

Migrations are in `modules/api/src/main/resources/db/migration/`

```bash
# Migrations run automatically on startup

# To create a new migration:
# 1. Create file: V{next_number}__description.sql
# 2. Write your SQL
# 3. Restart the application
```

### Adding New Features

1. Update requirements in `.kiro/specs/food-cost-calculator/requirements.md`
2. Add tasks to `.kiro/specs/food-cost-calculator/tasks.md`
3. Implement backend changes in `modules/api/`
4. Write tests (unit + integration)
5. Implement frontend changes in `frontend/src/`
6. Test end-to-end

## 📊 API Documentation

Full API documentation is available in the deployment guide: `DEPLOYMENT_GUIDE.md`

### Key Endpoints

**Authentication:**
- `POST /api/v1/auth/register` - Register
- `POST /api/v1/auth/login` - Login
- `POST /api/v1/auth/refresh` - Refresh token
- `POST /api/v1/auth/logout` - Logout
- `POST /api/v1/auth/password-reset/request` - Request reset
- `POST /api/v1/auth/password-reset/confirm` - Confirm reset
- `GET /api/v1/auth/oauth/google` - Google OAuth
- `GET /api/v1/auth/oauth/apple` - Apple OAuth
- `POST /api/v1/auth/oauth/token` - Exchange OAuth code

**Ingredients:**
- `GET /api/v1/venues/:venueId/ingredients` - List
- `POST /api/v1/venues/:venueId/ingredients` - Create
- `PATCH /api/v1/venues/:venueId/ingredients/:id` - Update
- `DELETE /api/v1/venues/:venueId/ingredients/:id` - Delete

**Recipes:**
- `GET /api/v1/venues/:venueId/recipes` - List
- `POST /api/v1/venues/:venueId/recipes` - Create
- `GET /api/v1/venues/:venueId/recipes/:id` - Get with cost breakdown
- `PATCH /api/v1/venues/:venueId/recipes/:id` - Update
- `DELETE /api/v1/venues/:venueId/recipes/:id` - Delete
- `POST /api/v1/venues/:venueId/recipes/:id/duplicate` - Duplicate

**Reports:**
- `GET /api/v1/venues/:venueId/reports/costing` - Costing report
- `GET /api/v1/venues/:venueId/reports/costing/export` - Export CSV

## 🐛 Troubleshooting

### Docker Issues

**"Docker daemon is not running"**
```bash
# Start Docker Desktop from Applications
# Then run: ./start-services.sh
```

**"Port already in use"**
```bash
# Stop existing containers
docker stop foodcost-postgres foodcost-redis

# Or kill processes using the ports
lsof -ti:5432 | xargs kill -9  # PostgreSQL
lsof -ti:6379 | xargs kill -9  # Redis
```

### Backend Issues

**"Cannot connect to database"**
```bash
# Check if PostgreSQL is running
docker ps | grep foodcost-postgres

# View logs
docker logs foodcost-postgres

# Restart
docker restart foodcost-postgres
```

**"Port 8080 already in use"**
```bash
# Find process using port 8080
lsof -ti:8080

# Kill it
lsof -ti:8080 | xargs kill -9

# Or change port in application.properties
# server.port=8081
```

**"Flyway migration failed"**
```bash
# Drop and recreate database
docker exec -it foodcost-postgres psql -U postgres -c "DROP DATABASE foodcost;"
docker exec -it foodcost-postgres psql -U postgres -c "CREATE DATABASE foodcost;"

# Restart backend
./gradlew :modules:api:bootRun
```

### Frontend Issues

**"Cannot connect to API"**
- Check backend is running: http://localhost:8080/actuator/health
- Check `.env` file has correct API URL
- Check browser console for CORS errors

**"npm install fails"**
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
```

**"Port 5173 already in use"**
- Vite will auto-increment to 5174
- Or kill the process: `lsof -ti:5173 | xargs kill -9`

## 📝 Configuration

### Environment Variables

**Backend** (application.properties):
- `DATABASE_URL` - PostgreSQL connection URL
- `REDIS_HOST` - Redis host
- `COGNITO_*` - Cognito configuration
- `AWS_*` - AWS credentials and region
- `STRIPE_*` - Stripe API keys
- `SQUARE_*` - Square OAuth configuration

**Frontend** (.env):
- `VITE_API_BASE_URL` - Backend API URL

### AWS Services Configuration

For full functionality, configure:
1. **AWS Cognito** - User authentication
2. **AWS SQS** - Async job processing
3. **AWS S3** - File storage
4. **AWS Textract** - Invoice OCR
5. **AWS Bedrock** - AI insights
6. **AWS KMS** - Encryption keys

### External Services

- **Stripe** - Payment processing
- **Square** - POS integration
- **Amazon SES** - Email delivery

## 🚀 Deployment

### Production Deployment

The application is designed to run on AWS EKS. Infrastructure is defined in the `infra/` directory using AWS CDK.

```bash
cd infra

# Install dependencies
npm install

# Deploy to AWS
cdk deploy --all
```

See `DEPLOYMENT_GUIDE.md` for detailed production deployment instructions.

## 📚 Documentation

- `DEPLOYMENT_GUIDE.md` - Complete deployment instructions
- `.kiro/specs/food-cost-calculator/requirements.md` - Detailed requirements
- `.kiro/specs/food-cost-calculator/tasks.md` - Implementation tasks
- `TASK_*.md` files - Individual task implementation summaries

## 🤝 Contributing

1. Review requirements in `.kiro/specs/food-cost-calculator/`
2. Check tasks in `tasks.md`
3. Implement changes
4. Write tests
5. Update documentation

## 📄 License

Proprietary - All rights reserved

## 🆘 Support

For issues or questions:
1. Check this README
2. Review `DEPLOYMENT_GUIDE.md`
3. Check implementation summaries (TASK_*.md)
4. Review spec files in `.kiro/specs/`
5. Check backend logs for detailed errors
6. Check browser console for frontend errors

---

**Status:** ✅ Authentication features complete | 🚧 Pro/Pro+ features require AWS configuration

**Last Updated:** 2024
