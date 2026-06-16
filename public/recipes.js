/**
 * recipes.js — UI wiring for creating, listing, deleting, and exporting recipes.
 *
 * Responsibilities:
 *  - Render and manage the "Add a recipe" form, including a dynamic list of
 *    ingredient rows (add / remove).
 *  - POST a new recipe and refresh the on-page list on success.
 *  - List all recipes with the ability to view details and delete.
 *  - Collect selected recipes and download a shopping-list CSV.
 *
 * Every state is surfaced to the user (loading, empty, success, error); nothing
 * is silently swallowed. Untrusted text is rendered via textContent (XSS-safe).
 */

import {
  listRecipes,
  createRecipe,
  deleteRecipe,
  exportShoppingListCsv,
  ApiError,
} from './api.js';

const MESSAGES = Object.freeze({
  loading: 'Loading recipes…',
  empty: 'No recipes yet. Add one above to get started.',
  loadError: 'Could not load recipes. Please try again.',
  saving: 'Saving recipe…',
  saved: (title) => `Saved “${title}”.`,
  titleRequired: 'Please enter a recipe title.',
  servingsInvalid: 'Servings must be a positive whole number.',
  ingredientNameRequired:
    'Every ingredient with a quantity or unit needs a name. Remove empty rows or add names.',
  deleting: 'Deleting recipe…',
  deleted: 'Recipe deleted.',
  deleteError: 'Could not delete the recipe. Please try again.',
  exportEmpty: 'Select at least one recipe to export.',
  exporting: 'Building shopping list…',
  exported: 'Shopping list downloaded.',
  exportError: 'Could not export the shopping list. Please try again.',
  unexpected: 'Something went wrong. Please try again.',
});

/** @returns {{ rows: HTMLElement }} */
function createIngredientRow() {
  const row = document.createElement('div');
  row.className = 'ingredient-row';

  const name = document.createElement('input');
  name.type = 'text';
  name.className = 'field__input ingredient-row__name';
  name.placeholder = 'Name (e.g. Flour)';
  name.setAttribute('aria-label', 'Ingredient name');

  const quantity = document.createElement('input');
  quantity.type = 'number';
  quantity.className = 'field__input ingredient-row__quantity';
  quantity.placeholder = 'Qty';
  quantity.step = 'any';
  quantity.min = '0';
  quantity.setAttribute('aria-label', 'Ingredient quantity');

  const unit = document.createElement('input');
  unit.type = 'text';
  unit.className = 'field__input ingredient-row__unit';
  unit.placeholder = 'Unit (e.g. g)';
  unit.setAttribute('aria-label', 'Ingredient unit');

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'button button--icon';
  remove.textContent = '×';
  remove.setAttribute('aria-label', 'Remove ingredient');
  remove.addEventListener('click', () => row.remove());

  row.append(name, quantity, unit, remove);
  return row;
}

/**
 * Read ingredient rows into the API shape, validating as we go.
 * Rows that are entirely empty are skipped. A row with a quantity or unit
 * but no name is a validation error.
 *
 * @param {HTMLElement} container
 * @returns {Array<{ name: string, quantity?: number, unit?: string }>}
 * @throws {Error} when a row is partially filled but missing a name.
 */
function collectIngredients(container) {
  const rows = container.querySelectorAll('.ingredient-row');
  const ingredients = [];

  for (const row of rows) {
    const name = row.querySelector('.ingredient-row__name').value.trim();
    const quantityRaw = row.querySelector('.ingredient-row__quantity').value.trim();
    const unit = row.querySelector('.ingredient-row__unit').value.trim();

    if (name.length === 0 && quantityRaw.length === 0 && unit.length === 0) {
      continue; // Entirely empty row — ignore it.
    }

    if (name.length === 0) {
      throw new Error(MESSAGES.ingredientNameRequired);
    }

    /** @type {{ name: string, quantity?: number, unit?: string }} */
    const ingredient = { name };
    if (quantityRaw.length > 0) {
      ingredient.quantity = Number(quantityRaw);
    }
    if (unit.length > 0) {
      ingredient.unit = unit;
    }
    ingredients.push(ingredient);
  }

  return ingredients;
}

/**
 * @param {HTMLElement} status
 * @param {string} message
 * @param {boolean} [isError=false]
 */
function setStatus(status, message, isError = false) {
  status.textContent = message;
  status.classList.toggle('status--error', isError);
}

/**
 * Build the details block (instructions + ingredients) for a recipe.
 *
 * @param {object} recipe
 * @returns {HTMLElement}
 */
function renderDetails(recipe) {
  const details = document.createElement('div');
  details.className = 'recipe-card__details';
  details.hidden = true;

  if (recipe.instructions && recipe.instructions.trim().length > 0) {
    const heading = document.createElement('h4');
    heading.className = 'recipe-card__subheading';
    heading.textContent = 'Instructions';
    const body = document.createElement('p');
    body.className = 'recipe-card__instructions';
    body.textContent = recipe.instructions;
    details.append(heading, body);
  }

  const ingHeading = document.createElement('h4');
  ingHeading.className = 'recipe-card__subheading';
  ingHeading.textContent = 'Ingredients';
  details.append(ingHeading);

  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  if (ingredients.length === 0) {
    const none = document.createElement('p');
    none.className = 'recipe-card__muted';
    none.textContent = 'No ingredients listed.';
    details.append(none);
  } else {
    const list = document.createElement('ul');
    list.className = 'recipe-card__ingredients';
    for (const ing of ingredients) {
      const item = document.createElement('li');
      const parts = [];
      if (ing.quantity !== null && ing.quantity !== undefined) {
        parts.push(String(ing.quantity));
      }
      if (ing.unit) {
        parts.push(ing.unit);
      }
      parts.push(ing.name);
      item.textContent = parts.join(' ');
      list.append(item);
    }
    details.append(list);
  }

  return details;
}

/**
 * Build a single recipe card with select checkbox, details toggle, and delete.
 *
 * @param {object} recipe
 * @param {(id: number) => void} onDelete
 * @returns {HTMLLIElement}
 */
function renderRecipeCard(recipe, onDelete) {
  const card = document.createElement('li');
  card.className = 'recipe-card';

  const header = document.createElement('div');
  header.className = 'recipe-card__header';

  const select = document.createElement('label');
  select.className = 'recipe-card__select';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'recipe-card__checkbox';
  checkbox.value = String(recipe.id);
  checkbox.setAttribute('aria-label', `Select ${recipe.title} for export`);

  const titleWrap = document.createElement('span');
  titleWrap.className = 'recipe-card__titlewrap';

  const title = document.createElement('span');
  title.className = 'recipe-card__title';
  title.textContent = recipe.title;

  const meta = document.createElement('span');
  meta.className = 'recipe-card__meta';
  meta.textContent = `${recipe.servings} serving${recipe.servings === 1 ? '' : 's'}`;

  titleWrap.append(title, meta);
  select.append(checkbox, titleWrap);

  const actions = document.createElement('div');
  actions.className = 'recipe-card__actions';

  const details = renderDetails(recipe);

  const detailsBtn = document.createElement('button');
  detailsBtn.type = 'button';
  detailsBtn.className = 'button button--ghost button--small';
  detailsBtn.textContent = 'Details';
  detailsBtn.setAttribute('aria-expanded', 'false');
  detailsBtn.addEventListener('click', () => {
    const showing = !details.hidden;
    details.hidden = showing;
    detailsBtn.setAttribute('aria-expanded', String(!showing));
    detailsBtn.textContent = showing ? 'Details' : 'Hide';
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'button button--danger button--small';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', () => onDelete(recipe.id));

  actions.append(detailsBtn, deleteBtn);
  header.append(select, actions);
  card.append(header, details);
  return card;
}

/**
 * @typedef {Object} Elements
 * @property {HTMLFormElement} form
 * @property {HTMLInputElement} title
 * @property {HTMLInputElement} servings
 * @property {HTMLTextAreaElement} instructions
 * @property {HTMLElement} ingredientRows
 * @property {HTMLButtonElement} addIngredient
 * @property {HTMLButtonElement} submit
 * @property {HTMLElement} formStatus
 * @property {HTMLUListElement} list
 * @property {HTMLElement} listStatus
 * @property {HTMLButtonElement} exportButton
 */

/** @returns {Elements} */
function getElements() {
  const el = (id) => document.getElementById(id);
  const form = el('recipe-form');
  const title = el('recipe-title');
  const servings = el('recipe-servings');
  const instructions = el('recipe-instructions');
  const ingredientRows = el('ingredient-rows');
  const addIngredient = el('add-ingredient');
  const submit = el('recipe-submit');
  const formStatus = el('recipe-status');
  const list = el('recipe-list');
  const listStatus = el('recipes-status');
  const exportButton = el('export-csv');

  if (
    !form || !title || !servings || !instructions || !ingredientRows ||
    !addIngredient || !submit || !formStatus || !list || !listStatus ||
    !exportButton
  ) {
    throw new Error('Recipe UI is missing required elements.');
  }

  return {
    form, title, servings, instructions, ingredientRows, addIngredient,
    submit, formStatus, list, listStatus, exportButton,
  };
}

/**
 * Load all recipes and render them. Surfaces loading / empty / error states.
 *
 * @param {Elements} els
 */
async function refreshList(els) {
  setStatus(els.listStatus, MESSAGES.loading);
  try {
    const recipes = await listRecipes();

    if (recipes.length === 0) {
      els.list.replaceChildren();
      setStatus(els.listStatus, MESSAGES.empty);
      return;
    }

    const onDelete = (id) => void handleDelete(els, id);
    const fragment = document.createDocumentFragment();
    for (const recipe of recipes) {
      fragment.appendChild(renderRecipeCard(recipe, onDelete));
    }
    els.list.replaceChildren(fragment);
    setStatus(els.listStatus, '');
  } catch (error) {
    const message = error instanceof ApiError ? error.message : MESSAGES.loadError;
    setStatus(els.listStatus, message, true);
  }
}

/**
 * @param {Elements} els
 * @param {number} id
 */
async function handleDelete(els, id) {
  setStatus(els.listStatus, MESSAGES.deleting);
  try {
    await deleteRecipe(id);
    await refreshList(els);
    setStatus(els.listStatus, MESSAGES.deleted);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : MESSAGES.deleteError;
    setStatus(els.listStatus, message, true);
  }
}

/**
 * @param {Elements} els
 */
async function handleSubmit(els) {
  const title = els.title.value.trim();
  if (title.length === 0) {
    setStatus(els.formStatus, MESSAGES.titleRequired, true);
    els.title.focus();
    return;
  }

  const servings = Number(els.servings.value);
  if (!Number.isInteger(servings) || servings <= 0) {
    setStatus(els.formStatus, MESSAGES.servingsInvalid, true);
    els.servings.focus();
    return;
  }

  let ingredients;
  try {
    ingredients = collectIngredients(els.ingredientRows);
  } catch (error) {
    setStatus(els.formStatus, error.message, true);
    return;
  }

  /** @type {{ title: string, servings: number, instructions?: string, ingredients: any[] }} */
  const payload = { title, servings, ingredients };
  const instructions = els.instructions.value.trim();
  if (instructions.length > 0) {
    payload.instructions = instructions;
  }

  els.submit.disabled = true;
  setStatus(els.formStatus, MESSAGES.saving);
  try {
    const recipe = await createRecipe(payload);
    resetForm(els);
    setStatus(els.formStatus, MESSAGES.saved(recipe.title));
    await refreshList(els);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : MESSAGES.unexpected;
    setStatus(els.formStatus, message, true);
  } finally {
    els.submit.disabled = false;
  }
}

/**
 * Reset the form back to its initial state (one blank ingredient row).
 *
 * @param {Elements} els
 */
function resetForm(els) {
  els.form.reset();
  els.ingredientRows.replaceChildren(createIngredientRow());
}

/**
 * Gather selected recipe ids, request the CSV, and trigger a download.
 *
 * @param {Elements} els
 */
async function handleExport(els) {
  const checked = els.list.querySelectorAll('.recipe-card__checkbox:checked');
  const recipeIds = Array.from(checked, (cb) => Number(cb.value));

  if (recipeIds.length === 0) {
    setStatus(els.listStatus, MESSAGES.exportEmpty, true);
    return;
  }

  els.exportButton.disabled = true;
  setStatus(els.listStatus, MESSAGES.exporting);
  try {
    const blob = await exportShoppingListCsv(recipeIds);
    triggerDownload(blob, 'shopping-list.csv');
    setStatus(els.listStatus, MESSAGES.exported);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : MESSAGES.exportError;
    setStatus(els.listStatus, message, true);
  } finally {
    els.exportButton.disabled = false;
  }
}

/**
 * Download a Blob as a named file via a temporary object URL.
 *
 * @param {Blob} blob
 * @param {string} filename
 */
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Initialize the recipe create/list/export UI. Safe to call once on DOM ready.
 */
export function initRecipes() {
  const els = getElements();

  // Start with a single blank ingredient row.
  els.ingredientRows.replaceChildren(createIngredientRow());

  els.addIngredient.addEventListener('click', () => {
    els.ingredientRows.appendChild(createIngredientRow());
  });

  els.form.addEventListener('submit', (event) => {
    event.preventDefault();
    void handleSubmit(els);
  });

  els.exportButton.addEventListener('click', () => {
    void handleExport(els);
  });

  void refreshList(els);
}
