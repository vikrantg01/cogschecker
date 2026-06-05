# Task 20.2: Google and Apple Social Login Buttons Implementation

## Overview
Implemented Google and Apple social login buttons using Cognito hosted UI OAuth redirect flow on both the Login and Register pages.

## Implementation Details

### 1. Frontend - Login Page
**File**: `frontend/src/features/auth/LoginPage.tsx`

The Login page already had social login buttons implemented (from task 20.1):
- Google login button with branded icon
- Apple login button with branded icon
- Both buttons call `handleSocialLogin(provider)` which redirects to backend OAuth initiation endpoints
- Redirect URLs: `/api/v1/auth/oauth/google` and `/api/v1/auth/oauth/apple`

### 2. Frontend - Register Page
**File**: `frontend/src/features/auth/RegisterPage.tsx`

Implemented complete registration page with:
- Email/password registration form with validation
- Display name input field
- Password confirmation field
- Password requirements displayed (8+ chars, uppercase, lowercase, digit)
- **Google and Apple social login buttons** (matching Login page design)
- Social login buttons redirect to backend OAuth endpoints
- Consistent UI/UX with Login page

### 3. Frontend - OAuth Callback Handler
**File**: `frontend/src/features/auth/OAuthCallbackPage.tsx`

Created OAuth callback page that:
- Extracts authorization code or error from URL parameters
- Displays loading state while processing
- Handles error cases with user-friendly messages
- Includes detailed implementation notes about token exchange
- Provides "Return to login" button

**Route**: Added `/auth/callback` route to `frontend/src/router/index.tsx`

### 4. Backend - OAuth Callback Handlers
**File**: `modules/api/src/main/java/com/cogschecker/foodcost/api/controller/AuthController.java`

Modified OAuth callback handlers to redirect to frontend instead of returning JSON:

#### Google OAuth Callback:
```java
@GetMapping("/oauth/google/callback")
public RedirectView handleGoogleCallback(...)
```
- Changed return type from `ResponseEntity<?>` to `RedirectView`
- Redirects to `http://localhost:5173/auth/callback` with code or error parameters
- URL-encodes parameters for safe transmission

#### Apple OAuth Callback:
```java
@GetMapping("/oauth/apple/callback")
public RedirectView handleAppleCallback(...)
```
- Same redirect pattern as Google
- Redirects to frontend callback page with parameters

### 5. OAuth Flow

**Complete OAuth Flow**:
1. User clicks "Continue with Google" or "Continue with Apple" button
2. Frontend redirects to backend endpoint: `/api/v1/auth/oauth/{provider}`
3. Backend constructs Cognito Hosted UI URL and redirects browser
4. User authenticates with Google/Apple via Cognito Hosted UI
5. Cognito redirects back to backend callback: `/api/v1/auth/oauth/{provider}/callback?code=xxx`
6. Backend receives authorization code and redirects to frontend: `http://localhost:5173/auth/callback?code=xxx`
7. Frontend OAuth callback page receives the code
8. **TODO (future task)**: Frontend calls backend token exchange endpoint
9. **TODO (future task)**: Backend exchanges code for tokens with Cognito token endpoint using client secret
10. **TODO (future task)**: Backend returns JWT tokens to frontend
11. **TODO (future task)**: Frontend stores tokens and redirects to dashboard

## Testing

### Backend Tests
**File**: `modules/api/src/test/java/com/cogschecker/foodcost/api/controller/AuthControllerTest.java`

Existing OAuth tests updated to expect `RedirectView` instead of `ResponseEntity`:
- ✅ Google OAuth initiation redirects to Cognito Hosted UI
- ✅ Google OAuth callback with valid code redirects to frontend
- ✅ Google OAuth callback with error redirects to frontend with error
- ✅ Apple OAuth initiation redirects to Cognito Hosted UI
- ✅ Apple OAuth callback with valid code redirects to frontend
- ✅ Apple OAuth callback with error redirects to frontend with error

**Test Result**: All AuthController tests pass (BUILD SUCCESSFUL)

### Manual Testing
To test the social login flow manually:
1. Start backend: `cd food-cost-calculator && ./gradlew :modules:api:bootRun`
2. Start frontend: `cd frontend && npm run dev`
3. Navigate to http://localhost:5173/login
4. Click "Continue with Google" or "Continue with Apple"
5. Observe redirect to backend, then to frontend callback page
6. Callback page will show implementation note about token exchange

## Requirements Validated

✅ **Requirement 8.3**: Google social login provider support
- Users can initiate Google OAuth flow via button
- System redirects to Cognito Hosted UI with Google identity provider
- Callback endpoint receives authorization code from Cognito

✅ **Requirement 8.4**: Apple social login provider support
- Users can initiate Apple OAuth flow via button
- System redirects to Cognito Hosted UI with Apple identity provider
- Callback endpoint receives authorization code from Cognito

✅ **Requirement 8.5**: Account creation on first social login (delegated to Cognito)
✅ **Requirement 8.6**: Account linking when email matches existing account (delegated to Cognito)

## Files Modified

### Frontend
- `frontend/src/features/auth/RegisterPage.tsx` - Added social login buttons
- `frontend/src/router/index.tsx` - Added OAuth callback route

### Backend
- `modules/api/src/main/java/com/cogschecker/foodcost/api/controller/AuthController.java` - Changed callback handlers to redirect to frontend

## Files Created

### Frontend
- `frontend/src/features/auth/OAuthCallbackPage.tsx` - OAuth callback handler page

## Production Deployment Notes

### Environment Variables
The backend callback handlers currently use hardcoded localhost URL for frontend callback. Update for production:

```java
// Current (development):
String frontendCallbackUrl = "http://localhost:5173/auth/callback";

// Production should use environment variable:
@Value("${frontend.callback-url:http://localhost:5173/auth/callback}")
private String frontendCallbackUrl;
```

Add to `application.properties`:
```properties
frontend.callback-url=${FRONTEND_CALLBACK_URL:http://localhost:5173/auth/callback}
```

### Cognito Configuration
Before deploying to production, ensure:
1. Google OAuth client credentials configured in Cognito User Pool
2. Apple Sign In credentials configured in Cognito User Pool
3. Hosted UI domain set up in Cognito
4. Allowed callback URLs include both backend endpoints:
   - `https://api.yourdomain.com/api/v1/auth/oauth/google/callback`
   - `https://api.yourdomain.com/api/v1/auth/oauth/apple/callback`
5. Custom attributes for venue_roles and tier added to user pool schema

### Next Steps (Future Task)

#### Token Exchange Endpoint
The OAuth flow currently stops at the callback page because token exchange is not yet implemented. A future task should:

1. **Create backend token exchange endpoint**: `POST /api/v1/auth/oauth/token`
   - Accepts authorization code from frontend
   - Calls Cognito token endpoint with client secret
   - Exchanges code for JWT access token and refresh token
   - Extracts user information from ID token
   - Creates or updates user record in database
   - Returns tokens to frontend

2. **Update frontend callback page** to call the token exchange endpoint
3. **Store tokens** in frontend auth store
4. **Redirect to dashboard** on successful authentication

## Architecture Notes

### Security Considerations
- Authorization code is single-use and time-limited by Cognito
- HTTPS required for all OAuth flows (enforced by Cognito)
- Client secret never exposed to frontend (token exchange must be server-side)
- State parameter validation handled by Cognito

### Delegation to Cognito
All authentication logic is fully delegated to Amazon Cognito:
- User credential handling
- OAuth provider integration (Google, Apple)
- Account creation and linking
- Token issuance and management

The backend endpoints serve as lightweight redirectors and callback handlers.

## Summary

Task 20.2 has been successfully implemented. Google and Apple social login buttons have been added to both the Login and Register pages, and the OAuth redirect flow is fully functional up to the callback stage. The buttons are properly styled with brand icons, and clicking them initiates the OAuth flow through the backend to Cognito Hosted UI.

The OAuth callback handlers now properly redirect to the frontend with the authorization code. The final step of token exchange will need to be implemented in a future task to complete the end-to-end social login flow.

All backend tests pass, and the implementation follows the OAuth 2.0 authorization code flow pattern with Cognito as the identity provider.
