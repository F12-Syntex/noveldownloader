/**
 * UI Screens Index
 * Export all screen modules
 */

export { showMainMenu } from './main-menu.js';
export {
  showContentTypeSelection,
  selectSourceForType,
  contentTypeFlow
} from './content-type-select.js';
export { showSourceSelect, showSourceManagement } from './source-select.js';
export {
  showDownloadMethod,
  performSearch,
  performBrowse,
  performUrlFetch,
  searchFlow
} from './search.js';
export {
  showContentDetails,
  selectChapters,
  selectTorrentFiles,
  createProgressDisplay,
  showTorrentProgress,
  downloadContent,
  downloadTorrent,
  handleFailedChapters
} from './download.js';
export {
  showDownloadsList,
  showDownloadManagement,
  showDownloadStats
} from './downloads-list.js';
export {
  selectExportFormat,
  selectContentToExport,
  configureExportOptions,
  showExportProgress,
  executeExport,
  exportFlow
} from './export.js';
export { showSettings } from './settings.js';

export default {
  mainMenu: await import('./main-menu.js'),
  sourceSelect: await import('./source-select.js'),
  search: await import('./search.js'),
  download: await import('./download.js'),
  downloadsList: await import('./downloads-list.js'),
  export: await import('./export.js'),
  settings: await import('./settings.js')
};
