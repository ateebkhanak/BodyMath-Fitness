# Health Pilot — AI Proxy

A minimal backend that holds your Anthropic API key server-side and exposes
one endpoint (`POST /api/generate-plan`) that `app.js` calls to generate a
personalized diet + workout plan. This exists because `index.html`/`app.js`
are static files with no server — calling Anthropic directly from that
client-side code would expose your API key to every visitor.

## Run it locally

```bash
cd server
npm install
cp .env.example .env
# edit .env and paste in your real ANTHROPIC_API_KEY
npm start
```

The server listens on `http://localhost:8787` by default.

## Point the frontend at it

In `app.js`, find this line near the top of the file:

```js
const AI_PROXY_ENDPOINT = '/api/generate-plan';
```

- If you're serving `index.html` **from the same server/domain** as this
  proxy (e.g. Express serving both), leave it as a relative path.
- If the frontend is hosted elsewhere (e.g. a static host / CDN) and the
  proxy is on a different domain, change it to the full URL, e.g.
  `https://your-proxy.example.com/api/generate-plan`, and make sure CORS
  is configured for your frontend's origin (the `cors()` middleware in
  `index.js` currently allows all origins — lock this down before going
  to production).

## Deploying

This is a plain Express app, so it runs anywhere Node does:

- **Render / Railway / Fly.io**: point them at the `server/` folder, set
  the `ANTHROPIC_API_KEY` environment variable in their dashboard, and
  they'll run `npm start`.
- **A VPS**: `npm install && npm start` behind a process manager (pm2,
  systemd) and a reverse proxy (nginx/Caddy) for TLS.
- **Serverless (Vercel/Netlify functions, AWS Lambda)**: the request
  handler logic in `index.js` can be adapted into a single function file —
  the core `fetch()` call to Anthropic and JSON parsing stay the same,
  only the entrypoint/export shape changes.

## What happens without this server

`app.js` is written to degrade gracefully: it first tries this proxy, then
falls back to a rich rule-based personalization engine built into the
frontend itself (diet/workout adaptation by condition, equipment, allergy,
and goal). The app never breaks without the AI backend — it just won't be
using live AI-generated plans until this is deployed.
