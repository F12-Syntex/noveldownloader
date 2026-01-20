/**
 * Source Selection Screen
 * Displays sources grouped by content type and allows switching
 */

import {
  sectionHeader,
  buildSourceSelectionChoices,
  selectMenu,
  confirm,
  success,
  error,
  warning,
  sourceInfo
} from '../components/index.js';
import {
  getSources,
  getActiveSource,
  setActiveSource,
  setSourceEnabled,
  reloadSources
} from '../../core/sources/manager.js';
import { colors, menuChoice, backChoice, icons } from '../theme/index.js';

/**
 * Show source selection menu
 * @returns {Promise<boolean>} True if source was changed
 */
export async function showSourceSelect() {
  const sources = await getSources();
  const activeSource = getActiveSource();

  console.log('\n' + sectionHeader('Manage Sources'));
  console.log('');

  if (sources.length === 0) {
    console.log(warning('No sources found. Add source configurations to the sources/ directory.'));
    return false;
  }

  // Build choices grouped by type
  const choices = buildSourceSelectionChoices(sources, activeSource);

  const selection = await selectMenu(
    'Select a source to activate:',
    choices,
    { pageSize: 15 }
  );

  if (selection === null) {
    return false;
  }

  try {
    const newSource = await setActiveSource(selection);
    console.log(success(`Switched to ${newSource.name}`));
    return true;
  } catch (err) {
    console.log(error(err.message));
    return false;
  }
}

/**
 * Show source management menu with more options
 * @returns {Promise<string|null>}
 */
export async function showSourceManagement() {
  const sources = await getSources();
  const activeSource = getActiveSource();

  console.log('\n' + sectionHeader('Source Management'));
  console.log('');

  const choices = [
    menuChoice('Switch Active Source', 'switch', 'Change the current source'),
    menuChoice('View Source Info', 'info', 'See details about a source'),
    menuChoice('Enable/Disable Source', 'toggle', 'Toggle source availability'),
    menuChoice('Reload Sources', 'reload', 'Reload sources from disk'),
    backChoice('Back to Main Menu')
  ];

  const action = await selectMenu('What would you like to do?', choices);

  switch (action) {
    case 'switch':
      return await showSourceSelect();

    case 'info':
      return await showSourceInfo(sources);

    case 'toggle':
      return await showToggleSource(sources);

    case 'reload':
      return await reloadSourcesAction();

    default:
      return null;
  }
}

/**
 * Show detailed info about a source
 */
async function showSourceInfo(sources) {
  const choices = sources.map(s => ({
    name: `${s.enabled ? colors.success(icons.active) : colors.muted(icons.pending)} ${s.name}`,
    value: s.id
  }));
  choices.push(backChoice());

  const selection = await selectMenu('Select source to view:', choices);

  if (!selection) return null;

  const source = sources.find(s => s.id === selection);
  if (source) {
    console.log('\n' + sourceInfo(source));
  }

  return null;
}

/**
 * Toggle source enabled/disabled
 */
async function showToggleSource(sources) {
  const choices = sources.map(s => ({
    name: `${s.enabled ? colors.success('Enabled') : colors.error('Disabled')} - ${s.name}`,
    value: s.id
  }));
  choices.push(backChoice());

  const selection = await selectMenu('Select source to toggle:', choices);

  if (!selection) return null;

  const source = sources.find(s => s.id === selection);
  if (!source) return null;

  const newState = !source.enabled;
  const confirmed = await confirm(
    `${newState ? 'Enable' : 'Disable'} ${source.name}?`,
    true
  );

  if (confirmed) {
    try {
      await setSourceEnabled(source.id, newState);
      console.log(success(`${source.name} ${newState ? 'enabled' : 'disabled'}`));
    } catch (err) {
      console.log(error(err.message));
    }
  }

  return null;
}

/**
 * Reload sources from disk
 */
async function reloadSourcesAction() {
  console.log(colors.muted('Reloading sources...'));

  try {
    const sources = await reloadSources();
    console.log(success(`Loaded ${sources.length} source(s)`));
  } catch (err) {
    console.log(error(`Failed to reload: ${err.message}`));
  }

  return null;
}

export default {
  showSourceSelect,
  showSourceManagement
};
