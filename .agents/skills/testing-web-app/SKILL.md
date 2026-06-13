---
name: testing-ssd-studio-web
description: Test the SSD Studio Next.js web app auth flow and UI. Use when verifying auth middleware, login, route protection, or frontend changes.
---

# Testing SSD Studio Web App

## Prerequisites

- Node.js 20+
- Dependencies installed: `npm install --legacy-peer-deps` from repo root
- Prisma client generated: `cd packages/db && npx prisma generate`

## Starting the Web App (No Backend Needed)

The Next.js middleware runs server-side and doesn't require the API for route protection testing.

```bash
cd apps/web
echo 'NEXT_PUBLIC_API_URL=http://localhost:4000/api
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_NAME=SSD Studio' > .env.local
npm run dev
```

Server starts on `http://localhost:3000`.

## Auth Flow Testing

The auth system has two storage mechanisms that must stay in sync:
- `localStorage` (client-side reads by React components)
- `document.cookie` named `ssd_studio_token` (server-side reads by Next.js middleware)

### Key Test Cases

1. **Route protection without token**: Navigate to `/dashboard` → should redirect to `/login?redirect=%2Fdashboard`
2. **Token storage**: Call `setToken(jwt)` → verify both `localStorage.getItem('ssd_studio_token')` AND `document.cookie` contain the JWT
3. **Route access with token**: Set the cookie → navigate to `/dashboard` → should render "My Bookings" page without redirect
4. **Token removal**: Call `removeToken()` → verify cookie cleared → `/dashboard` redirects again

### Setting a Test Token via Console

```javascript
const TOKEN_KEY = 'ssd_studio_token';
const testToken = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.fake';
localStorage.setItem(TOKEN_KEY, testToken);
document.cookie = `${TOKEN_KEY}=${testToken}; path=/; max-age=${7*24*60*60}; SameSite=Lax`;
```

## Full Stack Testing (Requires Docker)

For testing with the API (login, bookings, Stripe):

```bash
docker compose up -d postgres redis
cd apps/api && npm run dev
cd apps/web && npm run dev
```

Docker might not be available in all environments. If Docker is unavailable, auth middleware and UI testing can still be done without the backend.

## Login Form Validation

- Empty email → "Email is required"
- Invalid email format → "Enter a valid email address"
- Empty password → "Password is required"
- API unreachable → "Network error. Please try again."

## Protected Routes

Middleware config in `apps/web/src/middleware.ts`:
- Protected: `/dashboard`, `/booking`
- Public: `/`, `/login`, `/register`, `/_next`, `/favicon.ico`, `/api`

## Devin Secrets Needed

None required for basic auth flow testing. For full-stack testing:
- Database credentials (defaults in docker-compose: `ssd_user`/`ssd_password`)
- No external API keys needed for local dev
