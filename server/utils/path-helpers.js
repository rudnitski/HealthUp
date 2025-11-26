import { fileURLToPath } from 'url';
import { dirname } from 'path';

export function getDirname(importMetaUrl) {
  return dirname(fileURLToPath(importMetaUrl));
}

export function getFilename(importMetaUrl) {
  return fileURLToPath(importMetaUrl);
}
