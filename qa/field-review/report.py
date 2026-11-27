"""Rebuild the archived v0.5.2 comparison using its original worker-economy capture logs."""
from pathlib import Path
from io import BytesIO
from PIL import Image
from base64 import b64encode
from html import escape
import json, sys

ROOT = Path(__file__).resolve().parent
build = ROOT / sys.argv[1]
def picture(path, thumb=1200):
    if path.suffix==".webp":
        data=path.read_bytes()
    else:
        with Image.open(path) as im:
            im.thumbnail((thumb,900))
            stream=BytesIO()
            im.convert("RGB").save(stream,"WEBP",quality=88)
            data=stream.getvalue()
    return "data:image/webp;base64,"+b64encode(data).decode()
def shot(path,caption):
    return '<figure><figcaption>'+escape(caption)+'</figcaption><img loading="lazy" src="'+picture(path)+'" alt="'+escape(caption)+'"></figure>'
stages=[("home","본진 채집"),("advance","병력 진격"),("combat","중앙 교전"),("capture","광산 점령"),("siege","적 본진 공격"),("result","승패 화면")]
labels={"phone":"휴대폰 세로 · 390 × 844","landscape":"휴대폰 가로 · 844 × 390","pc":"PC · 1440 × 900"}
records=json.loads((build/"phone-state.json").read_text(encoding='utf8'))
def phase_text(k):
    s=records[k+"-split"][0]
    if k=="home":return f"양측 일꾼 {sum(s['workers'])}마리가 있는 시작 장면"
    if k=="advance":return f"전장 병력 {sum(s['units'])}마리"
    if k=="combat":return f"누적 공격 {s['attacks']}회 · 유닛 피격 {s['hits']}회"
    if k=="capture":return f"아군이 점령한 중앙 광산 {sum(m['owner']==0 for m in s['mines'])}곳"
    if k=="siege":return f"적 본진 체력 {s['bases'][1]['hp']:,.0f} / {s['bases'][1]['max']:,}"
    return f"아군 승리 · 아군 생산 {s['production'][0]}마리 / 적군 생산 {s['production'][1]}마리"
images={layout:[picture(build/f"{layout}-{k}-split.png") for k,_ in stages] for layout in labels}
captions=[f"{int(records[k+'-split'][0]['time']//60):02}:{int(records[k+'-split'][0]['time']%60):02} · {phase_text(k)}" for k,_ in stages]
buttons=lambda items,field:"".join(f'<button data-{field}="{v}">{escape(label)}</button>' for v,label in items)
out='''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>넘모리 전장 검수 · v0.5.2</title><style>*{box-sizing:border-box}body{font:16px/1.6 system-ui,sans-serif;color:#233e31;background:#f4f4e9;margin:0}main{max-width:920px;margin:auto;padding:22px 16px 46px}header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:7px}h1{margin:0;font-size:clamp(24px,4vw,42px)}h2{margin:26px 0 5px;font-size:21px}p{margin:8px 0}a{color:#146144}figure{margin:10px 0}img{width:100%;max-height:680px;object-fit:contain;background:#e6eadb;border:1px solid #bcc7b3;border-radius:8px;display:block}figcaption,#time{font-size:14px;font-weight:650;margin:5px 0}.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}nav{display:flex;flex-wrap:wrap;gap:4px;margin:8px 0}button{font:inherit;font-size:13px;padding:7px 10px;border:1px solid #a7b4a2;border-radius:5px;color:#244737;background:white;cursor:pointer}button[aria-pressed=true]{background:#224c3b;color:white}#film{max-height:450px}.frame{min-height:5em}</style><main><header><h1>넘모리 전장 검수</h1><a href="/numori/">게임 열기 →</a></header><p>v0.5.2 · 시드 123 · 보통 AI. 생산 버튼으로 군대를 만든 뒤 같은 입력 순서와 시뮬레이션 틱으로 수정 전후를 비교했습니다. 장면 사이의 대기는 가속했습니다.</p><h2>중앙 교전</h2>'''
films={k:picture(build/f'landscape-{k}-follow.webp') for k in ['advance','combat','siege']}
out+='<nav>'+buttons([('advance','진격'),('combat','교전'),('siege','공성')],'clip')+'</nav><img id="film" alt="전장 움직임"><p>교전 버튼을 누른 뒤 카메라를 조작하지 않고 각 구간을 게임 시간 4초, 초당 15장으로 기록했습니다.</p>'
out+='<h2>한 판의 실제 게임 화면</h2><nav>'+buttons(labels.items(),"layout")+'</nav><nav>'+buttons(enumerate(label for _,label in stages),"stage")+'</nav><p id="time"></p><div class="frame"><img id="scene"></div>'
out+='<h2>작은 화면에서 사라졌던 전장</h2><p>작업대가 열린 320 × 568 화면에서 전장 캔버스 높이를 측정했습니다. 이전 공개본은 0px였고, 수정본은 143px입니다.</p><div class="pair">'+shot(ROOT/'old-home-320.png','수정 전 · 전장이 보이지 않음')+shot(ROOT/'new-home-320.png','수정 후 · 출격 중인 전장과 작업대')+'</div>'
out+='<h2>교전 바로가기가 보여주는 위치</h2><p>같은 입력으로 20초까지 진행한 뒤 교전 버튼을 눌렀습니다. 화면 중앙 절반에 들어온 진격 병력이 0마리에서 24마리로 바뀌었습니다.</p><div class="pair">'+shot(ROOT/'before'/'landscape-advance-front.png','수정 전 · 중앙 광산')+shot(build/'landscape-advance-front.png','수정 후 · 진격 중인 병력')+'</div>'
out+='<h2>검증 환경</h2><p>브라우저 터치 에뮬레이션과 PC 브라우저로 검수했습니다. 미니맵 이동과 교전 바로가기, 전장 확대·복귀, 채집·전투·거점 상태를 확인했습니다. 좁은 전선을 가까이 볼 때는 다른 광산의 상황이나 공성 후열이 화면 밖에 있을 수 있습니다. 여러 병력이 겹친 근접전에서 개별 공격자의 식별에는 여전히 한계가 있습니다. 실제 휴대전화 성능은 미측정입니다.</p></main>'
out+='<script>const films='+json.dumps(films)+',frames='+json.dumps(images)+',captions='+json.dumps(captions,ensure_ascii=False)+''';let layout='phone',stage=2;function movie(k){document.querySelector('#film').src=films[k];document.querySelectorAll('[data-clip]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.clip===k));}movie('combat');function show(){scene.src=frames[layout][stage];scene.alt=captions[stage];document.querySelector('#time').textContent=captions[stage];document.querySelectorAll('[data-layout]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.layout===layout));document.querySelectorAll('[data-stage]').forEach(b=>b.setAttribute('aria-pressed',+b.dataset.stage===stage));}document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.clip){movie(b.dataset.clip);return;}if(b.dataset.layout)layout=b.dataset.layout;if(b.dataset.stage!==undefined)stage=+b.dataset.stage;show()});show()</script>'''
(ROOT/'verification.html').write_text(out,encoding='utf8')
