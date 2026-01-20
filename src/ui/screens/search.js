/**
 * Search Screen
 * Handles search, browse, and URL input for all content types
 */

import {
  sectionHeader,
  buildDownloadMethodChoices,
  selectMenu,
  textInput,
  urlInput,
  searchResults,
  torrentResults,
  success,
  error,
  warning,
  info
} from '../components/index.js';
import {
  colors,
  menuChoice,
  backChoice,
  getContentLabel,
  getContentIcon,
  truncate
} from '../theme/index.js';
import { getActiveSource } from '../../core/sources/manager.js';
import { getHandlerForSource } from '../../core/content/index.js';
import { ContentType, Capabilities, hasCapability } from '../../core/content/types.js';

/**
 * Show download method selection based on source capabilities
 * @returns {Promise<string|null>} Selected method or null
 */
export async function showDownloadMethod() {
  const source = getActiveSource();

  if (!source) {
    console.log(error('No source selected. Please select a source first.'));
    return null;
  }

  const contentLabel = getContentLabel(source.contentType);
  console.log('\n' + sectionHeader(`Download ${contentLabel}`));
  console.log('');

  const choices = buildDownloadMethodChoices(source);

  return await selectMenu(`How would you like to find ${contentLabel.toLowerCase()}?`, choices);
}

/**
 * Perform a text search
 * @returns {Promise<Object|null>} Selected result or null
 */
export async function performSearch() {
  const source = getActiveSource();
  const handler = getHandlerForSource(source);

  if (!handler) {
    console.log(error('No handler available for this source type'));
    return null;
  }

  const contentLabel = getContentLabel(source.contentType, { lowercase: true });
  const query = await textInput(`Search for ${contentLabel}:`);

  if (!query || !query.trim()) {
    return null;
  }

  console.log(colors.muted(`\nSearching for "${query}"...`));

  try {
    let results;

    // Anime sources may have additional search options
    if (source.contentType === ContentType.ANIME) {
      results = await handler.search(query, source, {});
    } else {
      results = await handler.search(query, source);
    }

    if (!results || results.length === 0) {
      console.log(warning('No results found. Try different search terms.'));
      return null;
    }

    return await showSearchResults(results, source);
  } catch (err) {
    console.log(error(`Search failed: ${err.message}`));
    return null;
  }
}

/**
 * Browse by category/genre
 * @returns {Promise<Object|null>} Selected result or null
 */
export async function performBrowse() {
  const source = getActiveSource();
  const handler = getHandlerForSource(source);

  if (!handler) {
    console.log(error('No handler available for this source type'));
    return null;
  }

  // Get genres/categories from handler
  let categories;
  if (source.contentType === ContentType.ANIME) {
    categories = handler.getCategories(source);
  } else {
    categories = handler.getGenres(source);
  }

  if (!categories || categories.length === 0) {
    console.log(warning('No categories available for browsing'));
    return null;
  }

  // Select category
  const categoryChoices = categories.map(cat => ({
    name: cat.name,
    value: cat.value || cat.url
  }));
  categoryChoices.push(backChoice());

  const selectedCategory = await selectMenu('Select a category:', categoryChoices);

  if (!selectedCategory) {
    return null;
  }

  console.log(colors.muted('\nLoading...'));

  try {
    let results;

    if (source.contentType === ContentType.ANIME) {
      // For anime, search with category filter
      results = await handler.search('', source, { category: selectedCategory });
    } else {
      results = await handler.browse(selectedCategory, 1, source);
    }

    if (!results || results.length === 0) {
      console.log(warning('No results found in this category'));
      return null;
    }

    return await showSearchResults(results, source);
  } catch (err) {
    console.log(error(`Browse failed: ${err.message}`));
    return null;
  }
}

/**
 * Fetch from direct URL
 * @returns {Promise<Object|null>} Fetched content or null
 */
export async function performUrlFetch() {
  const source = getActiveSource();
  const handler = getHandlerForSource(source);

  if (!handler) {
    console.log(error('No handler available for this source type'));
    return null;
  }

  const contentLabel = getContentLabel(source.contentType, { lowercase: true });
  const url = await urlInput(`Enter ${contentLabel} URL:`);

  if (!url || !url.trim()) {
    return null;
  }

  console.log(colors.muted('\nFetching details...'));

  try {
    const details = await handler.getDetails(url, source);
    return details;
  } catch (err) {
    console.log(error(`Failed to fetch: ${err.message}`));
    return null;
  }
}

/**
 * Display search results and let user select
 * @param {Object[]} results - Search results
 * @param {Object} source - Active source
 * @returns {Promise<Object|null>} Selected result
 */
async function showSearchResults(results, source) {
  const isAnime = source.contentType === ContentType.ANIME;

  // Display results
  console.log('');
  if (isAnime) {
    console.log(torrentResults(results));
  } else {
    console.log(searchResults(results));
  }
  console.log('');

  // Build selection choices
  const choices = results.map((result, index) => {
    let name = `${index + 1}. ${truncate(result.title, 50)}`;

    if (isAnime) {
      const trust = result.trusted ? colors.success(' [Trusted]') : '';
      const seeders = colors.success(`↑${result.seeders || 0}`);
      name = `${index + 1}. ${truncate(result.title, 45)} ${seeders}${trust}`;
    }

    return {
      name,
      value: index
    };
  });
  choices.push(backChoice('Cancel'));

  const selection = await selectMenu('Select one:', choices, { pageSize: 15 });

  if (selection === null) {
    return null;
  }

  return results[selection];
}

/**
 * Main search flow - handles method selection and execution
 * @returns {Promise<Object|null>} Selected/fetched content
 */
export async function searchFlow() {
  const method = await showDownloadMethod();

  switch (method) {
    case 'search':
      return await performSearch();

    case 'browse':
      return await performBrowse();

    case 'url':
      return await performUrlFetch();

    default:
      return null;
  }
}

export default {
  showDownloadMethod,
  performSearch,
  performBrowse,
  performUrlFetch,
  searchFlow
};
