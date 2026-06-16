/**
 * api.js — thin client for the Recipe Box search endpoint.
 *
 * Contract (from server.js):
 *   GET /search?ingredient=<value>
 *     200 -> JSON array of { id, title }
 *     400 -> JSON { error: "<message>" } (missing/empty ingredient)
 *   Any non-2xx with a JSON { error } body surfaces that message.
 */

const SEARCH_PATH = '/search';

/**
 * Raised for any non-successful search response so callers can show a
 * user-friendly message instead of a raw exception.
 */
export class SearchError extends Error {
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
 * @returns {Promise<string>}
 */
async function readErrorMessage(response) {
  try {
    const body = await response.json();
    if (body && typeof body.error === 'string' && body.error.trim().length > 0) {
      return body.error;
    }
  } catch {
    // Non-JSON / empty body — fall through to the generic message.
  }
  return `Search failed (HTTP ${response.status}). Please try again.`;
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
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
  } catch {
    // Network-level failure (offline, DNS, CORS, server down).
    throw new SearchError(
      'Could not reach the server. Check your connection and try again.',
    );
  }

  if (!response.ok) {
    throw new SearchError(await readErrorMessage(response));
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
