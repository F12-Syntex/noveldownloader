/**
 * Prompt Component
 * User input and interaction utilities
 */

import inquirer from 'inquirer';
import { exec } from 'child_process';
import { promisify } from 'util';
import { colors, promptConfig } from '../theme/index.js';

const execAsync = promisify(exec);

/**
 * Wait for user to press enter
 * @param {string} message - Message to display
 */
export async function pressEnter(message = 'Press Enter to continue...') {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(colors.muted(`\n${message}`), () => {
      rl.close();
      resolve();
    });
  });
}

/**
 * Prompt for text input
 * @param {string} message - Prompt message
 * @param {Object} options - Additional options
 */
export async function textInput(message, options = {}) {
  const promptOptions = {
    type: 'input',
    name: 'value',
    message
  };

  // Only add optional properties if they are defined
  if (options.default !== undefined) promptOptions.default = options.default;
  if (options.validate) promptOptions.validate = options.validate;
  if (options.filter) promptOptions.filter = options.filter;

  const { value } = await inquirer.prompt([promptOptions]);
  return value;
}

/**
 * Prompt for number input
 * @param {string} message - Prompt message
 * @param {Object} options - Additional options
 */
export async function numberInput(message, options = {}) {
  const { value } = await inquirer.prompt([{
    type: 'number',
    name: 'value',
    message,
    default: options.default,
    validate: (input) => {
      if (isNaN(input)) return 'Please enter a valid number';
      if (options.min !== undefined && input < options.min) {
        return `Value must be at least ${options.min}`;
      }
      if (options.max !== undefined && input > options.max) {
        return `Value must be at most ${options.max}`;
      }
      if (options.validate) return options.validate(input);
      return true;
    }
  }]);
  return value;
}

/**
 * Prompt for password input (hidden)
 * @param {string} message - Prompt message
 */
export async function passwordInput(message) {
  const { value } = await inquirer.prompt([{
    type: 'password',
    name: 'value',
    message,
    mask: '*'
  }]);
  return value;
}

/**
 * Prompt for confirmation
 * @param {string} message - Prompt message
 * @param {boolean} defaultValue - Default value
 */
export async function confirm(message, defaultValue = false) {
  const { value } = await inquirer.prompt([{
    type: 'confirm',
    name: 'value',
    message,
    default: defaultValue
  }]);
  return value;
}

/**
 * Prompt for single selection
 * @param {string} message - Prompt message
 * @param {Array} choices - Selection choices
 * @param {Object} options - Additional options
 */
export async function select(message, choices, options = {}) {
  const { value } = await inquirer.prompt([{
    type: 'list',
    name: 'value',
    message,
    choices,
    ...promptConfig(options)
  }]);
  return value;
}

/**
 * Prompt for multiple selection
 * @param {string} message - Prompt message
 * @param {Array} choices - Selection choices
 * @param {Object} options - Additional options
 */
export async function multiSelect(message, choices, options = {}) {
  const promptOptions = {
    type: 'checkbox',
    name: 'values',
    message,
    choices,
    ...promptConfig(options)
  };

  // Only add validate if required is true
  if (options.required) {
    promptOptions.validate = (input) => {
      if (input.length === 0) return 'Please select at least one option';
      return true;
    };
  }

  const { values } = await inquirer.prompt([promptOptions]);
  return values;
}

/**
 * Prompt for editor input (opens text editor)
 * @param {string} message - Prompt message
 * @param {string} defaultValue - Default text
 */
export async function editor(message, defaultValue = '') {
  const { value } = await inquirer.prompt([{
    type: 'editor',
    name: 'value',
    message,
    default: defaultValue
  }]);
  return value;
}

/**
 * Prompt for range selection (chapter ranges, etc.)
 * Supports formats: "1-10", "1,3,5", "1-5,10,15-20"
 * @param {string} message - Prompt message
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 */
export async function rangeInput(message, min, max) {
  const { value } = await inquirer.prompt([{
    type: 'input',
    name: 'value',
    message: `${message} (e.g., "1-10", "1,3,5", "all"):`,
    validate: (input) => {
      const trimmed = input.trim().toLowerCase();
      if (trimmed === '' || trimmed === 'all') return true;

      // Validate range format
      const parts = trimmed.split(',');
      for (const part of parts) {
        const range = part.trim().split('-');
        if (range.length === 1) {
          const num = parseInt(range[0]);
          if (isNaN(num) || num < min || num > max) {
            return `Invalid number: ${range[0]}. Must be between ${min} and ${max}`;
          }
        } else if (range.length === 2) {
          const start = parseInt(range[0]);
          const end = parseInt(range[1]);
          if (isNaN(start) || isNaN(end)) {
            return `Invalid range: ${part}`;
          }
          if (start < min || end > max || start > end) {
            return `Invalid range: ${part}. Must be between ${min} and ${max}`;
          }
        } else {
          return `Invalid format: ${part}`;
        }
      }
      return true;
    }
  }]);

  return parseRange(value, min, max);
}

/**
 * Parse a range string into array of numbers
 * @param {string} rangeStr - Range string
 * @param {number} min - Minimum value (for "all")
 * @param {number} max - Maximum value (for "all")
 * @returns {number[]}
 */
export function parseRange(rangeStr, min = 1, max = Infinity) {
  const trimmed = rangeStr.trim().toLowerCase();

  if (trimmed === '' || trimmed === 'all') {
    if (max === Infinity) return [];
    const result = [];
    for (let i = min; i <= max; i++) result.push(i);
    return result;
  }

  const numbers = new Set();
  const parts = trimmed.split(',');

  for (const part of parts) {
    const range = part.trim().split('-');
    if (range.length === 1) {
      numbers.add(parseInt(range[0]));
    } else if (range.length === 2) {
      const start = parseInt(range[0]);
      const end = parseInt(range[1]);
      for (let i = start; i <= end; i++) {
        numbers.add(i);
      }
    }
  }

  return Array.from(numbers).sort((a, b) => a - b);
}

/**
 * Prompt for URL input with validation
 * @param {string} message - Prompt message
 * @param {Object} options - Validation options
 */
export async function urlInput(message, options = {}) {
  const promptOptions = {
    type: 'input',
    name: 'value',
    message,
    validate: (input) => {
      if (!input.trim()) {
        return options.required ? 'URL is required' : true;
      }
      try {
        new URL(input);
        if (options.allowedHosts && options.allowedHosts.length > 0) {
          const url = new URL(input);
          if (!options.allowedHosts.includes(url.hostname)) {
            return `URL must be from: ${options.allowedHosts.join(', ')}`;
          }
        }
        return true;
      } catch {
        return 'Please enter a valid URL';
      }
    }
  };

  if (options.default !== undefined) promptOptions.default = options.default;

  const { value } = await inquirer.prompt([promptOptions]);
  return value;
}

/**
 * Create a search prompt with autocomplete-like behavior
 * @param {string} message - Prompt message
 * @param {Function} searchFn - Function that takes query and returns results
 */
export async function searchPrompt(message, searchFn) {
  // First get the search query
  const query = await textInput(message);
  if (!query.trim()) return null;

  // Then get results and let user select
  console.log(colors.muted('Searching...'));
  const results = await searchFn(query);

  if (!results || results.length === 0) {
    console.log(colors.warning('No results found'));
    return null;
  }

  return results;
}

/**
 * Open a native folder picker dialog
 * @param {string} title - Dialog title
 * @param {string} initialPath - Initial directory to open
 * @returns {Promise<string|null>} Selected folder path or null if cancelled
 */
export async function folderPicker(title = 'Select Folder', initialPath = '') {
  const platform = process.platform;

  try {
    if (platform === 'win32') {
      // Use PowerShell to open Windows folder browser dialog
      const psScript = `
        Add-Type -AssemblyName System.Windows.Forms
        $browser = New-Object System.Windows.Forms.FolderBrowserDialog
        $browser.Description = '${title.replace(/'/g, "''")}'
        $browser.RootFolder = 'MyComputer'
        ${initialPath ? `$browser.SelectedPath = '${initialPath.replace(/'/g, "''")}'` : ''}
        $browser.ShowNewFolderButton = $true
        $result = $browser.ShowDialog()
        if ($result -eq 'OK') {
          Write-Output $browser.SelectedPath
        }
      `.trim();

      const { stdout } = await execAsync(`powershell -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
        windowsHide: true
      });

      const selectedPath = stdout.trim();
      return selectedPath || null;

    } else if (platform === 'darwin') {
      // macOS: Use osascript to open native folder picker
      const script = `osascript -e 'POSIX path of (choose folder with prompt "${title}")'`;
      const { stdout } = await execAsync(script);
      return stdout.trim() || null;

    } else {
      // Linux: Try zenity or kdialog
      try {
        const { stdout } = await execAsync(`zenity --file-selection --directory --title="${title}"`);
        return stdout.trim() || null;
      } catch {
        try {
          const { stdout } = await execAsync(`kdialog --getexistingdirectory "${initialPath || '~'}" --title "${title}"`);
          return stdout.trim() || null;
        } catch {
          // Fall back to manual input
          console.log(colors.warning('No folder picker available. Please enter the path manually.'));
          return null;
        }
      }
    }
  } catch (err) {
    // User cancelled or error occurred
    return null;
  }
}

export default {
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
};
