# Scene Forge 0.16.2

This maintenance release minifies the production editor JavaScript shipped in
wheels and source archives, reducing the code transferred to the browser.
Development builds remain readable. Both modes preserve source maps, version
identity, offline execution and third-party license notices.

With Node 24.22.1 and esbuild 0.28.2, the same editor source, ES2022 browser/ESM
settings, external source map and fixed 0.16.2 label produce:

| JavaScript | Before | Minified | Reduction |
| --- | ---: | ---: | ---: |
| Bytes | 402,115 | 223,248 | 44.5% |
| gzip bytes (level 9) | 88,930 | 69,200 | 22.2% |

Sizes exclude the source map. gzip is a comparison measurement; no runtime HTTP
compression has been added. Production uses esbuild's `minify: true`; there is no
new dependency. See [build instructions](RELEASING.md#ui-build-identity).

Existing projects, HTTP/MCP contracts and authoring workflows are unchanged.
The installed editor requires neither Node nor additional Python dependencies.

After publication, launch the minified editor with:

```sh
uvx --from 'gbc-scene-forge==0.16.2' gbc-scene-forge --project-root /path/to/projects
```

An explicit pin to an older version, including 0.15.0, still runs that version's
original bundle. Minification happens when building the distribution, rather than
when launching the server or opening a project.
