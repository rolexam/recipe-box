# LOGIC.md — Business Logic Contract (`logic.js`)

This is the contract for the **pure** business-logic layer. The API layer
(Subagent 3) must read this to integrate correctly.

## Design principles

- **Pure functions.** No database access, no I/O, no imports from `db.js`.
  Functions operate only on plain JS objects passed in.
- **Immutable.** Inputs are never mutated; every function returns NEW objects.
- **Validated.** Inputs are validated at the boundary; clear `Error`s are
  thrown on invalid data.

## Data shapes (agreed contract)

```js
// recipe
{ id, title, servings, instructions, ingredients: [ ingredient ] }

// ingredient
{ id, recipe_id, name, quantity, unit }
// quantity: number | null | undefined   (null/undefined = "no amount", e.g. "to taste")
// name, unit: string
```

## Module exports

```js
const { scaleServings, buildShoppingList } = require('./logic.js');
```

CommonJS, named exports (per AGENTS.md style).

---

## `scaleServings(recipe, targetServings)`

Returns a **new** recipe object scaled from `recipe.servings` to
`targetServings`.

### Signature
- `recipe` — recipe object (see shape above).
- `targetServings` — `number`, strictly positive.
- **Returns** a new recipe: `{ ...recipe, servings: targetServings, ingredients: [...scaled] }`.

### Behavior
- `factor = targetServings / recipe.servings`.
- Each `ingredient.quantity` is multiplied by `factor`.
- **Rounding:** result rounded to **3 decimal places** (`SCALE_DECIMALS = 3`).
  Chosen to support fractional amounts (e.g. `0.333`) without floating-point
  noise. Float artifacts are removed via `Number.EPSILON`-corrected rounding.
- **Null handling:** ingredients with `null`/`undefined` quantity keep their
  quantity unchanged (NOT turned into `NaN`).
- All other ingredient fields (`id`, `recipe_id`, `name`, `unit`) are copied
  through unchanged.
- If `recipe.ingredients` is missing/not an array, it is treated as `[]`.

### Validation (throws `Error`)
- `recipe` must be a non-array object.
- `recipe.servings` must be a positive finite number.
- `targetServings` must be a positive finite number.
- A non-null `ingredient.quantity` that is not a finite number throws.

### Example
```js
const recipe = {
  id: 1, title: 'Soup', servings: 4, instructions: '...',
  ingredients: [
    { id: 1, recipe_id: 1, name: 'Flour', quantity: 200, unit: 'g' },
    { id: 2, recipe_id: 1, name: 'Salt',  quantity: null, unit: 'pinch' },
  ],
};

scaleServings(recipe, 6);
// => {
//   id: 1, title: 'Soup', servings: 6, instructions: '...',
//   ingredients: [
//     { id: 1, recipe_id: 1, name: 'Flour', quantity: 300, unit: 'g' },
//     { id: 2, recipe_id: 1, name: 'Salt',  quantity: null, unit: 'pinch' },
//   ],
// }
// `recipe` itself is unchanged.
```

---

## `buildShoppingList(recipes)`

Aggregates ingredients across multiple recipes into one combined shopping list.

### IMPORTANT — input is an ARRAY of recipe OBJECTS, not ids

The original task phrased this as `buildShoppingList(recipeIds)`. Because this
module is pure (no DB), it instead takes **`recipes`: an array of recipe
objects**.

> **API layer (Subagent 3) must resolve ids → recipe objects first**
> (fetch each recipe with its ingredients from the DB), then pass the array of
> objects into `buildShoppingList`.

### Signature
- `recipes` — `Array<recipe>`.
- **Returns** `Array<{ name: string, unit: string, quantity: number }>`.

### Behavior
- Ingredients are merged by the **(name + unit)** pair, **summing** quantities.
- Same `name` but different `unit` are kept as **separate** line items
  (e.g. `Flour / g` and `Flour / cup` stay distinct).
- **Null handling:** `null`/`undefined` quantities are treated as **0**. The
  line item still appears (it is not dropped), so an ingredient like
  `Salt / pinch` with no amount shows up with `quantity: 0`.
- Summed quantities are rounded to **3 decimals** (`SCALE_DECIMALS = 3`).
- `name`/`unit` of `null`/`undefined` are normalized to `''`.
- Output is **sorted by `name`, then by `unit`** (deterministic).

### Validation (throws `Error`)
- `recipes` must be an array.
- Each element must be an object; each ingredient must be an object.
- A non-null `ingredient.quantity` that is not a finite number throws.

### Example
```js
const r1 = { id:1, title:'Soup',  servings:4, instructions:'',
  ingredients:[{ id:1, recipe_id:1, name:'Flour', quantity:100, unit:'g' }] };
const r2 = { id:2, title:'Bread', servings:2, instructions:'',
  ingredients:[
    { id:2, recipe_id:2, name:'Flour', quantity:200, unit:'g' },
    { id:3, recipe_id:2, name:'Flour', quantity:1,   unit:'cup' },
    { id:4, recipe_id:2, name:'Salt',  quantity:null, unit:'pinch' },
  ] };

buildShoppingList([r1, r2]);
// => [
//   { name: 'Flour', unit: 'cup',   quantity: 1   },
//   { name: 'Flour', unit: 'g',     quantity: 300 },  // 100 + 200 merged
//   { name: 'Salt',  unit: 'pinch', quantity: 0   },  // null -> 0
// ]
```

### Typical API usage
```js
// In the API/route layer (NOT in logic.js):
const recipes = recipeIds.map((id) => db.getRecipeWithIngredients(id));
const shoppingList = buildShoppingList(recipes);
```
