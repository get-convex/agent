#!/usr/bin/env node

/**
 * Pre-typecheck script that detects AI SDK v5 patterns and provides
 * helpful upgrade instructions before TypeScript errors confuse users.
 *
 * Run with: node scripts/check-upgrade.js [directory]
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

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
    } catch (e) {
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

function main() {
  const targetDir = process.argv[2] || process.cwd();
  const files = findFiles(targetDir);
  const allIssues = [];

  for (const file of files) {
    const issues = checkFile(file, targetDir);
    allIssues.push(...issues);
  }

  if (allIssues.length === 0) {
    console.log('✅ No AI SDK v5 patterns detected. Ready for v6!');
    process.exit(0);
  }

  console.error('\n' + '='.repeat(70));
  console.error('⚠️  AI SDK v5 → v6 UPGRADE REQUIRED');
  console.error('='.repeat(70));
  console.error('\nFound', allIssues.length, 'pattern(s) that need updating:\n');

  for (const issue of allIssues) {
    console.error(`📍 ${issue.file}:${issue.line}:${issue.col}`);
    console.error(`   ${issue.message}`);
    console.error(`   Fix: ${issue.fix}`);
    console.error('');
  }

  console.error('='.repeat(70));
  console.error('📚 Full upgrade guide: https://github.com/get-convex/agent/blob/main/MIGRATION.md');
  console.error('='.repeat(70) + '\n');

  process.exit(1);
}

main();
