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
2. Fill in Neon, R2, Recall, ElevenLabs, and Inngest credentials.
3. Run `npm install`.
4. Run `npm run dev`.

## Vendor Webhooks

Recall bot status webhooks are delivered to endpoints configured in the Recall dashboard. ElevenLabs speech to text webhooks are delivered to workspace configured webhooks when transcript jobs set `webhook=true`. Per request webhook metadata is stored only for correlation.

## Verification

```bash
npm run lint
npm run test
npm run build
npx playwright test
```
