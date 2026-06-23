# Meeting Transcript

Team meeting transcript product.

## Stack

1. Next.js on Vercel
2. Neon Auth for Google OAuth
3. Neon Postgres for product data
4. Cloudflare R2 for media
5. Recall.ai for Google Meet and Zoom capture
6. ElevenLabs for transcription
7. Inngest style workers for long running jobs

## Local Setup

1. Copy `.env.example` to `.env.local`.
2. Fill in Neon, R2, Recall, ElevenLabs, and Inngest credentials. `NEON_AUTH_BASE_URL` is optional when `NEON_AUTH_JWKS_URL` ends with `/.well-known/jwks.json`; generate `NEON_AUTH_COOKIE_SECRET` with `openssl rand -base64 32`.
3. Run `npm install`.
4. Run `npm run dev`.

## Auth

The app uses Neon Auth through the official Next.js SDK. Browser auth requests are proxied through `/api/auth/[...path]`, the landing page routes users to `/auth/sign-in`, and server code reads the current user from Neon Auth sessions instead of a hand rolled JWT cookie.
Dashboard, meeting transcript, and team settings pages require an authenticated session. Anonymous visitors are redirected to `/auth/sign-in`.

## Meeting Links

The new meeting page posts Google Meet and Zoom links to `/api/meetings/link`. The route requires an authenticated Neon Auth session, rejects unsupported meeting hosts, and schedules a Recall bot with `/api/recall/webhook` as the callback URL.

## Vendor Webhooks

Recall bot status webhooks are delivered to endpoints configured in the Recall dashboard. ElevenLabs speech to text webhooks are delivered to workspace configured webhooks when transcript jobs set `webhook=true`. Both webhook routes verify vendor signatures from the raw request body before parsing the event. Per request webhook metadata is stored only for correlation.

## Verification

```bash
npm run lint
npm run test
npm run build
npx playwright test
```
