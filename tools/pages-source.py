"""Stage the original browser runtime and BLOOM PLAYGROUND metadata for Pages."""

import argparse
from datetime import datetime, timezone
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from shutil import copyfile
from subprocess import check_output
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
STYLESHEET_URL = re.compile(
    r"""\burl\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)""", re.IGNORECASE
)


class RuntimeReferences(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag in {"script", "img"} and attributes.get("src"):
            self.urls.append(attributes["src"])
        if tag == "link" and attributes.get("href"):
            relation = (attributes.get("rel") or "").split()
            if {"stylesheet", "icon", "preload", "modulepreload"}.intersection(relation):
                self.urls.append(attributes["href"])


def local_source(origin, url):
    reference = urlsplit(url)
    if reference.scheme == "data" or (not reference.path and reference.fragment):
        return None
    path = unquote(reference.path)
    if reference.scheme or reference.netloc or path.startswith("/") or "\\" in path:
        raise ValueError(f"{origin.name} must reference a relative snapshot file: {url!r}")
    resolved = (origin.parent / path).resolve()
    if not resolved.is_relative_to(ROOT) or not resolved.is_file():
        raise ValueError(f"{origin.name} references a missing snapshot file: {url!r}")
    return resolved


def runtime_files():
    entry = ROOT / "index.html"
    html = RuntimeReferences()
    html.feed(entry.read_text(encoding="utf-8"))
    files = {entry}
    pending = [(entry, url) for url in html.urls]
    while pending:
        origin, url = pending.pop()
        source = local_source(origin, url)
        if source is None or source in files:
            continue
        files.add(source)
        if source.suffix.lower() == ".css":
            stylesheet = source.read_text(encoding="utf-8")
            pending.extend(
                (source, next(value for value in match.groups() if value is not None))
                for match in STYLESHEET_URL.finditer(stylesheet)
            )
    return files


def nightly_tag():
    commit, epoch = check_output(
        ["git", "show", "--no-patch", "--format=%H %ct", "HEAD"], cwd=ROOT, text=True
    ).split()
    stamp = datetime.fromtimestamp(int(epoch), timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"nightly-{stamp}-{commit[:12]}"


def stage(destination):
    files = runtime_files()
    manifest = json.loads((ROOT / "bloom-game.json").read_text(encoding="utf-8"))
    if "nightly" in manifest:
        raise ValueError("The source manifest must omit the generated nightly field")
    if destination.exists() and any(destination.iterdir()):
        raise ValueError("Use an empty destination for the Pages artifact")
    for source in sorted(files):
        target = destination / source.relative_to(ROOT)
        target.parent.mkdir(parents=True, exist_ok=True)
        copyfile(source, target)
    manifest["nightly"] = nightly_tag()
    (destination / "bloom-game.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=4) + "\n", encoding="utf-8"
    )
    print(f"Staged {len(files)} original runtime files for {manifest['nightly']}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    stage(parser.parse_args().destination)
