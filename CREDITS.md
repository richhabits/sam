# Credits & Third-Party Licenses

SAM stands on the shoulders of great open-source work. We absorb and adapt under
each project's license, and keep the required attributions here.

## SAM Creative Space
SAM's Creative Space (image/video studio) is our own slim build (`src/StudioView.tsx`)
wired to SAM's key-hiding `/api/creative` proxy. It bundles no third-party code.

## Runtime
- Model access via each provider's own free/paid API under their terms.
- Local inference via Ollama (MIT). Embeddings via nomic-embed / provider APIs.
