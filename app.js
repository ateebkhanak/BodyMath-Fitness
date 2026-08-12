(() => {
  // ============================================================
  // Static config & DB
  // ============================================================
  // Data-key names used with the backend's generic per-user key/value store
  // (GET/PUT/DELETE /api/data/:key) — the user is scoped server-side from
  // the auth token, so these no longer need a manual account prefix.
  const STORAGE_KEY_PLAN = 'winterArc.plan.v1';
  const STORAGE_KEY_PROGRESS = 'winterArc.progress.v1';
  const STORAGE_KEY_WORKOUT = 'winterArc.workout.v1';
  const STORAGE_KEY_TOKEN = 'winterArc.authToken.v1';

  // Backend proxy that holds the real Anthropic API key, plus auth/data
  // routes (see server/). Relative path assumes the API is served from the
  // same origin as this page. If it's hosted elsewhere, change this to the
  // full origin, e.g. 'https://your-api.example.com'.
  const API_BASE = '/api';
  const AI_PROXY_ENDPOINT = `${API_BASE}/generate-plan`;

  const BUDGET_TIERS = {
    LOW: { min: 5000, max: 8000, label: "Low (₨5k–₨8k)" },
    MED: { min: 8001, max: 12000, label: "Medium (₨8k–₨12k)" },
    HIGH: { min: 12001, max: 9999999, label: "High (₨12k+)" }
  };

  const FOODS = {
    // Nutrition values are per the serving named in `name`.
    eggs: { name: "Egg (1 large)", cal: 70, protein: 6, fat: 5, carbs: 0.5, cost: 30, icon: "🥚" },
    roti: { name: "Roti (1)", cal: 120, protein: 4, fat: 3, carbs: 22, cost: 6, icon: "🥖" },
    daal: { name: "Daal (1 bowl / 200g)", cal: 180, protein: 10, fat: 4, carbs: 25, cost: 40, icon: "🥣" },
    chana: { name: "Chana (1 bowl / 200g)", cal: 160, protein: 9, fat: 3, carbs: 27, cost: 30, icon: "🥗" },
    milk250: { name: "Milk (250ml)", cal: 130, protein: 8, fat: 5, carbs: 12, cost: 60, icon: "🥛" },
    oats: { name: "Oats (40g)", cal: 150, protein: 6, fat: 3, carbs: 27, cost: 50, icon: "🫙" },
    banana: { name: "Banana (1)", cal: 90, protein: 1, fat: 0.3, carbs: 23, cost: 30, icon: "🍌" },
    chicken: { name: "Chicken (150g)", cal: 330, protein: 30, fat: 7, carbs: 0, cost: 160, icon: "🍗" },
    fish: { name: "Fish (150g)", cal: 300, protein: 28, fat: 12, carbs: 0, cost: 220, icon: "🐟" },
    beef: { name: "Beef (150g)", cal: 360, protein: 31, fat: 24, carbs: 0, cost: 280, icon: "🥩" },
    whey: { name: "Whey (30g / 1 scoop)", cal: 120, protein: 24, fat: 2, carbs: 3, cost: 200, icon: "🧴" },
    nuts: { name: "Nuts (30g)", cal: 180, protein: 5, fat: 16, carbs: 6, cost: 80, icon: "🥜" },
    veg: { name: "Vegetables (100g)", cal: 40, protein: 2, fat: 0.3, carbs: 8, cost: 30, icon: "🥦" },
    sweetpotato: { name: "Sweet potato (150g)", cal: 130, protein: 2, fat: 0.2, carbs: 30, cost: 60, icon: "🍠" },
    quinoa: { name: "Cooked quinoa (185g)", cal: 220, protein: 8, fat: 3.5, carbs: 39, cost: 120, icon: "🍚" },
    paneer: { name: "Paneer (100g)", cal: 265, protein: 18, fat: 20, carbs: 3, cost: 150, icon: "🧀" }
  };

  // The planner stores servings internally for accurate nutrition math, but
  // always renders them as practical kitchen quantities.
  const FOOD_PORTIONS = {
    eggs: { unit: 'count', amount: 1 }, roti: { unit: 'count', amount: 1 },
    daal: { unit: 'g', amount: 200 }, chana: { unit: 'g', amount: 200 },
    milk250: { unit: 'ml', amount: 250 }, oats: { unit: 'g', amount: 40 },
    banana: { unit: 'count', amount: 1 }, chicken: { unit: 'g', amount: 150 },
    fish: { unit: 'g', amount: 150 }, beef: { unit: 'g', amount: 150 },
    whey: { unit: 'g', amount: 30 }, nuts: { unit: 'g', amount: 30 },
    veg: { unit: 'g', amount: 100 }, sweetpotato: { unit: 'g', amount: 150 },
    quinoa: { unit: 'g', amount: 185 }, paneer: { unit: 'g', amount: 100 }
  };

  // ============================================================
  // Condition / preference-based diet adaptation
  // ============================================================
  // Substitution maps applied to a meal template *before* scaling.
  const VEG_SUBS = { chicken: 'paneer', fish: 'paneer', beef: 'chana' };
  const VEGAN_SUBS = { chicken: 'chana', fish: 'chana', beef: 'daal', eggs: 'oats', milk250: 'nuts', whey: 'chana', paneer: 'daal' };
  const KETO_SUBS = { roti: 'nuts', oats: 'eggs', banana: 'nuts', quinoa: 'nuts', sweetpotato: 'veg' };
  const DIABETES_SUBS = { banana: 'nuts' };
  const HEART_SUBS = { beef: 'fish' };
  const ROTI_CAP_FOR_DIABETES = 2; // max roti per meal

  // Simple keyword → food-key exclusion map for user-entered allergies.
  const ALLERGY_FOOD_MAP = {
    egg: { keys: ['eggs'], sub: 'oats' },
    dairy: { keys: ['milk250', 'whey', 'paneer'], sub: 'chana' },
    milk: { keys: ['milk250'], sub: 'chana' },
    nut: { keys: ['nuts'], sub: 'chana' },
    peanut: { keys: ['nuts'], sub: 'chana' },
    gluten: { keys: ['roti'], sub: 'quinoa' },
    wheat: { keys: ['roti'], sub: 'quinoa' },
    fish: { keys: ['fish'], sub: 'chicken' },
    seafood: { keys: ['fish'], sub: 'chicken' },
    soy: { keys: [], sub: null },
    shellfish: { keys: ['fish'], sub: 'chicken' }
  };

  function buildDietarySubs(dietPref, conditions) {
    // Order matters: dietary preference is applied first, then medical
    // conditions layer on top (but never re-introduce meat into a veg sub).
    const subs = {};
    if (dietPref === 'veg') Object.assign(subs, VEG_SUBS);
    if (dietPref === 'vegan') Object.assign(subs, VEGAN_SUBS);
    if (dietPref === 'keto') Object.assign(subs, KETO_SUBS);
    if (conditions.includes('diabetes')) Object.assign(subs, DIABETES_SUBS);
    if (conditions.includes('heart') && dietPref !== 'veg' && dietPref !== 'vegan') Object.assign(subs, HEART_SUBS);
    return subs;
  }

  function buildAllergySubs(allergies) {
    const subs = {};
    (allergies || []).forEach(a => {
      const term = a.trim().toLowerCase();
      Object.keys(ALLERGY_FOOD_MAP).forEach(keyword => {
        if (term.includes(keyword)) {
          const { keys, sub } = ALLERGY_FOOD_MAP[keyword];
          keys.forEach(k => { if (sub) subs[k] = sub; });
        }
      });
    });
    return subs;
  }

  function applyDietarySubs(template, dietPref, conditions, allergies) {
    const subs = { ...buildDietarySubs(dietPref, conditions), ...buildAllergySubs(allergies) };
    const capRoti = conditions.includes('diabetes');
    return template.map(meal => meal.map(it => {
      let next = { ...it };
      if (subs[next.f]) next.f = subs[next.f];
      if (capRoti && next.f === 'roti' && next.q > ROTI_CAP_FOR_DIABETES) {
        next.q = ROTI_CAP_FOR_DIABETES;
      }
      return next;
    }));
  }

  function buildDietNotes(dietPref, conditions, allergies) {
    const notes = [];
    if (dietPref === 'veg') notes.push('🌱 Vegetarian: meat swapped for paneer/chana to hold protein targets.');
    if (dietPref === 'vegan') notes.push('🌿 Vegan: all animal products swapped for plant-based protein (chana, daal, oats, nuts) — consider a B12 supplement.');
    if (dietPref === 'halal') notes.push('☪️ Halal: no pork in this plan; please source halal-certified meat.');
    if (dietPref === 'keto') notes.push('🥑 Keto: high-carb staples (roti, oats, banana, quinoa) swapped for fat/protein sources to keep carbs low.');
    if (conditions.includes('diabetes')) notes.push('🩸 Diabetes: high-GI items reduced (banana → nuts, roti portions capped) — favor whole grains and fiber, and pair carbs with protein.');
    if (conditions.includes('heart')) notes.push('❤️ Heart health: red meat swapped for fish; go easy on fried and processed food, prioritize omega-3 sources.');
    if (conditions.includes('hypertension')) notes.push('🧂 Hypertension: minimize added salt and processed/pickled foods; favor fresh produce and potassium-rich veg.');
    if (conditions.includes('thyroid')) notes.push('🦋 Thyroid: include iodine-rich foods (dairy, eggs) where possible and keep meal timing consistent.');
    if (conditions.includes('pcos')) notes.push('⚖️ PCOS: extra emphasis on fiber and protein, minimal refined sugar, to help manage insulin response.');
    if (allergies && allergies.length) notes.push(`🚫 Allergies noted (${allergies.join(', ')}): matching ingredients swapped out automatically — please double-check every item before eating.`);
    return notes;
  }

  const TEMPLATES = {
    LOW: [
      [{ f: 'eggs', q: 2 }, { f: 'roti', q: 1 }],
      [{ f: 'daal', q: 1 }, { f: 'roti', q: 2 }, { f: 'veg', q: 1 }],
      [{ f: 'banana', q: 1 }, { f: 'milk250', q: 1 }],
      [{ f: 'eggs', q: 2 }, { f: 'chana', q: 1 }, { f: 'roti', q: 1 }],
      [{ f: 'milk250', q: 1 }]
    ],
    MED: [
      [{ f: 'eggs', q: 3 }, { f: 'oats', q: 1 }],
      [{ f: 'chicken', q: 1 }, { f: 'roti', q: 2 }, { f: 'veg', q: 1 }],
      [{ f: 'banana', q: 1 }, { f: 'nuts', q: 0.5 }],
      [{ f: 'chicken', q: 1 }, { f: 'quinoa', q: 0.5 }, { f: 'veg', q: 1 }],
      [{ f: 'milk250', q: 1 }, { f: 'whey', q: 0.5 }]
    ],
    HIGH: [
      [{ f: 'eggs', q: 3 }, { f: 'oats', q: 1 }, { f: 'banana', q: 1 }],
      [{ f: 'chicken', q: 1.5 }, { f: 'quinoa', q: 1 }, { f: 'veg', q: 1 }],
      [{ f: 'whey', q: 1 }, { f: 'nuts', q: 0.5 }],
      [{ f: 'fish', q: 1 }, { f: 'sweetpotato', q: 1 }, { f: 'veg', q: 1 }],
      [{ f: 'milk250', q: 1 }, { f: 'nuts', q: 0.5 }]
    ]
  };

  // Progression pacing: how many weeks between rep bumps, by experience.
  // Beginners progress fastest, advanced lifters progress slowest.
  const PROGRESSION_STEP_WEEKS = { Beginner: 1, Intermediate: 2, Advanced: 3 };
  const PROGRESSION_WEEKS = 12;

  // ============================================================
  // DOM references
  // ============================================================
  const $ = id => document.getElementById(id);

  const ageEl = $('age'),
    genderEl = $('gender'),
    heightFeetEl = $('heightFeet'),
    heightInchesEl = $('heightInches'),
    weightEl = $('weight'),
    targetWeightEl = $('targetWeight'),
    activityEl = $('activity'),
    goalEl = $('goal'),
    budgetEl = $('budget'),
    experienceEl = $('experience'),
    workoutTypeEl = $('workoutType'),
    dietPrefEl = $('dietPref'),
    equipmentEl = $('equipment'),
    allergiesEl = $('allergies'),
    showSupplementsEl = $('showSupplements');

  const conditionCheckboxes = () => Array.from(document.querySelectorAll('.condition-checkbox'));

  // Auth screen elements
  const authScreenEl = $('authScreen'), appRootEl = $('appRoot'),
    loginFormEl = $('loginForm'), loginEmailEl = $('loginEmail'), loginPasswordEl = $('loginPassword'), loginErrorEl = $('loginError'),
    registerFormEl = $('registerForm'), registerNameEl = $('registerName'), registerEmailEl = $('registerEmail'),
    registerPasswordEl = $('registerPassword'), registerConfirmEl = $('registerConfirm'), registerErrorEl = $('registerError'),
    showRegisterLinkEl = $('showRegisterLink'), showLoginLinkEl = $('showLoginLink'),
    logoutBtnEl = $('logoutBtn'), userNameLabelEl = $('userNameLabel'), guestBtnEl = $('continueGuestBtn'), topRegisterBtnEl = $('topRegisterBtn');

  const generateBtn = $('generateBtn'), regenBtn = $('regenBtn');
  const calTargetEl = $('calTarget'), calDetailEl = $('calDetail'), proteinTargetEl = $('proteinTarget'), fatTargetEl = $('fatTarget'), carbsTargetEl = $('carbsTarget');
  const budgetTierEl = $('budgetTier'), estCostEl = $('estCost');
  const mealsContainer = $('mealsContainer');
  const workoutContainer = $('workoutContainer');
  const workoutTitleEl = $('workoutTitle');
  const dailyTotalsEl = $('dailyTotals'), calBar = $('calBar'), protBar = $('protBar');
  const exportPdfBtn = $('exportPdf'), exportDocxBtn = $('exportDocx'), clearSavedBtn = $('clearSaved');
  const messageBox = $('messageBox');
  const dietNotesEl = $('dietNotes'), workoutNotesEl = $('workoutNotes');
  const waterTargetEl = $('waterTarget'), restDaysNoteEl = $('restDaysNote');
  const coachNotesCard = $('coachNotesCard'), coachNotesEl = $('coachNotes'), supplementNotesEl = $('supplementNotes');
  const progressAccountLabelEl = $('progressAccountLabel');

  // The authenticated session. Nothing loads from the backend until this is
  // set (via login/register/token restore), and everything the person sees
  // is scoped server-side to their user id — no cross-user data leakage.
  let authToken = null;
  let currentUser = null; // { id, fullName, email }
  let isGuestSession = false; // true = browsing without an account, nothing persists

  // Mutable in-memory state for the currently rendered, editable workout.
  let currentWorkoutPlan = null;
  let currentExperience = 'Intermediate';
  let currentWorkoutType = 'PPL';
  // The last plan generated this session, kept in memory so Export still
  // works for guests (whose plans are never written to the backend).
  let lastGeneratedPlanState = null;

  const waistEl = $('waist'), absEl = $('absRating'), photoEl = $('progPhoto'),
    saveProgressBtn = $('saveProgress'), reflectionEl = $('reflection'), progressListEl = $('progressList');

  // ============================================================
  // Auth + backend data helpers
  // ============================================================
  function getStoredToken() {
    try { return localStorage.getItem(STORAGE_KEY_TOKEN); } catch (e) { return null; }
  }
  function setStoredToken(token) {
    try {
      if (token) localStorage.setItem(STORAGE_KEY_TOKEN, token);
      else localStorage.removeItem(STORAGE_KEY_TOKEN);
    } catch (e) { /* ignore */ }
  }

  // Wraps fetch with the auth header and central 401 handling (expired/
  // invalid token -> drop back to the login screen).
  async function apiRequest(path, options = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const res = await fetch(`${API_BASE}${path}`, Object.assign({}, options, { headers }));
    if (res.status === 401) {
      handleAuthExpired();
      throw new Error('Session expired.');
    }
    return res;
  }

  // Generic per-user JSON store — mirrors the old localStorage get/set/remove
  // shape but is scoped to the logged-in user on the backend.
  async function fetchJsonData(key) {
    if (!currentUser) return null;
    try {
      const res = await apiRequest(`/data/${encodeURIComponent(key)}`);
      if (res.status === 404) return null;
      if (!res.ok) return null;
      const body = await res.json();
      return body.value ? JSON.parse(body.value) : null;
    } catch (e) { console.error('Could not load from server:', e); return null; }
  }
  async function putJsonData(key, value) {
    if (!currentUser) return;
    try {
      await apiRequest(`/data/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ value: JSON.stringify(value) }) });
    } catch (e) { console.error('Could not save to server:', e); }
  }
  async function deleteJsonData(key) {
    if (!currentUser) return;
    try { await apiRequest(`/data/${encodeURIComponent(key)}`, { method: 'DELETE' }); } catch (e) { /* ignore */ }
  }

  async function registerUser(e) {
    e.preventDefault();
    registerErrorEl.textContent = '';
    const fullName = registerNameEl.value.trim();
    const email = registerEmailEl.value.trim();
    const password = registerPasswordEl.value;
    const confirmPassword = registerConfirmEl.value;
    if (!fullName || !email || !password || !confirmPassword) { registerErrorEl.textContent = 'Please fill in every field.'; return; }
    if (password !== confirmPassword) { registerErrorEl.textContent = 'Passwords do not match.'; return; }
    if (password.length < 8) { registerErrorEl.textContent = 'Password must be at least 8 characters.'; return; }
    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, email, password, confirmPassword })
      });
      const body = await res.json();
      if (!res.ok) { registerErrorEl.textContent = body.error || 'Registration failed.'; return; }
      await onAuthSuccess(body.token, body.user);
    } catch (err) { console.error(err); registerErrorEl.textContent = 'Could not reach the server — please try again.'; }
  }

  async function loginUser(e) {
    e.preventDefault();
    loginErrorEl.textContent = '';
    const email = loginEmailEl.value.trim();
    const password = loginPasswordEl.value;
    if (!email || !password) { loginErrorEl.textContent = 'Please enter your email and password.'; return; }
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const body = await res.json();
      if (!res.ok) { loginErrorEl.textContent = body.error || 'Login failed.'; return; }
      await onAuthSuccess(body.token, body.user);
    } catch (err) { console.error(err); loginErrorEl.textContent = 'Could not reach the server — please try again.'; }
  }

  async function onAuthSuccess(token, user) {
    authToken = token;
    currentUser = user;
    setStoredToken(token);
    if (loginFormEl) loginFormEl.reset();
    if (registerFormEl) registerFormEl.reset();
    showApp();
    await loadUserDataIntoApp();
  }

  function logoutUser() {
    authToken = null;
    currentUser = null;
    isGuestSession = false;
    setStoredToken(null);
    currentWorkoutPlan = null;
    lastGeneratedPlanState = null;
    showAuthScreen();
  }

  // Lets someone use the app without an account. Nothing about this touches
  // the backend or localStorage — isGuestSession lives only in memory, so a
  // reload (or navigating away and back) always lands back on the login
  // screen, exactly like a fresh visit.
  function continueAsGuest() {
    authToken = null;
    currentUser = null;
    isGuestSession = true;
    showApp();
    renderProgressList([]);
  }

  function handleAuthExpired() {
    authToken = null;
    currentUser = null;
    isGuestSession = false;
    setStoredToken(null);
    showAuthScreen();
    showValidationError('⚠️ Your session expired — please log in again.');
  }

  function showApp() {
    if (authScreenEl) authScreenEl.style.display = 'none';
    if (appRootEl) appRootEl.style.display = '';
    if (isGuestSession) {
      if (userNameLabelEl) userNameLabelEl.textContent = '';
      if (logoutBtnEl) logoutBtnEl.textContent = 'Log In';
      if (topRegisterBtnEl) topRegisterBtnEl.style.display = '';
    } else {
      if (userNameLabelEl) userNameLabelEl.textContent = currentUser ? (currentUser.fullName || currentUser.email) : '';
      if (logoutBtnEl) logoutBtnEl.textContent = 'Log Out';
      if (topRegisterBtnEl) topRegisterBtnEl.style.display = 'none';
    }
  }

  function showAuthScreen() {
    if (appRootEl) appRootEl.style.display = 'none';
    if (authScreenEl) authScreenEl.style.display = 'flex';
  }

  // Pulls this user's saved progress + in-progress workout edits from the
  // backend right after login/register/token-restore.
  async function loadUserDataIntoApp() {
    if (progressAccountLabelEl) progressAccountLabelEl.textContent = `Showing progress for: ${currentUser.fullName || currentUser.email}`;
    renderProgressList(await loadProgressEntries());
    const savedWorkout = await loadWorkoutState();
    if (savedWorkout && savedWorkout.workoutPlan) {
      currentWorkoutPlan = savedWorkout.workoutPlan;
      currentExperience = savedWorkout.experience || 'Intermediate';
      currentWorkoutType = savedWorkout.workoutType || 'PPL';
      await rerenderWorkoutAfterEdit();
    }
  }

  // Restores a session from a previously-stored token on page load, so
  // logging in on a new device (or reopening the tab) pulls everything back
  // from the backend automatically.
  async function initAuth() {
    const token = getStoredToken();
    if (!token) { showAuthScreen(); return; }
    authToken = token;
    try {
      const res = await apiRequest('/auth/me');
      if (!res.ok) throw new Error('invalid session');
      const body = await res.json();
      currentUser = body.user;
      showApp();
      await loadUserDataIntoApp();
    } catch (e) {
      authToken = null; currentUser = null; setStoredToken(null);
      showAuthScreen();
    }
  }

  // ============================================================
  // Core calculations
  // ============================================================
  function mifflinStJeor({ age, gender, heightCm, weightKg, activityLevel, goal }) {
    const s = (gender === 'female') ? -161 : 5;
    const bmr = Math.round(10 * weightKg + 6.25 * heightCm - 5 * age + s);
    const mult = ({ 'Sedentary': 1.2, 'Light': 1.375, 'Moderate': 1.55, 'Active': 1.725 })[activityLevel] || 1.55;
    let maintenance = Math.round(bmr * mult);
    if (goal === 'Fat Loss') maintenance = Math.max(1200, maintenance - 350);
    if (goal === 'Muscle Gain') maintenance += 300;
    return { bmr, maintenance };
  }

  // Nudge the calorie target further based on the gap to a stated target
  // weight, on top of the goal-based adjustment above. Bounded so it can
  // never push calories below a safe floor.
  function applyTargetWeightAdjustment(maintenance, weightKg, targetWeightKg) {
    if (!targetWeightKg || Math.abs(weightKg - targetWeightKg) < 1) return maintenance;
    const diff = weightKg - targetWeightKg; // positive => needs to lose
    const adj = Math.max(-250, Math.min(250, diff * 15));
    return Math.max(1200, Math.round(maintenance - adj));
  }

  function budgetTierFromValue(v) {
    const n = Number(v) || 0;
    if (n >= BUDGET_TIERS.LOW.min && n <= BUDGET_TIERS.LOW.max) return 'LOW';
    if (n >= BUDGET_TIERS.MED.min && n <= BUDGET_TIERS.MED.max) return 'MED';
    if (n >= BUDGET_TIERS.HIGH.min) return 'HIGH';
    return 'LOW';
  }

  // ============================================================
  // Authoritative nutrition targets and meal validation
  // ============================================================
  function calculateNutritionTargets(user, caloriesTarget) {
    const calories = Math.round(caloriesTarget);
    const protein = Math.round(user.weightKg * 1.8);
    const fat = Math.round(Math.max(user.weightKg * 0.6, (calories * 0.25) / 9));
    const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
    return { calories, protein, fat, carbs };
  }

  const NUTRITION_TOLERANCE = { caloriesPct: 0.05, proteinGrams: 10, fatGrams: 8, carbsGrams: 12 };

  function mealPlanTotals(meals) {
    const t = { calories: 0, protein: 0, fat: 0, carbs: 0, cost: 0 };
    (meals || []).forEach(meal => (meal.items || []).forEach(item => {
      t.calories += Number(item.cal) || 0;
      t.protein += Number(item.prot) || 0;
      t.fat += Number(item.fat) || 0;
      t.carbs += Number(item.carbs) || 0;
      t.cost += Number(item.cost) || 0;
    }));
    return Object.fromEntries(Object.entries(t).map(([k,v]) => [k, Math.round(v * 10) / 10]));
  }

  function nutritionWithinTolerance(totals, targets) {
    return Math.abs(totals.calories - targets.calories) <= targets.calories * NUTRITION_TOLERANCE.caloriesPct
      && Math.abs(totals.protein - targets.protein) <= NUTRITION_TOLERANCE.proteinGrams
      && Math.abs(totals.fat - targets.fat) <= NUTRITION_TOLERANCE.fatGrams
      && Math.abs(totals.carbs - targets.carbs) <= NUTRITION_TOLERANCE.carbsGrams;
  }

  function nutritionScore(t, target) {
    return Math.pow((t.calories-target.calories)/Math.max(100,target.calories*0.05),2)
      + Math.pow((t.protein-target.protein)/10,2)
      + Math.pow((t.fat-target.fat)/8,2)
      + Math.pow((t.carbs-target.carbs)/12,2);
  }

  function finalizeMealPlan(meals) {
    const t = mealPlanTotals(meals);
    return { meals, totalCal: Math.round(t.calories), totalProt: Math.round(t.protein), totalFat: Math.round(t.fat), totalCarbs: Math.round(t.carbs), estCostPKR: Math.round(t.cost) };
  }

  function makeMealItems(template) {
    return template.map(meal => ({ items: meal.map(it => {
      const food = FOODS[it.f];
      return { key: it.f, name: food?.name || it.f, icon: food?.icon || '🍴', qty: Number(it.q) || 0,
        cal: (food?.cal || 0) * (Number(it.q)||0), prot: (food?.protein || 0) * (Number(it.q)||0),
        fat: (food?.fat || 0) * (Number(it.q)||0), carbs: (food?.carbs || 0) * (Number(it.q)||0),
        cost: (food?.cost || 0) * (Number(it.q)||0) };
    }) }));
  }

  function recalcItem(item, qty) {
    const food = FOODS[item.key];
    item.qty = Math.max(0, qty);
    item.cal = (food?.cal || 0) * item.qty;
    item.prot = (food?.protein || 0) * item.qty;
    item.fat = (food?.fat || 0) * item.qty;
    item.carbs = (food?.carbs || 0) * item.qty;
    item.cost = (food?.cost || 0) * item.qty;
  }

  function optimizeMealPlan(meals, targets) {
    const items = meals.flatMap(m => m.items);
    // Keep a meaningful item in every meal while allowing portions to move.
    const minimum = key => ({ eggs:0.5, roti:0.5, banana:0.5 }[key] || 0.25);
    const maximum = key => key === 'whey' ? 3 : 5;
    let current = mealPlanTotals(meals);
    let score = nutritionScore(current, targets);

    for (let pass=0; pass<300; pass++) {
      let improved=false;
      for (const item of items) {
        const step = ['eggs','roti','banana'].includes(item.key) ? 0.25 : 0.05;
        const original = item.qty;
        let bestQty=original, bestLocal=score;
        for (const dir of [1,-1]) {
          const candidate=Math.max(minimum(item.key), Math.min(maximum(item.key), original + dir*step));
          if (Math.abs(candidate-original)<1e-9) continue;
          recalcItem(item,candidate);
          const s=nutritionScore(mealPlanTotals(meals),targets);
          if (s < bestLocal-1e-8) { bestLocal=s; bestQty=candidate; }
        }
        recalcItem(item,bestQty);
        if (bestLocal < score-1e-8) { score=bestLocal; improved=true; }
      }
      if (nutritionWithinTolerance(mealPlanTotals(meals),targets) || !improved) break;
    }
    return finalizeMealPlan(meals);
  }

  function buildMealPlanForTier(tierKey, targets, dietPref, conditions, allergies) {
    const template = applyDietarySubs(TEMPLATES[tierKey], dietPref || 'nonveg', conditions || [], allergies || []);
    const meals = makeMealItems(template);

    // First scale the complete template toward the calorie target.
    const initial = mealPlanTotals(meals);
    const scale = Math.max(0.65, Math.min(1.7, targets.calories / Math.max(1, initial.calories)));
    meals.forEach(meal => meal.items.forEach(item => recalcItem(item, item.qty * scale)));

    // If protein is low, add a compatible protein food to meal 5 as a lever.
    const needsPlantProtein = dietPref === 'vegan' || (allergies || []).some(a => /dairy|milk|whey/i.test(String(a)));
    const proteinKey = needsPlantProtein ? 'chana' : 'whey';
    if (!meals.some(m => m.items.some(i => i.key === proteinKey))) {
      const food=FOODS[proteinKey];
      meals[4].items.push({ key:proteinKey,name:food.name,icon:food.icon,qty:0,cal:0,prot:0,fat:0,carbs:0,cost:0 });
    }

    const result = optimizeMealPlan(meals, targets);
    if (!nutritionWithinTolerance(mealPlanTotals(result.meals), targets)) {
      throw new Error('Unable to build a meal plan within the nutrition tolerance.');
    }
    return result;
  }

  function mealPlanFromAI(aiMealPlan, targets) {
    if (!Array.isArray(aiMealPlan) || !aiMealPlan.length) return null;
    const meals = aiMealPlan.map(meal => ({ items: (meal.items || []).map(it => {
      const rawName=String(it.name || '').trim().toLowerCase();
      const key=Object.keys(FOODS).find(k => FOODS[k].name.toLowerCase() === rawName || k === rawName);
      if (!key) return null;
      const qty=Number(it.qty);
      if (!Number.isFinite(qty) || qty<=0) return null;
      const food=FOODS[key];
      return { key, name:food.name, icon:food.icon, qty, cal:food.cal*qty, prot:food.protein*qty, fat:food.fat*qty, carbs:food.carbs*qty, cost:food.cost*qty };
    }).filter(Boolean) }));
    if (meals.some(m => !m.items.length)) return null;
    const optimized=optimizeMealPlan(meals,targets);
    return nutritionWithinTolerance(mealPlanTotals(optimized.meals),targets) ? optimized : null;
  }

  // ============================================================
  // Workout generation
  // ============================================================
  function generatePPLWorkout() {
    const push = [
      { name: 'Barbell Bench Press', sets: 4, reps: 8 },
      { name: 'Overhead Shoulder Press', sets: 3, reps: 10 },
      { name: 'Incline Dumbbell Press', sets: 3, reps: 10 },
      { name: 'Tricep Dips', sets: 3, reps: 12 },
      { name: 'Lateral Raises', sets: 3, reps: 15 }
    ];
    const pull = [
      { name: 'Deadlift', sets: 4, reps: 6 },
      { name: 'Pull-ups or Lat Pulldown', sets: 3, reps: 10 },
      { name: 'Barbell Row', sets: 3, reps: 10 },
      { name: 'Face Pulls', sets: 3, reps: 15 },
      { name: 'Bicep Curls', sets: 3, reps: 12 }
    ];
    const legs = [
      { name: 'Squats', sets: 4, reps: 8 },
      { name: 'Leg Press', sets: 3, reps: 12 },
      { name: 'Lunges', sets: 3, reps: 12 },
      { name: 'Romanian Deadlift', sets: 3, reps: 10 },
      { name: 'Standing Calf Raises', sets: 4, reps: 15 },
      { name: 'Hanging Leg Raises (core)', sets: 3, reps: 12 }
    ];

    return [
      { day: 1, focus: 'Push', exercises: push },
      { day: 2, focus: 'Pull', exercises: pull },
      { day: 3, focus: 'Legs', exercises: legs },
      { day: 4, focus: 'Push', exercises: push },
      { day: 5, focus: 'Pull', exercises: pull },
      { day: 6, focus: 'Legs', exercises: legs }
    ];
  }

  function generateBroSplitWorkout() {
    return [
      { day: 1, focus: 'Chest', exercises: [
        { name: 'Bench Press', sets: 4, reps: 8 },
        { name: 'Incline Dumbbell Press', sets: 3, reps: 10 },
        { name: 'Chest Fly', sets: 3, reps: 12 }
      ]},
      { day: 2, focus: 'Back', exercises: [
        { name: 'Deadlift', sets: 4, reps: 6 },
        { name: 'Lat Pulldown', sets: 3, reps: 10 },
        { name: 'Seated Row', sets: 3, reps: 12 }
      ]},
      { day: 3, focus: 'Shoulders', exercises: [
        { name: 'Overhead Press', sets: 4, reps: 8 },
        { name: 'Lateral Raises', sets: 3, reps: 12 },
        { name: 'Rear Delt Fly', sets: 3, reps: 15 }
      ]},
      { day: 4, focus: 'Arms', exercises: [
        { name: 'Barbell Curl', sets: 3, reps: 10 },
        { name: 'Tricep Pushdown', sets: 3, reps: 10 },
        { name: 'Hammer Curl', sets: 3, reps: 12 }
      ]},
      { day: 5, focus: 'Legs', exercises: [
        { name: 'Squats', sets: 4, reps: 8 },
        { name: 'Leg Curl', sets: 3, reps: 12 },
        { name: 'Calf Raises', sets: 4, reps: 15 },
        { name: 'Hanging Leg Raises (core)', sets: 3, reps: 12 }
      ]}
    ];
  }

  function generateUpperLowerWorkout() {
    const upperA = [
      { name: 'Barbell Bench Press', sets: 4, reps: 8 },
      { name: 'Barbell Row', sets: 4, reps: 8 },
      { name: 'Overhead Shoulder Press', sets: 3, reps: 10 },
      { name: 'Lat Pulldown', sets: 3, reps: 10 },
      { name: 'Bicep Curls', sets: 3, reps: 12 },
      { name: 'Tricep Pushdown', sets: 3, reps: 12 }
    ];
    const lowerA = [
      { name: 'Squats', sets: 4, reps: 8 },
      { name: 'Romanian Deadlift', sets: 3, reps: 10 },
      { name: 'Leg Press', sets: 3, reps: 12 },
      { name: 'Standing Calf Raises', sets: 4, reps: 15 },
      { name: 'Hanging Leg Raises (core)', sets: 3, reps: 12 }
    ];
    const upperB = [
      { name: 'Incline Dumbbell Press', sets: 4, reps: 10 },
      { name: 'Pull-ups or Lat Pulldown', sets: 4, reps: 8 },
      { name: 'Lateral Raises', sets: 3, reps: 15 },
      { name: 'Seated Row', sets: 3, reps: 12 },
      { name: 'Hammer Curl', sets: 3, reps: 12 },
      { name: 'Tricep Dips', sets: 3, reps: 12 }
    ];
    const lowerB = [
      { name: 'Deadlift', sets: 4, reps: 6 },
      { name: 'Lunges', sets: 3, reps: 12 },
      { name: 'Leg Curl', sets: 3, reps: 12 },
      { name: 'Calf Raises', sets: 4, reps: 15 },
      { name: 'Seated Knee Raises (core)', sets: 3, reps: 12 }
    ];
    return [
      { day: 1, focus: 'Upper', exercises: upperA },
      { day: 2, focus: 'Lower', exercises: lowerA },
      { day: 3, focus: 'Upper', exercises: upperB },
      { day: 4, focus: 'Lower', exercises: lowerB }
    ];
  }

  function generateFullBodyWorkout() {
    const a = [
      { name: 'Squats', sets: 4, reps: 8 },
      { name: 'Bench Press', sets: 3, reps: 10 },
      { name: 'Barbell Row', sets: 3, reps: 10 },
      { name: 'Hanging Leg Raises (core)', sets: 3, reps: 12 }
    ];
    const b = [
      { name: 'Deadlift', sets: 4, reps: 6 },
      { name: 'Overhead Press', sets: 3, reps: 10 },
      { name: 'Pull-ups or Lat Pulldown', sets: 3, reps: 10 },
      { name: 'Lateral Raises', sets: 3, reps: 15 }
    ];
    const c = [
      { name: 'Leg Press', sets: 3, reps: 12 },
      { name: 'Incline Dumbbell Press', sets: 3, reps: 10 },
      { name: 'Seated Row', sets: 3, reps: 12 },
      { name: 'Bicep Curls', sets: 3, reps: 12 },
      { name: 'Tricep Pushdown', sets: 3, reps: 12 }
    ];
    return [
      { day: 1, focus: 'Full Body', exercises: a },
      { day: 2, focus: 'Full Body', exercises: b },
      { day: 3, focus: 'Full Body', exercises: c }
    ];
  }

  function generateHomeWorkout() {
    const a = [
      { name: 'Push-ups', sets: 4, reps: 15 },
      { name: 'Bodyweight Squats', sets: 4, reps: 20 },
      { name: 'Inverted Rows / Superman Pulls', sets: 3, reps: 12 },
      { name: 'Glute Bridges', sets: 3, reps: 15 },
      { name: 'Mountain Climbers', sets: 3, reps: 20 }
    ];
    const b = [
      { name: 'Pike Push-ups', sets: 3, reps: 12 },
      { name: 'Bodyweight Lunges', sets: 3, reps: 15 },
      { name: 'Doorway Rows', sets: 3, reps: 12 },
      { name: 'Single-Leg Glute Bridges', sets: 3, reps: 12 },
      { name: 'Towel/Resistance Band Curl', sets: 3, reps: 15 }
    ];
    const c = [
      { name: 'Decline Push-ups', sets: 3, reps: 12 },
      { name: 'Bodyweight Squats', sets: 4, reps: 20 },
      { name: 'Bench/Chair Dips', sets: 3, reps: 12 },
      { name: 'Superman Pulls', sets: 3, reps: 15 },
      { name: 'Bicycle Crunches', sets: 3, reps: 20 }
    ];
    return [
      { day: 1, focus: 'Home', exercises: a },
      { day: 2, focus: 'Home', exercises: b },
      { day: 3, focus: 'Home', exercises: c }
    ];
  }

  // Single source of truth for each workout type: the label shown in the
  // "Workout Plan – …" heading, the rest-day note, the phrase used in the
  // AI prompt, and the generator that builds the rule-based fallback plan.
  // Adding a new split only requires one new entry here (plus a <option>
  // in the Workout type select).
  const WORKOUT_TYPES = {
    PPL: {
      label: '6-Day Push Pull Legs (PPL)',
      restLabel: 'Rest & recovery: Day 7',
      promptLabel: '6-day push/pull/legs',
      generator: generatePPLWorkout
    },
    BroSplit: {
      label: 'Single Muscle Split',
      restLabel: 'Rest & recovery: Days 6–7',
      promptLabel: '5-day single-muscle-group',
      generator: generateBroSplitWorkout
    },
    UpperLower: {
      label: 'Upper/Lower Split',
      restLabel: 'Rest & recovery: Days 5, 6 & 7',
      promptLabel: '4-day upper/lower',
      generator: generateUpperLowerWorkout
    },
    FullBody: {
      label: 'Full Body Training',
      restLabel: 'Rest & recovery: Days 2, 4, 6 & 7',
      promptLabel: '3-day full body',
      generator: generateFullBodyWorkout
    },
    Home: {
      label: 'Home Workout',
      restLabel: 'Rest & recovery: Days 4 & 7',
      promptLabel: '3-day home bodyweight/dumbbell',
      generator: generateHomeWorkout
    }
  };

  function getWorkoutTypeConfig(workoutType) {
    return WORKOUT_TYPES[workoutType] || WORKOUT_TYPES.PPL;
  }

  function buildWorkoutPlan(workoutType) {
    return getWorkoutTypeConfig(workoutType).generator();
  }

  // ------------------------------------------------------------
  // Experience gates which splits make sense. A beginner doesn't need
  // (and shouldn't be pushed toward) a 6-day PPL — more days/muscle
  // specialization is for once technique + consistency are already
  // solid. Each level gets a sensible default and only the splits
  // appropriate for it stay selectable.
  // ------------------------------------------------------------
  const EXPERIENCE_SPLITS = {
    Beginner: {
      allowed: ['FullBody', 'Home'],
      default: 'FullBody',
      note: '🟢 Beginners get Full Body (3-day) — full-body sessions build technique and consistency before adding more training days.'
    },
    Intermediate: {
      allowed: ['FullBody', 'UpperLower', 'Home'],
      default: 'UpperLower',
      note: '🟡 Intermediate lifters get Upper/Lower (4-day) — more weekly volume once technique and consistency are solid.'
    },
    Advanced: {
      allowed: ['UpperLower', 'BroSplit', 'PPL'],
      default: 'PPL',
      note: '🔴 Advanced lifters get higher-frequency splits (Upper/Lower, Muscle Split, PPL) for individualized, higher-volume programming.'
    }
  };

  // Returns a split guaranteed to be appropriate for the given experience —
  // falls back to that level's default if the requested split isn't one of
  // its allowed options (or isn't chosen yet). Used as a final safety net
  // even if the UI state is somehow bypassed.
  function getSplitForExperience(experience, requestedSplit) {
    const config = EXPERIENCE_SPLITS[experience];
    if (!config) return requestedSplit;
    return config.allowed.includes(requestedSplit) ? requestedSplit : config.default;
  }

  // Filters the Split dropdown to only the options that fit the chosen
  // experience level, auto-selects that level's default, and shows an
  // explanatory note. Called on experience change, on init, and when a
  // saved profile is restored.
  function applyExperienceSplitConstraints(preserveSelection) {
    if (!experienceEl || !workoutTypeEl) return;
    const config = EXPERIENCE_SPLITS[experienceEl.value];
    const splitNoteEl = $('splitNote');
    if (!config) {
      Array.from(workoutTypeEl.options).forEach(opt => { opt.hidden = false; opt.disabled = false; });
      if (splitNoteEl) splitNoteEl.style.display = 'none';
      return;
    }
    Array.from(workoutTypeEl.options).forEach(opt => {
      if (!opt.value) return; // keep the "Select" placeholder visible
      const allowed = config.allowed.includes(opt.value);
      opt.hidden = !allowed;
      opt.disabled = !allowed;
    });
    if (!preserveSelection || !config.allowed.includes(workoutTypeEl.value)) {
      workoutTypeEl.value = config.default;
    }
    if (splitNoteEl) { splitNoteEl.textContent = config.note; splitNoteEl.style.display = 'block'; }
  }

  // ============================================================
  // Exercise library — used for manual add/replace, keyed by focus
  // ============================================================
  const EXERCISE_LIBRARY = {
    Push: [
      { name: 'Barbell Bench Press', sets: 4, reps: 8 },
      { name: 'Overhead Shoulder Press', sets: 3, reps: 10 },
      { name: 'Incline Dumbbell Press', sets: 3, reps: 10 },
      { name: 'Machine Chest Press (low impact)', sets: 3, reps: 12 },
      { name: 'Tricep Dips', sets: 3, reps: 12 },
      { name: 'Lateral Raises', sets: 3, reps: 15 },
      { name: 'Push-ups', sets: 3, reps: 15 }
    ],
    Pull: [
      { name: 'Deadlift', sets: 4, reps: 6 },
      { name: 'Romanian Deadlift (light, controlled)', sets: 3, reps: 10 },
      { name: 'Pull-ups or Lat Pulldown', sets: 3, reps: 10 },
      { name: 'Barbell Row', sets: 3, reps: 10 },
      { name: 'Seated Cable Row', sets: 3, reps: 12 },
      { name: 'Face Pulls', sets: 3, reps: 15 },
      { name: 'Bicep Curls', sets: 3, reps: 12 }
    ],
    Legs: [
      { name: 'Squats', sets: 4, reps: 8 },
      { name: 'Leg Press', sets: 3, reps: 12 },
      { name: 'Lunges', sets: 3, reps: 12 },
      { name: 'Step-Ups (low impact)', sets: 3, reps: 12 },
      { name: 'Romanian Deadlift', sets: 3, reps: 10 },
      { name: 'Seated Leg Curl', sets: 3, reps: 12 },
      { name: 'Standing Calf Raises', sets: 4, reps: 15 },
      { name: 'Hanging Leg Raises (core)', sets: 3, reps: 12 },
      { name: 'Seated Knee Raises (core)', sets: 3, reps: 12 }
    ],
    Chest: [
      { name: 'Bench Press', sets: 4, reps: 8 },
      { name: 'Incline Dumbbell Press', sets: 3, reps: 10 },
      { name: 'Chest Fly', sets: 3, reps: 12 },
      { name: 'Machine Chest Press (low impact)', sets: 3, reps: 12 },
      { name: 'Push-ups', sets: 3, reps: 15 }
    ],
    Back: [
      { name: 'Deadlift', sets: 4, reps: 6 },
      { name: 'Romanian Deadlift (light, controlled)', sets: 3, reps: 10 },
      { name: 'Lat Pulldown', sets: 3, reps: 10 },
      { name: 'Seated Row', sets: 3, reps: 12 },
      { name: 'Face Pulls', sets: 3, reps: 15 }
    ],
    Shoulders: [
      { name: 'Overhead Press', sets: 4, reps: 8 },
      { name: 'Lateral Raises', sets: 3, reps: 12 },
      { name: 'Rear Delt Fly', sets: 3, reps: 15 },
      { name: 'Machine Shoulder Press (low impact)', sets: 3, reps: 12 }
    ],
    Arms: [
      { name: 'Barbell Curl', sets: 3, reps: 10 },
      { name: 'Tricep Pushdown', sets: 3, reps: 10 },
      { name: 'Hammer Curl', sets: 3, reps: 12 },
      { name: 'Cable Curl', sets: 3, reps: 12 }
    ]
  };

  // Combined categories so the "+ Add exercise" picker also works for the
  // Upper/Lower, Full Body, and Home workout types.
  EXERCISE_LIBRARY.Upper = [...EXERCISE_LIBRARY.Push, ...EXERCISE_LIBRARY.Pull];
  EXERCISE_LIBRARY.Lower = EXERCISE_LIBRARY.Legs;
  EXERCISE_LIBRARY['Full Body'] = [...EXERCISE_LIBRARY.Push, ...EXERCISE_LIBRARY.Pull, ...EXERCISE_LIBRARY.Legs];
  EXERCISE_LIBRARY.Home = [
    { name: 'Push-ups', sets: 3, reps: 15 },
    { name: 'Decline Push-ups', sets: 3, reps: 12 },
    { name: 'Pike Push-ups', sets: 3, reps: 12 },
    { name: 'Bodyweight Squats', sets: 4, reps: 20 },
    { name: 'Bodyweight Lunges', sets: 3, reps: 15 },
    { name: 'Glute Bridges', sets: 3, reps: 15 },
    { name: 'Single-Leg Glute Bridges', sets: 3, reps: 12 },
    { name: 'Inverted Rows / Superman Pulls', sets: 3, reps: 12 },
    { name: 'Superman Pulls', sets: 3, reps: 15 },
    { name: 'Doorway Rows', sets: 3, reps: 12 },
    { name: 'Bench/Chair Dips', sets: 3, reps: 12 },
    { name: 'Towel/Resistance Band Curl', sets: 3, reps: 15 },
    { name: 'Mountain Climbers', sets: 3, reps: 20 },
    { name: 'Bicycle Crunches', sets: 3, reps: 20 }
  ];

  // Exercises swapped out automatically when equipment is limited.
  const BODYWEIGHT_SWAPS = {
    'Barbell Bench Press': { name: 'Push-ups', sets: 4, reps: 15 },
    'Bench Press': { name: 'Push-ups', sets: 4, reps: 15 },
    'Incline Dumbbell Press': { name: 'Decline Push-ups', sets: 3, reps: 12 },
    'Squats': { name: 'Bodyweight Squats', sets: 4, reps: 20 },
    'Leg Press': { name: 'Bodyweight Lunges', sets: 3, reps: 15 },
    'Deadlift': { name: 'Glute Bridges', sets: 3, reps: 15 },
    'Romanian Deadlift': { name: 'Single-Leg Glute Bridges', sets: 3, reps: 12 },
    'Barbell Row': { name: 'Inverted Rows / Superman Pulls', sets: 3, reps: 12 },
    'Pull-ups or Lat Pulldown': { name: 'Pull-ups (or Doorway Rows)', sets: 3, reps: 8 },
    'Lat Pulldown': { name: 'Doorway Rows', sets: 3, reps: 12 },
    'Overhead Press': { name: 'Pike Push-ups', sets: 3, reps: 12 },
    'Overhead Shoulder Press': { name: 'Pike Push-ups', sets: 3, reps: 12 },
    'Barbell Curl': { name: 'Towel/Resistance Band Curl', sets: 3, reps: 15 },
    'Tricep Pushdown': { name: 'Bench/Chair Dips', sets: 3, reps: 12 }
  };

  const HOME_SWAPS = {
    'Barbell Bench Press': { name: 'Dumbbell Bench Press', sets: 4, reps: 10 },
    'Bench Press': { name: 'Dumbbell Bench Press', sets: 4, reps: 10 },
    'Deadlift': { name: 'Dumbbell Romanian Deadlift', sets: 3, reps: 10 },
    'Barbell Row': { name: 'Dumbbell Row', sets: 3, reps: 10 },
    'Overhead Press': { name: 'Dumbbell Shoulder Press', sets: 3, reps: 10 },
    'Overhead Shoulder Press': { name: 'Dumbbell Shoulder Press', sets: 3, reps: 10 },
    'Barbell Curl': { name: 'Dumbbell Curl', sets: 3, reps: 12 }
  };

  function adjustWorkoutForEquipment(workoutPlan, equipment) {
    if (equipment !== 'bodyweight' && equipment !== 'home') return { plan: workoutPlan, notes: [] };
    const swaps = equipment === 'bodyweight' ? BODYWEIGHT_SWAPS : HOME_SWAPS;
    const plan = workoutPlan.map(day => ({
      ...day,
      exercises: day.exercises.map(ex => {
        const swap = swaps[ex.name];
        return swap ? { ...ex, name: swap.name, sets: swap.sets, reps: swap.reps, adapted: true } : { ...ex };
      })
    }));
    const notes = [equipment === 'bodyweight'
      ? '🏠 Bodyweight-only: barbell/machine lifts swapped for equivalent bodyweight movements.'
      : '🏠 Home basics: barbell lifts swapped for dumbbell/band equivalents.'];
    return { plan, notes };
  }


  const JOINT_SAFE_SWAPS = {
    'Squats': { name: 'Leg Press', sets: 3, reps: 12 },
    'Lunges': { name: 'Step-Ups (low impact)', sets: 3, reps: 12 },
    'Deadlift': { name: 'Romanian Deadlift (light, controlled)', sets: 3, reps: 10 },
    'Leg Curl': { name: 'Seated Leg Curl', sets: 3, reps: 12 },
    'Hanging Leg Raises (core)': { name: 'Seated Knee Raises (core)', sets: 3, reps: 12 }
  };

  // Heavy compound lifts that get trimmed/paced for heart disease & hypertension
  // (these involve breath-holding / high intra-abdominal pressure).
  const HEAVY_COMPOUNDS = ['Deadlift', 'Squats', 'Bench Press', 'Barbell Bench Press', 'Overhead Press', 'Overhead Shoulder Press'];

  function adjustWorkoutForConditions(workoutPlan, conditions) {
    const hasJoint = conditions.includes('joint');
    const cautious = conditions.includes('heart') || conditions.includes('hypertension');

    const plan = workoutPlan.map(day => ({
      ...day,
      exercises: day.exercises.map(ex => {
        let e = { ...ex };
        if (hasJoint && JOINT_SAFE_SWAPS[e.name]) {
          const swap = JOINT_SAFE_SWAPS[e.name];
          e = { ...e, name: swap.name, sets: swap.sets, reps: swap.reps, adapted: true };
        }
        if (cautious && HEAVY_COMPOUNDS.includes(e.name)) {
          e = { ...e, sets: Math.max(3, e.sets - 1), caution: true };
        }
        return e;
      })
    }));

    const notes = [];
    if (hasJoint) notes.push('🦵 Joint-friendly: high-impact leg/spine-loading moves swapped for lower-impact alternatives.');
    if (cautious) notes.push('❤️ Heart/BP: heavy compound sets trimmed and paced — breathe steadily, never hold your breath, stop if dizzy or short of breath.');
    if (conditions.includes('diabetes')) notes.push('🩸 Diabetes: consider a short walk after meals to help manage blood sugar, and keep a fast-acting carb source on hand during training.');

    return { plan, notes };
  }

  function composeWorkoutAdjustments(rawPlan, conditions, equipment) {
    const step1 = adjustWorkoutForConditions(rawPlan, conditions);
    const step2 = adjustWorkoutForEquipment(step1.plan, equipment);
    return { plan: step2.plan, notes: [...step1.notes, ...step2.notes] };
  }

  function restDaysLabel(workoutType) {
    return getWorkoutTypeConfig(workoutType).restLabel;
  }

  function waterTargetLiters(weightKg) {
    return Math.round(weightKg * 0.035 * 10) / 10;
  }

  const SUPPLEMENT_SUGGESTIONS = [
    'Whey or plant protein — convenient way to hit your daily protein target',
    'Creatine monohydrate (5g/day) — well-studied for strength/muscle gains',
    'Multivitamin — a simple nutritional safety net',
    'Omega-3 / fish oil — supports heart & joint health'
  ];

  function buildCoachNotes(user, tierLabel) {
    const parts = [];
    const heightNote = `${user.heightFeet}'${user.heightInches || 0}"`;
    parts.push(`At ${user.age}, ${heightNote} and ${user.weightKg}kg with a ${user.activityLevel.toLowerCase()} activity level, your plan is built around a ${user.goal.toLowerCase()} goal.`);
    if (user.targetWeightKg) {
      const diff = user.weightKg - user.targetWeightKg;
      if (Math.abs(diff) >= 1) {
        parts.push(`Getting from ${user.weightKg}kg to your ${user.targetWeightKg}kg target means ${diff > 0 ? 'a steady calorie deficit' : 'a modest calorie surplus'} — sustainable pacing beats crash changes.`);
      }
    }
    parts.push(`As a ${user.experience.toLowerCase()} lifter, your ${getWorkoutTypeConfig(user.workoutType).label.toLowerCase()} routine is paced accordingly, using ${user.equipment === 'bodyweight' ? 'bodyweight-only movements' : user.equipment === 'home' ? 'home/dumbbell equipment' : 'full gym equipment'}.`);
    parts.push(`Nutrition is tuned to your ${tierLabel.toLowerCase()} budget and ${user.dietPref} preference${user.conditions.length ? `, with adjustments for ${user.conditions.join(', ')}` : ''}.`);
    parts.push(`Aim for ${waterTargetLiters(user.weightKg)}L of water daily and stick to consistent meal timing for the best results.`);
    return parts.join(' ');
  }

  // 12-week linear progression: every N weeks (by experience) add one rep
  // per set, then note when it's time to add load and reset reps.
  function buildProgressionForExercise(exercise, experience) {
    const stepWeeks = PROGRESSION_STEP_WEEKS[experience] || 2;
    const weeks = [];
    let reps = exercise.reps;
    for (let w = 1; w <= PROGRESSION_WEEKS; w++) {
      if (w > 1 && (w - 1) % stepWeeks === 0) reps += 1;
      weeks.push({ week: w, sets: exercise.sets, reps });
    }
    return weeks;
  }

  function buildWeeklyProgression(workoutPlan, experience) {
    return workoutPlan.map(day => ({
      ...day,
      exercises: day.exercises.map(ex => ({
        ...ex,
        progression: buildProgressionForExercise(ex, experience)
      }))
    }));
  }

  // ============================================================
  // Rendering
  // ============================================================
  function formatNumber(n) {
    const x=Math.round(Number(n)*10)/10;
    return Number.isInteger(x) ? String(x) : x.toFixed(1).replace(/\.0$/,'');
  }

  // Rounds a gram/ml amount to a step size a person could actually measure
  // or eyeball, scaling the step with the size of the portion.
  function roundToNiceStep(amount) {
    if (amount <= 0) return 0;
    const step = amount < 50 ? 5 : amount < 150 ? 10 : 25;
    return Math.round(amount / step) * step;
  }

  // Rounds count-based items (eggs, roti, banana) to the nearest half —
  // a practical kitchen quantity — and renders it with a fraction glyph.
  function formatCount(qty) {
    const rounded = Math.round(qty * 2) / 2;
    if (rounded <= 0) return { label: '0', value: 0 };
    const whole = Math.floor(rounded);
    const hasHalf = rounded - whole === 0.5;
    const label = !hasHalf ? String(rounded) : (whole === 0 ? '½' : `${whole}½`);
    return { label, value: rounded };
  }

  function formatPortion(item) {
    const qty=Number(item?.qty);
    if(!Number.isFinite(qty)||qty<=0) return '';
    const key=item.key || Object.keys(FOODS).find(k=>FOODS[k].name===item.name);
    const meta=FOOD_PORTIONS[key];
    if(!meta) { const c=formatCount(qty); return `${c.label} serving${c.value===1?'':'s'}`; }
    if(meta.unit==='g'){
      const amount=roundToNiceStep(qty*meta.amount);
      return `${amount} g ${FOODS[key].name.replace(/\s*\([^)]*\)\s*$/,'')}`;
    }
    if(meta.unit==='ml'){
      const amount=roundToNiceStep(qty*meta.amount);
      return `${amount} ml milk`;
    }
    const c=formatCount(qty);
    if(key==='eggs') return `${c.label} ${c.value===1?'egg':'eggs'}`;
    if(key==='roti') return `${c.label} ${c.value===1?'roti':'rotis'}`;
    if(key==='banana') return `${c.label} ${c.value===1?'banana':'bananas'}`;
    return `${c.label} serving${c.value===1?'':'s'}`;
  }

  function renderMealPlan(mealPlan) {
    mealsContainer.innerHTML='';
    mealPlan.meals.forEach((meal,idx)=>{
      const div=document.createElement('div'); div.className='inner-card fade-in';
      div.innerHTML=`<h3 style="font-family:'Space Grotesk',sans-serif;font-size:0.875rem;font-weight:600;color:#67e8f9;margin-bottom:0.6rem;">🍽️ Meal ${idx+1}</h3>
        <ul style="font-size:0.82rem;display:flex;flex-direction:column;gap:0.35rem;">${meal.items.map(it=>`<li style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.04);padding-bottom:0.3rem;"><span>${it.icon} ${formatPortion(it)}</span><span style="font-size:0.72rem;color:#64748b;white-space:nowrap;margin-left:0.5rem;">${Math.round(it.cal)} cal · ${Math.round(it.prot)}g P · ${Math.round(it.fat)}g F · ${Math.round(it.carbs)}g C</span></li>`).join('')}</ul>`;
      mealsContainer.appendChild(div);
    });
  }

  function renderWorkoutPlan(workoutPlan, workoutType) {
    workoutTitleEl.textContent = `🏋️ ${getWorkoutTypeConfig(workoutType).label}`;

    workoutContainer.innerHTML = '';
    workoutPlan.forEach((day, dayIdx) => {
      const dayDiv = document.createElement('div');
      dayDiv.className = "inner-card fade-in";

      const libraryOptions = (EXERCISE_LIBRARY[day.focus] || [])
        .map(ex => `<option value="${escapeHtml(ex.name)}">${escapeHtml(ex.name)}</option>`)
        .join('');

      dayDiv.innerHTML = `
        <h3 style="font-family:'Space Grotesk',sans-serif;font-size:0.875rem;font-weight:600;color:#93c5fd;margin-bottom:0.6rem;">🗓️ Day ${day.day} – ${day.focus}</h3>
        <ul style="font-size:0.82rem;display:flex;flex-direction:column;gap:0.35rem;" data-day-idx="${dayIdx}">
          ${day.exercises.map((ex, exIdx) => `
            <li style="border-bottom:1px solid rgba(255,255,255,0.04);padding:0.35rem 0;" class="exercise-row" data-ex-idx="${exIdx}">
              <span class="min-w-0">
                ${exIdx + 1}. ${escapeHtml(ex.name)}${ex.adapted ? ' <span class="text-cyan-300 text-[0.65rem]">(adapted)</span>' : ''}${ex.caution ? ' <span class="text-yellow-300 text-[0.65rem]">(paced)</span>' : ''}
                <span style="font-size:0.7rem;color:#64748b;display:block;">${ex.sets} sets × ${ex.reps} reps</span>
              </span>
              <span class="exercise-controls">
                <button type="button" class="btn-xs" data-action="up" title="Move up">▲</button>
                <button type="button" class="btn-xs" data-action="down" title="Move down">▼</button>
                <button type="button" class="btn-xs danger" data-action="remove" title="Remove">✕</button>
              </span>
            </li>`).join('')}
        </ul>
        <div class="add-exercise-row">
          <select class="hp-input add-exercise-select" style="font-size:0.75rem;padding:0.35rem 0.6rem;" data-day-idx="${dayIdx}">
            <option value="">+ Add exercise…</option>
            ${libraryOptions}
          </select>
          <button type="button" class="btn-xs add-exercise-btn" data-day-idx="${dayIdx}">Add</button>
        </div>`;
      workoutContainer.appendChild(dayDiv);
    });
  }

  // ============================================================
  // Workout editor — add / remove / reorder, persisted per session
  // ============================================================
  async function saveWorkoutState() {
    if (!currentWorkoutPlan || !currentUser) return;
    await putJsonData(STORAGE_KEY_WORKOUT, {
      workoutPlan: currentWorkoutPlan,
      experience: currentExperience,
      workoutType: currentWorkoutType,
      savedAt: new Date().toISOString()
    });
  }

  async function loadWorkoutState() {
    if (!currentUser) return null;
    return await fetchJsonData(STORAGE_KEY_WORKOUT);
  }

  async function rerenderWorkoutAfterEdit() {
    const progressionPlan = buildWeeklyProgression(currentWorkoutPlan, currentExperience);
    renderWorkoutPlan(currentWorkoutPlan, currentWorkoutType);
    renderWeeklyProgression(progressionPlan);
    await saveWorkoutState();
  }

  async function handleWorkoutEditClick(e) {
    const btn = e.target.closest('button[data-action]');
    const addBtn = e.target.closest('.add-exercise-btn');
    if (!btn && !addBtn) return;
    if (!currentWorkoutPlan) return;

    if (addBtn) {
      const dayIdx = Number(addBtn.dataset.dayIdx);
      const select = workoutContainer.querySelector(`.add-exercise-select[data-day-idx="${dayIdx}"]`);
      const name = select && select.value;
      if (!name) return;
      const focus = currentWorkoutPlan[dayIdx].focus;
      const libEntry = (EXERCISE_LIBRARY[focus] || []).find(ex => ex.name === name);
      const newExercise = libEntry ? { ...libEntry } : { name, sets: 3, reps: 12 };
      currentWorkoutPlan[dayIdx].exercises.push(newExercise);
      await rerenderWorkoutAfterEdit();
      return;
    }

    const li = btn.closest('li[data-ex-idx]');
    const ul = btn.closest('ul[data-day-idx]');
    if (!li || !ul) return;
    const dayIdx = Number(ul.dataset.dayIdx);
    const exIdx = Number(li.dataset.exIdx);
    const exercises = currentWorkoutPlan[dayIdx].exercises;
    const action = btn.dataset.action;

    if (action === 'remove') {
      if (exercises.length <= 1) return; // keep at least one exercise per day
      exercises.splice(exIdx, 1);
    } else if (action === 'up' && exIdx > 0) {
      [exercises[exIdx - 1], exercises[exIdx]] = [exercises[exIdx], exercises[exIdx - 1]];
    } else if (action === 'down' && exIdx < exercises.length - 1) {
      [exercises[exIdx + 1], exercises[exIdx]] = [exercises[exIdx], exercises[exIdx + 1]];
    } else {
      return;
    }
    await rerenderWorkoutAfterEdit();
  }

  function renderWeeklyProgression(progressionPlan) {
    const container = $('weeklyProgression');
    container.innerHTML = `<div style="font-family:'Space Grotesk',sans-serif;font-size:1rem;font-weight:600;color:#e2e8f0;margin-bottom:1rem;">📈 12-Week Progression</div>`;
    const grid = document.createElement('div');
    grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:0.75rem;";

    progressionPlan.forEach(day => {
      const dayDiv = document.createElement('div');
      dayDiv.className = "fade-in"; dayDiv.style.cssText = "background:rgba(0,0,0,0.25);border:1px solid rgba(0,255,255,0.07);border-radius:0.75rem;padding:0.875rem;";
      const rows = day.exercises.map(ex => {
        const wk1 = ex.progression[0];
        const wk12 = ex.progression[ex.progression.length - 1];
        return `<div style="display:flex;justify-content:space-between;font-size:0.72rem;padding:0.3rem 0;border-bottom:1px solid rgba(255,255,255,0.04);">
          <span style="color:#cbd5e1;">${ex.name}</span>
          <span style="color:#64748b;">${wk1.sets}×${wk1.reps} → ${wk12.sets}×${wk12.reps} wk12</span>
        </div>`;
      }).join('');
      dayDiv.innerHTML = `<div style="font-size:0.8rem;font-weight:600;color:#67e8f9;margin-bottom:0.4rem;">Day ${day.day} – ${day.focus}</div>${rows}`;
      grid.appendChild(dayDiv);
    });

    container.appendChild(grid);
    const note = document.createElement('p');
    note.style.cssText = "font-size:0.72rem;color:#475569;margin-top:0.875rem;line-height:1.5;";
    note.textContent = "Add a rep to every set on schedule above. Once you hit the top rep target for all sets, add load and drop back to the starting rep count.";
    container.appendChild(note);
  }

  function renderProgressList(entries) {
    progressListEl.innerHTML = '';
    if (!entries.length) {
      progressListEl.innerHTML = `<p class="text-sm text-gray-400 col-span-3">No entries yet — save your first check-in above.</p>`;
      return;
    }
    // newest first
    [...entries].reverse().forEach(entry => {
      const card = document.createElement('div');
      card.className = "inner-card fade-in";
      card.innerHTML = `
        <div style="font-size:0.8rem;font-weight:600;color:#67e8f9;margin-bottom:0.4rem;">${entry.date}</div>
        <div style="font-size:0.82rem;color:#94a3b8;">Waist: ${entry.waist ?? '—'} in · Abs: ${entry.abs ?? '—'}/10</div>
        ${entry.reflection ? `<p style="font-size:0.75rem;color:#64748b;margin-top:0.5rem;">${escapeHtml(entry.reflection)}</p>` : ''}
        ${entry.photo ? `<img src="${entry.photo}" style="margin-top:0.75rem;border-radius:0.5rem;width:100%;height:8rem;object-fit:cover;" alt="Progress photo" />` : ''}
      `;
      progressListEl.appendChild(card);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ============================================================
  // Validation
  // ============================================================
  const FIELD_MAP = [
    { key: 'age', el: ageEl, label: 'Age', min: 14, max: 90, unit: 'yrs' },
    { key: 'gender', el: genderEl, label: 'Gender' },
    { key: 'heightFeet', el: heightFeetEl, label: 'Height (feet)', min: 3, max: 8, unit: 'ft' },
    { key: 'weightKg', el: weightEl, label: 'Weight', min: 25, max: 250, unit: 'kg' },
    { key: 'activityLevel', el: activityEl, label: 'Activity level' },
    { key: 'goal', el: goalEl, label: 'Goal' },
    { key: 'budget', el: budgetEl, label: 'Budget', min: 3000, max: 300000, unit: 'PKR' },
    { key: 'experience', el: experienceEl, label: 'Experience level' },
    { key: 'workoutType', el: workoutTypeEl, label: 'Workout type' },
  ];

  function clearFieldErrors() {
    FIELD_MAP.forEach(f => f.el.classList.remove('input-error'));
    heightInchesEl.classList.remove('input-error');
    if (targetWeightEl) targetWeightEl.classList.remove('input-error');
    waistEl.classList.remove('input-error');
    absEl.classList.remove('input-error');
  }

  let errorMessageTimeout = null;

  function showValidationError(html) {
    if (errorMessageTimeout) clearTimeout(errorMessageTimeout);
    messageBox.innerHTML = `<div id="errorMessage" class="error-msg fade-in">${html}</div>`;

    const errorEl = $('errorMessage');
    errorMessageTimeout = setTimeout(() => {
      if (!errorEl) return;
      errorEl.style.transition = 'opacity 0.5s ease';
      errorEl.style.opacity = '0';
      setTimeout(() => {
        if (messageBox.contains(errorEl)) messageBox.innerHTML = '';
      }, 500);
    }, 6500);
  }

  function validateForm() {
    clearFieldErrors();
    const missing = [];
    const outOfRange = [];

    FIELD_MAP.forEach(f => {
      const val = f.el.value;
      if (val === '' || val === null || val === undefined) {
        missing.push(f.label);
        f.el.classList.add('input-error');
        return;
      }
      if (typeof f.min === 'number') {
        const num = Number(val);
        if (Number.isNaN(num) || num < f.min || num > f.max) {
          outOfRange.push(`${f.label} must be between ${f.min}–${f.max} ${f.unit}`);
          f.el.classList.add('input-error');
        }
      }
    });

    // heightInches is optional but still bounded 0-11
    const inches = heightInchesEl.value;
    if (inches !== '' && (Number(inches) < 0 || Number(inches) > 11 || Number.isNaN(Number(inches)))) {
      outOfRange.push('Height (inches) must be between 0–11 in');
      heightInchesEl.classList.add('input-error');
    }

    // targetWeight is optional but still bounded like weight
    if (targetWeightEl && targetWeightEl.value !== '') {
      const tw = Number(targetWeightEl.value);
      if (Number.isNaN(tw) || tw < 25 || tw > 250) {
        outOfRange.push('Target weight must be between 25–250 kg');
        targetWeightEl.classList.add('input-error');
      }
    }

    if (missing.length || outOfRange.length) {
      const parts = [];
      if (missing.length) parts.push(`⚠️ Missing: <b>${missing.join(', ')}</b>`);
      if (outOfRange.length) parts.push(`⚠️ ${outOfRange.join(' · ')}`);
      showValidationError(parts.map(p => `<div>${p}</div>`).join(''));
      return false;
    }
    if (errorMessageTimeout) clearTimeout(errorMessageTimeout);
    messageBox.innerHTML = '';
    return true;
  }

  // ============================================================
  // Persistence
  // ============================================================
  function collectUserInputs() {
    return {
      accountId: currentUser ? (currentUser.fullName || currentUser.email) : '',
      age: Number(ageEl.value),
      gender: genderEl.value,
      heightFeet: Number(heightFeetEl.value),
      heightInches: Number(heightInchesEl.value) || 0,
      heightCm: (Number(heightFeetEl.value) * 30.48) + (Number(heightInchesEl.value) * 2.54),
      weightKg: Number(weightEl.value),
      targetWeightKg: targetWeightEl && targetWeightEl.value ? Number(targetWeightEl.value) : null,
      activityLevel: activityEl.value,
      goal: goalEl.value,
      budget: Number(budgetEl.value),
      experience: experienceEl.value,
      workoutType: getSplitForExperience(experienceEl.value, workoutTypeEl.value),
      dietPref: dietPrefEl ? dietPrefEl.value : 'nonveg',
      equipment: equipmentEl ? equipmentEl.value : 'full',
      allergies: allergiesEl && allergiesEl.value.trim()
        ? allergiesEl.value.split(',').map(s => s.trim()).filter(Boolean)
        : [],
      showSupplements: !!(showSupplementsEl && showSupplementsEl.checked),
      conditions: conditionCheckboxes().filter(cb => cb.checked).map(cb => cb.value)
    };
  }

  function applyUserInputs(user) {
    if (!user) return;
    ageEl.value = user.age ?? '';
    genderEl.value = user.gender ?? '';
    heightFeetEl.value = user.heightFeet ?? '';
    heightInchesEl.value = user.heightInches ?? '';
    weightEl.value = user.weightKg ?? '';
    if (targetWeightEl) targetWeightEl.value = user.targetWeightKg ?? '';
    activityEl.value = user.activityLevel ?? '';
    goalEl.value = user.goal ?? '';
    budgetEl.value = user.budget ?? '';
    experienceEl.value = user.experience ?? '';
    workoutTypeEl.value = user.workoutType ?? '';
    applyExperienceSplitConstraints(true);
    if (equipmentEl) equipmentEl.value = user.equipment ?? 'full';
    if (allergiesEl) allergiesEl.value = (user.allergies || []).join(', ');
  }


  async function savePlan(state) {
    if (!currentUser) return;
    await putJsonData(STORAGE_KEY_PLAN, state);
  }

  async function loadPlan() {
    if (!currentUser) return null;
    return await fetchJsonData(STORAGE_KEY_PLAN);
  }

  async function loadProgressEntries() {
    if (!currentUser) return [];
    return (await fetchJsonData(STORAGE_KEY_PROGRESS)) || [];
  }

  async function saveProgressEntries(entries) {
    if (!currentUser) return;
    await putJsonData(STORAGE_KEY_PROGRESS, entries);
  }

  // ============================================================
  // Main generate flow
  // ============================================================
  function renderFullResult(user, nutritionTargets, bmr, mealPlan, workoutPlan, progressionPlan, dietNotes, workoutAdaptNotes) {
    calTargetEl.textContent = `${nutritionTargets.calories} kcal`;
    calDetailEl.textContent = `BMR ${bmr} kcal · ${user.activityLevel} activity`;
    proteinTargetEl.textContent = `${nutritionTargets.protein} g`;
    if (fatTargetEl) fatTargetEl.textContent = `${nutritionTargets.fat} g`;
    if (carbsTargetEl) carbsTargetEl.textContent = `${nutritionTargets.carbs} g`;

    const tier=budgetTierFromValue(user.budget);
    budgetTierEl.textContent=BUDGET_TIERS[tier].label;
    estCostEl.textContent=`Est. daily cost: ₨${Math.round(mealPlan.estCostPKR/5)*5} PKR`;
    if(waterTargetEl) waterTargetEl.textContent=`${waterTargetLiters(user.weightKg)} L`;

    renderNotesPanel(dietNotesEl,dietNotes);
    renderMealPlan(mealPlan);
    const actual=mealPlanTotals(mealPlan.meals);
    dailyTotalsEl.textContent=`${Math.round(actual.calories)} kcal · ${Math.round(actual.protein)} g P · ${Math.round(actual.fat)} g F · ${Math.round(actual.carbs)} g C · ₨${Math.round(actual.cost)}/day`;
    calBar.style.width=`${Math.min(100,Math.round((actual.calories/nutritionTargets.calories)*100))}%`;
    protBar.style.width=`${Math.min(100,Math.round((actual.protein/nutritionTargets.protein)*100))}%`;

    renderNotesPanel(workoutNotesEl,workoutAdaptNotes);
    renderWorkoutPlan(workoutPlan,user.workoutType);
    renderWeeklyProgression(progressionPlan);
    if(restDaysNoteEl) restDaysNoteEl.textContent=restDaysLabel(user.workoutType);
    if(coachNotesCard&&coachNotesEl){
      coachNotesCard.classList.remove('hidden');
      coachNotesEl.textContent=buildCoachNotes(user,BUDGET_TIERS[tier].label);
      if(supplementNotesEl) supplementNotesEl.innerHTML=user.showSupplements
        ? `<b>Optional supplements</b> (not required — check with a professional first, especially with existing conditions):<ul class="list-disc list-inside mt-1 space-y-0.5">${SUPPLEMENT_SUGGESTIONS.map(s=>`<li>${s}</li>`).join('')}</ul>` : '';
    }
  }

  function renderNotesPanel(container, notes) {
    if (!container) return;
    if (!notes || !notes.length) { container.innerHTML = ''; return; }
    container.innerHTML = notes.map(n => `<p class="condition-note">${n}</p>`).join('');
  }

  // ============================================================
  // AI-powered generation (falls back to the rule-based engine below
  // if the Anthropic API isn't reachable from this environment — the
  // app remains fully usable either way).
  // ============================================================
  function buildPlanPrompt(user, maintenance, tierLabel, nutritionTargets) {
    const schemaHint = `Return ONLY minified JSON, no prose, no code fences, matching exactly:
{"mealPlan":[{"items":[{"name":"string","qty":number,"cal":number,"prot":number,"fat":number,"carbs":number,"cost":number}]}],
"workoutPlan":[{"day":number,"focus":"string","exercises":[{"name":"string","sets":number,"reps":number}]}],
"coachNotes":"string (3-5 sentences, professional nutritionist/coach tone)"}`;

    return `You are a certified nutritionist and fitness coach. Build a one-day meal plan (5 meals) and a ${getWorkoutTypeConfig(user.workoutType).promptLabel} workout plan for this client:
- Age ${user.age}, ${user.gender}, ${user.heightFeet}ft ${user.heightInches}in, ${user.weightKg}kg${user.targetWeightKg ? `, target weight ${user.targetWeightKg}kg` : ''}
- Activity: ${user.activityLevel}, Experience: ${user.experience}, Goal: ${user.goal}
- AUTHORITATIVE daily targets: ${nutritionTargets.calories} kcal, ${nutritionTargets.protein} g protein, ${nutritionTargets.fat} g fat, ${nutritionTargets.carbs} g carbohydrates.
- Budget tier: ${tierLabel} (PKR ${user.budget}/month)
- Dietary preference: ${user.dietPref}${user.allergies.length ? `, allergies: ${user.allergies.join(', ')}` : ''}
- Equipment available: ${user.equipment}
- Medical conditions: ${user.conditions.length ? user.conditions.join(', ') : 'none'}
Use common Pakistani/South Asian foods (roti, daal, chicken, eggs, chana, etc.) priced in PKR. Keep total daily meal cost within budget. Adapt exercises for any medical conditions and equipment limits.
${schemaHint}`;
  }

  function validPlanShape(parsed) {
    return parsed && parsed.mealPlan && parsed.workoutPlan;
  }

  // Preferred path: our own backend (server/), which holds the real API
  // key. This is the only path that works once the app is deployed as a
  // plain static site.
  async function tryGenerateViaProxy(user, maintenance, tierLabel) {
    try {
      const response = await fetch(AI_PROXY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, maintenance, tierLabel })
      });
      if (!response.ok) return null;
      const parsed = await response.json();
      return validPlanShape(parsed) ? parsed : null;
    } catch (e) {
      console.warn('AI proxy unavailable:', e);
      return null;
    }
  }

  // Secondary path: call Anthropic directly. There is no API key attached
  // client-side here, so this only succeeds in environments that proxy the
  // request on your behalf (e.g. previewing this file inside Claude.ai).
  // In a real standalone deployment this call will simply fail, and that's
  // expected — see server/README.md.
  async function tryGenerateDirect(user, maintenance, tierLabel, nutritionTargets) {
    const prompt = buildPlanPrompt(user, maintenance, tierLabel, nutritionTargets);
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 2000,
          messages: [{ role: "user", content: prompt }]
        })
      });
      if (!response.ok) return null;
      const data = await response.json();
      const text = (data.content || []).map(b => b.text || '').join('');
      const clean = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      return validPlanShape(parsed) ? parsed : null;
    } catch (e) {
      console.warn('Direct AI call unavailable:', e);
      return null;
    }
  }

  async function tryGenerateWithAI(user, maintenance, tierLabel, nutritionTargets) {
    const viaProxy = await tryGenerateViaProxy(user, maintenance, tierLabel);
    if (viaProxy) return viaProxy;
    const direct = await tryGenerateDirect(user, maintenance, tierLabel, nutritionTargets);
    if (direct) return direct;
    console.info('AI plan generation unavailable — using the built-in personalization engine.');
    return null;
  }

  async function generateAll() {
    if (!currentUser && !isGuestSession) { showValidationError('⚠️ Please log in (or continue as guest) to generate a plan.'); return; }
    if (!validateForm()) return;
    const user = collectUserInputs();
    const tier = budgetTierFromValue(user.budget);
    const { bmr, maintenance: baseMaintenance } = mifflinStJeor(user);
    const maintenance = applyTargetWeightAdjustment(baseMaintenance, user.weightKg, user.targetWeightKg);
    const nutritionTargets = calculateNutritionTargets(user, maintenance);

    generateBtn.textContent = '🧠 Building and validating your plan…';
    generateBtn.disabled = true;

    try {
      const aiResult = await tryGenerateWithAI(user, maintenance, BUDGET_TIERS[tier].label, nutritionTargets);
      let mealPlan, workoutPlan, workoutAdaptNotes, coachNotesOverride, usedAI=false;

      if (aiResult) {
        mealPlan = mealPlanFromAI(aiResult.mealPlan, nutritionTargets);
        if (mealPlan) usedAI=true;
        else console.warn('AI meal plan rejected: nutrition totals did not meet the authoritative targets.');
        const composed=composeWorkoutAdjustments(aiResult.workoutPlan,user.conditions,user.equipment);
        workoutPlan=composed.plan; workoutAdaptNotes=composed.notes; coachNotesOverride=aiResult.coachNotes;
      }

      // Deterministic fallback is authoritative: it cannot display/export until validated.
      if (!mealPlan) mealPlan=buildMealPlanForTier(tier,nutritionTargets,user.dietPref,user.conditions,user.allergies);
      if (!workoutPlan) {
        const composed=composeWorkoutAdjustments(buildWorkoutPlan(user.workoutType),user.conditions,user.equipment);
        workoutPlan=composed.plan; workoutAdaptNotes=composed.notes;
      }

      const actual=mealPlanTotals(mealPlan.meals);
      if (!nutritionWithinTolerance(actual,nutritionTargets)) throw new Error('Generated meals failed final nutrition validation.');

      const dietNotes=buildDietNotes(user.dietPref,user.conditions,user.allergies);
      const progressionPlan=buildWeeklyProgression(workoutPlan,user.experience);
      currentWorkoutPlan=workoutPlan; currentExperience=user.experience; currentWorkoutType=user.workoutType;

      renderFullResult(user,nutritionTargets,bmr,mealPlan,workoutPlan,progressionPlan,dietNotes,workoutAdaptNotes);
      if (coachNotesOverride && coachNotesEl) coachNotesEl.textContent=coachNotesOverride;
      ['summaryCard','mealPlanCard','workoutCard','weeklyProgression','actionButtons'].forEach(id=>{const el=document.getElementById(id);if(el)el.classList.remove('hidden');});
      const workoutHeading=document.getElementById('workoutPlanHeading'); if(workoutHeading) workoutHeading.classList.remove('hidden');
      lastGeneratedPlanState = {user,maintenance,nutritionTargets,bmr,mealPlan,workoutPlan,progressionPlan,usedAI,savedAt:new Date().toISOString()};
      if (currentUser) {
        // Guests skip this entirely — nothing about their plan reaches the backend.
        await savePlan(lastGeneratedPlanState);
        await saveWorkoutState();
      }
      generateBtn.textContent=usedAI?'✅ AI Plan Generated!':'✅ Plan Generated & Validated!';
      setTimeout(()=>{generateBtn.textContent='Generate Plan';},2500);
    } catch (err) {
      console.error(err);
      showValidationError('⚠️ The meal generator could not produce a plan that meets the nutrition targets. No invalid plan was displayed or saved.');
      generateBtn.textContent='Generate Plan';
    } finally {
      generateBtn.disabled=false;
    }
  }

  // ============================================================
  // Progress tracker
  // ============================================================
  function readPhotoAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleSaveProgress() {
    if (!currentUser) {
      showValidationError(isGuestSession
        ? '⚠️ Progress isn\'t saved in Guest mode — log in or register to track it.'
        : '⚠️ Please log in before saving progress.');
      return;
    }

    // Realistic physiological bounds — reject impossible values.
    const waistVal = waistEl.value !== '' ? Number(waistEl.value) : null;
    const absVal = absEl.value !== '' ? Number(absEl.value) : null;
    const errors = [];
    if (waistVal !== null && (Number.isNaN(waistVal) || waistVal < 20 || waistVal > 60)) {
      errors.push('Waist must be between 20–60 in');
      waistEl.classList.add('input-error');
    }
    if (absVal !== null && (Number.isNaN(absVal) || absVal < 1 || absVal > 10 || !Number.isInteger(absVal))) {
      errors.push('Abs rating must be a whole number between 1–10');
      absEl.classList.add('input-error');
    }
    if (errors.length) {
      showValidationError(errors.map(e => `<div>⚠️ ${e}</div>`).join(''));
      return;
    }
    waistEl.classList.remove('input-error');
    absEl.classList.remove('input-error');

    const entries = await loadProgressEntries();
    const photoFile = photoEl.files && photoEl.files[0];
    let photoDataUrl = null;
    try {
      photoDataUrl = await readPhotoAsDataUrl(photoFile);
    } catch (e) {
      console.error('Could not read progress photo:', e);
    }

    const entry = {
      date: new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
      waist: waistVal,
      abs: absVal,
      reflection: reflectionEl.value.trim(),
      photo: photoDataUrl
    };

    entries.push(entry);
    await saveProgressEntries(entries);
    renderProgressList(entries);

    // reset inputs after saving
    waistEl.value = '';
    absEl.value = '';
    reflectionEl.value = '';
    photoEl.value = '';
  }

  // ============================================================
  // Export / clear
  // ============================================================
  function showNoPlanToExportMessage() {
    messageBox.innerHTML = `
      <div class="max-w-lg mx-auto mt-2 mb-1 p-3 rounded-xl border border-yellow-500/40
                  bg-yellow-500/10 text-yellow-200 text-sm shadow-md text-center fade-in">
        Generate a plan first, then export it.
      </div>`;
  }

  // Emoji render as missing-glyph boxes in the PDF/Word fonts we ship, so
  // strip them from note text before writing it into an exported document.
  function stripEmoji(str) {
    return String(str || '').replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF\u2190-\u21FF\u2B00-\u2BFF]/gu, '').replace(/\s{2,}/g, ' ').trim();
  }

  // Pulls together everything needed for a professional export: the saved
  // profile/meal data plus the *live* (possibly hand-edited) workout plan
  // and its dynamic heading, so the exported file matches what's on screen.
  async function getExportData() {
    const saved = lastGeneratedPlanState || await loadPlan();
    if(!saved||!saved.user) return null;
    const tier=budgetTierFromValue(saved.user.budget);
    const nutritionTargets=saved.nutritionTargets || calculateNutritionTargets(saved.user,saved.maintenance);
    const mealPlan=saved.mealPlan;
    if(!mealPlan || !nutritionWithinTolerance(mealPlanTotals(mealPlan.meals),nutritionTargets)) return null;
    return {
      accountId:saved.user.accountId, generatedAt:saved.savedAt?new Date(saved.savedAt):new Date(),
      maintenance:nutritionTargets.calories, nutritionTargets, waterTarget:waterTargetLiters(saved.user.weightKg),
      tierLabel:BUDGET_TIERS[tier].label, mealPlan, workoutPlan:currentWorkoutPlan||saved.workoutPlan,
      workoutHeading:(workoutTitleEl&&workoutTitleEl.textContent)||`Workout Plan – ${getWorkoutTypeConfig(saved.user.workoutType).label}`,
      dietNotes:buildDietNotes(saved.user.dietPref,saved.user.conditions,saved.user.allergies),
      coachNotes:(coachNotesEl&&coachNotesEl.textContent)||buildCoachNotes(saved.user,BUDGET_TIERS[tier].label)
    };
  }

  async function handleExportPdf() {
    const data = await getExportData();
    if (!data) { showNoPlanToExportMessage(); return; }
    if (!window.jspdf || !window.jspdf.jsPDF) {
      showValidationError('⚠️ PDF export library failed to load — check your connection and try again.');
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 40;
    let y = 50;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(15, 23, 42);
    doc.text('BodyMath Fitness — Personalized Plan', margin, y);
    y += 18;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(100, 110, 125);
    doc.text(`Prepared for ${data.accountId}  ·  Generated ${data.generatedAt.toLocaleDateString()}`, margin, y);
    y += 22;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(15, 23, 42);
    doc.text('Daily Targets', margin, y);
    y += 8;
    doc.autoTable({
      startY: y,
      theme: 'grid',
      margin: { left: margin, right: margin },
      head: [['Calories', 'Protein', 'Fat', 'Carbs', 'Water', 'Budget tier', 'Est. daily cost']],
      body: [[
        `${data.nutritionTargets.calories} kcal`,
        `${data.nutritionTargets.protein} g`,
        `${data.nutritionTargets.fat} g`,
        `${data.nutritionTargets.carbs} g`,
        `${data.waterTarget} L`,
        data.tierLabel,
        `PKR ${data.mealPlan.estCostPKR}/day`
      ]],
      styles: { fontSize: 9, cellPadding: 6 },
      headStyles: { fillColor: [15, 23, 42] }
    });
    y = doc.lastAutoTable.finalY + 22;

    if (data.coachNotes) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(15, 23, 42);
      doc.text("Coach's Notes", margin, y);
      y += 14;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(70, 80, 95);
      const lines = doc.splitTextToSize(stripEmoji(data.coachNotes), pageWidth - margin * 2);
      doc.text(lines, margin, y);
      y += lines.length * 12 + 16;
    }

    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(15, 23, 42);
    doc.text('Meal Plan', margin, y);
    y += 8;
    const mealRows = [];
    data.mealPlan.meals.forEach((meal, idx) => {
      meal.items.forEach((it, i) => {
        mealRows.push([i === 0 ? `Meal ${idx + 1}` : '', formatPortion(it), `${Math.round(it.cal)} cal`, `${Math.round(it.prot)} g`, `${Math.round(it.fat)} g`, `${Math.round(it.carbs)} g`]);
      });
    });
    doc.autoTable({
      startY: y,
      theme: 'striped',
      margin: { left: margin, right: margin },
      head: [['Meal', 'Item', 'Calories', 'Protein', 'Fat', 'Carbs']],
      body: mealRows,
      foot: [['', 'Daily total', `${data.mealPlan.totalCal} cal`, `${data.mealPlan.totalProt} g`, `${data.mealPlan.totalFat} g`, `${data.mealPlan.totalCarbs} g`]],
      styles: { fontSize: 8.5, cellPadding: 5 },
      headStyles: { fillColor: [15, 23, 42] },
      footStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold' }
    });
    y = doc.lastAutoTable.finalY + 22;

    if (data.dietNotes.length) {
      if (y > pageHeight - 100) { doc.addPage(); y = 50; }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(80, 90, 105);
      data.dietNotes.forEach(n => {
        const lines = doc.splitTextToSize(`• ${stripEmoji(n)}`, pageWidth - margin * 2);
        doc.text(lines, margin, y);
        y += lines.length * 11 + 3;
      });
      y += 14;
    }

    if (y > pageHeight - 120) { doc.addPage(); y = 50; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(15, 23, 42);
    doc.text(stripEmoji(data.workoutHeading) || 'Workout Plan', margin, y);
    y += 8;
    const workoutRows = [];
    data.workoutPlan.forEach(day => {
      day.exercises.forEach((ex, i) => {
        workoutRows.push([i === 0 ? `Day ${day.day} – ${day.focus}` : '', ex.name, `${ex.sets}`, `${ex.reps}`]);
      });
    });
    doc.autoTable({
      startY: y,
      theme: 'striped',
      margin: { left: margin, right: margin },
      head: [['Day', 'Exercise', 'Sets', 'Reps']],
      body: workoutRows,
      styles: { fontSize: 8.5, cellPadding: 5 },
      headStyles: { fillColor: [15, 23, 42] }
    });

    doc.save(`health-pilot-plan-${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  async function handleExportDocx() {
    const data = await getExportData();
    if (!data) { showNoPlanToExportMessage(); return; }
    if (!window.docx) {
      showValidationError('⚠️ Word export library failed to load — check your connection and try again.');
      return;
    }

    const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } = window.docx;

    const cell = (text, opts = {}) => new TableCell({
      width: { size: opts.width || 25, type: WidthType.PERCENTAGE },
      children: [new Paragraph({ children: [new TextRun({ text: String(text), bold: !!opts.bold })] })]
    });

    const summaryTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: ['Calories', 'Protein', 'Fat', 'Carbs', 'Water', 'Budget tier'].map(h => cell(h, { bold: true })) }),
        new TableRow({ children: [
          cell(`${data.nutritionTargets.calories} kcal`), cell(`${data.nutritionTargets.protein} g`), cell(`${data.nutritionTargets.fat} g`), cell(`${data.nutritionTargets.carbs} g`), cell(`${data.waterTarget} L`), cell(data.tierLabel)
        ] })
      ]
    });

    const mealRows = [new TableRow({ children: ['Meal', 'Item', 'Calories', 'Protein', 'Fat', 'Carbs'].map(h => cell(h, { bold: true })) })];
    data.mealPlan.meals.forEach((meal, idx) => {
      meal.items.forEach((it, i) => {
        mealRows.push(new TableRow({ children: [
          cell(i === 0 ? `Meal ${idx + 1}` : ''), cell(formatPortion(it)), cell(`${Math.round(it.cal)} cal`), cell(`${Math.round(it.prot)} g`), cell(`${Math.round(it.fat)} g`), cell(`${Math.round(it.carbs)} g`)
        ] }));
      });
    });
    mealRows.push(new TableRow({ children: [
      cell(''), cell('Daily total', { bold: true }), cell(`${data.mealPlan.totalCal} cal`, { bold: true }), cell(`${data.mealPlan.totalProt} g`, { bold: true })
    ] }));
    const mealTable = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: mealRows });

    const workoutRows = [new TableRow({ children: ['Day', 'Exercise', 'Sets', 'Reps'].map(h => cell(h, { bold: true })) })];
    data.workoutPlan.forEach(day => {
      day.exercises.forEach((ex, i) => {
        workoutRows.push(new TableRow({ children: [
          cell(i === 0 ? `Day ${day.day} - ${day.focus}` : ''), cell(ex.name), cell(`${ex.sets}`), cell(`${ex.reps}`)
        ] }));
      });
    });
    const workoutTable = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: workoutRows });

    const children = [
      new Paragraph({ text: 'BodyMath Fitness — Personalized Plan', heading: HeadingLevel.TITLE }),
      new Paragraph({ text: `Prepared for ${data.accountId}  ·  Generated ${data.generatedAt.toLocaleDateString()}`, spacing: { after: 300 } }),
      new Paragraph({ text: 'Daily Targets', heading: HeadingLevel.HEADING_1 }),
      summaryTable,
      new Paragraph({ text: '', spacing: { after: 200 } })
    ];

    if (data.coachNotes) {
      children.push(new Paragraph({ text: "Coach's Notes", heading: HeadingLevel.HEADING_1 }));
      children.push(new Paragraph({ text: stripEmoji(data.coachNotes), spacing: { after: 300 } }));
    }

    children.push(new Paragraph({ text: 'Meal Plan', heading: HeadingLevel.HEADING_1 }));
    children.push(mealTable);
    if (data.dietNotes.length) {
      children.push(new Paragraph({ text: '', spacing: { after: 100 } }));
      data.dietNotes.forEach(n => children.push(new Paragraph({ text: `• ${stripEmoji(n)}` })));
    }
    children.push(new Paragraph({ text: '', spacing: { after: 300 } }));

    children.push(new Paragraph({ text: stripEmoji(data.workoutHeading) || 'Workout Plan', heading: HeadingLevel.HEADING_1 }));
    children.push(workoutTable);

    try {
      const doc = new Document({ sections: [{ properties: {}, children }] });
      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `health-pilot-plan-${new Date().toISOString().slice(0, 10)}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Could not build Word document:', e);
      showValidationError('⚠️ Could not generate the Word document. Please try again.');
    }
  }

  async function handleClearSaved() {
    if (currentUser) {
      await Promise.all([
        deleteJsonData(STORAGE_KEY_PLAN),
        deleteJsonData(STORAGE_KEY_PROGRESS),
        deleteJsonData(STORAGE_KEY_WORKOUT)
      ]);
    }

    // reset form — clearing data isn't the same as logging out, so the
    // session (currentUser/authToken) is left untouched here.
    $('userForm').reset();
    conditionCheckboxes().forEach(cb => { cb.checked = false; });
    clearFieldErrors();
    messageBox.innerHTML = '';

    // reset summary
    calTargetEl.textContent = '— kcal';
    calDetailEl.textContent = '—';
    proteinTargetEl.textContent = '— g';
    if (fatTargetEl) fatTargetEl.textContent = '— g';
    if (carbsTargetEl) carbsTargetEl.textContent = '— g';
    budgetTierEl.textContent = '—';
    estCostEl.textContent = 'Est. daily cost: — PKR';
    if (waterTargetEl) waterTargetEl.textContent = '— L';
    if (coachNotesCard) coachNotesCard.classList.add('hidden');

    // reset results
    if (dietNotesEl) dietNotesEl.innerHTML = '';
    if (workoutNotesEl) workoutNotesEl.innerHTML = '';
    mealsContainer.innerHTML = '';
    workoutContainer.innerHTML = '';
    workoutTitleEl.textContent = 'Workout Plan';
    $('weeklyProgression').innerHTML = '';
    dailyTotalsEl.textContent = '— kcal · — g protein · — PKR/day';
    calBar.style.width = '0%';
    protBar.style.width = '0%';

    // Re-hide result sections
    ['summaryCard', 'mealPlanCard', 'workoutCard'].forEach(id => {
      const el = $(id);
      if (el) el.classList.add('hidden');
    });
    const weeklyProg = $('weeklyProgression');
    if (weeklyProg) { weeklyProg.innerHTML = ''; weeklyProg.classList.add('hidden'); }
    const ab = $('actionButtons');
    if (ab) ab.style.display = 'none';
    const emptyState = $('emptyState');
    if (emptyState) emptyState.style.display = '';

    // reset editable workout state
    currentWorkoutPlan = null;

    // reset progress tracker
    renderProgressList([]);
  }

  // ============================================================
  // Auth screen tab switching (Login <-> Register)
  // ============================================================
  function showRegisterTab() {
    if (loginFormEl) loginFormEl.style.display = 'none';
    if (registerFormEl) registerFormEl.style.display = '';
    if (loginErrorEl) loginErrorEl.textContent = '';
    if (registerErrorEl) registerErrorEl.textContent = '';
  }
  function showLoginTab() {
    if (registerFormEl) registerFormEl.style.display = 'none';
    if (loginFormEl) loginFormEl.style.display = '';
    if (loginErrorEl) loginErrorEl.textContent = '';
    if (registerErrorEl) registerErrorEl.textContent = '';
  }

  generateBtn.addEventListener("click", generateAll);
  regenBtn.addEventListener("click", generateAll);
  exportPdfBtn.addEventListener("click", handleExportPdf);
  exportDocxBtn.addEventListener("click", handleExportDocx);
  clearSavedBtn.addEventListener("click", handleClearSaved);
  saveProgressBtn.addEventListener("click", handleSaveProgress);
  workoutContainer.addEventListener("click", handleWorkoutEditClick);
  experienceEl.addEventListener("change", () => applyExperienceSplitConstraints(false));

  if (loginFormEl) loginFormEl.addEventListener("submit", loginUser);
  if (registerFormEl) registerFormEl.addEventListener("submit", registerUser);
  if (showRegisterLinkEl) showRegisterLinkEl.addEventListener("click", e => { e.preventDefault(); showRegisterTab(); });
  if (showLoginLinkEl) showLoginLinkEl.addEventListener("click", e => { e.preventDefault(); showLoginTab(); });
  if (logoutBtnEl) logoutBtnEl.addEventListener("click", logoutUser);
  if (guestBtnEl) guestBtnEl.addEventListener("click", continueAsGuest);
  if (topRegisterBtnEl) topRegisterBtnEl.addEventListener("click", () => { logoutUser(); showRegisterTab(); });

  document.addEventListener("DOMContentLoaded", initAuth);
  if (document.readyState !== 'loading') initAuth();
  applyExperienceSplitConstraints(true);
})();
