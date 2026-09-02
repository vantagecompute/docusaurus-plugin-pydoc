const path = require('path');
const {generateDocs} = require('./generator');

/**
 * Docusaurus plugin that generates a Python SDK reference from docstrings.
 *
 * Option shape mirrors @vantagecompute/docusaurus-plugin-godoc, so a repository moving
 * between the two changes the module list and nothing else.
 *
 * @param {object} context Docusaurus plugin context; `siteDir` anchors relative paths.
 * @param {object} options
 * @param {string} options.projectRoot Project root, relative to the Docusaurus site dir.
 * @param {Array<string|{module: string, label?: string}>} options.modules Dotted module
 *   names to document, optionally with a display label.
 * @param {string} [options.outputDir='./docs/sdk-reference'] Where pages are written.
 * @param {string} [options.python='python3'] Interpreter used to run the introspector.
 *   It parses source and never imports it, so this need not be the project's own venv.
 * @param {boolean} [options.strict=true] Fail the build on an introspection failure.
 */
module.exports = function pluginPydoc(context, options) {
  const {
    projectRoot,
    modules = [],
    outputDir = './docs/sdk-reference',
    python = 'python3',
    strict = true,
  } = options;

  if (!projectRoot) {
    throw new Error('[pydoc] projectRoot is required');
  }

  const resolvedProjectRoot = path.resolve(context.siteDir, projectRoot);
  const resolvedOutputDir = path.resolve(context.siteDir, outputDir);

  return {
    name: 'docusaurus-plugin-pydoc',

    async loadContent() {
      await generateDocs({
        projectRoot: resolvedProjectRoot,
        modules,
        outputDir: resolvedOutputDir,
        python,
        strict,
      });
    },
  };
};
