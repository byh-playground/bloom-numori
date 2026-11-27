"""Check painter-order instancing, atlas growth and context restore by reading real WebGL pixels."""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

# 3 large regions cannot share an 8 MiB bank. The renderer must still paint
# all three using a single instanced submission and restore the uploads after loss.
PROBE = """async () => {
    const canvas = document.querySelector('canvas');
    const gpu = NumoriGPU.create(canvas);
    const gl = canvas.getContext('webgl2');
    const tiles = ['red', 'lime', 'blue'].map(color => {
        const tile = document.createElement('canvas');
        tile.width = 1600;
        tile.height = 890;
        const context = tile.getContext('2d');
        context.fillStyle = color;
        context.fillRect(0, 0, tile.width, tile.height);
        return tile;
    });
    for (const tile of tiles) gpu.register(tile);

    const calls = [];
    const native = gl.drawElementsInstanced;
    gl.drawElementsInstanced = function(...args) {
        calls.push(args[4]);
        return native.apply(this, args);
    };
    function render() {
        const active = gpu.begin({width:90, height:30, cx:45, cy:15, zoom:1, dpr:1});
        if (!active) return false;
        tiles.forEach((tile, i) => gpu.image(tile, 0, 0, 1600, 890, i*30, 0, 30, 30));
        return gpu.end();
    }
    function readColors() {
        const pixel = new Uint8Array(4);
        return tiles.map((_, i) => {
            gl.readPixels(5 + 30*i, 5, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
            return Array.from(pixel);
        });
    }
    const before = render(), beforeColors = readColors();
    const extension = gl.getExtension('WEBGL_lose_context');
    const wait = name => new Promise(resolve => canvas.addEventListener(name, resolve, {once:true}));
    let event = wait('webglcontextlost');
    extension.loseContext();
    await event;
    const during = render();
    event = wait('webglcontextrestored');
    setTimeout(() => extension.restoreContext(), 150);
    await event;
    const after = render(), afterColors = readColors();
    gpu.dispose();
    return {before, during, after, beforeColors, afterColors, calls};
}"""


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=["--enable-unsafe-swiftshader"])
        page = browser.new_page()
        page.set_content("<canvas></canvas>")
        for name in ("vendor/gamekit-core.js", "gpu-batch.js"):
            page.add_script_tag(path=ROOT / name)
        result = page.evaluate(PROBE)
        browser.close()
    expected = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]]
    assert result["beforeColors"] == result["afterColors"] == expected, result
    assert result["calls"] == [3, 3], result
    assert result["during"] is False
    assert result["before"]["atlasBanks"] == 3
    assert result["before"]["drawCalls"] == result["after"]["drawCalls"] == 1
    assert result["after"]["restores"] == 1
    print("PASS 3 texture banks, 1 hardware draw, identical pixels after context restoration")


if __name__ == "__main__":
    main()
