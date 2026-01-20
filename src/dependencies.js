/**
 * Dependencies Module
 * Check and install required dependencies for novel export
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';
import inquirer from 'inquirer';

const execAsync = promisify(exec);

/**
 * Dependency definitions
 */
const DEPENDENCIES = {
    pandoc: {
        name: 'Pandoc',
        description: 'Universal document converter (required for all exports)',
        required: true,
        checkCmd: 'pandoc --version',
        wingetId: 'JohnMacFarlane.Pandoc',
        downloadUrl: 'https://pandoc.org/installing.html',
        formats: ['EPUB', 'PDF', 'DOCX', 'ODT', 'HTML', 'TXT', 'RTF', 'AZW3', 'MOBI']
    },
    latex: {
        name: 'MiKTeX (LaTeX)',
        description: 'LaTeX distribution for PDF generation with CJK support',
        required: false,
        checkCmd: 'xelatex --version',
        wingetId: 'MiKTeX.MiKTeX',
        downloadUrl: 'https://miktex.org/download',
        formats: ['PDF'],
        postInstall: 'After installation, run MiKTeX Console and set "Install missing packages on-the-fly" to "Yes"'
    },
    calibre: {
        name: 'Calibre',
        description: 'E-book management (required for Kindle formats)',
        required: false,
        checkCmd: 'ebook-convert --version',
        wingetId: 'calibre.calibre',
        downloadUrl: 'https://calibre-ebook.com/download',
        formats: ['AZW3', 'MOBI']
    }
};

/**
 * Check if a command exists
 */
async function commandExists(cmd) {
    try {
        await execAsync(cmd, { timeout: 10000 });
        return true;
    } catch {
        return false;
    }
}

/**
 * Get version of a dependency
 */
async function getVersion(cmd) {
    try {
        const { stdout } = await execAsync(cmd, { timeout: 10000 });
        const firstLine = stdout.split('\n')[0].trim();
        return firstLine;
    } catch {
        return null;
    }
}

/**
 * Check all dependencies and return status
 */
export async function checkAllDependencies() {
    const results = {};

    for (const [key, dep] of Object.entries(DEPENDENCIES)) {
        const installed = await commandExists(dep.checkCmd);
        let version = null;

        if (installed) {
            version = await getVersion(dep.checkCmd);
        }

        results[key] = {
            ...dep,
            key,
            installed,
            version
        };
    }

    return results;
}

/**
 * Check if winget is available
 */
async function checkWinget() {
    try {
        await execAsync('winget --version');
        return true;
    } catch {
        return false;
    }
}

/**
 * Install a dependency using winget
 */
async function installWithWinget(dep) {
    console.log(chalk.cyan(`\nInstalling ${dep.name}...`));
    console.log(chalk.gray(`Running: winget install ${dep.wingetId}\n`));

    try {
        const { stdout, stderr } = await execAsync(
            `winget install ${dep.wingetId} --accept-package-agreements --accept-source-agreements`,
            { timeout: 600000 } // 10 minute timeout for large installs
        );
        console.log(stdout);
        if (stderr) console.log(chalk.yellow(stderr));
        return true;
    } catch (err) {
        console.log(chalk.red(`Installation failed: ${err.message}`));
        return false;
    }
}

/**
 * Display dependency status
 */
export function displayDependencyStatus(deps) {
    console.log(chalk.cyan('\n━━━ Dependency Status ━━━\n'));

    for (const [key, dep] of Object.entries(deps)) {
        const status = dep.installed
            ? chalk.green('✓ Installed')
            : (dep.required ? chalk.red('✗ Missing (required)') : chalk.yellow('○ Not installed'));

        console.log(chalk.white.bold(dep.name));
        console.log(chalk.gray(`  ${dep.description}`));
        console.log(`  Status: ${status}`);

        if (dep.installed && dep.version) {
            console.log(chalk.gray(`  Version: ${dep.version}`));
        }

        console.log(chalk.gray(`  Used for: ${dep.formats.join(', ')}`));
        console.log();
    }
}

/**
 * Interactive dependency manager
 */
export async function manageDependencies() {
    console.clear();
    console.log(chalk.cyan('━━━ Dependencies ━━━\n'));

    console.log(chalk.gray('Checking installed dependencies...\n'));

    const deps = await checkAllDependencies();
    displayDependencyStatus(deps);

    const missingDeps = Object.values(deps).filter(d => !d.installed);
    const hasWinget = await checkWinget();

    if (missingDeps.length === 0) {
        console.log(chalk.green('All dependencies are installed!'));
        return;
    }

    // Show options
    const choices = [];

    if (hasWinget) {
        if (missingDeps.length > 0) {
            choices.push({
                name: `Install all missing (${missingDeps.length})`,
                value: 'all'
            });
        }

        for (const dep of missingDeps) {
            choices.push({
                name: `Install ${dep.name}`,
                value: dep.key
            });
        }

        choices.push(new inquirer.Separator());
    }

    choices.push({
        name: 'Show manual installation instructions',
        value: 'manual'
    });

    choices.push(new inquirer.Separator());
    choices.push({
        name: chalk.gray('← Back to menu'),
        value: 'back'
    });

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: hasWinget
                ? 'What would you like to do?'
                : 'Winget not found. What would you like to do?',
            choices,
            loop: false
        }
    ]);

    if (action === 'back') return;

    if (action === 'manual') {
        showManualInstructions(missingDeps);
        return;
    }

    if (action === 'all') {
        for (const dep of missingDeps) {
            const success = await installWithWinget(dep);
            if (success && dep.postInstall) {
                console.log(chalk.yellow(`\nNote: ${dep.postInstall}`));
            }
        }
    } else {
        const dep = deps[action];
        const success = await installWithWinget(dep);
        if (success && dep.postInstall) {
            console.log(chalk.yellow(`\nNote: ${dep.postInstall}`));
        }
    }

    // Re-check and show status
    console.log(chalk.gray('\nVerifying installation...\n'));
    const newDeps = await checkAllDependencies();
    displayDependencyStatus(newDeps);
}

/**
 * Show manual installation instructions
 */
function showManualInstructions(missingDeps) {
    console.log(chalk.cyan('\n━━━ Manual Installation Instructions ━━━\n'));

    for (const dep of missingDeps) {
        console.log(chalk.white.bold(dep.name));
        console.log(chalk.gray(`  Download from: ${dep.downloadUrl}`));

        if (dep.wingetId) {
            console.log(chalk.gray(`  Or via winget: winget install ${dep.wingetId}`));
        }

        if (dep.postInstall) {
            console.log(chalk.yellow(`  Note: ${dep.postInstall}`));
        }

        console.log();
    }

    console.log(chalk.cyan('━━━ Winget Installation ━━━\n'));
    console.log(chalk.gray('If you don\'t have winget, you can install it from:'));
    console.log(chalk.gray('  https://aka.ms/getwinget'));
    console.log(chalk.gray('  Or from Microsoft Store (App Installer)'));
    console.log();
}

/**
 * Quick check - returns true if all required deps are installed
 */
export async function hasRequiredDependencies() {
    for (const [key, dep] of Object.entries(DEPENDENCIES)) {
        if (dep.required) {
            const installed = await commandExists(dep.checkCmd);
            if (!installed) return false;
        }
    }
    return true;
}

/**
 * Get missing dependencies for a specific format
 */
export async function getMissingDepsForFormat(format) {
    const missing = [];

    for (const [key, dep] of Object.entries(DEPENDENCIES)) {
        if (dep.formats.includes(format.toUpperCase())) {
            const installed = await commandExists(dep.checkCmd);
            if (!installed) {
                missing.push(dep);
            }
        }
    }

    return missing;
}
