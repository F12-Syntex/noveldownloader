/**
 * Main Menu Screen
 * Displays the main application menu with options based on active source
 */

import {
  getBanner,
  buildMainMenuChoices,
  selectMenu
} from '../components/index.js';
import { getActiveSource } from '../../core/sources/manager.js';

/**
 * Display the main menu and get user selection
 * @returns {Promise<string>} Selected action
 */
export async function showMainMenu() {
  const source = getActiveSource();

  // Display banner
  console.log(getBanner(source));

  // Build and display menu
  const choices = buildMainMenuChoices(source);

  const selection = await selectMenu(
    'What would you like to do?',
    choices,
    { pageSize: 15 }
  );

  return selection;
}

export default { showMainMenu };
