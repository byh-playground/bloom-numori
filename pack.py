"""Export the playable source page as a self-contained HTML Share file."""
import base64
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STYLESHEET = re.compile(r'<link rel="stylesheet" href="([^"]+)"\s*/?>')
SCRIPT = re.compile(r'<script src="([^"]+)"></script>')
IMAGE = re.compile(r"""(["'])(assets/[^"']+\.webp)\1""")


def source(name):
    return (ROOT / name).read_text(encoding="utf-8-sig")


def pack():
    def embed_image(match):
        quote, filename = match.groups()
        payload = base64.b64encode((ROOT / filename).read_bytes()).decode("ascii")
        return quote + "data:image/webp;base64," + payload + quote

    body = source("index.html")
    body = STYLESHEET.sub(lambda match: "<style>\n" + source(match[1]) + "</style>", body)
    body = IMAGE.sub(embed_image, body)
    body = SCRIPT.sub(lambda match: "<script>\n" + source(match[1]) + "</script>", body)
    tmp = ROOT / "numori-beta.part"
    tmp.write_text(body, encoding="utf-8", newline="\n")
    os.replace(tmp, ROOT / "numori-beta.html")


if __name__ == "__main__":
    pack()
