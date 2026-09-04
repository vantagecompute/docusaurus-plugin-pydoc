/**
 * Renders the introspector's JSON into Docusaurus-compatible Markdown pages.
 *
 * Page shape deliberately matches @vantagecompute/docusaurus-plugin-godoc so a reader
 * moving between a Go spoke and a Python spoke on docs.vantagecompute.ai sees the same
 * furniture: the same frontmatter keys, the same "do not edit" marker, an Overview
 * section, then Constants, Classes and Functions, and an index carrying a package table.
 */

/** Escapes the characters that would otherwise break out of a Markdown table cell. */
function escapeCell(text) {
  return String(text).replace(/\|/g, '\\|').replace(/\n+/g, ' ');
}

//: Google-style section headers whose bodies are a list of named items. Their contents
//: become a Markdown list so each name keeps its own line.
const FIELD_SECTIONS = new Set([
  'Args',
  'Arguments',
  'Attributes',
  'Keyword Args',
  'Keyword Arguments',
  'Other Parameters',
  'Parameters',
  'Raises',
]);

//: Google-style section headers whose bodies are prose or a literal block. Their contents
//: are emitted as-is under a bold label, dedented so Markdown does not read the original
//: indentation as a code block.
const PROSE_SECTIONS = new Set([
  'Example',
  'Examples',
  'Note',
  'Notes',
  'References',
  'Returns',
  'See Also',
  'Todo',
  'Warning',
  'Warnings',
  'Warns',
  'Yields',
]);

const SECTION_HEADER = /^([A-Z][A-Za-z ]*?)\s*:\s*$/;
const FIELD_ITEM = /^(\S[^:]*?)\s*:\s*(.*)$/;
const FENCE = /^\s*(```|~~~)/;

/** Removes the common leading whitespace from a block of lines. */
function dedent(blockLines) {
  const populated = blockLines.filter((line) => line.trim() !== '');
  if (populated.length === 0) {
    return blockLines.map(() => '');
  }
  const indent = Math.min(...populated.map((line) => line.length - line.trimStart().length));
  return blockLines.map((line) => (line.trim() === '' ? '' : line.slice(indent)));
}

/**
 * Splits a field section's body into `[name, descriptionLines]` pairs.
 *
 * Returns null when the body does not parse as a list of named items, which is the signal
 * to fall back to emitting it verbatim rather than guessing.
 */
function parseFieldItems(blockLines) {
  const body = dedent(blockLines);
  const items = [];
  for (const line of body) {
    if (line.trim() === '') {
      if (items.length > 0) {
        items[items.length - 1].description.push('');
      }
      continue;
    }
    const isContinuation = /^\s/.test(line);
    const match = isContinuation ? null : FIELD_ITEM.exec(line);
    if (match) {
      items.push({name: match[1].trim(), description: match[2].trim() === '' ? [] : [match[2]]});
    } else if (items.length > 0) {
      items[items.length - 1].description.push(line);
    } else {
      return null;
    }
  }
  return items.length > 0 ? items : null;
}

/**
 * Whether a description block must keep its own line breaks rather than being joined.
 *
 * Google style wraps a long description across aligned continuation lines, which are just
 * one sentence and should be joined. A literal or fenced block is different, and both are
 * reliably marked by a blank line or a fence: a wrapped sentence never contains either.
 * Indentation alone is not the signal, because aligned continuations are deeply indented
 * by construction.
 */
function needsVerbatim(descriptionLines) {
  return descriptionLines.some((line) => FENCE.test(line) || line.trim() === '');
}

/** Renders one field item as a Markdown list entry. */
function renderFieldItem(item, out) {
  const description = item.description;
  const trailing = [...description];
  while (trailing.length > 0 && trailing[trailing.length - 1].trim() === '') {
    trailing.pop();
  }

  if (trailing.length === 0) {
    out.push(`- \`${item.name}\``);
    return;
  }

  if (!needsVerbatim(trailing)) {
    const joined = trailing.map((line) => line.trim()).filter(Boolean).join(' ');
    out.push(`- \`${item.name}\`: ${joined}`);
    return;
  }

  // A description carrying a fenced block or a literal block keeps its own lines. Two
  // spaces of indent is what keeps them inside the list item rather than ending it.
  out.push(`- \`${item.name}\`:`);
  out.push('');
  for (const line of dedent(trailing)) {
    out.push(line === '' ? '' : `  ${line}`);
  }
  out.push('');
}

/**
 * Converts Google-style docstring sections into Markdown, leaving everything else alone.
 *
 * The bodies of `Args:`, `Raises:` and their siblings are indented under a header, and
 * Markdown collapses that indentation into one run-on paragraph, so a reader of the
 * generated page loses every line break and every name boundary. Only the recognized
 * sections are touched here.
 *
 * Prose outside a recognized section is emitted verbatim, as are fenced code blocks
 * anywhere, and a section whose body does not parse falls back to verbatim too. Docstrings
 * are authored by the people who wrote the code, and reflowing them wholesale would mangle
 * the indented blocks, tables and reStructuredText roles that many of them contain.
 */
function formatDocstring(doc) {
  const source = String(doc).split('\n');
  const out = [];
  let index = 0;
  let inFence = false;

  while (index < source.length) {
    const line = source[index];

    if (FENCE.test(line)) {
      inFence = !inFence;
      out.push(line);
      index += 1;
      continue;
    }
    if (inFence) {
      out.push(line);
      index += 1;
      continue;
    }

    const header = SECTION_HEADER.exec(line);
    const name = header ? header[1].trim() : null;
    if (!name || (!FIELD_SECTIONS.has(name) && !PROSE_SECTIONS.has(name))) {
      out.push(line);
      index += 1;
      continue;
    }

    // Collect the indented body belonging to this header.
    const block = [];
    let cursor = index + 1;
    while (cursor < source.length) {
      const candidate = source[cursor];
      if (candidate.trim() === '' || /^\s/.test(candidate)) {
        block.push(candidate);
        cursor += 1;
        continue;
      }
      break;
    }
    while (block.length > 0 && block[block.length - 1].trim() === '') {
      block.pop();
    }

    if (block.length === 0) {
      out.push(line);
      index += 1;
      continue;
    }

    if (out.length > 0 && out[out.length - 1].trim() !== '') {
      out.push('');
    }
    out.push(`**${name}:**`);
    out.push('');

    const items = FIELD_SECTIONS.has(name) ? parseFieldItems(block) : null;
    if (items) {
      for (const item of items) {
        renderFieldItem(item, out);
      }
    } else {
      out.push(...dedent(block));
    }
    out.push('');

    index = cursor;
  }

  while (out.length > 0 && out[out.length - 1].trim() === '') {
    out.pop();
  }
  return out.join('\n');
}

/**
 * Renders a docstring for placement in a Markdown body.
 *
 * Recognized Google-style sections become Markdown; everything else is emitted verbatim.
 * See `formatDocstring`.
 */
function renderDoc(doc, lines) {
  if (!doc) {
    return;
  }
  lines.push(formatDocstring(doc));
  lines.push('');
}

/** Renders one module's page. */
function renderModulePage(mod, label) {
  const lines = [];

  lines.push('---');
  lines.push(`title: "Module: ${label}"`);
  lines.push(`description: "Python API documentation for ${mod.module}"`);
  lines.push('---');
  lines.push('');
  lines.push(`# Module \`${label}\``);
  lines.push('');
  lines.push('{/* Auto-generated by @vantagecompute/docusaurus-plugin-pydoc. Do not edit manually. */}');
  lines.push('');
  lines.push(`Source: \`${mod.source}\``);
  lines.push('');

  if (mod.overview) {
    lines.push('## Overview');
    lines.push('');
    renderDoc(mod.overview, lines);
  }

  if (mod.constants.length > 0) {
    lines.push('## Constants');
    lines.push('');
    for (const constant of mod.constants) {
      const annotation = constant.annotation ? `: ${constant.annotation}` : '';
      const value = constant.value ? ` = ${constant.value}` : '';
      lines.push('```python');
      lines.push(`${constant.name}${annotation}${value}`);
      lines.push('```');
      lines.push('');
    }
  }

  if (mod.classes.length > 0) {
    lines.push('## Classes');
    lines.push('');
    for (const cls of mod.classes) {
      const bases = cls.bases.length > 0 ? `(${cls.bases.join(', ')})` : '';
      lines.push(`### ${cls.name}`);
      lines.push('');
      for (const decorator of cls.decorators) {
        lines.push('```python');
        lines.push(`@${decorator}`);
        lines.push('```');
        lines.push('');
      }
      lines.push('```python');
      lines.push(`class ${cls.name}${bases}`);
      lines.push('```');
      lines.push('');
      renderDoc(cls.doc, lines);

      if (cls.attributes.length > 0) {
        lines.push('| Attribute | Type | Default |');
        lines.push('|-----------|------|---------|');
        for (const attribute of cls.attributes) {
          const dflt = attribute.default ? `\`${escapeCell(attribute.default)}\`` : '';
          lines.push(`| \`${attribute.name}\` | \`${escapeCell(attribute.annotation)}\` | ${dflt} |`);
        }
        lines.push('');
      }

      for (const method of cls.methods) {
        const prefix = method.is_async ? 'async def' : 'def';
        lines.push(`#### ${cls.name}.${method.name}`);
        lines.push('');
        lines.push('```python');
        lines.push(`${prefix} ${method.name}${method.signature}`);
        lines.push('```');
        lines.push('');
        renderDoc(method.doc, lines);
      }
    }
  }

  if (mod.functions.length > 0) {
    lines.push('## Functions');
    lines.push('');
    for (const fn of mod.functions) {
      const prefix = fn.is_async ? 'async def' : 'def';
      lines.push(`### ${fn.name}`);
      lines.push('');
      lines.push('```python');
      lines.push(`${prefix} ${fn.name}${fn.signature}`);
      lines.push('```');
      lines.push('');
      renderDoc(fn.doc, lines);
    }
  }

  return lines.join('\n');
}

/**
 * Renders the index page.
 *
 * The package table's row shape is load-bearing for consumers that verify a docs build
 * really produced a reference rather than an empty shell: a row renders to
 * `>name</a></td>` in the built HTML, which is greppable in a way a sidebar entry is not.
 */
function renderIndexPage(moduleDocs) {
  const lines = [];

  lines.push('---');
  lines.push('title: SDK Reference');
  lines.push('description: "Auto-generated Python API documentation"');
  lines.push('---');
  lines.push('');
  lines.push('# SDK Reference');
  lines.push('');
  lines.push('{/* Auto-generated by @vantagecompute/docusaurus-plugin-pydoc. Do not edit manually. */}');
  lines.push('');
  lines.push('Auto-generated from docstrings in the source.');
  lines.push('');
  lines.push('## Modules');
  lines.push('');
  lines.push('| Module | Classes | Functions | Description |');
  lines.push('|--------|---------|-----------|-------------|');

  for (const mod of moduleDocs) {
    const description = mod.overview ? escapeCell(mod.overview.split('\n')[0]).substring(0, 80) : '';
    lines.push(`| [${mod.label}](./${mod.filename}) | ${mod.classes} | ${mod.functions} | ${description} |`);
  }

  lines.push('');
  lines.push('## Regenerating');
  lines.push('');
  lines.push('These pages are generated at build time by `@vantagecompute/docusaurus-plugin-pydoc`,');
  lines.push('which reads the source with `ast` and never imports it. To regenerate manually:');
  lines.push('');
  lines.push('```bash');
  lines.push('yarn build');
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

module.exports = {renderModulePage, renderIndexPage, formatDocstring};
