/**
 * Search Screen
 * Handles search, browse, and URL input for all content types
 * Includes smart episode matching for anime
 */

import {
  sectionHeader,
  buildDownloadMethodChoices,
  selectMenu,
  textInput,
  urlInput,
  searchResults,
  torrentResults,
  confirm,
  success,
  error,
  warning,
  info
} from '../components/index.js';
import {
  colors,
  icons,
  menuChoice,
  backChoice,
  getContentLabel,
  getContentIcon,
  truncate,
  formatBytes
} from '../theme/index.js';
import { getActiveSource } from '../../core/sources/manager.js';
import { getHandlerForSource } from '../../core/content/index.js';
import { ContentType, Capabilities, hasCapability } from '../../core/content/types.js';
import {
  parseEpisodeInput,
  findBestTorrents,
  formatEpisodeInfo,
  extractEpisodesFromTitle
} from '../../utils/episode-parser.js';

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
 * Perform anime search with smart episode matching
 * @returns {Promise<Object|null>} Selected torrent or null
 */
async function performAnimeSearch() {
  const source = getActiveSource();
  const handler = getHandlerForSource(source);

  // Get anime title
  const titleQuery = await textInput('Search anime title:');
  if (!titleQuery || !titleQuery.trim()) {
    return null;
  }

  // Get episode info (optional)
  console.log('');
  console.log(colors.muted('Episode formats: "5", "1-12", "S2E5", "Season 2 Episode 5", or leave empty for all'));
  const episodeInput = await textInput('Episode (optional):');

  const episodeInfo = parseEpisodeInput(episodeInput);

  // Build search query
  let searchQuery = titleQuery.trim();

  // If season specified, add to query for better results
  if (episodeInfo.season !== null) {
    searchQuery += ` Season ${episodeInfo.season}`;
  }

  console.log(colors.muted(`\nSearching for "${searchQuery}"...`));

  if (episodeInfo.episodes.length > 0 || episodeInfo.season !== null) {
    console.log(colors.muted(`Looking for: ${formatEpisodeInfo(episodeInfo)}`));
  }

  try {
    const results = await handler.search(searchQuery, source, {});

    if (!results || results.length === 0) {
      console.log(warning('No results found. Try different search terms.'));
      return null;
    }

    // If episode info specified, use smart matching
    if (episodeInfo.episodes.length > 0 || episodeInfo.season !== null) {
      return await showSmartTorrentResults(results, episodeInfo, source);
    }

    // Otherwise show regular results
    return await showTorrentResults(results, source);
  } catch (err) {
    console.log(error(`Search failed: ${err.message}`));
    return null;
  }
}

/**
 * Show smart-matched torrent results
 */
async function showSmartTorrentResults(results, episodeInfo, source) {
  // Find best matching torrents
  const matched = findBestTorrents(results, episodeInfo, {
    minScore: 10,
    limit: 15,
    preferTrusted: true
  });

  if (matched.length === 0) {
    console.log(warning('No torrents match your episode criteria.'));
    console.log(colors.muted('Showing all results instead...\n'));
    return await showTorrentResults(results, source);
  }

  // Show matched results
  console.log('\n' + sectionHeader('Best Matches'));
  console.log(colors.muted(`Showing torrents matching: ${formatEpisodeInfo(episodeInfo)}`));
  console.log('');

  // Display results with match info
  matched.forEach((torrent, index) => {
    const trust = torrent.trusted ? colors.success(icons.trusted) : '';
    const remake = torrent.remake ? colors.error(icons.remake) : '';
    const seeders = colors.success(`↑${torrent.seeders || 0}`);
    const score = colors.primary(`[${torrent.matchScore}%]`);

    console.log(`${colors.muted(`${index + 1}.`)} ${truncate(torrent.title, 55)} ${trust}${remake}`);

    // Show episode info
    const epInfo = torrent.episodeInfo;
    const epStr = epInfo.episodes.length > 0
      ? (epInfo.isBatch
        ? `Eps ${epInfo.episodes[0]}-${epInfo.episodes[epInfo.episodes.length - 1]}`
        : `Ep ${epInfo.episodes.join(', ')}`)
      : 'Unknown eps';
    const seasonStr = epInfo.season ? `S${epInfo.season}` : '';

    console.log(colors.muted(`   ${score} ${seeders} | ${torrent.size || 'Unknown'} | ${seasonStr} ${epStr}`));
  });
  console.log('');

  // Check if there's a clear best match (score > 150)
  const bestMatch = matched[0];
  if (bestMatch.matchScore >= 150 && matched.length > 1) {
    const secondBest = matched[1];
    if (bestMatch.matchScore - secondBest.matchScore >= 30) {
      // Offer auto-select
      console.log(success(`Best match: ${truncate(bestMatch.title, 50)}`));
      const useAuto = await confirm('Use this torrent?', true);
      if (useAuto) {
        return bestMatch;
      }
    }
  }

  // Manual selection
  const choices = matched.map((torrent, index) => ({
    name: `${index + 1}. ${truncate(torrent.title, 45)} ${colors.success(`↑${torrent.seeders}`)} ${colors.primary(`[${torrent.matchScore}%]`)}`,
    value: index
  }));

  choices.push(menuChoice('Show All Results', 'all', 'View unfiltered results'));
  choices.push(backChoice('Cancel'));

  const selection = await selectMenu('Select torrent:', choices, { pageSize: 15 });

  if (selection === null) {
    return null;
  }

  if (selection === 'all') {
    return await showTorrentResults(results, source);
  }

  return matched[selection];
}

/**
 * Show regular torrent results
 */
async function showTorrentResults(results, source) {
  console.log('\n' + torrentResults(results));
  console.log('');

  const choices = results.slice(0, 20).map((result, index) => {
    const trust = result.trusted ? colors.success(' [T]') : '';
    const seeders = colors.success(`↑${result.seeders || 0}`);
    return {
      name: `${index + 1}. ${truncate(result.title, 45)} ${seeders}${trust}`,
      value: index
    };
  });

  choices.push(backChoice('Cancel'));

  const selection = await selectMenu('Select torrent:', choices, { pageSize: 15 });

  if (selection === null) {
    return null;
  }

  return results[selection];
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

  // Use smart search for anime
  if (source.contentType === ContentType.ANIME) {
    return await performAnimeSearch();
  }

  const contentLabel = getContentLabel(source.contentType, { lowercase: true });
  const query = await textInput(`Search for ${contentLabel}:`);

  if (!query || !query.trim()) {
    return null;
  }

  console.log(colors.muted(`\nSearching for "${query}"...`));

  try {
    const results = await handler.search(query, source);

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

      if (!results || results.length === 0) {
        console.log(warning('No results found in this category'));
        return null;
      }

      return await showTorrentResults(results, source);
    } else {
      results = await handler.browse(selectedCategory, 1, source);

      if (!results || results.length === 0) {
        console.log(warning('No results found in this category'));
        return null;
      }

      return await showSearchResults(results, source);
    }
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
 * Display search results and let user select (for novels/manga)
 * @param {Object[]} results - Search results
 * @param {Object} source - Active source
 * @returns {Promise<Object|null>} Selected result
 */
async function showSearchResults(results, source) {
  console.log('');
  console.log(searchResults(results));
  console.log('');

  const choices = results.map((result, index) => ({
    name: `${index + 1}. ${truncate(result.title, 50)}`,
    value: index
  }));

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
