# DATA.md — Data Layer Contract (`db.js`)

The data layer is implemented in `db.js` using **better-sqlite3** (synchronous, no
async/await). It is a CommonJS module with a single named export: a factory
function `createDb`.

## Module export

```js
const { createDb } = require('./db.js'); // named export, CommonJS
```

`createDb` is the **only** export. Everything else is reached through the object
it returns.

## `createDb(filename)` — primary entry point

```
createDb(filename = 'recipes.db') -> store
```

- `filename` (string, optional): the SQLite file path. Defaults to `'recipes.db'`.
- Pass `':memory:'` to get an isolated in-memory database (use this in tests so
  each test/suite starts clean).
- Opens the connection, enables `PRAGMA foreign_keys = ON`, and creates the
  `recipes` and `ingredients` tables if they do not exist (idempotent).

Returns a **store object** with these properties:

```
store = {
  db,                                  // raw better-sqlite3 Database instance (escape hatch)
  createRecipe(input)        -> recipe,
  getRecipe(id)             -> recipe | null,
  listRecipes()             -> recipe[],
  updateRecipe(id, input)   -> recipe | null,
  deleteRecipe(id)          -> boolean,
  close()                   -> void      // closes the underlying connection
}
```

All CRUD functions are **synchronous** (they return values directly, not Promises).

## Object shapes

### Recipe (returned by the read/write functions)

```js
{
  id: number,                  // generated, integer
  title: string,
  servings: number,            // positive integer
  instructions: string | null, // null when omitted
  ingredients: Ingredient[]    // always present; [] when none
}
```

### Ingredient (always nested inside a recipe's `ingredients` array)

```js
{
  id: number,        // generated, integer
  recipe_id: number, // FK to recipes.id
  name: string,
  quantity: number | null, // null when omitted
  unit: string | null      // null when omitted
}
```

## Function reference

### `createRecipe(input) -> recipe`

- `input`: `{ title, servings, instructions?, ingredients? }`
  - `title` (string, **required**, non-empty after trimming)
  - `servings` (number, **required**, positive integer)
  - `instructions` (string, optional → stored as `null` if omitted)
  - `ingredients` (array, optional → stored as `[]` if omitted). Each item:
    `{ name (string, required, non-empty), quantity? (number), unit? (string) }`
- Returns the full recipe object including the generated `id` and a fully
  populated `ingredients` array (each ingredient with its own `id` and `recipe_id`).
- **Throws** `Error` on invalid input (map to HTTP 400 in the API layer).
- Does **not** mutate `input`. Runs inside a transaction (recipe + ingredients
  are inserted atomically).

### `getRecipe(id) -> recipe | null`

- `id`: positive integer (numeric strings like `'1'` are accepted and coerced).
- Returns the recipe with nested `ingredients`, or `null` if not found.
- **Throws** `Error` only when `id` is not a positive integer (invalid input);
  a valid-but-missing id returns `null`, it does not throw.

### `listRecipes() -> recipe[]`

- Returns an array of all recipes (each with nested `ingredients`), ordered by `id`.
- Returns `[]` when there are no recipes.

### `updateRecipe(id, input) -> recipe | null`

- `id`: positive integer.
- `input`: same shape and validation rules as `createRecipe`.
- Replaces the recipe's fields **and the entire ingredient set** (old
  ingredients are deleted, new ones inserted). Runs in a transaction.
- Returns the updated recipe object, or `null` if no recipe with that `id` exists.
- **Throws** `Error` on invalid `id` or invalid `input`.

### `deleteRecipe(id) -> boolean`

- `id`: positive integer.
- Returns `true` if a row was deleted, `false` if nothing matched.
- Cascades: the recipe's ingredients are removed automatically
  (`ON DELETE CASCADE` + foreign keys enabled).
- **Throws** `Error` on invalid `id`.

## Error handling contract for the API layer

- Validation failures (bad/missing `title`, non-positive `servings`, malformed
  `ingredients`, invalid `id`) throw `Error` with a human-readable `.message`.
  Catch these and respond **400**.
- "Not found" is **not** an error: `getRecipe`/`updateRecipe` return `null` and
  `deleteRecipe` returns `false`. Map those to **404** as appropriate.

## In-memory DB for tests

```js
const { createDb } = require('../db.js');
const store = createDb(':memory:'); // fresh, isolated DB per call
```

Create a new store per test (or in `beforeEach`) for isolation, and call
`store.close()` in teardown if desired.

## 2-line usage example

```js
const store = require('./db.js').createDb(':memory:');
const recipe = store.createRecipe({ title: 'Pancakes', servings: 4, ingredients: [{ name: 'Flour', quantity: 200, unit: 'g' }] });
```
