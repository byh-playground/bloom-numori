"""Rebuild Numori's standalone 1:1 GameKit adapter from its pinned upstream release.

Usage: python tools/vendor_transport.py [path to local bloom-gamekit checkout]
The source repository must contain the dist commit and its 0.28.2 esbuild dependency.
The generated artifact is checked in so pack.py and offline gameplay have no dependency.
"""
import hashlib
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KIT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT.parent.parent / "bloom-gamekit"
DIST = "10b27d8ea7f816586e41973d37d4bd2a01cc8755"
SOURCE = "9dd41e95f8064dc6c96f057d66f35ca9e9d690b4"
DIGEST = "883db0ae044214a9cee89adefb454d83afde004a29a3360557950856252c3868"

release = subprocess.check_output(["git", "-C", str(KIT), "show", f"{DIST}:transport.js"])
if hashlib.sha256(release).hexdigest() != DIGEST:
    raise SystemExit("GameKit transport release hash mismatch")
with tempfile.TemporaryDirectory() as tmp:
    work = Path(tmp)
    (work / "transport.mjs").write_bytes(release)
    (work / "entry.mjs").write_text(
        "export {createNostrRoom, createNostrSignaler} from './transport.mjs';\n", encoding="utf-8"
    )
    subprocess.run(
        ["node", str(KIT / "node_modules/esbuild/bin/esbuild"), "entry.mjs", "--bundle",
         "--format=iife", "--global-name=NumoriGameKitTransport", "--target=es2022",
         "--legal-comments=inline", "--outfile=transport.js"],
        check=True, cwd=work
    )
    header = (f"// BLOOM GameKit 1:1 WebRTC transport, source {SOURCE}, dist {DIST}.\n"
              "// All original code by bloom-gamekit. Regenerate with tools/vendor_transport.py.\n")
    (ROOT / "vendor/gamekit-transport.js").write_bytes(header.encode() + (work / "transport.js").read_bytes())
