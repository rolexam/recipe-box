/**
 * server.js — Express API layer for the Recipe Box app (Subagent 3).
 *
 * Built strictly against the contracts in DATA.md (db.js) and LOGIC.md (logic.js).
 *
 * Key integration facts honored here:
 *  - db.js exports `createDb(filename)` -> store with synchronous CRUD methods.
 *    Validation failures THROW Error (-> 400). Not-found returns null /
 *    deleteRecipe returns false (-> 404).
 *  - logic.js exports `scaleServings(recipe, targetServings)` and
 *    `buildShoppingList(recipes)` where `recipes` is an ARRAY OF RECIPE OBJECTS.
 *    So the shopping-list route resolves each id -> recipe object via the store
 *    before calling buildShoppingList.
 *
 * The app is exposed as a factory `createApp(store)` so tests can inject an
 * in-memory store. `app.listen` is only called when this file is run directly.
 */

'use strict';

const path = require('path');
const express = require('express');
const { createDb } = require('./db.js');
const {
  scaleServings,
  buildShoppingList,
  searchByIngredient,
  formatShoppingListCsv,
} = require('./logic.js');

const DEFAULT_PORT = 3000;

// Directory holding the frontend's static assets (served by Express).
// Anchored to __dirname so serving is independent of the process cwd.
const PUBLIC_DIR = path.join(__dirname, 'public');

/**
 * Wrap a route handler so any thrown error (sync) is forwarded to the
 * centralized error middleware via next(). Keeps individual handlers clean.
 */
function wrap(handler) {
  return (req, res, next) => {
    try {
      handler(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}

/** Parse and validate a route :id param. Returns a positive integer or null. */
function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return id;
}

/** Parse and validate a positive finite number (e.g. servings). Returns number or null. */
function parsePositiveNumber(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return n;
}

/**
 * Build a configured Express app around an injected store.
 * Does NOT call app.listen — that is the caller's responsibility.
 *
 * @param {object} store - a db.js store (createDb(...) result).
 * @returns {import('express').Express}
 */
function createApp(store) {
  if (!store || typeof store !== 'object') {
    throw new Error('createApp requires a store object');
  }

  const app = express();
  app.use(express.json());

  // CREATE — POST /recipes
  app.post(
    '/recipes',
    wrap((req, res) => {
      // db.createRecipe validates the body and throws on bad input (-> 400).
      const recipe = store.createRecipe(req.body);
      res.status(201).json(recipe);
    }),
  );

  // LIST — GET /recipes
  app.get(
    '/recipes',
    wrap((req, res) => {
      res.status(200).json(store.listRecipes());
    }),
  );

  // SEARCH — GET /search?ingredient=...
  // Validates the ingredient query param at the boundary (missing / empty /
  // whitespace-only -> 400). Returns a JSON array of ONLY { id, title } objects
  // for recipes that contain a matching ingredient (case-insensitive substring).
  app.get(
    '/search',
    wrap((req, res) => {
      const { ingredient } = req.query;

      if (typeof ingredient !== 'string' || ingredient.trim().length === 0) {
        return res
          .status(400)
          .json({ error: 'Query param "ingredient" is required and must be a non-empty string' });
      }

      const recipes = store.listRecipes();
      const matches = searchByIngredient(recipes, ingredient);
      res.status(200).json(matches);
    }),
  );

  // SCALE — GET /recipes/:id/scale?servings=N
  // Registered before GET /recipes/:id is irrelevant (distinct path), but kept
  // grouped with the read routes. Validates id and servings at the boundary.
  app.get(
    '/recipes/:id/scale',
    wrap((req, res) => {
      const id = parseId(req.params.id);
      if (id === null) {
        return res.status(400).json({ error: 'Invalid recipe id: must be a positive integer' });
      }

      const targetServings = parsePositiveNumber(req.query.servings);
      if (targetServings === null) {
        return res
          .status(400)
          .json({ error: 'Query param "servings" is required and must be a positive number' });
      }

      const recipe = store.getRecipe(id);
      if (recipe === null) {
        return res.status(404).json({ error: `Recipe ${id} not found` });
      }

      // scaleServings is pure and immutable; throws on bad data (-> 400).
      const scaled = scaleServings(recipe, targetServings);
      res.status(200).json(scaled);
    }),
  );

  // GET ONE — GET /recipes/:id
  app.get(
    '/recipes/:id',
    wrap((req, res) => {
      const id = parseId(req.params.id);
      if (id === null) {
        return res.status(400).json({ error: 'Invalid recipe id: must be a positive integer' });
      }

      const recipe = store.getRecipe(id);
      if (recipe === null) {
        return res.status(404).json({ error: `Recipe ${id} not found` });
      }
      res.status(200).json(recipe);
    }),
  );

  // UPDATE — PUT /recipes/:id
  app.put(
    '/recipes/:id',
    wrap((req, res) => {
      const id = parseId(req.params.id);
      if (id === null) {
        return res.status(400).json({ error: 'Invalid recipe id: must be a positive integer' });
      }

      // updateRecipe validates the body (throws -> 400) and returns null if missing.
      const updated = store.updateRecipe(id, req.body);
      if (updated === null) {
        return res.status(404).json({ error: `Recipe ${id} not found` });
      }
      res.status(200).json(updated);
    }),
  );

  // DELETE — DELETE /recipes/:id
  app.delete(
    '/recipes/:id',
    wrap((req, res) => {
      const id = parseId(req.params.id);
      if (id === null) {
        return res.status(400).json({ error: 'Invalid recipe id: must be a positive integer' });
      }

      const deleted = store.deleteRecipe(id);
      if (!deleted) {
        return res.status(404).json({ error: `Recipe ${id} not found` });
      }
      res.status(204).end();
    }),
  );

  // Resolve a request body's `recipeIds` field to recipe objects from the store.
  // Returns either { recipes } on success or { error, status } describing why
  // resolution failed (so the caller can issue a single typed response).
  function resolveRecipeIds(body) {
    const { recipeIds } = body || {};

    if (!Array.isArray(recipeIds) || recipeIds.length === 0) {
      return { error: 'Body must include a non-empty "recipeIds" array', status: 400 };
    }

    const ids = [];
    for (const raw of recipeIds) {
      const id = parseId(raw);
      if (id === null) {
        return {
          error: `Invalid recipe id in "recipeIds": ${JSON.stringify(raw)} (must be a positive integer)`,
          status: 400,
        };
      }
      ids.push(id);
    }

    const recipes = [];
    const missing = [];
    for (const id of ids) {
      const recipe = store.getRecipe(id);
      if (recipe === null) {
        missing.push(id);
      } else {
        recipes.push(recipe);
      }
    }

    if (missing.length > 0) {
      return { error: `Recipe(s) not found: ${missing.join(', ')}`, status: 404 };
    }

    return { recipes };
  }

  // SHOPPING LIST — POST /shopping-list  body: { recipeIds: [...] }
  // Decision: a recipeId that does not resolve to a recipe yields 404 with a
  // clear message naming the missing id(s). Malformed input (not an array,
  // empty, or a non-positive-integer id) yields 400.
  app.post(
    '/shopping-list',
    wrap((req, res) => {
      const resolved = resolveRecipeIds(req.body);
      if (resolved.error) {
        return res.status(resolved.status).json({ error: resolved.error });
      }
      const shoppingList = buildShoppingList(resolved.recipes);
      res.status(200).json(shoppingList);
    }),
  );

  // SHOPPING LIST EXPORT — POST /shopping-list/export  body: { recipeIds: [...] }
  // Same validation as /shopping-list, but returns a downloadable CSV file
  // (Content-Type: text/csv) with the consolidated ingredients.
  app.post(
    '/shopping-list/export',
    wrap((req, res) => {
      const resolved = resolveRecipeIds(req.body);
      if (resolved.error) {
        return res.status(resolved.status).json({ error: resolved.error });
      }
      const shoppingList = buildShoppingList(resolved.recipes);
      const csv = formatShoppingListCsv(shoppingList);

      res.status(200);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="shopping-list.csv"');
      res.send(csv);
    }),
  );

  // Serve the frontend's static assets from public/. Placed AFTER the API
  // routes (so it never shadows them) and BEFORE the catch-all 404 (so missing
  // static files still fall through to the consistent { error } response).
  app.use(express.static(PUBLIC_DIR));

  // 404 for unmatched routes (consistent { error } envelope).
  app.use((req, res) => {
    res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
  });

  // Centralized error handler. Validation Errors thrown by db.js/logic.js map
  // to 400. Never leaks stack traces to the client.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const message = err && err.message ? err.message : 'Internal server error';
    // Treat thrown Errors as client validation failures (per the contracts).
    res.status(400).json({ error: message });
  });

  return app;
}

// Start a real server only when run directly.
if (require.main === module) {
  const store = createDb();
  const app = createApp(store);
  const port = process.env.PORT || DEFAULT_PORT;
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Recipe Box API listening on port ${port}`);
  });
}

module.exports = { createApp };
