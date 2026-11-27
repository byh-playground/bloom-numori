"""Package the locally pinned GameKit runtime, game sources and art into one HTML."""
import base64
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STYLES = ("shell.css", "world.css", "editor.css", "lobby.css")
SCRIPTS = (
    "vendor/gamekit-core.js", "vendor/gamekit-transport.js", "network.js",
    "math.js", "battle.js", "economy.js", "match-session.js", "peer-match.js",
    "rig-data.js", "actor-rig.js", "combat-fx.js", "gpu-batch.js", "world.js", "editor.js",
    "audio.js", "lobby.js", "game.js",
)
ART = {
    "COVER_IMAGE": "shape-valley-title.webp",
    "PORTRAIT_IMAGE": "shape-valley-title-portrait.webp",
    "RIG_ATLAS": "geometry-rig.webp",
    "ENV_ATLAS": "shape-valley-environment.webp",
}


def source(name):
    return (ROOT / name).read_text(encoding="utf-8-sig")


def pack():
    body = source("shell.html")
    styles = "\n".join(source(name) for name in STYLES)
    body = body.replace("<!-- STYLES -->", "<style>" + styles + "</style>")
    for marker, filename in ART.items():
        payload = base64.b64encode((ROOT / "assets" / filename).read_bytes()).decode("ascii")
        body = body.replace(marker, "data:image/webp;base64," + payload)
    scripts = "\n".join("<script>\n" + source(name) + "\n</script>" for name in SCRIPTS)
    body = body.replace("<!-- SCRIPTS -->", scripts)
    tmp = ROOT / "numori-beta.part"
    tmp.write_text(body, encoding="utf-8")
    os.replace(tmp, ROOT / "numori-beta.html")


if __name__ == "__main__":
    pack()
