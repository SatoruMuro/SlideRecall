import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const walk = (directory) => readdirSync(directory).flatMap((name) => {
  const path = join(directory, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const forbidden = walk('dist').filter((path) => {
  const normalized = relative('dist', path).split(sep).join('/');
  return /\.(pdf|zip|md|txt|env|map)$/i.test(normalized)
    || /(^|\/)(tests?|fixtures?|node_modules|\.git)(\/|$)/i.test(normalized);
});
if (forbidden.length) throw new Error('Unexpected non-application file in dist');
