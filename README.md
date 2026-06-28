# SoilIQ Assessment Frontend

> **Progressive Web App for Kenyan extension workers doing field soil assessments.**  
> Built for the Kenya AI Challenge — demoed live in front of Microsoft Nairobi engineers, Neo4j CTO, and Mercy Corps AgriFin judges.

---

## What is SoilIQ?

SoilIQ is a soil intelligence PWA designed for **James Kamau** — an extension officer standing in a maize field in Njoro, Nakuru at 7:30 am with 11 farm visits ahead and dirty hands. It requires **one-thumb operation**, large text, and Swahili-first content.

It gives farmers and extension workers:
- 🎙️ **Voice note capture** — speak in Swahili/English, AI refines the transcription with crop + county context
- 📷 **Photo soil analysis** — upload a field photo for instant AI visual diagnostics
- 📋 **Structured form** — crop picker, pH slider, symptom selector
- 🗺️ **Live Leaflet map** — GPS-tracked farm pins with urgency color coding and popup details
- 📊 **Pattern trends** — clustering analysis of multi-farm intervention levels
- 🔊 **Audio readout** — Swahili SpeechSynthesis (`sw-KE`, 0.85× rate) for low-literacy farmers
- 📤 **Web Share** — share advisory cards via SMS/WhatsApp

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 18 + Vite 5 |
| Styling | Vanilla CSS (high-contrast design system) |
| Map | Leaflet.js (CDN) |
| PWA | `manifest.json` + service worker |
| Speech | Web Speech API (SpeechRecognition + SpeechSynthesis) |
| API | Go backend at `https://kenya-ai-challenge-1.onrender.com` |

---

## Running Locally

```bash
# 1. Install dependencies
npm install

# 2. Copy environment file
cp .env.example .env
# Edit VITE_API_BASE_URL if using a local backend

# 3. Start dev server
npm run dev
# → http://localhost:3000
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE_URL` | `https://kenya-ai-challenge-1.onrender.com` | Backend API base URL |

---

## Building for Production

```bash
npm run build
# Output: dist/
```

> The `dist/` folder is not committed — deploy it via Render, Vercel, or Netlify.

---

## Running Tests

```bash
npm test
```

All 7 structural test assertions must pass before any push:

```
✔ app contains the expected SoilIQ experience entry points
✔ app uses a configurable API base URL
✔ app wires up microphone recording for voice transcription
✔ app uses browser geolocation for live location updates
✔ app includes an image analysis flow with upload and output handling
✔ app uses live location reverse geocoding instead of a hardcoded county
✔ app accepts multiple transcription response shapes from the backend
```

---

## Design System

| Token | Value | Usage |
|---|---|---|
| `--soil` | `#3D2B1F` | Deep fertile soil — primary text |
| `--green` | `#2D6A2D` | Healthy crop green — CTAs |
| `--clay` | `#C4622D` | Kenyan clay orange — accents |
| `--sky` | `#87CEEB` | Highland sky — backgrounds |
| `--cream` | `#F5F0E8` | Dry season earth — cards |
| `--urgent` | `#DC2626` | High urgency red |
| `--caution` | `#D97706` | Medium urgency amber |
| `--safe` | `#16A34A` | Low urgency green |

All touch targets: **minimum 56px height** for one-thumb field operation.

---

## Backend

This frontend connects to the **SoilIQ Go backend** at:  
[github.com/NgangaKamau3/Kenya_AI_challenge](https://github.com/NgangaKamau3/Kenya_AI_challenge)

Key API endpoints used:

| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | Server heartbeat |
| `/analyze` | POST | LLM soil advisory |
| `/transcribe` | POST | Whisper ASR + LLM correction |
| `/analyze-image` | POST | Vision soil diagnostics |
| `/assessments` | GET | All recorded assessments |
| `/patterns` | GET | Multi-farm trend clustering |
| `/graph-context` | GET | Neo4j zone intelligence |

---

## Git Safety

- `.env` is gitignored — never commit secrets
- `dist/` is gitignored — deploy separately
- `node_modules/` is gitignored

---

## License

Kenya AI Challenge 2026 — SoilIQ Team
