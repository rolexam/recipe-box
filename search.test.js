'use strict';

/**
 * search.test.js — Integration tests for GET /search?ingredient=
 *
 * Verifies the full stack: HTTP boundary validation in server.js
 * plus the searchByIngredient logic in logic.js.
 *
 * Each test gets its own isolated in-memory DB via makeApp(), so there is
 * no shared state between tests.
 */

const request = require('supertest');
const { createApp } = require('./server.js');
const { createDb } = require('./db.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fresh in-memory DB + app per test → full isolation. */
function makeApp() {
  return createApp(createDb(':memory:'));
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PASTA = {
  title: 'Pasta Carbonara',
  servings: 2,
  instructions: 'Cook pasta, mix with egg and cheese.',
  ingredients: [
    { name: 'Pasta', quantity: 200, unit: 'g' },
    { name: 'Egg', quantity: 3, unit: 'pcs' },
    { name: 'Parmesan', quantity: 50, unit: 'g' },
  ],
};

const OMELETTE = {
  title: 'French Omelette',
  servings: 1,
  instructions: 'Whisk eggs and cook.',
  ingredients: [
    { name: 'Egg', quantity: 3, unit: 'pcs' },
    { name: 'Butter', quantity: 10, unit: 'g' },
  ],
};

const SALAD = {
  title: 'Garden Salad',
  servings: 2,
  instructions: 'Toss vegetables.',
  ingredients: [
    { name: 'Lettuce', quantity: 100, unit: 'g' },
    { name: 'Tomato', quantity: 2, unit: 'pcs' },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /search?ingredient=', () => {
  // -------------------------------------------------------------------------
  // Response shape
  // -------------------------------------------------------------------------

  test('returns matching recipe as array of objects with ONLY id and title fields', async () => {
    const app = makeApp();
    await request(app).post('/recipes').send(PASTA);
    await request(app).post('/recipes').send(SALAD);

    const res = await request(app).get('/search?ingredient=Lettuce');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);

    const recipe = res.body[0];
    // Must contain id and title
    expect(recipe).toHaveProperty('id');
    expect(recipe).toHaveProperty('title', 'Garden Salad');
    // Must NOT contain any other recipe fields
    expect(recipe).not.toHaveProperty('servings');
    expect(recipe).not.toHaveProperty('instructions');
    expect(recipe).not.toHaveProperty('ingredients');
  });

  test('response objects contain exactly two keys: id and title', async () => {
    const app = makeApp();
    await request(app).post('/recipes').send(PASTA);

    const res = await request(app).get('/search?ingredient=Egg');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);

    const keys = Object.keys(res.body[0]).sort();
    expect(keys).toEqual(['id', 'title']);
  });

  // -------------------------------------------------------------------------
  // Matching behaviour — case-insensitive
  // -------------------------------------------------------------------------

  test('matches ingredient name with exact same case', async () => {
    const app = makeApp();
    await request(app).post('/recipes').send(PASTA);

    const res = await request(app).get('/search?ingredient=Egg');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('Pasta Carbonara');
  });

  test('matches ingredient name with all-lowercase query', async () => {
    const app = makeApp();
    await request(app).post('/recipes').send(PASTA);

    const res = await request(app).get('/search?ingredient=egg');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('Pasta Carbonara');
  });

  test('matches ingredient name with all-uppercase query', async () => {
    const app = makeApp();
    await request(app).post('/recipes').send(PASTA);

    const res = await request(app).get('/search?ingredient=EGG');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('Pasta Carbonara');
  });

  test('matches ingredient name with mixed-case query', async () => {
    const app = makeApp();
    await request(app).post('/recipes').send(PASTA);

    const res = await request(app).get('/search?ingredient=eGg');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('Pasta Carbonara');
  });

  // -------------------------------------------------------------------------
  // Matching behaviour — substring
  // -------------------------------------------------------------------------

  test('matches ingredient name when query is a partial substring', async () => {
    const app = makeApp();
    await request(app).post('/recipes').send(PASTA);

    // 'parm' is a substring of 'Parmesan'
    const res = await request(app).get('/search?ingredient=parm');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('Pasta Carbonara');
  });

  test('matches ingredient name with a two-character substring (case-insensitive)', async () => {
    const app = makeApp();
    await request(app).post('/recipes').send(OMELETTE);

    // 'gg' is a substring of 'Egg'
    const res = await request(app).get('/search?ingredient=gg');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('French Omelette');
  });

  // -------------------------------------------------------------------------
  // Multiple matches
  // -------------------------------------------------------------------------

  test('returns all recipes that share the searched ingredient', async () => {
    const app = makeApp();
    const pastaRes = await request(app).post('/recipes').send(PASTA);
    const omelRes = await request(app).post('/recipes').send(OMELETTE);
    await request(app).post('/recipes').send(SALAD); // no Egg → must not appear

    const res = await request(app).get('/search?ingredient=Egg');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);

    const ids = res.body.map((r) => r.id);
    expect(ids).toContain(pastaRes.body.id);
    expect(ids).toContain(omelRes.body.id);

    const titles = res.body.map((r) => r.title);
    expect(titles).not.toContain('Garden Salad');
  });

  // -------------------------------------------------------------------------
  // No matches
  // -------------------------------------------------------------------------

  test('returns 200 with empty array when no recipe contains the ingredient', async () => {
    const app = makeApp();
    await request(app).post('/recipes').send(PASTA);
    await request(app).post('/recipes').send(SALAD);

    const res = await request(app).get('/search?ingredient=Truffle');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('returns 200 with empty array when the database has no recipes', async () => {
    const app = makeApp(); // empty store

    const res = await request(app).get('/search?ingredient=Egg');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Input validation — 400 cases
  // -------------------------------------------------------------------------

  test('returns 400 with {error} when ingredient query param is absent', async () => {
    const app = makeApp();

    const res = await request(app).get('/search');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('returns 400 with {error} when ingredient is an empty string', async () => {
    const app = makeApp();

    const res = await request(app).get('/search?ingredient=');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 with {error} when ingredient is whitespace only', async () => {
    const app = makeApp();

    // Use supertest .query() to pass a value with spaces reliably
    const res = await request(app).get('/search').query({ ingredient: '   ' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  // -------------------------------------------------------------------------
  // Non-matching recipes are filtered out (not just truncated)
  // -------------------------------------------------------------------------

  test('does not include recipes that lack the queried ingredient', async () => {
    const app = makeApp();
    await request(app).post('/recipes').send(PASTA);    // has Butter? No.
    await request(app).post('/recipes').send(OMELETTE); // has Butter
    await request(app).post('/recipes').send(SALAD);    // no Butter

    const res = await request(app).get('/search?ingredient=Butter');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('French Omelette');
  });

  // -------------------------------------------------------------------------
  // id field type
  // -------------------------------------------------------------------------

  test('returned id is a positive integer matching the created recipe id', async () => {
    const app = makeApp();
    const created = await request(app).post('/recipes').send(SALAD);
    const createdId = created.body.id;

    const res = await request(app).get('/search?ingredient=Tomato');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(createdId);
    expect(Number.isInteger(res.body[0].id)).toBe(true);
    expect(res.body[0].id).toBeGreaterThan(0);
  });
});
