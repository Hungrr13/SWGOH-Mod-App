import { MOD_TEMPLATE_MANIFEST } from '../data/modTemplateManifest';

function flattenManifestEntries(manifest = MOD_TEMPLATE_MANIFEST) {
  return [
    ...(manifest.shapes ?? []),
    ...(manifest.atlases ?? []),
    ...(manifest.shapeSetVariants ?? []),
  ];
}

export async function hydrateModTemplateLibrary(manifest = MOD_TEMPLATE_MANIFEST) {
  const entries = flattenManifestEntries(manifest).map(entry => ({
    ...entry,
    localUri: null,
    source: entry.remoteUrl ? 'remote' : 'bundled',
  }));

  return {
    version: manifest.version ?? 1,
    source: manifest.source ?? 'bundled',
    entries,
    counts: {
      shapes: manifest.shapes?.length ?? 0,
      atlases: manifest.atlases?.length ?? 0,
      shapeSetVariants: manifest.shapeSetVariants?.length ?? 0,
      total: entries.length,
    },
  };
}

export async function getModTemplateLibraryStatus() {
  const hydrated = await hydrateModTemplateLibrary();
  return {
    version: hydrated.version,
    source: hydrated.source,
    counts: hydrated.counts,
    ready: hydrated.entries.length > 0,
    remoteReady: hydrated.entries.some(entry => Boolean(entry.remoteUrl)),
  };
}
