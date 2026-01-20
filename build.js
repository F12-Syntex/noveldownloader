/**
 * Build script for creating standalone executables and installers
 */

import * as esbuild from 'esbuild';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

// Node.js built-in modules to mark as external
const nodeBuiltins = [
    'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram', 'dns',
    'domain', 'events', 'fs', 'http', 'https', 'net', 'os', 'path', 'punycode',
    'querystring', 'readline', 'stream', 'string_decoder', 'timers', 'tls',
    'tty', 'url', 'util', 'v8', 'vm', 'zlib', 'fs/promises', 'node:sqlite'
];

// Common Inno Setup paths (including various installation methods)
const INNO_PATHS = [
    // Winget / user install locations (most common)
    process.env.LOCALAPPDATA + '\\Programs\\Inno Setup 6\\ISCC.exe',
    process.env.USERPROFILE + '\\AppData\\Local\\Programs\\Inno Setup 6\\ISCC.exe',
    // System-wide installs
    'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
    'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
    'C:\\Program Files (x86)\\Inno Setup 5\\ISCC.exe',
    'C:\\Program Files\\Inno Setup 5\\ISCC.exe',
    // Scoop install location
    process.env.USERPROFILE + '\\scoop\\apps\\inno-setup\\current\\ISCC.exe',
    // Chocolatey install location
    'C:\\ProgramData\\chocolatey\\lib\\InnoSetup\\tools\\ISCC.exe',
];

async function findInnoSetup() {
    // Try PATH first
    try {
        await execAsync('where iscc');
        return 'iscc';
    } catch {}

    // Try common installation paths
    for (const innoPath of INNO_PATHS) {
        try {
            await fs.access(innoPath);
            return `"${innoPath}"`;
        } catch {}
    }

    return null;
}

async function build() {
    const args = process.argv.slice(2);
    const skipInstaller = args.includes('--no-installer');
    const installerOnly = args.includes('--installer-only');

    console.log('🔨 Building Novel Downloader...\n');

    // Ensure dist directory exists
    await fs.mkdir('dist', { recursive: true });

    if (!installerOnly) {
        // Step 1: Bundle with esbuild
        console.log('📦 Step 1: Bundling with esbuild...');

        try {
            await esbuild.build({
                entryPoints: ['src/index.js'],
                bundle: true,
                platform: 'node',
                target: 'node18',
                outfile: 'dist/noveldownloader.cjs',
                format: 'cjs',
                minify: false,
                sourcemap: false,
                // Externalize node: protocol imports that pkg can't handle
                external: ['node:sqlite'],
                // Handle import.meta.url for ESM compatibility
                define: {
                    'import.meta.url': 'undefined'
                },
                // No banner needed for pkg
                banner: {
                    js: '"use strict";'
                },
                // Ignore optional dependencies that may not exist
                plugins: [{
                    name: 'ignore-optional',
                    setup(build) {
                        // Mark node:sqlite as external and empty
                        build.onResolve({ filter: /^node:sqlite$/ }, () => ({
                            path: 'node:sqlite',
                            external: true,
                            sideEffects: false
                        }));
                    }
                }]
            });
            console.log('   ✓ Bundle created: dist/noveldownloader.cjs\n');

            // Post-process: Remove/mock node:sqlite references that pkg can't handle
            let bundleContent = await fs.readFile('dist/noveldownloader.cjs', 'utf-8');
            bundleContent = bundleContent.replace(
                /require\(["']node:sqlite["']\)/g,
                '({})'  // Replace with empty object
            );
            await fs.writeFile('dist/noveldownloader.cjs', bundleContent);
            console.log('   ✓ Bundle post-processed\n');
        } catch (err) {
            console.error('   ✗ Bundle failed:', err.message);
            process.exit(1);
        }

        // Step 2: Create executable with pkg
        console.log('🔧 Step 2: Creating executable with pkg...');
        console.log('   (This may take a while on first run as it downloads Node.js binaries)\n');

        try {
            // Use --no-bytecode to avoid compilation issues with bundled code
            const { stdout, stderr } = await execAsync(
                'npx pkg dist/noveldownloader.cjs --targets node18-win-x64 --output dist/NovelDownloader.exe --no-bytecode --public-packages "*" --public',
                { timeout: 600000 }
            );
            if (stdout) console.log(stdout);
            if (stderr && !stderr.includes('Fetching') && !stderr.includes('Warning')) console.log(stderr);

            // Check if exe was created
            const exeStats = await fs.stat('dist/NovelDownloader.exe');
            const sizeMB = (exeStats.size / (1024 * 1024)).toFixed(1);

            console.log(`   ✓ Executable created: dist/NovelDownloader.exe (${sizeMB} MB)\n`);
        } catch (err) {
            console.error('   ✗ Executable creation failed:', err.message);
            console.log('\n   Trying alternative approach...\n');

            try {
                await execAsync(
                    'npx pkg dist/noveldownloader.cjs --targets node18-win-x64 --output dist/NovelDownloader.exe --no-bytecode',
                    { timeout: 600000 }
                );
                console.log('   ✓ Executable created with alternative settings\n');
            } catch (err2) {
                console.error('   ✗ Alternative approach also failed:', err2.message);
                console.log('\n   The bundled JS file is still available at dist/noveldownloader.cjs');
                console.log('   Users can run it with: node dist/noveldownloader.cjs\n');
                if (!skipInstaller) {
                    console.log('   Skipping installer creation (no executable)\n');
                    return;
                }
            }
        }
    }

    // Step 3: Create installer with Inno Setup
    if (!skipInstaller) {
        console.log('📀 Step 3: Creating installer with Inno Setup...');

        const innoCompiler = await findInnoSetup();

        if (!innoCompiler) {
            console.log('   ⚠ Inno Setup not found!\n');
            console.log('   To create installers, install Inno Setup:');
            console.log('   • Download from: https://jrsoftware.org/isdl.php');
            console.log('   • Or run: winget install JRSoftware.InnoSetup\n');
            console.log('   After installing, run: npm run build:installer\n');
        } else {
            try {
                console.log(`   Using: ${innoCompiler}\n`);

                const { stdout, stderr } = await execAsync(
                    `${innoCompiler} installer.iss`,
                    { timeout: 300000 }
                );

                if (stdout) {
                    // Only show relevant output
                    const lines = stdout.split('\n').filter(l =>
                        l.includes('Successful') || l.includes('Output') || l.includes('bytes')
                    );
                    lines.forEach(l => console.log('   ' + l.trim()));
                }

                // Get installer size
                const installerPath = 'dist/NovelDownloader-Setup-1.0.0.exe';
                try {
                    const stats = await fs.stat(installerPath);
                    const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
                    console.log(`\n   ✓ Installer created: ${installerPath} (${sizeMB} MB)\n`);
                } catch {
                    console.log('\n   ✓ Installer created\n');
                }
            } catch (err) {
                console.error('   ✗ Installer creation failed:', err.message);
            }
        }
    }

    console.log('✅ Build complete!\n');
    console.log('Distribution files:');

    try {
        await fs.access('dist/NovelDownloader-Setup-1.0.0.exe');
        console.log('   dist/NovelDownloader-Setup-1.0.0.exe  - Windows Installer (recommended)');
    } catch {}

    try {
        await fs.access('dist/NovelDownloader.exe');
        console.log('   dist/NovelDownloader.exe              - Standalone executable');
    } catch {}

    try {
        await fs.access('dist/noveldownloader.cjs');
        console.log('   dist/noveldownloader.cjs              - Bundled JS (requires Node.js)');
    } catch {}

    console.log();
}

build().catch(console.error);
