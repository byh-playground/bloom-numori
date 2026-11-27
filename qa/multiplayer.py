"""Exercise a four-digit duel through two independent browser clients.

Default signaling uses the deployed GameKit Nostr/WebRTC path. Use --local for
offline signaling via two tabs sharing a browser context. The HTTP fixture
serves exactly one self-contained game from a loopback origin.
"""
import argparse
import asyncio
import contextlib
import json
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = """() => {
  const b=Numori.battle,e=Numori.economy;
  return {
    tick:b.tick,winner:b.winner,units:b.units.map(u=>[u.id,u.side,u.type,u.giantKind,u.route,u.waypoint,u.x,u.y,u.hp]),
    station:b.station,
    towers:b.towers.map(side=>[side.bridge.hp,side.supply.hp]),
    defense:b.defenders.map(s=>[s.id,s.shotCount,s.lastShotKind]),
    caps:b.bases.map(q=>q.hp), math:e.sides.map(s=>s.targets.summon),
    spent:e.sides.map(s=>s.stats.spent),produced:e.sides.map(s=>s.stats.produced),
    allocations:[e.allocation(0),e.allocation(1)],stock:e.sides.map(s=>s.inventory),
    combat:[b.stats.hits,b.stats.attacks,b.stats.deaths,b.stats.captures]
  };
}"""


def game_url(url, local):
    pieces = urlsplit(url)
    params = dict(parse_qsl(pieces.query))
    params.update(debug='1', seed='123')
    if local:
        params['signal'] = 'local'
    return urlunsplit((*pieces[:3], urlencode(params), ''))


@contextlib.contextmanager
def serve(source):
    if '://' in source:
        yield source
        return
    data = Path(source).resolve().read_bytes()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args):
            pass

    with ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield f'http://127.0.0.1:{server.server_port}/numori/'
        finally:
            server.shutdown()
            thread.join()


async def press(page, selector, touch=False):
    loc = page.locator(selector)
    if touch:
        await loc.tap()
    else:
        await loc.click()


async def initialize(page, url, errors):
    page.on('pageerror', lambda error: errors.append(str(error)))
    await page.add_init_script("""{
        const Peer = window.RTCPeerConnection;
        window.__qaPeers = [];
        window.RTCPeerConnection = class extends Peer {
          constructor(...args) {super(...args); window.__qaPeers.push(this);}
        };
    }""")
    await page.goto(url, wait_until='domcontentloaded', timeout=60000)
    # Stop only the game's automatic scheduler; networking and real DOM input
    # keep their normal clocks. Advance fixed ticks through the debug interface.
    await page.evaluate("window.requestAnimationFrame=()=>0; window.cancelAnimationFrame=()=>{}")


async def wait_ready(page):
    await page.wait_for_function("window.Numori?.battle && !document.querySelector('#gameScreen').hidden",
                                 polling=50, timeout=55000)


async def put_ast(page, ast, touch, shelf):
    if ast['type'] == 'num':
        await press(page, f'[data-number="{ast["key"]}"]', touch)
        return
    left, right = ast['args']
    bank = right['type'] != 'num'
    if bank:
        await put_ast(page, right, touch, shelf)
        await press(page, '[data-action="new"]', touch)
        index = len(shelf)
        shelf.append(right)
    await put_ast(page, left, touch, shelf)
    await press(page, f'[data-op="{ast["id"]}"]', touch)
    if bank:
        await press(page, f'[data-stored="{index}"]', touch)
        shelf.pop(index)
    else:
        await put_ast(page, right, touch, shelf)


async def summon(page, side, touch, route='bridge'):
    ast = await page.evaluate("s=>Numori.economy.summonHint(s,{})", side)
    assert ast, f'no payable exact opening on side {side}'
    await put_ast(page, ast, touch, [])
    await expect(page.locator('.ne-dispatch-count')).to_have_text('24마리')
    selector = '[data-action="produce-supply"]' if route == 'supply' else '[data-action="produce"]'
    await press(page, selector, touch)


async def pump(host, guest, ticks):
    """Allow dependable link time between bounded host and guest advancement."""
    target = await host.evaluate("n=>Numori.battle.tick+n", ticks)
    previous = None
    stalled = 0
    for _ in range(2400):
        h = await host.evaluate("""goal=>{const b=Numori.battle;
          Numori.advance(Math.min(48,Math.max(0,goal-b.tick)));return [b.tick,b.winner]}""", target)
        await asyncio.sleep(0.015)
        g = await guest.evaluate("()=>{Numori.advance(48);return [Numori.battle.tick,Numori.battle.winner]}")
        stalled = stalled + 1 if previous == (h,g) else 0
        previous = (h,g)
        if stalled > 80:
            detail = await asyncio.gather(*[p.evaluate("() => ({ready:Numori.match?.ready, modal:document.querySelector('#modalTitle').innerText, tick:Numori.battle?.tick, state:Numori.battle?.winner})") for p in (host,guest)])
            raise AssertionError(('no progress',target,detail))
        if h == g and (h[0] >= target or h[1] >= 0):
            return
    raise AssertionError(f'fixed tick synchronization stalled: {h}, {g}, goal={target}')


async def unknown_room(context, url, errors, active_code):
    page = await context.new_page()
    try:
        await initialize(page, url, errors)
        await press(page, '[data-act="multiplayer"]')
        await page.locator('#joinCode').fill('0001' if active_code=='0000' else '0000')
        await press(page, '#joinRoom')
        await expect(page.locator('#lobbyMessage.is-error')).to_be_visible(timeout=40000)
        assert not await page.evaluate('!!window.Numori?.battle')
        assert await page.locator('#lobbyEntry').is_visible()
        print('unknown room', await page.locator('#lobbyMessage').inner_text(), flush=True)
    finally:
        await page.close()


async def run(url, local, archive, disconnect_only=False):
    errors = []
    async with async_playwright() as pw:
        process = await pw.chromium.launch(channel='chrome',args=['--disable-background-timer-throttling'])
        second = process if local else await pw.chromium.launch(channel='chrome',args=['--disable-background-timer-throttling'])
        try:
            host_context = await process.new_context(viewport={'width':1440,'height':900})
            guest_context = host_context if local else await second.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
            host,guest = await asyncio.gather(host_context.new_page(),guest_context.new_page())
            touch = not local
            await asyncio.gather(initialize(host,url,errors),initialize(guest,url,errors))
            await asyncio.gather(press(host,'[data-act="multiplayer"]'),press(guest,'[data-act="multiplayer"]',touch))
            # Invalid length and a cancelled room lookup shouldn't capture the next connection.
            await guest.locator('#joinCode').fill('12')
            await press(guest, '#joinRoom', touch)
            await expect(guest.locator('#lobbyEntry')).to_be_visible()
            if local:
                await guest.locator('#joinCode').fill('0000')
                await press(guest, '#joinRoom')
                await expect(guest.locator('#lobbyWaiting')).to_be_visible()
                await press(guest, '#cancelRoom')
                await expect(guest.locator('#lobbyEntry')).to_be_visible()
            await press(host,'#createRoom')
            code_field = host.locator('#lobbyCode')
            await expect(code_field).to_have_value(re.compile(r'^[0-9]{4}$'), timeout=50000)
            code = await code_field.input_value()
            print('room',code,flush=True)
            await guest.locator('#joinCode').fill(code)
            await press(guest,'#joinRoom',touch)
            await asyncio.gather(wait_ready(host),wait_ready(guest))
            route = await host.evaluate("""async()=>{const pc=__qaPeers.find(p=>p.connectionState==='connected');
              if(!pc)return null;const stats=await pc.getStats();
              const transport=[...stats.values()].find(x=>x.type==='transport'&&x.selectedCandidatePairId);
              const pair=transport&&stats.get(transport.selectedCandidatePairId);
              return pair&&[stats.get(pair.localCandidateId).candidateType, stats.get(pair.remoteCandidateId).candidateType];}""")
            print('connected', 'local discovery' if local else 'public discovery',route, flush=True)
            assert route, 'WebRTC did not select a route'
            if archive:
                archive.mkdir(parents=True, exist_ok=True)
                await host.screenshot(path=archive/'host-ready.png')
                await guest.screenshot(path=archive/'guest-ready.png')
            if local:
                third = await host_context.new_page()
                await initialize(third,url,errors)
                await press(third,'[data-act="multiplayer"]')
                await third.locator('#joinCode').fill(code)
                await press(third,'#joinRoom')
                await expect(third.locator('#lobbyMessage.is-error')).to_be_visible(timeout=16000)
                assert not await third.evaluate('!!window.Numori?.battle')
                print('occupied room',await third.locator('#lobbyMessage').inner_text(),flush=True)
                await third.close()
            if disconnect_only:
                await guest.close()
                await expect(host.locator('#modalTitle')).to_have_text('연결 종료', timeout=20000)
                tick = await host.evaluate('Numori.battle.tick')
                await host.evaluate('Numori.advance(300)')
                assert await host.evaluate('Numori.battle.tick') == tick
                await press(host, '[data-act="leave"]')
                await press(host, '[data-act="start"]')
                assert await host.evaluate('Numori.match.role') == 'solo'
                assert not errors,errors
                print('peer tab closed; host stops safely and can start solo',flush=True)
                return
            unknown = asyncio.create_task(unknown_room(host_context,url,errors,code)) if local else None
            await pump(host,guest,60)
            assert await host.evaluate(SNAPSHOT)==await guest.evaluate(SNAPSHOT)
            assert await host.locator('.ne-goal').inner_text()==str(await host.evaluate('Numori.economy.sides[0].targets.summon'))
            assert await guest.locator('.ne-goal').inner_text()==str(await guest.evaluate('Numori.economy.sides[1].targets.summon'))
            # Pay one actual exact formula at each player's desk, then compare ledgers.
            for side,page,use_touch in [(0,host,False),(1,guest,touch)]:
                await summon(page,side,use_touch)
                await pump(host,guest,30)
                assert await host.evaluate('s=>Numori.economy.sides[s].stats.produced',side)==24
                assert await guest.evaluate('s=>Numori.economy.sides[s].stats.produced',side)==24
            await press(guest,'[data-act="labor"]',touch)
            await press(guest,'[data-mine="mineral"] [data-delta="-1"]',touch)
            await pump(host,guest,3)
            await press(guest,'[data-mine="gas"] [data-delta="1"]',touch)
            await pump(host,guest,3)
            await press(guest,'[data-act="labor"]',touch)
            assert await host.evaluate("Numori.economy.allocation(1).gas")==6
            assert await host.evaluate("Numori.economy.allocation(0).gas")==5
            await pump(host,guest,30*40)
            state = await host.evaluate(SNAPSHOT)
            assert state==await guest.evaluate(SNAPSHOT)
            assert state['produced']==[24,24],state['produced']
            print('sync',state['tick'], 'no AI/actual paid troops',state['produced'],flush=True)
            await summon(guest,1,touch,'supply')
            await pump(host,guest,6)
            assert await host.evaluate("Numori.economy.sides[1].stats.byRoute.supply")==24
            assert await guest.evaluate(SNAPSHOT)==await host.evaluate(SNAPSHOT)
            # Keep one side sending real UI orders throughout the midfield and siege.
            for _ in range(90):
                if await host.evaluate('Numori.battle.winner>=0'):break
                available = await host.evaluate("!!Numori.economy.summonHint(0,{}) && Numori.economy.sides[0].inventory['=']>0")
                if available:
                    await summon(host,0,False)
                await pump(host,guest,30*8)
            state=await host.evaluate(SNAPSHOT)
            assert state['winner']==0, (state['winner'],state['caps'],state['tick'])
            assert state['towers'][1][0]==0, state['towers']
            assert state['station']['recruits'][1] > 0, state['station']
            assert state==await guest.evaluate(SNAPSHOT)
            await expect(host.locator('#modalTitle')).to_contain_text('승리')
            await expect(guest.locator('#modalTitle')).to_contain_text('패배')
            if archive:
                await host.screenshot(path=archive/'host-win.png')
                await guest.screenshot(path=archive/'guest-loss.png')
                (archive/'result.json').write_text(json.dumps({'tick':state['tick'],'winner':0,'hp':state['caps'],'produced':state['produced'],'combat':state['combat'],'station':state['station']},indent=2),encoding='utf8')
            print('win/loss',state['tick'],state['produced'],state['combat'],flush=True)
            # One vote must leave the current result intact. Both votes share a fresh round.
            await press(host, '[data-act="rematch"]')
            await asyncio.sleep(.12)
            assert await host.evaluate('Numori.battle.winner') == 0
            await press(guest, '[data-act="rematch"]', touch)
            for page in (host, guest):
                await page.wait_for_function("Numori.match?.ready && Numori.battle?.winner===-1 && Numori.battle?.tick===0",polling=50)
                assert await page.evaluate("Numori.economy.sides.map(s=>s.stats.produced)") == [0, 0]
                assert await page.evaluate("Numori.battle.bases.every(b=>b.hp===1400) && Numori.battle.towers.every(t=>t.bridge.hp>0 && t.supply.hp>0)")
                assert await page.evaluate("Numori.battle.station.recruits.every(n=>n===0) && !!Numori.battle.station.giantKind")
            await pump(host,guest,30)
            await press(guest, '[data-act="menu"]', touch)
            await press(guest, '[data-act="askSurrender"]', touch)
            await press(guest, '[data-act="surrender"]', touch)
            await asyncio.sleep(.15)
            await pump(host,guest,3)
            await expect(guest.locator('#modalTitle')).to_contain_text('패배')
            await expect(host.locator('#modalTitle')).to_contain_text('승리')
            await press(guest, '[data-act="leave"]', touch)
            await press(host, '[data-act="leave"]')
            await press(host, '[data-act="start"]')
            assert await host.evaluate('Numori.match.role') == 'solo'
            print('rematch, surrender and solo reentry', flush=True)
            if unknown:
                await unknown
            assert not errors, errors
        finally:
            if second is not process:await second.close()
            await process.close()


if __name__ == '__main__':
    cli=argparse.ArgumentParser()
    cli.add_argument('source',nargs='?',default=str(ROOT/'numori-beta.html'))
    cli.add_argument('--local',action='store_true')
    cli.add_argument('--evidence',type=Path)
    cli.add_argument('--disconnect',action='store_true',help='Close the guest tab during a live match')
    opts=cli.parse_args()
    with serve(opts.source) as origin:
        asyncio.run(run(game_url(origin,opts.local),opts.local,opts.evidence,opts.disconnect))
