// BodyMath Fitness — AI plan generation proxy
//
// Why this exists: the frontend (index.html/app.js) is a static, no-build
// single-file app with no server of its own. Calling the Anthropic API
// directly from that client-side JS would mean shipping your API key to
// every visitor's browser, which is not safe. This tiny server holds the
// key and exposes one endpoint the frontend can call instead.
//
// Run locally:
//   cd server
//   npm install
//   cp .env.example .env   # then paste your real key into .env
//   npm start
//
// Deploy anywhere that runs Node (Render, Railway, Fly.io, a VPS, etc).
// Point the frontend at it by setting AI_PROXY_ENDPOINT in app.js (see
// the comment near the top of that file).

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8787;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

app.use(cors());
app.use(express.json({ limit: '200kb' }));

// Simple in-memory rate limit: N requests per IP per minute.
// Swap for a real store (Redis, etc.) if you deploy this beyond a demo.
const RATE_LIMIT = 10;
const WINDOW_MS = 60 * 1000;
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip) || { count: 0, resetAt: now + WINDOW_MS };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + WINDOW_MS;
  }
  entry.count += 1;
  hits.set(ip, entry);
  return entry.count > RATE_LIMIT;
}

app.post('/api/generate-plan', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY. See server/.env.example.' });
  }

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests, please try again in a minute.' });
  }

  const { user, maintenance, tierLabel } = req.body || {};
  if (!user || !maintenance || !tierLabel) {
    return res.status(400).json({ error: 'Missing user, maintenance, or tierLabel in request body.' });
  }

  const schemaHint = `Return ONLY minified JSON, no prose, no code fences, matching exactly:
{"mealPlan":[{"items":[{"name":"string","qty":number,"cal":number,"prot":number,"cost":number}]}],
"workoutPlan":[{"day":number,"focus":"string","exercises":[{"name":"string","sets":number,"reps":number}]}],
"coachNotes":"string (3-5 sentences, professional nutritionist/coach tone)"}`;

  const prompt = `You are a certified nutritionist and fitness coach. Build a one-day meal plan (5 meals) and a ${user.workoutType === 'BroSplit' ? '5-day single-muscle-group' : '6-day push/pull/legs'} workout plan for this client:
- Age ${user.age}, ${user.gender}, ${user.heightFeet}ft ${user.heightInches}in, ${user.weightKg}kg${user.targetWeightKg ? `, target weight ${user.targetWeightKg}kg` : ''}
- Activity: ${user.activityLevel}, Experience: ${user.experience}, Goal: ${user.goal}
- Daily calorie target: ~${maintenance} kcal, budget tier: ${tierLabel} (PKR ${user.budget}/month)
- Dietary preference: ${user.dietPref}${(user.allergies || []).length ? `, allergies: ${user.allergies.join(', ')}` : ''}
- Equipment available: ${user.equipment}
- Medical conditions: ${(user.conditions || []).length ? user.conditions.join(', ') : 'none'}
Use common Pakistani/South Asian foods (roti, daal, chicken, eggs, chana, etc.) priced in PKR. Keep total daily meal cost within budget. Adapt exercises for any medical conditions and equipment limits.
${schemaHint}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return res.status(502).json({ error: 'Upstream AI service error.' });
    }

    const data = await response.json();
    const text = (data.content || []).map(b => b.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    if (!parsed.mealPlan || !parsed.workoutPlan) {
      return res.status(502).json({ error: 'AI response did not match the expected plan format.' });
    }

    res.json(parsed);
  } catch (err) {
    console.error('generate-plan failed:', err);
    res.status(500).json({ error: 'Plan generation failed.' });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`BodyMath Fitness AI proxy listening on http://localhost:${PORT}`);
});
