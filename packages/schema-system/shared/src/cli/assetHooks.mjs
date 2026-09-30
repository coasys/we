/**
 * Node module hooks that let the validator import a schema which imports an asset.
 *
 * A schema is TypeScript, so validating it means importing it, which means resolving everything it
 * imports — including `import cover from '../assets/CTA/ForBuilders.jpg'`, which a bundler
 * understands and Node does not. Two of the default template's largest schemas failed with
 * "Unknown file extension .jpg" and were silently skipped, so the section of the app most likely to
 * be edited had no validation at all. That is how a call to a store method the AI context had never
 * heard of sat unreported.
 *
 * The stub returns the asset's own URL, matching what a bundler's file loader yields: a string that
 * ends up in `src` or `bgImage`. Nothing about validation depends on the bytes.
 *
 * Plain `.mjs` because `register()` loads hooks in a separate thread, before any TypeScript
 * transform is in play there.
 */
const ASSET = /\.(jpe?g|png|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp[34]|webm|wav|ogg)(\?.*)?$/i;

export async function resolve(specifier, context, nextResolve) {
  if (ASSET.test(specifier)) {
    const url = specifier.startsWith('.') ? new URL(specifier, context.parentURL).href : specifier;
    return { url, format: 'module', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (ASSET.test(url)) {
    return { format: 'module', source: `export default ${JSON.stringify(url)};`, shortCircuit: true };
  }
  return nextLoad(url, context);
}
