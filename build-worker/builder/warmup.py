"""Image-build step: install everything a build may use, while the network is up.

Builds run with --network=none, so the platforms, toolchains, Arduino frameworks,
and catalog libraries must already be in the image. Compiling one sketch per
platform makes PlatformIO fetch the tool packages it installs lazily.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

TARGETS = json.loads(Path("/opt/iot-hub/targets.json").read_text())
LIBRARIES_FILE = Path("/opt/iot-hub/libraries.json")
LIBRARY_DIR = Path("/opt/iot-hub/libraries")
SKETCH = "#include <Arduino.h>\nvoid setup() {}\nvoid loop() {}\n"


def pio(*args: str) -> None:
    subprocess.run(["pio", *args], check=True)


def project(root: Path, platform_spec: str, board: str, extra: list[str]) -> Path:
    (root / "src").mkdir(parents=True)
    (root / "src" / "main.cpp").write_text(SKETCH)
    (root / "platformio.ini").write_text(
        "\n".join(
            ["[env:warmup]", f"platform = {platform_spec}", f"board = {board}", "framework = arduino", *extra, ""]
        )
    )
    return root


def warm_platforms() -> None:
    for platform in TARGETS["platforms"].values():
        with tempfile.TemporaryDirectory() as temp:
            root = project(Path(temp), platform["spec"], platform["warmupBoard"], [])
            pio("run", "--project-dir", str(root))


def install_libraries() -> None:
    espressif32 = TARGETS["platforms"]["espressif32"]
    with tempfile.TemporaryDirectory() as temp:
        libraries = json.loads(LIBRARIES_FILE.read_text())["libraries"]
        lib_deps = ["lib_deps ="] + [f"    {library}" for library in libraries]
        root = project(Path(temp), espressif32["spec"], espressif32["warmupBoard"], lib_deps)
        pio("pkg", "install", "--project-dir", str(root))
        installed = root / ".pio" / "libdeps" / "warmup"
        LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
        for library in installed.iterdir():
            if library.is_dir():
                shutil.move(str(library), LIBRARY_DIR / library.name)


# Two steps, run as two image layers, so changing the library list does not
# download every toolchain again.
STEPS = {"platforms": warm_platforms, "libraries": install_libraries}

if __name__ == "__main__":
    STEPS[sys.argv[1]]()
