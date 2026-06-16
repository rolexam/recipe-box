/**
 * api.js — thin client for the Recipe Box HTTP API.
 *
 * Contracts (from server.js):
 *   GET    /search?ingredient=<value>   200 -> [{ id, title }]            400 -> { error }
 *   POST   /recipes                      201 -> recipe                     400 -> { error }
 *   GET    /recipes                      200 -> recipe[]
 *   GET    /recipes/:id                  200 -> recipe                     404 -> { error }
 *   DELETE /recipes/:id                  204 -> (no body)                  404 -> { error }
 *   POST   /shopping-list/export         200 -> text/csv (attachment)      400/404 -> { error }
 *
 * Any non-2xx with a JSON { error } body surfaces that message.
 */

const SEARCH_PATH = '/search';
const RECIPES_PATH = '/recipes';
const EXPORT_PATH = '/shopping-list/export';

/**
 * Raised for any non-successful API response so callers can show a
 * user-friendly message instead of a raw exception.
 */
export class ApiError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Back-compat alias: the search UI historically caught `SearchError`.
 * Kept as a subclass so existing `instanceof` checks keep working.
 */
export class SearchError extends ApiError {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'SearchError';
  }
}

/**
 * Best-effort extraction of an { error } message from a failed response.
 * Falls back to a generic, status-aware message when the body is not JSON.
 *
 * @param {Response} response
 * @param {string} fallbackVerb - e.g. 'Search', 'Request'
 * @returns {Promise<string>}
 */
async function readErrorMessage(response, fallbackVerb = 'Request') {
  try {
    const body = await response.json();
    if (body && typeof body.error === 'string' && body.error.trim().length > 0) {
      return body.error;
    }
  } catch {
    // Non-JSON / empty body — fall through to the generic message.
  }
  return `${fallbackVerb} failed (HTTP ${response.status}). Please try again.`;
}

/**
 * Perform a fetch, translating network failures into a friendly ApiError.
 *
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
async function request(url, options) {
  try {
    return await fetch(url, options);
  } catch {
    // Network-level failure (offline, DNS, server down).
    throw new ApiError(
      'Could not reach the server. Check your connection and try again.',
    );
  }
}

/**
 * Search recipes by ingredient.
 *
 * @param {string} ingredient - non-empty ingredient term (caller validates).
 * @returns {Promise<Array<{ id: number, title: string }>>}
 * @throws {SearchError} on HTTP error, network failure, or unexpected payload.
 */
export async function searchByIngredient(ingredient) {
  const url = `${SEARCH_PATH}?ingredient=${encodeURIComponent(ingredient)}`;

  let response;
  try {
    response = await request(url, { headers: { Accept: 'application/json' } });
  } catch (error) {
    throw new SearchError(error.message);
  }

  if (!response.ok) {
    throw new SearchError(await readErrorMessage(response, 'Search'));
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new SearchError('Received an invalid response from the server.');
  }

  if (!Array.isArray(data)) {
    throw new SearchError('Received an unexpected response from the server.');
  }

  return data;
}

/**
 * Fetch all recipes (each with nested ingredients).
 *
 * @returns {Promise<Array<object>>}
 * @throws {ApiError}
 */
export async function listRecipes() {
  const response = await request(RECIPES_PATH, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response, 'Loading recipes'));
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiError('Received an invalid response from the server.');
  }

  if (!Array.isArray(data)) {
    throw new ApiError('Received an unexpected response from the server.');
  }

  return data;
}

/**
 * Fetch a single recipe by id.
 *
 * @param {number} id
 * @returns {Promise<object>}
 * @throws {ApiError}
 */
export async function getRecipe(id) {
  const response = await request(`${RECIPES_PATH}/${encodeURIComponent(id)}`, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response, 'Loading the recipe'));
  }

  try {
    return await response.json();
  } catch {
    throw new ApiError('Received an invalid response from the server.');
  }
}

/**
 * Create a new recipe.
 *
 * @param {{ title: string, servings: number, instructions?: string,
 *           ingredients?: Array<{ name: string, quantity?: number, unit?: string }> }} input
 * @returns {Promise<object>} the created recipe
 * @throws {ApiError}
 */
export async function createRecipe(input) {
  const response = await request(RECIPES_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response, 'Saving the recipe'));
  }

  try {
    return await response.json();
  } catch {
    throw new ApiError('Received an invalid response from the server.');
  }
}

/**
 * Delete a recipe by id.
 *
 * @param {number} id
 * @returns {Promise<void>}
 * @throws {ApiError}
 */
export async function deleteRecipe(id) {
  const response = await request(`${RECIPES_PATH}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });

  // 204 No Content on success.
  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response, 'Deleting the recipe'));
  }
}

/**
 * Export a shopping list for the given recipe ids as a CSV Blob.
 *
 * @param {number[]} recipeIds - non-empty list of recipe ids.
 * @returns {Promise<Blob>} the CSV file contents.
 * @throws {ApiError}
 */
export async function exportShoppingListCsv(recipeIds) {
  const response = await request(EXPORT_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipeIds }),
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response, 'Exporting the shopping list'));
  }

  return response.blob();
}
