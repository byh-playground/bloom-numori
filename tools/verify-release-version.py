"""Check the requested Stable version against the selected source commit."""

import argparse
from pathlib import Path
import re
from subprocess import check_output


ROOT = Path(__file__).resolve().parents[1]
DECLARATION = re.compile(
    r"""^\s*globalThis\.NumoriVersion\s*=\s*(?P<quote>['"])(?P<version>[0-9]+\.[0-9]+\.[0-9]+)(?P=quote);\s*$""",
    re.MULTILINE,
)


def verify(commit, version):
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("A full source commit SHA is required")
    source = check_output(["git", "show", f"{commit}:version.js"], cwd=ROOT, text=True)
    declared = [match["version"] for match in DECLARATION.finditer(source)]
    if declared != [version.removeprefix("v")]:
        raise ValueError("Stable version must match the selected source commit product version")
    print(f"Verified product version {declared[0]} at {commit}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("commit")
    parser.add_argument("version")
    options = parser.parse_args()
    verify(options.commit, options.version)
