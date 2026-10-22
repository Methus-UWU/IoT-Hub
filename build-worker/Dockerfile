# syntax=docker/dockerfile:1
#
# Two images for firmware builds (docs/adr/ADR-002-build-isolation.md):
#
#   builder    - PlatformIO with every platform and library preinstalled. One
#                container per build, started by the dispatcher with no network,
#                no capabilities, a read-only root, and a non-root user.
#   dispatcher - claims jobs from the API with a scoped worker token and runs the
#                builder. It holds the Docker socket, so it never runs user code
#                and never holds a database credential or a platform secret.
ARG PYTHON_IMAGE=python:3.12-slim-bookworm
ARG NODE_IMAGE=node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

FROM ${PYTHON_IMAGE} AS builder
ARG PLATFORMIO_VERSION=6.1.19
ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PLATFORMIO_CORE_DIR=/opt/platformio \
    PLATFORMIO_SETTING_ENABLE_TELEMETRY=No \
    PLATFORMIO_SETTING_CHECK_PLATFORMIO_INTERVAL=3650 \
    PLATFORMIO_SETTING_CHECK_PRUNE_SYSTEM_THRESHOLD=0 \
    PLATFORMIO_DISABLE_PROGRESSBAR=true \
    PYTHONDONTWRITEBYTECODE=1
RUN pip install "platformio==${PLATFORMIO_VERSION}"
# Slow, network-bound layers first, each depending only on what it installs, so
# editing the library list or build.py does not download every toolchain again.
COPY builder/targets.json builder/warmup.py /opt/iot-hub/
# PlatformIO unpacks some packages owner-only. The chmod runs inside the layer
# that installed them: as its own RUN it would copy every toolchain file into a
# second layer.
RUN python /opt/iot-hub/warmup.py platforms \
    && rm -rf /opt/platformio/.cache /tmp/* \
    && chmod -R a+rX,go-w /opt/platformio
COPY builder/libraries.json /opt/iot-hub/
RUN python /opt/iot-hub/warmup.py libraries \
    && rm -rf /opt/platformio/.cache /tmp/* \
    && chmod -R a+rX,go-w /opt/platformio /opt/iot-hub
RUN useradd --uid 1000 --no-create-home --home-dir /workspace builder
COPY builder/build.py /opt/iot-hub/
# Writable state lives on the tmpfs mounts the dispatcher provides.
ENV HOME=/workspace \
    PLATFORMIO_CACHE_DIR=/tmp/platformio-cache \
    PLATFORMIO_BUILD_CACHE_DIR=/tmp/platformio-build-cache
USER 1000:1000
WORKDIR /workspace
ENTRYPOINT ["python", "/opt/iot-hub/build.py"]

FROM ${NODE_IMAGE} AS dispatcher
# Only the Docker CLI; the daemon is the host's, reached through the socket.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && echo "deb [signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
       > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli \
    && apt-get purge -y curl gnupg && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY dispatcher/package.json ./
COPY dispatcher/src ./src
ENV NODE_ENV=production
CMD ["node", "src/main.ts"]
