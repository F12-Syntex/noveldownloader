/**
 * Episode Parser Utility
 * Parses various episode/season formats and matches against torrent titles
 */

/**
 * Parsed episode info
 * @typedef {Object} EpisodeInfo
 * @property {number|null} season - Season number (null if not specified)
 * @property {number[]} episodes - Array of episode numbers
 * @property {boolean} isRange - Whether this is a range of episodes
 * @property {string} raw - Original input string
 */

/**
 * Parse episode string into structured info
 * Supports formats:
 * - "5" or "05" -> episode 5
 * - "1-10" -> episodes 1-10
 * - "1,3,5" -> episodes 1, 3, 5
 * - "S3E5" or "s03e05" -> season 3 episode 5
 * - "Season 3 Episode 5" -> season 3 episode 5
 * - "3x05" -> season 3 episode 5
 * - "S2E1-12" -> season 2 episodes 1-12
 * - "Season 2 Episodes 1-12" -> season 2 episodes 1-12
 *
 * @param {string} input - Episode string
 * @returns {EpisodeInfo}
 */
export function parseEpisodeInput(input) {
  if (!input || typeof input !== 'string') {
    return { season: null, episodes: [], isRange: false, raw: input || '' };
  }

  const raw = input.trim();
  const normalized = raw.toLowerCase();

  let season = null;
  let episodes = [];
  let isRange = false;

  // Pattern 1: S03E05 or S3E5 format (with optional episode range)
  const sXeXPattern = /s(\d{1,2})e(\d{1,4})(?:\s*[-~]\s*e?(\d{1,4}))?/i;
  const sXeXMatch = normalized.match(sXeXPattern);
  if (sXeXMatch) {
    season = parseInt(sXeXMatch[1]);
    const startEp = parseInt(sXeXMatch[2]);
    const endEp = sXeXMatch[3] ? parseInt(sXeXMatch[3]) : startEp;
    episodes = rangeToArray(startEp, endEp);
    isRange = startEp !== endEp;
    return { season, episodes, isRange, raw };
  }

  // Pattern 2: "Season X Episode Y" format
  const seasonEpPattern = /season\s*(\d{1,2})[\s,]*(?:episodes?|ep\.?)\s*(\d{1,4})(?:\s*[-~]\s*(\d{1,4}))?/i;
  const seasonEpMatch = normalized.match(seasonEpPattern);
  if (seasonEpMatch) {
    season = parseInt(seasonEpMatch[1]);
    const startEp = parseInt(seasonEpMatch[2]);
    const endEp = seasonEpMatch[3] ? parseInt(seasonEpMatch[3]) : startEp;
    episodes = rangeToArray(startEp, endEp);
    isRange = startEp !== endEp;
    return { season, episodes, isRange, raw };
  }

  // Pattern 3: 3x05 format
  const crossPattern = /(\d{1,2})x(\d{1,4})(?:\s*[-~]\s*(\d{1,4}))?/i;
  const crossMatch = normalized.match(crossPattern);
  if (crossMatch) {
    season = parseInt(crossMatch[1]);
    const startEp = parseInt(crossMatch[2]);
    const endEp = crossMatch[3] ? parseInt(crossMatch[3]) : startEp;
    episodes = rangeToArray(startEp, endEp);
    isRange = startEp !== endEp;
    return { season, episodes, isRange, raw };
  }

  // Pattern 4: Just "Episode X" or "Ep X"
  const epOnlyPattern = /(?:episodes?|ep\.?)\s*(\d{1,4})(?:\s*[-~]\s*(\d{1,4}))?/i;
  const epOnlyMatch = normalized.match(epOnlyPattern);
  if (epOnlyMatch) {
    const startEp = parseInt(epOnlyMatch[1]);
    const endEp = epOnlyMatch[2] ? parseInt(epOnlyMatch[2]) : startEp;
    episodes = rangeToArray(startEp, endEp);
    isRange = startEp !== endEp;
    return { season, episodes, isRange, raw };
  }

  // Pattern 5: Just "Season X" (all episodes of that season)
  const seasonOnlyPattern = /season\s*(\d{1,2})/i;
  const seasonOnlyMatch = normalized.match(seasonOnlyPattern);
  if (seasonOnlyMatch && !normalized.includes('episode') && !normalized.includes('ep')) {
    season = parseInt(seasonOnlyMatch[1]);
    return { season, episodes: [], isRange: false, raw };
  }

  // Pattern 6: Simple number range "1-10" or "1,3,5" or just "5"
  const simplePattern = /^[\d,\-\s~]+$/;
  if (simplePattern.test(normalized)) {
    episodes = parseSimpleRange(normalized);
    isRange = episodes.length > 1;
    return { season, episodes, isRange, raw };
  }

  return { season, episodes, isRange, raw };
}

/**
 * Convert start-end to array of numbers
 */
function rangeToArray(start, end) {
  const arr = [];
  for (let i = start; i <= end; i++) {
    arr.push(i);
  }
  return arr;
}

/**
 * Parse simple range like "1-10" or "1,3,5" or "1-5,10,15-20"
 */
function parseSimpleRange(rangeStr) {
  const episodes = new Set();
  const parts = rangeStr.split(',').map(s => s.trim());

  for (const part of parts) {
    if (part.includes('-') || part.includes('~')) {
      const [start, end] = part.split(/[-~]/).map(s => parseInt(s.trim()));
      if (!isNaN(start) && !isNaN(end) && start <= end) {
        for (let i = start; i <= end; i++) {
          episodes.add(i);
        }
      }
    } else {
      const num = parseInt(part);
      if (!isNaN(num)) {
        episodes.add(num);
      }
    }
  }

  return Array.from(episodes).sort((a, b) => a - b);
}

/**
 * Extract episode info from a torrent title
 * @param {string} title - Torrent title
 * @returns {Object}
 */
export function extractEpisodesFromTitle(title) {
  if (!title) return { season: null, episodes: [], isBatch: false };

  let season = null;
  let episodes = [];
  let isBatch = false;

  // Check for season indicators
  const seasonPatterns = [
    /S(\d{1,2})/i,
    /Season\s*(\d{1,2})/i,
    /(\d{1,2})(?:st|nd|rd|th)\s*Season/i
  ];

  for (const pattern of seasonPatterns) {
    const match = title.match(pattern);
    if (match) {
      season = parseInt(match[1]);
      break;
    }
  }

  // Episode patterns (ordered by specificity)
  const episodePatterns = [
    // S01E05 format
    /S\d{1,2}E(\d{1,4})(?:\s*[-~]\s*E?(\d{1,4}))?/i,
    // - 05 or - 01-12 format (common in anime)
    /[-\s](\d{1,4})(?:\s*[-~]\s*(\d{1,4}))?(?:\s*(?:END|Final|Complete|v\d))?(?:\s*[\[\(]|$)/,
    // Episode 5 format
    /Episode\s*(\d{1,4})(?:\s*[-~]\s*(\d{1,4}))?/i,
    // Ep 05 format
    /\bEp\.?\s*(\d{1,4})(?:\s*[-~]\s*(\d{1,4}))?/i,
    // (01-12) format in parentheses
    /\((\d{1,4})(?:\s*[-~]\s*(\d{1,4}))?\)/,
    // [01-12] format in brackets
    /\[(\d{1,4})(?:\s*[-~]\s*(\d{1,4}))?\]/,
  ];

  for (const pattern of episodePatterns) {
    const match = title.match(pattern);
    if (match) {
      const start = parseInt(match[1]);
      const end = match[2] ? parseInt(match[2]) : start;

      // Sanity check - episode numbers shouldn't be too high for single episodes
      // unless it's clearly a batch
      if (start <= 2000 && end <= 2000 && start <= end) {
        episodes = rangeToArray(start, end);
        isBatch = start !== end;
        break;
      }
    }
  }

  // Check for batch indicators
  const batchIndicators = /batch|complete|全話|全\d+話|1-\d+|\d+-\d+|Season\s*\d+\s*Complete/i;
  if (batchIndicators.test(title)) {
    isBatch = true;
  }

  return { season, episodes, isBatch };
}

/**
 * Score a torrent based on how well it matches the requested episodes
 * Higher score = better match
 * @param {Object} torrent - Torrent info
 * @param {EpisodeInfo} requested - Requested episode info
 * @returns {number}
 */
export function scoreTorrentMatch(torrent, requested) {
  let score = 0;

  const torrentInfo = extractEpisodesFromTitle(torrent.title);

  // If no specific episodes requested, any torrent is valid
  if (requested.episodes.length === 0 && !requested.season) {
    return 100; // Base score for any match
  }

  // Season matching
  if (requested.season !== null) {
    if (torrentInfo.season === requested.season) {
      score += 50; // Season match bonus
    } else if (torrentInfo.season !== null && torrentInfo.season !== requested.season) {
      return 0; // Wrong season, no match
    }
    // If torrent has no season info, it might still be valid (many anime don't list season)
  }

  // Episode matching
  if (requested.episodes.length > 0) {
    if (torrentInfo.episodes.length === 0) {
      // Torrent has no episode info - might be a full season batch
      if (torrentInfo.isBatch) {
        score += 20; // Batch might contain the episodes
      }
    } else {
      // Check how many requested episodes are in this torrent
      const matchedEpisodes = requested.episodes.filter(ep =>
        torrentInfo.episodes.includes(ep)
      );

      if (matchedEpisodes.length === 0) {
        return 0; // No matching episodes
      }

      // Score based on coverage
      const coverage = matchedEpisodes.length / requested.episodes.length;
      score += Math.round(coverage * 100);

      // Bonus for exact match (torrent has exactly what we need)
      if (matchedEpisodes.length === requested.episodes.length &&
          torrentInfo.episodes.length === requested.episodes.length) {
        score += 30; // Exact match bonus
      }

      // Slight penalty for having too many extra episodes (prefer targeted downloads)
      if (torrentInfo.episodes.length > requested.episodes.length * 2) {
        score -= 10;
      }
    }
  }

  // Quality bonuses
  if (torrent.trusted) score += 25;
  if (torrent.remake) score -= 20;

  // Seeder bonus (logarithmic scale)
  if (torrent.seeders > 0) {
    score += Math.min(20, Math.log10(torrent.seeders) * 10);
  }

  return Math.max(0, score);
}

/**
 * Find best matching torrents for requested episodes
 * @param {Object[]} torrents - Array of torrent results
 * @param {EpisodeInfo} requested - Requested episode info
 * @param {Object} options - Options
 * @returns {Object[]} Sorted torrents with scores
 */
export function findBestTorrents(torrents, requested, options = {}) {
  const { minScore = 1, limit = 10, preferTrusted = true } = options;

  const scored = torrents.map(torrent => ({
    ...torrent,
    matchScore: scoreTorrentMatch(torrent, requested),
    episodeInfo: extractEpisodesFromTitle(torrent.title)
  }));

  // Filter by minimum score
  const filtered = scored.filter(t => t.matchScore >= minScore);

  // Sort by score (descending), then seeders
  filtered.sort((a, b) => {
    // Trusted preference
    if (preferTrusted) {
      if (a.trusted && !b.trusted) return -1;
      if (!a.trusted && b.trusted) return 1;
    }

    // Score
    if (b.matchScore !== a.matchScore) {
      return b.matchScore - a.matchScore;
    }

    // Seeders as tiebreaker
    return (b.seeders || 0) - (a.seeders || 0);
  });

  return filtered.slice(0, limit);
}

/**
 * Format episode info for display
 * @param {EpisodeInfo} info - Episode info
 * @returns {string}
 */
export function formatEpisodeInfo(info) {
  const parts = [];

  if (info.season !== null) {
    parts.push(`Season ${info.season}`);
  }

  if (info.episodes.length > 0) {
    if (info.episodes.length === 1) {
      parts.push(`Episode ${info.episodes[0]}`);
    } else if (info.isRange && info.episodes.length > 2) {
      parts.push(`Episodes ${info.episodes[0]}-${info.episodes[info.episodes.length - 1]}`);
    } else {
      parts.push(`Episodes ${info.episodes.join(', ')}`);
    }
  }

  return parts.length > 0 ? parts.join(' ') : 'All episodes';
}

export default {
  parseEpisodeInput,
  extractEpisodesFromTitle,
  scoreTorrentMatch,
  findBestTorrents,
  formatEpisodeInfo
};
