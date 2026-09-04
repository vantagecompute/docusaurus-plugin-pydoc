#!/usr/bin/env node
/**
 * Standalone entry point, for generating the reference without a Docusaurus build.
 *
 * Usage:
 *   node src/generate.js --project-root .. --output-dir ./docs/sdk-reference \
 *     --modules slurm_mcp.app,slurm_mcp.auth --label slurm_mcp --position 1
 */
const path = require('path');
const {generateDocs} = require('./generator');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    args[key] = argv[i + 1];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(process.cwd(), args['project-root'] || '..');
  const outputDir = path.resolve(process.cwd(), args['output-dir'] || './docs/sdk-reference');
  const modules = (args.modules || '').split(',').map((m) => m.trim()).filter(Boolean);

  if (modules.length === 0) {
    console.error('generate.js: --modules is required (comma-separated dotted names)');
    process.exit(2);
  }

  const position = args.position === undefined ? undefined : Number(args.position);
  if (position !== undefined && !Number.isFinite(position)) {
    console.error('generate.js: --position must be a number');
    process.exit(2);
  }

  await generateDocs({
    projectRoot,
    modules,
    outputDir,
    label: args.label,
    position,
    python: args.python || 'python3',
    strict: args.strict !== 'false',
  });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
