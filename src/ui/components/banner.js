/**
 * Banner Component
 * Main application banner with source info
 */

import {
  colors,
  box,
  stripAnsi,
  getContentIcon,
  getAppTitle,
  getAppSubtitle
} from '../theme/index.js';

/**
 * Draw a box around text lines
 */
export function drawBox(lines, options = {}) {
  const {
    width = 60,
    padding = 1,
    borderColor = colors.primary
  } = options;

  const innerWidth = width - 2;
  const output = [];

  // Top border
  output.push(borderColor(`${box.topLeft}${box.horizontal.repeat(innerWidth)}${box.topRight}`));

  // Padding lines
  for (let i = 0; i < padding; i++) {
    output.push(borderColor(box.vertical) + ' '.repeat(innerWidth) + borderColor(box.vertical));
  }

  // Content lines
  for (const line of lines) {
    const stripped = stripAnsi(line);
    const paddingNeeded = innerWidth - stripped.length - 2;
    const leftPad = ' ';
    const rightPad = ' '.repeat(Math.max(0, paddingNeeded));
    output.push(borderColor(box.vertical) + leftPad + line + rightPad + borderColor(box.vertical));
  }

  // Bottom padding
  for (let i = 0; i < padding; i++) {
    output.push(borderColor(box.vertical) + ' '.repeat(innerWidth) + borderColor(box.vertical));
  }

  // Bottom border
  output.push(borderColor(`${box.bottomLeft}${box.horizontal.repeat(innerWidth)}${box.bottomRight}`));

  return output.join('\n');
}

/**
 * Create the main application banner
 * @param {Object} source - Active source configuration
 * @returns {string}
 */
export function getBanner(source) {
  const contentType = source?.contentType || 'novel';
  const sourceName = source?.name || 'No source selected';
  const icon = getContentIcon(contentType);

  const title = getAppTitle(contentType);
  const subtitle = getAppSubtitle(contentType);

  const lines = [
    colors.highlight(title),
    colors.muted(subtitle),
    '',
    `${icon}  ${colors.warning('Source:')} ${colors.highlight(sourceName)}`
  ];

  return '\n' + drawBox(lines, { width: 62, padding: 1 }) + '\n';
}

/**
 * Create a compact banner (for sub-screens)
 */
export function getCompactBanner(source, screenTitle) {
  const contentType = source?.contentType || 'novel';
  const icon = getContentIcon(contentType);
  const sourceName = source?.name || 'Unknown';

  return `${icon} ${colors.highlight(screenTitle)} ${colors.muted('|')} ${colors.muted(sourceName)}`;
}

/**
 * Create a section header
 */
export function sectionHeader(title) {
  const line = box.horizontal.repeat(3);
  return colors.primary(`${line} ${colors.highlight(title)} ${line}`);
}

/**
 * Create a divider line
 */
export function divider(width = 50) {
  return colors.muted(box.horizontal.repeat(width));
}

export default {
  drawBox,
  getBanner,
  getCompactBanner,
  sectionHeader,
  divider
};
