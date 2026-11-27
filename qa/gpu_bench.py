"""Profile the distributed game with driver-call counters and actual requestAnimationFrame pacing.

Example: python qa/gpu_bench.py numori-beta.html --out /path/to/metrics
Use the same machine, Chromium build, DPR, warmup, frames and scenes for comparisons.
Synthetic rows step once per rendered frame so both backends see identical simulation ticks.
"""
import argparse
import hashlib
import json
import platform
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
VIEWS = {"portrait": (390, 844), "landscape": (844, 390), "desktop": (1440, 900)}

PROBE = r"""() => {
    const nativeRaf = requestAnimationFrame.bind(window);
    const contexts = new Set();
    let frame = null;
    const wrap = (proto, name, count) => {
        const real = proto?.[name];
        if (typeof real !== 'function') return;
        proto[name] = function(...args) {
            if (frame) count(frame, this, args);
            return real.apply(this, args);
        };
    };
    const realGet = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...rest) {
        const value = realGet.call(this, type, ...rest);
        if (type === 'webgl2' && value) contexts.add(value);
        return value;
    };
    const proto = globalThis.WebGL2RenderingContext?.prototype;
    for (const name of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']) {
        wrap(proto, name, (f,gl,args) => {
            f[name]++;
            if (name.endsWith('Instanced')) f.instances += args[args.length-1];
        });
    }
    for (const name of ['texImage2D','texImage3D','texSubImage2D','texSubImage3D','copyTexSubImage2D','copyTexSubImage3D'])
        wrap(proto,name,f=>f.textureUploads++);
    for (const name of ['bufferData','bufferSubData'])
        wrap(proto,name,f=>f.bufferUploads++);
    wrap(CanvasRenderingContext2D.prototype,'drawImage',(f,ctx) => {
        f.canvasImages++;
        if (ctx.canvas.isConnected) f.visibleCanvasImages++;
    });
    window.__bench = {
        contexts, nativeRaf,
        begin() {frame={drawArrays:0,drawElements:0,drawArraysInstanced:0,drawElementsInstanced:0,
            instances:0,textureUploads:0,bufferUploads:0,canvasImages:0,visibleCanvasImages:0};},
        end() {const value=frame;frame=null;return value;}
    };
}"""

SCENE = r"""async ({count,view,frames,warmup,strict}) => {
    const probe=window.__bench;
    const real = count === 0;
    const {world} = Numori;
    const battle = real ? Numori.battle : Battle.create(123);
    const economy = real ? Numori.economy : new Economy({seed:123,battle,difficulty:'normal',computerOpponent:false});
    if (!real) {
        const roles=Object.keys(Battle.types);
        for (const side of [0,1]) {
            const half=count/2, size=Math.floor(half/roles.length);
            roles.forEach((role,i)=>battle.spawn(side,role,i===roles.length-1 ? half-(roles.length-1)*size : size));
            let i=0;
            const columns=Math.ceil(Math.sqrt(half));
            for(const u of battle.units.filter(x=>x.side===side)){
                u.x=1500+(side?1:-1)*(4+(i%columns)*10);u.y=900+(Math.floor(i/columns)-columns/2)*10;i++;
            }
            if(battle.count(side)!==half) throw new Error('Invalid stress size');
        }
    }
    const scene={battle,economy};
    world.render(scene,1/30);
    if(view==='overview') world.overview(); else world.battle();
    const gl = [...probe.contexts].find(c=>c.canvas.isConnected) ?? null;
    if(strict && !gl) throw new Error('Active battlefield WebGL2 context not found');
    const ext=gl?.getExtension('EXT_disjoint_timer_query_webgl2');
    const info=gl?.getExtension('WEBGL_debug_renderer_info');
    const hardware=gl ? {
        renderer:info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
        vendor:info?gl.getParameter(info.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),
        version:gl.getParameter(gl.VERSION),timer:!!ext,textureSize:gl.getParameter(gl.MAX_TEXTURE_SIZE)
    } : null;
    const rows=[],queries=[],gpu=[];
    let disjoint=0,prevTime;
    function poll() {
        if(!ext) return;
        if(gl.getParameter(ext.GPU_DISJOINT_EXT)) {
            for(const q of queries)gl.deleteQuery(q);
            disjoint+=queries.length;queries.length=0;return;
        }
        while(queries.length && gl.getQueryParameter(queries[0],gl.QUERY_RESULT_AVAILABLE)) {
            const q=queries.shift();
            gpu.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);
            gl.deleteQuery(q);
        }
    }
    const initial={tick:battle.tick,alive:battle.units.length,attacks:battle.stats.attacks};
    for(let i=0;i<warmup+frames;i++){
        const now=await new Promise(resolve=>probe.nativeRaf(resolve));
        const start=performance.now();
        economy.tick(1/30);battle.step(1/30);
        const simMs=performance.now()-start;
        const q=ext && i>=warmup && (i-warmup)%4===0 ? gl.createQuery():null;
        probe.begin();
        if(q) gl.beginQuery(ext.TIME_ELAPSED_EXT,q);
        const drawStart=performance.now();
        world.render(scene,1/30);
        const submitMs=performance.now()-drawStart;
        if(q) {gl.endQuery(ext.TIME_ELAPSED_EXT);queries.push(q);}
        const counts=probe.end();
        if(i>=warmup){
            rows.push({...counts,draws:counts.drawArrays+counts.drawElements+counts.drawArraysInstanced+counts.drawElementsInstanced,
                instanced:counts.drawArraysInstanced+counts.drawElementsInstanced,simMs,submitMs,rafMs:now-prevTime});
            poll();
        }
        prevTime=now;
    }
    for(let i=0;i<20 && queries.length;i++){await new Promise(resolve=>probe.nativeRaf(resolve));poll();}
    for(const q of queries) gl.deleteQuery(q);
    const summarize = a=>{
        const sorted=[...a].sort((a,b)=>a-b);
        const nth=p=>Math.round(sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]*100)/100;
        return {min:nth(0),median:nth(.5),p95:nth(.95),max:nth(1)};
    };
    const stats=Object.fromEntries(Object.keys(rows[0]).map(k=>[k,summarize(rows.map(r=>r[k]))]));
    const drawHistogram={};
    for(const row of rows) drawHistogram[row.draws]=(drawHistogram[row.draws]||0)+1;
    const size=document.querySelector('#world').getBoundingClientRect();
    return {count,view,frames,warmup,hardware,initial,final:{tick:battle.tick,alive:battle.units.length,attacks:battle.stats.attacks,
            hits:battle.stats.hits,first:battle.units[0]?.id,baseHp:battle.bases.map(b=>b.hp)},
        canvasCss:[size.width,size.height],stats,drawHistogram,gpuTimeMs:gpu.length?summarize(gpu):null,
        gpuSamples:gpu.length,disjoint,engine:world.renderStats??null,rig:world.rigRendering??null};
}"""


def press(page, selector, touch):
    node=page.locator(selector).first
    (node.tap if touch else node.click)(force=True)


def main():
    cli=argparse.ArgumentParser(description=__doc__)
    cli.add_argument("build",type=Path)
    cli.add_argument("--out",type=Path,required=True)
    cli.add_argument("--screens",nargs="+",choices=VIEWS,default=list(VIEWS))
    cli.add_argument("--counts",nargs="+",type=int,choices=[100,500,1000,2000],default=[100,500,1000,2000])
    cli.add_argument("--views",nargs="+",choices=['near','overview'],default=['near','overview'])
    cli.add_argument("--warmup",type=int,default=15)
    cli.add_argument("--frames",type=int,default=40)
    cli.add_argument("--dpr",type=float,default=1)
    cli.add_argument("--chrome",default="chrome")
    cli.add_argument("--batch",choices=["auto","single","vector"],default="auto",
                     help="Select the production backend or a diagnostic forced-flush/control path.")
    cli.add_argument("--software",action="store_true")
    cli.add_argument("--webgl",action="store_true",help="Fail if the game silently falls back")
    cli.add_argument("--renderer",choices=["auto","canvas2d"],default="auto")
    cli.add_argument("--natural-tick",type=int,default=None,
                     help="Advance the real match to this tick for comparisons with archived runs. Default: first hit + 24 ticks.")
    cli.add_argument("--skip-natural",action="store_true")
    args=cli.parse_args()
    if args.warmup<1 or args.frames<2:cli.error("Provide at least one warmup frame and two samples.")
    args.out.mkdir(parents=True,exist_ok=True)
    opts={"channel":args.chrome,"args":["--disable-background-timer-throttling","--disable-renderer-backgrounding"]}
    if args.software:opts['args']+=['--use-angle=swiftshader','--enable-unsafe-swiftshader']
    report={"sha256":hashlib.sha256(args.build.read_bytes()).hexdigest(),"seed":123,"dpr":args.dpr,
        "os":platform.platform(),"batch":args.batch,"renderer":args.renderer,"naturalTick":args.natural_tick,"method":"One fixed match tick per real rAF then standalone world render. GPU timer samples one in four measured frames when supported; no gl.finish. API counter wrappers active during world render only.","runs":[]}
    with sync_playwright() as pw:
        browser=pw.chromium.launch(**opts)
        report['browser']=browser.version
        for device in args.screens:
            w,h=VIEWS[device];touch=device!='desktop'
            ctx=browser.new_context(viewport={'width':w,'height':h},is_mobile=touch,has_touch=touch,device_scale_factor=args.dpr,offline=True)
            page=ctx.new_page()
            errors=[]
            page.on('pageerror',lambda err:errors.append(str(err)))
            page.add_init_script('('+PROBE+')()')
            query = '?seed=123&debug=1' + ('' if args.batch=='auto' else '&gpuBatch='+args.batch)
            if args.renderer=='canvas2d':query+='&renderer=canvas2d'
            page.goto(args.build.resolve().as_uri()+query)
            page.evaluate('window.requestAnimationFrame=()=>0;window.cancelAnimationFrame=()=>{}')
            press(page,'[data-act=start]',touch)
            page.wait_for_function('!!window.Numori?.world',polling=50)
            scenarios=[(n,v) for n in args.counts for v in args.views]
            if not args.skip_natural:
                for key in ['[data-number="8"]','[data-op="mul"]','[data-number="4"]','[data-action="produce"]']:
                    press(page,key,touch)
                if args.natural_tick is None:
                    page.evaluate('''() => {
                        const {battle} = Numori;
                        while (battle.stats.hits < 1 && battle.winner < 0 && battle.tick < 30*180) Numori.advance(3);
                        if (battle.stats.hits < 1) throw Error('No actual match engagement');
                        Numori.advance(24);
                    }''')
                else:
                    page.evaluate('tick => Numori.advance(tick - Numori.battle.tick)',args.natural_tick)
                assert page.evaluate('Numori.battle.count(0)>0 && Numori.battle.count(1)>0'), 'Real match failed to create opposing armies'
                scenarios.insert(0,(0,'near'))
            for n,v in scenarios:
                row=page.evaluate(SCENE,dict(count=n,view=v,frames=args.frames,warmup=args.warmup,strict=args.webgl))
                row['device']=device
                report['runs'].append(row)
                assert not errors, errors
                if args.webgl:assert row['stats']['draws']['min']>0, row
                print(device,n or 'real',v,'draw',row['stats']['draws'],'instances',row['stats']['instances']['median'],'rAF',row['stats']['rafMs']['p95'],flush=True)
                if n in (0,2000):
                    page.locator('#world').screenshot(path=args.out/f'{device}-{n or "real"}-{v}.png')
                (args.out/'metrics.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
            ctx.close()
        browser.close()


if __name__=='__main__':
    main()
