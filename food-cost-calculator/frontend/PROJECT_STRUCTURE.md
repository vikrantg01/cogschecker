# Frontend Project Structure

## Overview
React (TypeScript) + Vite SPA for the Food Cost Calculator application.

## Directory Structure

```
frontend/
├── src/
│   ├── features/              # Feature-based modules
│   │   ├── auth/              # Authentication (login, register, password reset)
│   │   ├── ingredients/       # Ingredient management
│   │   ├── recipes/           # Recipe management
│   │   ├── reports/           # Recipe costing reports
│   │   ├── venues/            # Multi-venue management
│   │   ├── account/           # Account settings & subscription
│   │   ├── insights/          # AI insights (Pro+)
│   │   ├── invoices/          # Invoice upload (Pro)
│   │   └── square/            # Square POS integration (Pro)
│   │
│   ├── components/            # Top-level shared components
│   │   ├── Navigation.tsx     # Main navigation menu
│   │   ├── ProtectedRoute.tsx # Authentication guard
│   │   └── VenueSelector.tsx  # Venue dropdown selector
│   │
│   ├── layouts/               # Layout components
│   │   ├── RootLayout.tsx     # Root layout with QueryClientProvider
│   │   ├── AuthLayout.tsx     # Layout for auth pages
│   │   └── MainLayout.tsx     # Main app layout with header
│   │
│   ├── pages/                 # Top-level page components
│   │   └── DashboardPage.tsx  # Dashboard landing page
│   │
│   ├── shared/                # Shared utilities across features
│   │   ├── components/        # Shared UI components (to be implemented)
│   │   ├── hooks/             # Shared React hooks (to be implemented)
│   │   └── utils/             # Utility functions (to be implemented)
│   │
│   ├── store/                 # Zustand state management
│   │   ├── authSlice.ts       # Auth state (token, user, isAuthenticated)
│   │   └── venueSlice.ts      # Venue state (currentVenueId, venues)
│   │
│   ├── lib/                   # Third-party library configurations
│   │   ├── api.ts             # Axios instance with interceptors
│   │   └── queryClient.ts     # React Query client configuration
│   │
│   ├── router/                # React Router configuration
│   │   └── index.tsx          # Route definitions
│   │
│   ├── types/                 # TypeScript type definitions
│   │   └── api.ts             # API entity types
│   │
│   ├── App.tsx                # Root component with RouterProvider
│   └── main.tsx               # Entry point
│
├── public/                    # Static assets
├── dist/                      # Build output (gitignored)
├── node_modules/              # Dependencies (gitignored)
│
├── .env.example               # Environment variable template
├── vite.config.ts             # Vite configuration
├── tsconfig.json              # TypeScript configuration
├── package.json               # Dependencies and scripts
└── README.md                  # Project documentation
```

## State Management Architecture

### Zustand Slices
1. **authSlice**: Manages authentication state
   - Persisted to localStorage
   - Contains: token, refreshToken, user, isAuthenticated
   - Actions: setAuth(), clearAuth()

2. **venueSlice**: Manages venue selection
   - Persisted to localStorage
   - Contains: currentVenueId, venues[]
   - Actions: setCurrentVenue(), setVenues(), getCurrentVenue()

### React Query
- Server-state caching and synchronization
- Automatic cache invalidation via SSE (to be implemented in task 19.3)
- 5-minute stale time, no refetch on window focus

## API Integration

### Axios Instance (`lib/api.ts`)
- Base URL: `VITE_API_BASE_URL` (defaults to `http://localhost:8080/api/v1`)
- Request interceptor: Injects `Authorization` and `X-Venue-ID` headers
- Response interceptor: Handles 401 (token refresh) and 402 (subscription gate)

### Automatic Token Refresh
When a 401 response is received:
1. Attempt to refresh using `/auth/refresh` endpoint
2. Update auth store with new tokens
3. Retry original request
4. If refresh fails, clear auth and redirect to login

## Routing Structure

### Public Routes
- `/auth/login` - Login page
- `/auth/register` - Registration page
- `/auth/password-reset` - Password reset request
- `/auth/password-reset/confirm` - Password reset confirmation

### Protected Routes (require authentication)
- `/` - Dashboard
- `/ingredients` - Ingredient library
- `/recipes` - Recipe list
- `/recipes/:id` - Recipe detail
- `/recipes/new` - Create recipe
- `/recipes/:id/edit` - Edit recipe
- `/reports` - Recipe costing report
- `/venues` - Venue management
- `/account` - Account settings
- `/insights` - AI insights (Pro+)
- `/invoices` - Invoice upload (Pro)
- `/square` - Square POS integration (Pro)

## TypeScript Types

Comprehensive type definitions for:
- API entities (Venue, Ingredient, Recipe, User, etc.)
- Enums (UnitOfMeasure, SubscriptionTier, UserRole)
- API responses (AuthResponse, ApiError, UpgradePrompt)

## Development

### Available Scripts
```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run preview  # Preview production build
npm run lint     # Run ESLint
```

### Environment Variables
Copy `.env.example` to `.env.local` and configure:
- `VITE_API_BASE_URL`: Backend API base URL

## Implementation Status

### ✅ Completed (Task 19.1)
- Project scaffold with Vite
- Feature directory structure
- Zustand store slices (auth, venue)
- React Query configuration
- Axios instance with interceptors
- React Router configuration
- All layouts and placeholder pages
- TypeScript type definitions

### 🔜 Next Steps
- **Task 19.2**: Shared UI components (CostBadge, ThresholdIndicator, UomSelect, UpgradeModal)
- **Task 19.3**: Custom hooks (useSubscriptionGate, useCostPropagation)
- **Tasks 20-26**: Feature implementations

## Design Patterns

### Feature-Based Architecture
Each feature is self-contained with its own:
- Page components
- API hooks (to be implemented)
- Feature-specific components (to be implemented)

### Shared Resources
Common components, hooks, and utilities are in `shared/` for reuse across features.

### Type Safety
All API interactions are fully typed using TypeScript interfaces defined in `types/api.ts`.

## Notes
- All API calls automatically include authentication and venue context headers
- Token refresh is transparent to the application
- Subscription tier gating will be handled via `useSubscriptionGate` hook (task 19.3)
- Real-time cost updates will be handled via `useCostPropagation` hook (task 19.3)
