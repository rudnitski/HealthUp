import fs from 'fs';
import path from 'path';
import { getDirname } from './path-helpers.js';

const __dirname = getDirname(import.meta.url);
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

export {
  loadPrompt,
};
