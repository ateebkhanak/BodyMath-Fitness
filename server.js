require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const userDataRoutes = require('./routes/userdata');

const app = express();

// Restrict which origins the browser is allowed to call this API from.
// Set CORS_ORIGIN in .env to the URL index.html is actually served from
// (comma-separated if there's more than one, e.g. local dev + production).
// Once this server serves the frontend itself (see static block below),
// requests are same-origin and CORS_ORIGIN mostly matters for local dev
// where you might still open the frontend from a different port/tool.
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests (curl, server-to-server) which have no
    // Origin header at all.
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  }
}));
app.use(express.json({ limit: '3mb' })); // generous enough for a progress-photo data URL

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/data', userDataRoutes);

// ------------------------------------------------------------
// AI plan generation proxy — holds the real Anthropic API key server-side
// so it's never exposed to the browser. app.js calls this first and falls
// back to its own built-in rule-based planner if it's unavailable/fails,
// so the app keeps working even with ANTHROPIC_API_KEY unset.
// ------------------------------------------------------------
app.post('/api/generate-plan', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI generation is not configured on this server.' });

  try {
    const { user, maintenance, tierLabel } = req.body || {};
    if (!user) return res.status(400).json({ error: 'Missing user profile.' });

    const prompt = `You are a certified nutritionist and fitness coach. Build a one-day meal plan (5 meals) and a workout plan for this client:
- Age ${user.age}, ${user.gender}, ${user.heightFeet}ft ${user.heightInches}in, ${user.weightKg}kg
- Activity: ${user.activityLevel}, Experience: ${user.experience}, Goal: ${user.goal}
- Maintenance calories: ${maintenance}
- Budget tier: ${tierLabel}
- Dietary preference: ${user.dietPref}
- Equipment available: ${user.equipment}
- Medical conditions: ${(user.conditions || []).join(', ') || 'none'}
Return ONLY minified JSON, no prose, no code fences, matching exactly:
{"mealPlan":[{"items":[{"name":"string","qty":number,"cal":number,"prot":number,"fat":number,"carbs":number,"cost":number}]}],
"workoutPlan":[{"day":number,"focus":"string","exercises":[{"name":"string","sets":number,"reps":number}]}],
"coachNotes":"string (3-5 sentences, professional nutritionist/coach tone)"}`;

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!anthropicRes.ok) {
      console.error('Anthropic API error:', anthropicRes.status, await anthropicRes.text());
      return res.status(502).json({ error: 'AI generation failed upstream.' });
    }

    const data = await anthropicRes.json();
    const text = (data.content || []).map(b => b.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return res.json(parsed);
  } catch (e) {
    console.error('generate-plan failed:', e);
    return res.status(500).json({ error: 'AI generation failed.' });
  }
});

// ------------------------------------------------------------
// Serve the frontend (index.html, app.js, style.css, etc.) from this same
// server, so the whole app is one process on one port — no separate
// `serve`/CORS setup needed, and it's what most hosts (Render, Railway,
// Fly.io) expect: one service, one port.
// ------------------------------------------------------------
app.use(express.static(__dirname));

// Any non-API route falls back to index.html so the app still loads if
// someone refreshes on a deep link or opens the bare domain.
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Centralized error handler — catches the CORS rejection above and anything
// else that throws synchronously in a route, so the client always gets JSON
// back instead of an HTML stack trace.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error.' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Health Pilot API listening on port ${PORT}`));
