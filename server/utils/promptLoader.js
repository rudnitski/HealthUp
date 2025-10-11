const fs = require('fs');
const path = require('path');

const PROMPT_ROOT = path.join(__dirname, '..', '..', 'prompts');
const cache = new Map();

function resolvePromptPath(filename) {
  return path.join(PROMPT_ROOT, filename);
}

function loadPrompt(filename) {
  if (cache.has(filename)) {
    return cache.get(filename);
  }

  const absolutePath = resolvePromptPath(filename);
  const content = fs.readFileSync(absolutePath, 'utf8').replace(/\r\n/g, '\n').trim();
  cache.set(filename, content);
  return content;
}

module.exports = {
  loadPrompt,
};
