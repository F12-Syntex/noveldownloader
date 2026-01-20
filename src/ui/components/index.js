/**
 * UI Components Index
 * Export all UI components from a single location
 */

// Banner components
export {
  drawBox,
  getBanner,
  getCompactBanner,
  sectionHeader,
  divider
} from './banner.js';

// Progress components
export {
  progressBar,
  downloadProgress,
  torrentProgress,
  spinner,
  loadingText,
  createInlineProgress,
  createProgressTracker
} from './progress.js';

// Menu components
export {
  separator,
  buildMainMenuChoices,
  buildDownloadMethodChoices,
  buildExportFormatChoices,
  buildSourceSelectionChoices,
  selectMenu,
  checkboxMenu,
  confirm as confirmMenu,
  input as menuInput
} from './menu.js';

// Prompt components
export {
  pressEnter,
  textInput,
  numberInput,
  passwordInput,
  confirm,
  select,
  multiSelect,
  editor,
  rangeInput,
  parseRange,
  urlInput,
  searchPrompt,
  folderPicker
} from './prompt.js';

// Status components
export {
  success,
  error,
  warning,
  info,
  detailsPanel,
  searchResults,
  torrentResults,
  downloadSummary,
  chapterList,
  fileList,
  errorDetails,
  statusList,
  sourceInfo,
  settingsPanel
} from './status.js';

// Default export with all components organized by category
export default {
  banner: await import('./banner.js'),
  progress: await import('./progress.js'),
  menu: await import('./menu.js'),
  prompt: await import('./prompt.js'),
  status: await import('./status.js')
};
