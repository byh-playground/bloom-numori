"""Replay both sides of one real WebRTC duel with touch keypad input."""
import argparse
import asyncio
import json
import math
import re
from pathlib import Path

from playwright.async_api import TimeoutError as PlaywrightTimeoutError, async_playwright, expect

from multiplayer import game_url, initialize, press, pump, put_ast, serve, wait_ready


def ast(tree):
    if isinstance(tree, int):
        return {'type': 'num', 'key': str(tree)}
    op, left, right = tree
    return {'type': 'op', 'id': op, 'args': [ast(left), ast(right)]}


# Commands use the ordinary formula editor and the host's authoritative round clock.
ORDERS = [
    (120, 0, 'bridge', ('mul', 4, 8), 32),
    (120, 1, 'bridge', ('add', ('add', 3, 8), 8), 19),
    (180, 0, 'supply', ('sub', ('mul', 4, 8), 2), 30),
    (192, 1, 'supply', ('mul', ('mul', 4, 4), 5), 80),
    (510, 0, 'supply', ('add', 3, 9), 12),
    (2400, 1, 'supply', ('add', 6, 9), 15),
    (2700, 1, 'supply', ('mul', 6, 8), 48),
    (3000, 1, 'supply', ('mul', 7, 8), 56),
]
SCENES = [
    (0, 'neutral', None, -1),
    (789, 'host-leads', 'capturing', 0),
    (840, 'contested', 'contested', 0),
    (879, 'contested-later', 'contested', 0),
    (891, 'turnover', 'capturing', 1),
    (912, 'recapture-lead', 'capturing', 0),
    (1962, 'recruit-1', 'secured', 0),
    (2802, 'second-spawn', None, -1),
    (4530, 'recruit-2', 'secured', 1),
]

READ = """() => {
    const {battle,match,world}=Numori;
    const card=document.querySelector('.nr-capture-status');
    const box=card.getBoundingClientRect(), field=card.parentElement.getBoundingClientRect();
    return {
        side:match.side, tick:battle.tick, station:battle.station,
        label:card.querySelector('.nr-capture-label').textContent,
        remaining:card.querySelector('.nr-capture-remaining').textContent,
        count:card.querySelector('.nr-capture-count').textContent,
        progress:Number(card.style.getPropertyValue('--capture-progress')),
        dataState:card.dataset.state, dataSide:card.dataset.side,
        progressSide:card.dataset.progressSide, hidden:card.hidden,
        x:box.x, y:box.y, width:box.width, height:box.height,
        inside:box.left>=field.left && box.right<=field.right && box.top>=field.top && box.bottom<=field.bottom,
        drawCalls:world.renderStats.drawCalls, backend:world.renderStats.backend,
    };
}"""


async def order(page, side, route, tree, value):
    assert await page.evaluate('Numori.match.side') == side
    await expect(page.locator('.ne-goal')).to_have_text(str(value))
    before = await page.evaluate('s=>Numori.economy.sides[s].stats.produced', side)
    if before:
        await expect(page.locator('[data-dispatch-route="supply"]')).to_be_hidden()
    await put_ast(page, ast(tree), True, [])
    await expect(page.locator('.ne-dispatch-count')).to_have_text('24마리')
    assert await page.evaluate('s=>Numori.economy.sides[s].stats.produced', side) == before
    selector = '[data-action="produce"]' if not before else f'[data-dispatch-route="{route}"]'
    await press(page, selector, True)
    await page.wait_for_function(
        '([side,before])=>Numori.economy.sides[side].stats.produced===before+24',
        arg=[side, before], polling=50,
    )


async def capture(pages, folder, key, state, leader):
    peers = []
    station, tick = None, None
    for role, page in zip(('host', 'guest'), pages):
        await page.evaluate("""() => {
            const {world,battle,economy}=Numori;
            world.render({battle,economy},0);
            world.supply();
            world.render({battle,economy},0);
        }""")
        read = await page.evaluate(READ)
        if station is None:
            station, tick = read.pop('station'), read.pop('tick')
        else:
            assert read.pop('station') == station and read.pop('tick') == tick
        ally = read['side'] == leader
        relative = 'ally' if ally else 'enemy'
        team = '아군' if ally else '적군'
        if state:
            assert read['dataState'] == state and not read['hidden'] and read['inside'], read
            assert read['progressSide'] == relative, read
            assert read['backend'] == 'webgl2' and read['drawCalls'] == 1, read
            mine, enemy = station['presence'][read['side']], station['presence'][1 - read['side']]
            if state == 'capturing':
                seconds = 30 * (1 - station['progress'])
                expected = f'{math.ceil(seconds * 10 - 1e-8) / 10:.1f}초'
                assert read['remaining'] == expected and read['label'] == team+' 점령 중', read
                assert read['dataSide'] == relative, read
            elif state == 'contested':
                assert read['label'] == '경합 · 일시정지' and read['dataSide'] == 'neutral', read
                assert read['remaining'] == f'{team} {math.floor(station["progress"] * 100)}%', read
            else:
                assert read['dataSide'] == relative and read['label'] == team+' 확보', read
                assert read['progress'] == 1, read
            if state != 'secured':
                assert read['count'] == f'아군 {mine} · 적군 {enemy}', read
        else:
            assert read['hidden'], read
        path = folder/f'{key}-{role}.png'
        await page.screenshot(path=path)
        peers.append(dict(read, screenshot=path.name))
    print(key, tick, station['presence'], station['claimant'],
          ['hidden' if p['hidden'] else (p['label']+' '+p['remaining']).strip() for p in peers], flush=True)
    return {'key': key, 'tick': tick, 'seconds': tick/30, 'station': station, 'peers': peers}


async def duel(url, local, folder):
    errors = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(channel='chrome', args=['--disable-background-timer-throttling'])
        try:
            host_context = await browser.new_context(
                viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True,
            )
            landscape = {'width': 844, 'height': 390}
            guest_context = host_context if local else await browser.new_context(
                viewport=landscape, is_mobile=True, has_touch=True,
            )
            host = await host_context.new_page()
            guest = await guest_context.new_page()
            if local:
                await guest.set_viewport_size(landscape)
            pages = host, guest
            await asyncio.gather(*(initialize(page, url, errors) for page in pages))
            await asyncio.gather(*(press(page, '[data-act="multiplayer"]', True) for page in pages))
            await press(host, '#createRoom', True)
            code_field = host.locator('#lobbyCode')
            await expect(code_field).to_have_value(re.compile(r'^\d{4}$'), timeout=55000)
            code = await code_field.input_value()
            await guest.locator('#joinCode').fill(code)
            await press(guest, '#joinRoom', True)
            await asyncio.gather(*(wait_ready(page) for page in pages))
            connected = await host.evaluate("""() => __qaPeers.some(peer=>peer.connectionState==='connected')""")
            assert connected
            print('WebRTC connected', 'local' if local else 'public four-digit', flush=True)
            report = {'transport': 'local-webrtc' if local else 'public-webrtc', 'seed': 123, 'scenes': [],
                      'orders': ORDERS, 'viewports': [page.viewport_size for page in pages]}
            schedule = sorted([(t, 0, *values) for t, *values in ORDERS]
                              + [(t, 1, *values) for t, *values in SCENES], key=lambda item: item[:2])
            previous = 0
            for tick, kind, *args in schedule:
                if tick != previous:
                    await pump(host, guest, tick-previous)
                    previous = tick
                if kind == 0:
                    player = pages[args[0]]
                    try:
                        await order(player, *args)
                    except PlaywrightTimeoutError:
                        await player.screenshot(path=folder/f'tap-failure-{tick}-{args[0]}.png')
                        raise
                    print('paid', tick, args[0], args[1], args[3], flush=True)
                else:
                    report['scenes'].append(await capture(pages, folder, *args))
                    (folder/'duel.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
            scenes = {row['key']: row['station'] for row in report['scenes']}
            tie, later = scenes['contested'], scenes['contested-later']
            assert tie['presence'] == later['presence'] == [24, 24] and tie['progress'] == later['progress'] > 0
            assert scenes['turnover']['presence'] == [23, 24]
            assert scenes['turnover']['progress'] < tie['progress']
            assert scenes['recruit-1']['lastRecruit']['giantKind'] == 'breaker'
            assert scenes['second-spawn']['giantKind'] == 'bulwark'
            assert scenes['recruit-2']['lastRecruit']['giantKind'] == 'bulwark'
            assert scenes['recruit-2']['recruits'] == [1, 1]
            assert not errors, errors
            print('both sides recruited a giant after an actual contested lead', flush=True)
        finally:
            await browser.close()


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('source')
    cli.add_argument('--out', required=True, type=Path)
    cli.add_argument('--local', action='store_true')
    options = cli.parse_args()
    options.out.mkdir(parents=True, exist_ok=True)
    with serve(options.source) as origin:
        asyncio.run(duel(game_url(origin, options.local), options.local, options.out))
