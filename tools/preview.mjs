import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, dirname, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateExample } from './validate.mjs';
import { buildDispatchRecipe } from '../examples/relay-dispatch/build-recipe.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const ui = resolve(repo, 'preview');
export const examples = ['catsurvivor', 'orbital-works', 'shield-drill', 'relay-dispatch'];
const types = { '.png': 'image/png', '.ttf': 'font/ttf' };
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));

async function assetPath(root, path) {
  const file = await realpath(resolve(root, path));
  const within = relative(root, file);
  if (within === '..' || within.startsWith('../') || within.startsWith('..\\') || isAbsolute(within)) {
    throw new Error(`Asset is outside its declared root: ${path}`);
  }
  return file;
}

export async function makePreview(example, { output, source, newEvent = false } = {}) {
  if (!examples.includes(example)) throw new Error(`Choose an example: ${examples.join(', ')}`);
  if (newEvent && example !== 'relay-dispatch') throw new Error('--with-new-event is available for relay-dispatch');
  const folder = resolve(repo, 'examples', example);
  const pack = await json(resolve(folder, 'asset-pack.json'));
  const recipe = await json(resolve(folder, 'recipe.json'));
  if (example === 'relay-dispatch') buildDispatchRecipe(recipe, await json(resolve(folder, 'catalog.json')), { newEvent });
  const root = await realpath(source ?? resolve(folder, pack.assetRoot ?? '.'));
  const files = new Map();
  await validateExample(recipe, pack, async (entry) => {
    const file = await assetPath(root, entry.path);
    if (entry.license) await assetPath(root, entry.license);
    const bytes = await readFile(file);
    const contentType = types[extname(file)];
    if (!contentType) throw new Error(`Unsupported preview format: ${entry.path}`);
    files.set(entry.path, `data:${contentType};base64,${bytes.toString('base64')}`);
    return bytes;
  });
  const urls = Object.fromEntries(Object.entries(pack.assets).map(([id, { path }]) => [id, files.get(path)]));
  const data = JSON.stringify({ pack, recipe, urls }).replaceAll('<', '\\u003c');
  const [template, styles, renderer] = await Promise.all(
    ['index.html', 'style.css', 'renderer.mjs'].map((file) => readFile(resolve(ui, file), 'utf8')),
  );
  const html = template
    .replace('<!-- STYLES -->', () => `<style>\n${styles}\n</style>`)
    .replace('<!-- PREVIEW -->', () => `<script type="application/json" id="data">${data}</script>\n<script type="module">\n${renderer}\n</script>`);
  const variant = newEvent ? '-new-event' : '';
  const destination = resolve(output ?? resolve(repo, '.artifacts', `${example}${variant}.html`));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, html);
  return { path: destination, url: pathToFileURL(destination).href, recipe, pack };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [, , example = 'catsurvivor', argument] = process.argv;
  try {
    const preview = await makePreview(example, argument === '--with-new-event' ? { newEvent: true } : { source: argument });
    console.log(`Preview: ${preview.path}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
