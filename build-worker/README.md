# build-worker

Firmware builds for IoT Hub, isolated from the API. Design and threat model:
`docs/adr/ADR-002-build-isolation.md`, `docs/SECURITY.md` § "Firmware builds".
Deployment: `docs/DEPLOYMENT.md` § "Firmware builds".

| Path | What it is |
| --- | --- |
| `builder/` | PlatformIO image. One container per build, sources on stdin, one JSON result line on stdout, compiler output on stderr. Runs with no network, so everything it can use is installed by `warmup.py` at image build. |
| `builder/targets.json` | Platforms and boards in the image. Must match the boards with `flash` in `backend/src/modules/projects/board-catalog.ts`. |
| `builder/libraries.json` | Catalog libraries in the image, found by `#include`. |
| `dispatcher/` | Node 24, no dependencies. Claims jobs from the API with `BUILD_WORKER_TOKEN` and runs the builder with the isolation flags in `src/builder-container.ts`. |

```sh
docker build --target builder -t unity-hub-builder:dev .
cd dispatcher && npm test
```
