/**
 * app.js — UI wiring for ingredient search.
 *
 * Responsibilities:
 *  - Validate input at the boundary (empty / whitespace-only).
 *  - Call the search API and render results.
 *  - Communicate every state to the user: loading, empty input, zero
 *    results, success, and errors. No state is silently swallowed.
 */

import { searchByIngredient, SearchError } from './api.js';
import { initThemeToggle } from './theme.js';
import { initRecipes } from './recipes.js';

const MESSAGES = Object.freeze({
  emptyInput: 'Please enter an ingredient to search for.',
  loading: 'Searching…',
  noResults: 'No recipes found for that ingredient. Try another one.',
  unexpected: 'Something went wrong. Please try again.',
  results: (count) =>
    `Found ${count} recipe${count === 1 ? '' : 's'}.`,
});

/**
 * @typedef {Object} Elements
 * @property {HTMLFormElement} form
 * @property {HTMLInputElement} input
 * @property {HTMLButtonElement} button
 * @property {HTMLElement} status
 * @property {HTMLUListElement} results
 */

/**
 * Resolve required DOM nodes once. Throws if the markup is missing them,
 * which surfaces wiring mistakes early rather than failing silently later.
 *
 * @returns {Elements}
 */
function getElements() {
  const form = document.getElementById('search-form');
  const input = document.getElementById('ingredient-input');
  const button = document.getElementById('search-button');
  const status = document.getElementById('search-status');
  const results = document.getElementById('results');

  if (!form || !input || !button || !status || !results) {
    throw new Error('Search UI is missing required elements.');
  }

  return { form, input, button, status, results };
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

/** @param {HTMLUListElement} container */
function clearResults(container) {
  container.replaceChildren();
}

/**
 * Build a single result list item from a recipe.
 *
 * @param {{ id: number, title: string }} recipe
 * @returns {HTMLLIElement}
 */
function renderItem(recipe) {
  const item = document.createElement('li');
  item.className = 'results__item';

  const title = document.createElement('span');
  title.className = 'results__title';
  // textContent (not innerHTML) keeps untrusted titles XSS-safe.
  title.textContent = recipe.title;

  const id = document.createElement('span');
  id.className = 'results__id';
  id.textContent = `Recipe #${recipe.id}`;

  item.append(title, id);
  return item;
}

/**
 * @param {HTMLUListElement} container
 * @param {Array<{ id: number, title: string }>} recipes
 */
function renderResults(container, recipes) {
  const fragment = document.createDocumentFragment();
  for (const recipe of recipes) {
    fragment.appendChild(renderItem(recipe));
  }
  container.replaceChildren(fragment);
}

/**
 * @param {Elements} els
 * @param {boolean} isLoading
 */
function setLoading(els, isLoading) {
  els.button.disabled = isLoading;
  els.input.disabled = isLoading;
}

/**
 * Run a single search cycle for the current input value.
 *
 * @param {Elements} els
 */
async function handleSearch(els) {
  const ingredient = els.input.value.trim();

  if (ingredient.length === 0) {
    clearResults(els.results);
    setStatus(els.status, MESSAGES.emptyInput, true);
    els.input.focus();
    return;
  }

  setLoading(els, true);
  setStatus(els.status, MESSAGES.loading);

  try {
    const recipes = await searchByIngredient(ingredient);

    if (recipes.length === 0) {
      clearResults(els.results);
      setStatus(els.status, MESSAGES.noResults);
      return;
    }

    renderResults(els.results, recipes);
    setStatus(els.status, MESSAGES.results(recipes.length));
  } catch (error) {
    clearResults(els.results);
    const message =
      error instanceof SearchError ? error.message : MESSAGES.unexpected;
    setStatus(els.status, message, true);
  } finally {
    setLoading(els, false);
  }
}

function init() {
  const els = getElements();
  els.form.addEventListener('submit', (event) => {
    event.preventDefault();
    void handleSearch(els);
  });

  const themeButton = document.getElementById('theme-toggle');
  if (themeButton instanceof HTMLButtonElement) {
    initThemeToggle(themeButton);
  }

  // Wire up the recipe create / list / export UI.
  initRecipes();
}

init();
