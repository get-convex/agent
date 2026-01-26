#!/usr/bin/env node
/* eslint-disable no-undef */

/**
 * Pre-typecheck script that detects AI SDK v5 patterns and provides
 * helpful upgrade instructions before TypeScript errors confuse users.
 *
 * Run with: node scripts/check-upgrade.js [directory]
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

// Known provider packages and their AI SDK v6 compatible versions
const PROVIDER_COMPATIBILITY = {
  '@ai-sdk/openai': { minV6Version: '3.0.0', v5Range: '^1.0.0 || ^2.0.0' },
  '@ai-sdk/anthropic': { minV6Version: '3.0.0', v5Range: '^1.0.0 || ^2.0.0' },
  '@ai-sdk/groq': { minV6Version: '3.0.0', v5Range: '^1.0.0 || ^2.0.0' },
  '@ai-sdk/google': { minV6Version: '3.0.0', v5Range: '^1.0.0 || ^2.0.0' },
  '@ai-sdk/mistral': { minV6Version: '3.0.0', v5Range: '^1.0.0 || ^2.0.0' },
  '@ai-sdk/cohere': { minV6Version: '3.0.0', v5Range: '^1.0.0 || ^2.0.0' },
  '@openrouter/ai-sdk-provider': { minV6Version: '2.0.0', v5Range: '^1.0.0' },
};

const V5_PATTERNS = [
  {
    pattern: /LanguageModelV2/g,
    message: 'LanguageModelV2 → LanguageModelV3',
    fix: "Change 'LanguageModelV2' to 'LanguageModelV3' (or just use 'LanguageModel' from 'ai')",
  },
  {
    pattern: /EmbeddingModel\s*<\s*string\s*>/g,
    message: 'EmbeddingModel<string> → EmbeddingModel',
    fix: "Remove the generic parameter: 'EmbeddingModel<string>' → 'EmbeddingModel'",
  },
  {
    pattern: /textEmbeddingModel\s*:/g,
    message: 'textEmbeddingModel → embeddingModel',
    fix: "Rename 'textEmbeddingModel' to 'embeddingModel' in your Agent config",
  },
  {
    pattern: /createTool\(\s*\{[^}]*\bargs\s*:/gs,
    message: 'createTool args → inputSchema',
    fix: "In createTool(), rename 'args' to 'inputSchema'",
  },
  {
    pattern: /\bhandler\s*:\s*async\s*\(/g,
    message: 'createTool handler → execute',
    fix: "In createTool(), rename 'handler' to 'execute' and update signature: execute: async (ctx, input, options)",
  },
  {
    pattern: /@ai-sdk\/provider['"];\s*$/gm,
    message: '@ai-sdk/provider v2 types',
    fix: "Update @ai-sdk/* packages to v3.x: npm install @ai-sdk/openai@^3.0.10",
    filePattern: /\.(ts|tsx)$/,
  },
];

function findFiles(dir, extensions = ['.ts', '.tsx']) {
  const files = [];

  function walk(currentDir) {
    try {
      const entries = readdirSync(currentDir);
      for (const entry of entries) {
        if (entry === 'node_modules' || entry === '_generated' || entry.startsWith('.')) {
          continue;
        }
        const fullPath = join(currentDir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          walk(fullPath);
        } else if (extensions.some(ext => entry.endsWith(ext))) {
          files.push(fullPath);
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  walk(dir);
  return files;
}

function checkFile(filePath, baseDir) {
  const content = readFileSync(filePath, 'utf-8');
  const issues = [];

  for (const { pattern, message, fix, filePattern } of V5_PATTERNS) {
    if (filePattern && !filePattern.test(filePath)) {
      continue;
    }

    // Reset regex state
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(content)) !== null) {
      const lines = content.slice(0, match.index).split('\n');
      const line = lines.length;
      const col = lines[lines.length - 1].length + 1;

      issues.push({
        file: relative(baseDir, filePath),
        line,
        col,
        message,
        fix,
        match: match[0].slice(0, 50),
      });
    }
  }

  return issues;
}

function checkPackageJson(targetDir) {
  const issues = [];
  const pkgPath = join(targetDir, 'package.json');

  try {
    const content = readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    for (const [name, compatibility] of Object.entries(PROVIDER_COMPATIBILITY)) {
      const version = deps[name];
      if (!version) continue;

      // Extract major version from version string (handles ^, ~, etc.)
      const match = version.match(/(\d+)\./);
      if (!match) continue;

      const majorVersion = parseInt(match[1], 10);
      const minMajor = parseInt(compatibility.minV6Version.split('.')[0], 10);

      if (majorVersion < minMajor) {
        issues.push({
          file: 'package.json',
          package: name,
          currentVersion: version,
          requiredVersion: `^${compatibility.minV6Version}`,
          message: `${name}@${version} is incompatible with AI SDK v6`,
          fix: `npm install ${name}@^${compatibility.minV6Version}`,
        });
      }
    }

    // Check for ai package version
    const aiVersion = deps['ai'];
    if (aiVersion) {
      const match = aiVersion.match(/(\d+)\./);
      if (match && parseInt(match[1], 10) < 6) {
        issues.push({
          file: 'package.json',
          package: 'ai',
          currentVersion: aiVersion,
          requiredVersion: '^6.0.0',
          message: `ai@${aiVersion} needs to be updated to v6`,
          fix: 'npm install ai@^6.0.35',
        });
      }
    }
  } catch {
    // package.json doesn't exist or isn't readable
  }

  return issues;
}

function main() {
  const targetDir = process.argv[2] || process.cwd();
  const files = findFiles(targetDir);
  const allIssues = [];
  const pkgIssues = checkPackageJson(targetDir);

  for (const file of files) {
    const issues = checkFile(file, targetDir);
    allIssues.push(...issues);
  }

  if (allIssues.length === 0 && pkgIssues.length === 0) {
    console.log('✅ No AI SDK v5 patterns detected. Ready for v6!');
    process.exit(0);
  }

  console.error('\n' + '='.repeat(70));
  console.error('⚠️  AI SDK v5 → v6 UPGRADE REQUIRED');
  console.error('='.repeat(70));

  if (pkgIssues.length > 0) {
    console.error('\n📦 Package dependency issues:\n');
    for (const issue of pkgIssues) {
      console.error(`   ${issue.package}: ${issue.currentVersion} → ${issue.requiredVersion}`);
      console.error(`   Fix: ${issue.fix}`);
      console.error('');
    }
  }

  if (allIssues.length > 0) {
    console.error('\n📝 Code patterns that need updating:\n');
    for (const issue of allIssues) {
      console.error(`📍 ${issue.file}:${issue.line}:${issue.col}`);
      console.error(`   ${issue.message}`);
      console.error(`   Fix: ${issue.fix}`);
      console.error('');
    }
  }

  console.error('='.repeat(70));
  console.error('📚 Full upgrade guide: https://github.com/get-convex/agent/blob/main/MIGRATION.md');
  console.error('='.repeat(70) + '\n');

  process.exit(1);
}

main();
