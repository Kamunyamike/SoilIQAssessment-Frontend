# SoilIQ PWA

## Run locally

1. Install Node.js 20+
2. Run `npm install`
3. Copy `.env.example` to `.env` and adjust `VITE_API_BASE_URL` if needed
4. Run `npm run dev`
5. Open http://localhost:3000

## Build

Run `npm run build`

## Git safety

- Keep local secrets in `.env` and do not commit it
- Build output in `dist/` is ignored by git
- The frontend uses the Go backend at https://kenya-ai-challenge-1.onrender.com/ by default
