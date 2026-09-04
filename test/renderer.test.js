/**
 * Tests for docstring rendering.
 *
 * Run with `node --test`, which needs no dependency and no runner config. The repository
 * has no devDependencies and this keeps it that way.
 */

const test = require('node:test');
const assert = require('node:assert');

const {formatDocstring} = require('../src/renderer.js');

test('plain prose is emitted verbatim', () => {
  const doc = 'Does a thing.\n\nAnd explains it over\ntwo lines.';
  assert.strictEqual(formatDocstring(doc), doc);
});

test('an Args section becomes a list, one entry per name', () => {
  const doc = ['Decode a token.', '', 'Args:', '    token: The token to decode.', '    key:   The key to verify with.'].join(
    '\n',
  );
  const out = formatDocstring(doc);
  assert.match(out, /\*\*Args:\*\*/);
  assert.match(out, /^- `token`: The token to decode\.$/m);
  assert.match(out, /^- `key`: The key to verify with\.$/m);
});

test('wrapped continuation lines are joined into their own item', () => {
  const doc = [
    'Summary.',
    '',
    'Args:',
    '    claims: Additional constraints, such as `audience` or `issuer`. May include',
    '            an `options` dict merged over the override.',
    '    token:  The token.',
  ].join('\n');
  const out = formatDocstring(doc);
  assert.match(out, /^- `claims`: Additional constraints, such as `audience` or `issuer`\. May include an `options` dict merged over the override\.$/m);
  assert.match(out, /^- `token`: The token\.$/m);
});

test('Raises entries keep their own lines, which is the bug this fixes', () => {
  const doc = [
    'Summary.',
    '',
    'Raises:',
    '    AuthenticationError: The signature did not verify. Maps to 401.',
    '    PayloadMappingError: The extractor missed. Maps to 500.',
  ].join('\n');
  const out = formatDocstring(doc);
  const listed = out.split('\n').filter((line) => line.startsWith('- '));
  assert.strictEqual(listed.length, 2, 'each raised type must get its own list entry');
});

test('a fenced block inside an item description is preserved, not joined', () => {
  const doc = [
    'Summary.',
    '',
    'Args:',
    '    extractor: A function such as:',
    '',
    '        ```python',
    '        def my_extractor(token: dict) -> list[str]:',
    '            return token["roles"]',
    '        ```',
    '    other: Something plain.',
  ].join('\n');
  const out = formatDocstring(doc);
  assert.match(out, /```python/);
  assert.match(out, /def my_extractor/);
  assert.match(out, /return token\["roles"\]/);
  assert.match(out, /^- `other`: Something plain\.$/m);
});

test('a fenced block outside any section is untouched', () => {
  const doc = ['Summary.', '', '```python', 'Args:', '    not_a_section: really', '```'].join('\n');
  assert.strictEqual(formatDocstring(doc), doc);
});

test('Returns is emitted as prose under a label, not as a list', () => {
  const doc = ['Summary.', '', 'Returns:', '    The verified payload, with `original_token` set.'].join('\n');
  const out = formatDocstring(doc);
  assert.match(out, /\*\*Returns:\*\*/);
  assert.match(out, /The verified payload, with `original_token` set\./);
  assert.ok(!out.includes('- `The'), 'prose sections must not be parsed as named items');
});

test('an unparseable field body falls back to verbatim rather than guessing', () => {
  const doc = ['Summary.', '', 'Args:', '    a bare sentence with no name and no colon'].join('\n');
  const out = formatDocstring(doc);
  assert.match(out, /\*\*Args:\*\*/);
  assert.match(out, /a bare sentence with no name and no colon/);
  assert.ok(!out.includes('- `'), 'must not invent a list entry');
});

test('an unrecognized heading is left alone', () => {
  const doc = ['Summary.', '', 'Something Else:', '    body text'].join('\n');
  assert.strictEqual(formatDocstring(doc), doc);
});

test('a section header with no body is left alone', () => {
  const doc = ['Summary.', '', 'Args:'].join('\n');
  assert.strictEqual(formatDocstring(doc), doc);
});

test('no content is lost for any section type', () => {
  const doc = [
    'Summary line.',
    '',
    'Args:',
    '    alpha: first',
    '    beta:  second',
    '',
    'Returns:',
    '    a value',
    '',
    'Raises:',
    '    ValueError: when bad',
  ].join('\n');
  const out = formatDocstring(doc);
  for (const token of ['Summary line.', 'alpha', 'first', 'beta', 'second', 'a value', 'ValueError', 'when bad']) {
    assert.ok(out.includes(token), `lost content: ${token}`);
  }
});

test('an empty or missing docstring does not throw', () => {
  assert.strictEqual(formatDocstring(''), '');
});
