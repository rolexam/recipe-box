const request = require('supertest');
const { createApp } = require('./server.js');
const { createDb } = require('./db.js');

// Fresh in-memory DB + app per test → full isolation.
function makeApp() {
  return createApp(createDb(':memory:'));
}

const PANCAKES = {
  title: 'Pancakes',
  servings: 4,
  instructions: 'Mix and fry.',
  ingredients: [
    { name: 'Flour', quantity: 200, unit: 'g' },
    { name: 'Milk', quantity: 300, unit: 'ml' },
    { name: 'Egg', quantity: 2, unit: 'pcs' },
  ],
};

const OMELETTE = {
  title: 'Omelette',
  servings: 2,
  instructions: 'Whisk and cook.',
  ingredients: [
    { name: 'Egg', quantity: 4, unit: 'pcs' },
    { name: 'Milk', quantity: 50, unit: 'ml' },
  ],
};

describe('Recipe CRUD', () => {
  test('POST /recipes creates a recipe with nested ingredients', async () => {
    const app = makeApp();
    const res = await request(app).post('/recipes').send(PANCAKES);
    expect(res.status).toBe(201);
    expect(res.body.id).toBeGreaterThan(0);
    expect(res.body.title).toBe('Pancakes');
    expect(res.body.ingredients).toHaveLength(3);
    expect(res.body.ingredients[0]).toHaveProperty('id');
    expect(res.body.ingredients[0]).toHaveProperty('recipe_id', res.body.id);
  });

  test('POST /recipes rejects invalid body with 400', async () => {
    const app = makeApp();
    const res = await request(app).post('/recipes').send({ servings: 2 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('GET /recipes lists all recipes', async () => {
    const app = makeApp();
    await request(app).post('/recipes').send(PANCAKES);
    await request(app).post('/recipes').send(OMELETTE);
    const res = await request(app).get('/recipes');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  test('GET /recipes/:id returns one recipe', async () => {
    const app = makeApp();
    const created = await request(app).post('/recipes').send(PANCAKES);
    const res = await request(app).get(`/recipes/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Pancakes');
  });

  test('GET /recipes/:id returns 404 when missing', async () => {
    const app = makeApp();
    const res = await request(app).get('/recipes/9999');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  test('PUT /recipes/:id updates a recipe', async () => {
    const app = makeApp();
    const created = await request(app).post('/recipes').send(PANCAKES);
    const res = await request(app)
      .put(`/recipes/${created.body.id}`)
      .send({ ...PANCAKES, title: 'Fluffy Pancakes', servings: 6 });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Fluffy Pancakes');
    expect(res.body.servings).toBe(6);
  });

  test('PUT /recipes/:id returns 404 when missing', async () => {
    const app = makeApp();
    const res = await request(app).put('/recipes/9999').send(PANCAKES);
    expect(res.status).toBe(404);
  });

  test('DELETE /recipes/:id removes a recipe (204) then 404', async () => {
    const app = makeApp();
    const created = await request(app).post('/recipes').send(PANCAKES);
    const del = await request(app).delete(`/recipes/${created.body.id}`);
    expect(del.status).toBe(204);
    const after = await request(app).get(`/recipes/${created.body.id}`);
    expect(after.status).toBe(404);
  });

  test('DELETE /recipes/:id returns 404 when missing', async () => {
    const app = makeApp();
    const res = await request(app).delete('/recipes/9999');
    expect(res.status).toBe(404);
  });
});

describe('GET /recipes/:id/scale', () => {
  test('scales ingredient quantities to target servings', async () => {
    const app = makeApp();
    const created = await request(app).post('/recipes').send(PANCAKES);
    const res = await request(app).get(`/recipes/${created.body.id}/scale?servings=8`);
    expect(res.status).toBe(200);
    expect(res.body.servings).toBe(8);
    // 4 -> 8 servings = factor 2
    const flour = res.body.ingredients.find((i) => i.name === 'Flour');
    expect(flour.quantity).toBe(400);
    const milk = res.body.ingredients.find((i) => i.name === 'Milk');
    expect(milk.quantity).toBe(600);
  });

  test('returns 400 when servings query is missing or invalid', async () => {
    const app = makeApp();
    const created = await request(app).post('/recipes').send(PANCAKES);
    const missing = await request(app).get(`/recipes/${created.body.id}/scale`);
    expect(missing.status).toBe(400);
    const bad = await request(app).get(`/recipes/${created.body.id}/scale?servings=-3`);
    expect(bad.status).toBe(400);
  });

  test('returns 404 when recipe does not exist', async () => {
    const app = makeApp();
    const res = await request(app).get('/recipes/9999/scale?servings=4');
    expect(res.status).toBe(404);
  });
});

describe('POST /shopping-list', () => {
  test('aggregates ingredients across recipes, merging by name+unit', async () => {
    const app = makeApp();
    const p = await request(app).post('/recipes').send(PANCAKES);
    const o = await request(app).post('/recipes').send(OMELETTE);
    const res = await request(app)
      .post('/shopping-list')
      .send({ recipeIds: [p.body.id, o.body.id] });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const egg = res.body.find((i) => i.name === 'Egg' && i.unit === 'pcs');
    expect(egg.quantity).toBe(6); // 2 + 4
    const milk = res.body.find((i) => i.name === 'Milk' && i.unit === 'ml');
    expect(milk.quantity).toBe(350); // 300 + 50
    const flour = res.body.find((i) => i.name === 'Flour');
    expect(flour.quantity).toBe(200);
  });

  test('returns 400 for empty or invalid recipeIds', async () => {
    const app = makeApp();
    const res = await request(app).post('/shopping-list').send({ recipeIds: [] });
    expect(res.status).toBe(400);
  });

  test('returns 400 or 404 when a recipe id does not resolve', async () => {
    const app = makeApp();
    const res = await request(app).post('/shopping-list').send({ recipeIds: [9999] });
    expect([400, 404]).toContain(res.status);
    expect(res.body).toHaveProperty('error');
  });
});
