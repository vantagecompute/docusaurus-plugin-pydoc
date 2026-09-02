const {execFileSync} = require('child_process');
const fs = require('fs');
const path = require('path');
const {renderModulePage, renderIndexPage} = require('./renderer');

const INTROSPECT = path.join(__dirname, 'introspect.py');

/**
 * Generates one Markdown page per module plus an index.
 *
 * Unlike this plugin's Go sibling, a failure here is fatal by default. That sibling warns
 * and continues on a per-package failure, which means a missing toolchain or a bad
 * credential produces a green build publishing an SDK reference with no packages in it,
 * and the consuming repository has to add a verification step to notice. Failing the
 * build is the behaviour that does not need a workaround downstream. `strict: false`
 * restores the warn-and-continue behaviour for anyone who wants it.
 */
async function generateDocs(options) {
  const {projectRoot, modules, outputDir, python = 'python3', strict = true} = options;

  if (!Array.isArray(modules) || modules.length === 0) {
    throw new Error('[pydoc] no modules configured; nothing to document');
  }

  fs.mkdirSync(outputDir, {recursive: true});

  const args = ['--root', projectRoot];
  for (const mod of modules) {
    args.push('--module', typeof mod === 'string' ? mod : mod.module);
  }

  let payload;
  try {
    payload = execFileSync(python, [INTROSPECT, ...args], {
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // execFileSync puts the child's stderr on err.stderr, which is where introspect.py
    // writes the reason. Surfacing it matters: the common failures are a mistyped module
    // name and a source file the parser could not read, and both name themselves.
    const reason = (err.stderr || err.message || '').toString().trim();
    const message = `[pydoc] introspection failed: ${reason}`;
    if (strict) {
      throw new Error(message);
    }
    console.warn(message);
    return;
  }

  const parsed = JSON.parse(payload);
  const labels = new Map(
    modules.filter((mod) => typeof mod !== 'string').map((mod) => [mod.module, mod.label]),
  );

  const moduleDocs = [];
  for (const mod of parsed.modules) {
    const label = labels.get(mod.module) || mod.module;
    const filename = `${mod.module.replace(/\./g, '-')}.md`;
    fs.writeFileSync(path.join(outputDir, filename), renderModulePage(mod, label), 'utf8');
    moduleDocs.push({
      module: mod.module,
      label,
      filename,
      overview: mod.overview,
      classes: mod.classes.length,
      functions: mod.functions.length,
    });
  }

  fs.writeFileSync(path.join(outputDir, 'index.md'), renderIndexPage(moduleDocs), 'utf8');

  const empty = moduleDocs.filter((mod) => mod.classes === 0 && mod.functions === 0);
  if (strict && empty.length === moduleDocs.length) {
    throw new Error(
      `[pydoc] every requested module documented zero classes and zero functions ` +
        `(${empty.map((mod) => mod.module).join(', ')}); this is almost always a wrong ` +
        `projectRoot or a src-layout mismatch rather than genuinely empty modules`,
    );
  }

  console.log(`[pydoc] generated docs for ${moduleDocs.length} modules`);
}

module.exports = {generateDocs};
