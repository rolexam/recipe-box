'use strict';

const Database = require('better-sqlite3');

/**
 * Data layer for the Recipe Box app.
 *
 * Uses better-sqlite3 (synchronous API). CommonJS, named exports.
 * The primary entry point is `createDb(filename)`, which opens/initializes a
 * database connection and returns an object containing all CRUD functions
 * bound to that connection. Pass ':memory:' for an isolated in-memory DB
 * (used by tests).
 */

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    servings INTEGER NOT NULL,
    instructions TEXT
  );

  CREATE TABLE IF NOT EXISTS ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    quantity REAL,
    unit TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_ingredients_recipe_id
    ON ingredients(recipe_id);
`;

// ---------------------------------------------------------------------------
// Validation helpers (throw on invalid input so the API layer maps to 400)
// ---------------------------------------------------------------------------

function validateRecipeInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Recipe payload must be an object');
  }

  const { title, servings } = input;

  if (typeof title !== 'string' || title.trim().length === 0) {
    throw new Error('Recipe "title" is required and must be a non-empty string');
  }

  if (!Number.isInteger(servings) || servings <= 0) {
    throw new Error('Recipe "servings" must be a positive integer');
  }

  if (
    input.instructions !== undefined &&
    input.instructions !== null &&
    typeof input.instructions !== 'string'
  ) {
    throw new Error('Recipe "instructions" must be a string when provided');
  }

  if (input.ingredients !== undefined && input.ingredients !== null) {
    if (!Array.isArray(input.ingredients)) {
      throw new Error('Recipe "ingredients" must be an array when provided');
    }
    input.ingredients.forEach(validateIngredientInput);
  }
}

function validateIngredientInput(ingredient, index) {
  const where = `ingredients[${index}]`;

  if (ingredient === null || typeof ingredient !== 'object' || Array.isArray(ingredient)) {
    throw new Error(`${where} must be an object`);
  }

  if (typeof ingredient.name !== 'string' || ingredient.name.trim().length === 0) {
    throw new Error(`${where} "name" is required and must be a non-empty string`);
  }

  if (
    ingredient.quantity !== undefined &&
    ingredient.quantity !== null &&
    (typeof ingredient.quantity !== 'number' || Number.isNaN(ingredient.quantity))
  ) {
    throw new Error(`${where} "quantity" must be a number when provided`);
  }

  if (
    ingredient.unit !== undefined &&
    ingredient.unit !== null &&
    typeof ingredient.unit !== 'string'
  ) {
    throw new Error(`${where} "unit" must be a string when provided`);
  }
}

function validateId(id) {
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new Error('Recipe "id" must be a positive integer');
  }
  return numeric;
}

// ---------------------------------------------------------------------------
// Normalization helpers (build new objects, never mutate caller input)
// ---------------------------------------------------------------------------

function normalizeIngredient(ingredient) {
  return {
    name: ingredient.name.trim(),
    quantity:
      ingredient.quantity === undefined || ingredient.quantity === null
        ? null
        : ingredient.quantity,
    unit:
      ingredient.unit === undefined || ingredient.unit === null
        ? null
        : ingredient.unit,
  };
}

function normalizeRecipe(input) {
  const ingredients = Array.isArray(input.ingredients)
    ? input.ingredients.map(normalizeIngredient)
    : [];

  return {
    title: input.title.trim(),
    servings: input.servings,
    instructions:
      input.instructions === undefined || input.instructions === null
        ? null
        : input.instructions,
    ingredients,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Open/init a database and return CRUD functions bound to that connection.
 *
 * @param {string} [filename='recipes.db'] file path, or ':memory:' for tests.
 * @returns {{
 *   db: import('better-sqlite3').Database,
 *   createRecipe: Function,
 *   getRecipe: Function,
 *   listRecipes: Function,
 *   updateRecipe: Function,
 *   deleteRecipe: Function,
 *   close: Function
 * }}
 */
function createDb(filename = 'recipes.db') {
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  // Prepared statements (reused for performance).
  const stmts = {
    insertRecipe: db.prepare(
      'INSERT INTO recipes (title, servings, instructions) VALUES (@title, @servings, @instructions)'
    ),
    insertIngredient: db.prepare(
      'INSERT INTO ingredients (recipe_id, name, quantity, unit) VALUES (@recipe_id, @name, @quantity, @unit)'
    ),
    selectRecipe: db.prepare('SELECT id, title, servings, instructions FROM recipes WHERE id = ?'),
    selectAllRecipes: db.prepare(
      'SELECT id, title, servings, instructions FROM recipes ORDER BY id'
    ),
    selectIngredients: db.prepare(
      'SELECT id, recipe_id, name, quantity, unit FROM ingredients WHERE recipe_id = ? ORDER BY id'
    ),
    updateRecipe: db.prepare(
      'UPDATE recipes SET title = @title, servings = @servings, instructions = @instructions WHERE id = @id'
    ),
    deleteIngredients: db.prepare('DELETE FROM ingredients WHERE recipe_id = ?'),
    deleteRecipe: db.prepare('DELETE FROM recipes WHERE id = ?'),
  };

  function readRecipe(id) {
    const recipe = stmts.selectRecipe.get(id);
    if (!recipe) {
      return null;
    }
    const ingredients = stmts.selectIngredients.all(id);
    return { ...recipe, ingredients };
  }

  function insertIngredients(recipeId, ingredients) {
    for (const ingredient of ingredients) {
      stmts.insertIngredient.run({ recipe_id: recipeId, ...ingredient });
    }
  }

  // -------------------------------------------------------------------------
  // CRUD operations
  // -------------------------------------------------------------------------

  const createRecipe = db.transaction((rawInput) => {
    validateRecipeInput(rawInput);
    const recipe = normalizeRecipe(rawInput);

    const info = stmts.insertRecipe.run({
      title: recipe.title,
      servings: recipe.servings,
      instructions: recipe.instructions,
    });
    const recipeId = Number(info.lastInsertRowid);

    insertIngredients(recipeId, recipe.ingredients);

    return readRecipe(recipeId);
  });

  function getRecipe(id) {
    const numericId = validateId(id);
    return readRecipe(numericId);
  }

  function listRecipes() {
    const recipes = stmts.selectAllRecipes.all();
    return recipes.map((recipe) => ({
      ...recipe,
      ingredients: stmts.selectIngredients.all(recipe.id),
    }));
  }

  const updateRecipe = db.transaction((id, rawInput) => {
    const numericId = validateId(id);
    validateRecipeInput(rawInput);

    const existing = stmts.selectRecipe.get(numericId);
    if (!existing) {
      return null;
    }

    const recipe = normalizeRecipe(rawInput);

    stmts.updateRecipe.run({
      id: numericId,
      title: recipe.title,
      servings: recipe.servings,
      instructions: recipe.instructions,
    });

    // Replace the ingredient set entirely.
    stmts.deleteIngredients.run(numericId);
    insertIngredients(numericId, recipe.ingredients);

    return readRecipe(numericId);
  });

  function deleteRecipe(id) {
    const numericId = validateId(id);
    const info = stmts.deleteRecipe.run(numericId);
    return info.changes > 0;
  }

  function close() {
    db.close();
  }

  return {
    db,
    createRecipe,
    getRecipe,
    listRecipes,
    updateRecipe,
    deleteRecipe,
    close,
  };
}

module.exports = { createDb };
