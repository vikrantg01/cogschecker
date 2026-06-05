# Food Cost Calculator - Local Deployment Guide

## Overview
This guide will help you run the Food Cost Calculator application locally with the completed authentication features.

## Prerequisites
- Java 21 (installed)
- Docker (for PostgreSQL and Redis)
- Node.js 18+ (for frontend)

## Quick Start

### 1. Start Database Services (PostgreSQL + Redis)

```bash
# Start PostgreSQL
docker run -d \
  --name foodcost-postgres \
  -e POSTGRES_DB=foodcost \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  postgres:15-alpine

# Start Redis
docker run -d \
  --name foodcost-redis \
  -p 6379:6379 \
  redis:7-alpine
```

### 2. Configure Environment Variables

The application is pre-configured to work with local services. For full functionality, you'll need AWS services (Cognito, SQS, S3), but authentication can work in development mode.

**Backend**: Already configured in `modules/api/src/main/resources/application.properties`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`
- Server: `localhost:8080`

**Frontend**: Create `.env` file in the `frontend/` directory:
```bash
cd frontend
cp .env.example .env
```

Edit `frontend/.env`:
```
VITE_API_BASE_URL=http://localhost:8080/api/v1
```

### 3. Start Backend (Spring Boot API)

```bash
# From project root
cd food-cost-calculator

# Build and run (this will also run Flyway migrations)
./gradlew :modules:api:bootRun
```

The API will start on **http://localhost:8080**

**Available endpoints:**
- Health check: http://localhost:8080/actuator/health
- API base: http://localhost:8080/api/v1

### 4. Start Frontend (React + Vite)

Open a new terminal:

```bash
# Navigate to frontend directory
cd food-cost-calculator/frontend

# Install dependencies (first time only)
npm install

# Start development server
npm run dev
```

The frontend will start on **http://localhost:5173**

## Authentication Features Available

### ✅ Implemented Features:
1. **Email/Password Registration** - `/register`
2. **Email/Password Login** - `/login`
3. **Password Reset Flow** - `/password-reset/request` and `/password-reset/confirm`
4. **Social Login Buttons** - Google and Apple (requires Cognito configuration)
5. **402 Payment Required Handling** - Subscription upgrade prompts

### 🔧 AWS Cognito Configuration (Optional for Full OAuth)

For full social login functionality, you need to configure AWS Cognito:

1. Create a Cognito User Pool
2. Add Google and Apple identity providers
3. Configure App Client with OAuth flows
4. Update environment variables:

```properties
# In application.properties
cognito.domain=https://your-domain.auth.region.amazoncognito.com
cognito.user-pool-id=region_PoolId
cognito.client-id=your-client-id
cognito.client-secret=your-client-secret
cognito.jwks-uri=https://cognito-idp.region.amazonaws.com/region_PoolId/.well-known/jwks.json
```

## Testing the Application

### 1. Access the Frontend
Open your browser to: **http://localhost:5173**

### 2. Test Authentication Flows

**Register a new account:**
1. Click "Create a new account"
2. Fill in email, password (min 8 chars, uppercase, lowercase, number), and display name
3. Submit the form

**Login:**
1. Go to http://localhost:5173/login
2. Enter email and password
3. Click "Sign in"

**Password Reset:**
1. Click "Forgot your password?"
2. Enter your email
3. Check backend logs for the reset code (without SES, codes are only logged)
4. Use the code to reset your password

### 3. Test Social Login (requires Cognito setup)
1. Click "Continue with Google" or "Continue with Apple"
2. Complete OAuth flow through Cognito Hosted UI
3. Redirected back and authenticated

## Troubleshooting

### Database Connection Issues
```bash
# Check if PostgreSQL is running
docker ps | grep foodcost-postgres

# View PostgreSQL logs
docker logs foodcost-postgres

# Restart PostgreSQL
docker restart foodcost-postgres
```

### Backend Issues
```bash
# Check backend logs for errors
./gradlew :modules:api:bootRun

# Common issues:
# - Port 8080 already in use: Kill the process or change server.port
# - Database connection failed: Ensure PostgreSQL container is running
# - Flyway migration errors: Check migration SQL files
```

### Frontend Issues
```bash
# Clear node_modules and reinstall
cd frontend
rm -rf node_modules package-lock.json
npm install

# Check if Vite dev server is running
npm run dev

# Common issues:
# - Port 5173 already in use: Vite will auto-increment to 5174
# - API connection failed: Ensure backend is running on port 8080
```

## Stopping the Application

### Stop Backend
Press `Ctrl+C` in the terminal running the Spring Boot application

### Stop Frontend
Press `Ctrl+C` in the terminal running the Vite dev server

### Stop Database Services
```bash
# Stop containers
docker stop foodcost-postgres foodcost-redis

# Remove containers (optional, to clean up)
docker rm foodcost-postgres foodcost-redis
```

## Available Features by Tier

### ✅ Free Tier (Default)
- Up to 2 venues
- Up to 25 recipes per venue
- All core features (ingredients, recipes, costing, reports)
- Email/password authentication
- Data export/import

### 🔒 Pro Tier (Requires Subscription)
- Unlimited venues
- Unlimited recipes
- Square POS integration
- Invoice OCR processing

### 🔒 Pro+ Tier (Requires Subscription)
- All Pro features
- AI-powered insights
- Advanced analytics

## Next Steps

1. **Configure AWS Cognito** for full OAuth functionality
2. **Set up AWS services** (SQS, S3, Textract, Bedrock) for Pro/Pro+ features
3. **Configure Stripe** for subscription management
4. **Set up Square OAuth** for POS integration
5. **Deploy to production** (EKS cluster via CDK)

## Development Notes

- Flyway migrations run automatically on startup
- H2 console is disabled (using PostgreSQL)
- Virtual threads enabled for improved performance
- CORS configured for localhost:5173 and localhost:3000
- API documentation: Consider adding Swagger/OpenAPI later

## API Endpoints Reference

### Authentication
- `POST /api/v1/auth/register` - Register new user
- `POST /api/v1/auth/login` - Login with email/password
- `POST /api/v1/auth/refresh` - Refresh access token
- `POST /api/v1/auth/logout` - Logout (invalidate sessions)
- `POST /api/v1/auth/password-reset/request` - Request password reset
- `POST /api/v1/auth/password-reset/confirm` - Confirm password reset
- `GET /api/v1/auth/oauth/google` - Initiate Google OAuth
- `GET /api/v1/auth/oauth/apple` - Initiate Apple OAuth
- `POST /api/v1/auth/oauth/token` - Exchange OAuth code for tokens

### Ingredients
- `GET /api/v1/venues/:venueId/ingredients` - List ingredients
- `POST /api/v1/venues/:venueId/ingredients` - Create ingredient
- `GET /api/v1/venues/:venueId/ingredients/:id` - Get ingredient
- `PATCH /api/v1/venues/:venueId/ingredients/:id` - Update ingredient
- `DELETE /api/v1/venues/:venueId/ingredients/:id` - Delete ingredient

### Recipes
- `GET /api/v1/venues/:venueId/recipes` - List recipes
- `POST /api/v1/venues/:venueId/recipes` - Create recipe
- `GET /api/v1/venues/:venueId/recipes/:id` - Get recipe with cost breakdown
- `PATCH /api/v1/venues/:venueId/recipes/:id` - Update recipe
- `DELETE /api/v1/venues/:venueId/recipes/:id` - Delete recipe
- `POST /api/v1/venues/:venueId/recipes/:id/duplicate` - Duplicate recipe

### Reports
- `GET /api/v1/venues/:venueId/reports/costing` - Get costing report
- `GET /api/v1/venues/:venueId/reports/costing/export` - Export CSV

### Data Export/Import
- `GET /api/v1/venues/:venueId/export` - Export venue data as JSON
- `POST /api/v1/venues/:venueId/import` - Import venue data from JSON

## Support

For issues or questions:
1. Check the implementation summary documents (TASK_*.md files)
2. Review the spec files in `.kiro/specs/food-cost-calculator/`
3. Check backend logs for detailed error messages
4. Check browser console for frontend errors
