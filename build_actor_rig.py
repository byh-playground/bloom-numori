"""Extract Numori's approved tile artwork into reusable, jointly animated parts.

Run with Pillow, numpy and scipy. The region IDs below refer to the colored
islands separated by the approved sheet's brown ink. For a new design, mark
the corresponding islands before rebuilding the rig. Coordinates are pixels
in the original 192-pixel cells; every pivot stays in the same coordinate frame.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent
CELL = 192
ROLES = ("shield", "archer", "spear", "charger", "thrower", "worker")
# Each set is a collection of connected color patches; e.g. the shield's
# blade and inset minus sign travel together, but the two feet never do.
ZONES = [
    dict(weapon=[4, 6], armL=[5], legL=[7], legR=[8]),
    dict(weapon=[2, 13], arrow=[6], armL=[8], hand=[9], legL=[16], legR=[17]),
    dict(weapon=[1, 2, 4, 5, 12], armL=[10], hand=[7, 9], legL=[13], legR=[14]),
    dict(weapon=[1], armL=[6], hand=[7], legL=[9], legR=[10]),
    dict(weapon=[1], hand=[3], armL=[7], legL=[11], legR=[12]),
    dict(weapon=[3, 6, 14], armL=[9], hand=[10], legL=[18], legR=[17]),
]
PIVOTS = [
    [(96, 147), (108, 77), (59, 146), (134, 145), (52, 103), (112, 117), (118, 120)],
    [(79, 146), (65, 80), (57, 146), (105, 146), (50, 105), (136, 104), (143, 106)],
    [(74, 148), (78, 68), (61, 149), (83, 149), (51, 111), (99, 102), (109, 102)],
    [(103, 145), (123, 116), (58, 145), (134, 144), (52, 123), (158, 123), (118, 92)],
    [(96, 148), (107, 78), (59, 145), (135, 146), (152, 96), (47, 86), (40, 73)],
    [(82, 144), (89, 100), (65, 146), (96, 142), (45, 113), (116, 118), (122, 118)],
]
PARTS = ("body", "face", "legL", "legR", "armL", "hand", "weapon", "arrow")
# Outline of the original unadorned body, used for the patches that become
# visible when an arm or weapon moves. The neutral sprite keeps original RGB.
BODY_PATHS = [
    [(47,139),(45,78),(49,58),(59,49),(78,47),(128,47),(144,54),(151,70),(151,128),(145,140),(133,148),(64,148)],
    [(24,107),(21,89),(24,72),(36,51),(57,37),(84,29),(112,29),(117,33),(98,47),(85,66),(83,83),(91,100),(106,114),(129,129),(126,140),(109,148),(75,151),(48,143),(31,129)],
    [(47,128),(47,50),(51,35),(62,26),(75,23),(87,30),(96,44),(98,129),(93,145),(83,152),(63,153),(51,144)],
    [(39,138),(48,119),(76,97),(110,77),(124,76),(142,93),(161,121),(156,140),(135,148),(68,150)],
    [(40,99),(45,81),(60,61),(84,49),(106,47),(129,52),(146,69),(155,88),(151,109),(143,130),(129,146),(107,154),(87,156),(65,149),(48,134),(40,115)],
    [(35,113),(40,95),(59,77),(85,69),(105,75),(125,103),(125,111),(91,143),(85,150),(75,149),(43,128)],
]
# Face regions tightly contain the two eyes, blush and mouth. Isolating
# pigmentation instead of cutting a rectangle avoids moving a chunk of skin.
FEATURES = [
    [(68,79,94,99),(81,61,103,85),(116,61,133,85),(99,80,120,96),(128,78,145,90)],
    [(36,79,57,92),(47,62,63,86),(74,61,82,83),(59,78,78,98)],
    [(55,65,72,84),(64,50,77,71),(86,50,95,71),(74,68,91,84),(87,66,96,82)],
    [(91,116,110,134),(106,98,124,121),(132,98,148,121),(120,118,139,140),(143,117,154,134)],
    [(66,73,91,91),(84,61,99,79),(115,60,131,78),(98,77,121,98),(128,72,147,91)],
    [(56,96,72,111),(70,83,84,101),(95,83,109,101),(80,100,99,117),(103,94,119,108)],
]
PIGMENTS = [(66,140,249),(169,210,83),(250,97,84),(252,143,63),(179,102,191),(147,227,191)]
SHADOWS = [(45,105,202),(128,172,60),(222,71,62),(244,106,40),(151,75,161),(100,197,161)]
EYES = [[(94,75),(126,75)],[(56,76),(77,73)],[(72,62),(91,62)],[(116,113),(141,113)],[(93,70),(123,68)],[(77,94),(102,92)]]

def polygon(points):
    image = Image.new("L", (CELL, CELL))
    ImageDraw.Draw(image).polygon(points, fill=255)
    return np.asarray(image) != 0

def clean_body(tile, owned, index):
    data = np.asarray(tile).copy()
    shape = polygon(BODY_PATHS[index])
    pigment = PIGMENTS[index]
    lower = SHADOWS[index]
    # A clean continuous cel-shaded underpaint avoids imprinting the dark
    # outline of a moving shield/eye on its revealed resting patch.
    shade_y = [135,139,136,138,142,140][index]
    y,x = np.indices((CELL,CELL))
    shadow = np.clip((y - shade_y + (x - 90)*0.10) / 3, 0, 1)[...,None]
    base_color = np.array(pigment)*(1-shadow) + np.array(lower)*shadow
    body = np.zeros_like(data)
    body[:,:,:3] = base_color.astype('uint8')
    body[:,:,3] = np.where(shape, data[:,:,3], 0)
    outline = shape & ~ndi.binary_erosion(shape,iterations=2)
    body[outline,:3] = (69,35,21)
    body[owned == 0] = data[owned == 0]
    return Image.fromarray(body)

def split(tile, index):
    a = np.asarray(tile)
    r,g,b,alpha = a.astype(float).transpose(2,0,1)
    ink=(r>g*.9)&(g<85)&(b<75)&(r<130)
    painted=(~ink)&(alpha>40)
    zones,_=ndi.label(painted)
    nearest=ndi.distance_transform_edt(~painted,return_distances=False,return_indices=True)
    region=zones[nearest[0],nearest[1]]
    owned = np.zeros((CELL,CELL),dtype=np.uint8)
    for name, ids in ZONES[index].items():
        mask = np.isin(region, ids) & (alpha>0)
        # Include the whole shared ink seam on the moving limb.
        mask |= (ndi.distance_transform_edt(~np.isin(zones,ids)) < 3.0) & ink & (alpha>0)
        owned[mask] = PARTS.index(name)
    if index == 1:
        # The loose bowstring crosses open space, and the thin arrow tail crosses
        # the strap. These unfilled strokes have no enclosed color island.
        for pts, name in [
            ([(91,96),(117,55),(120,59),(95,100)],'weapon'),
            ([(56,103),(91,97),(141,88),(150,85),(151,96),(95,106),(55,109)],'arrow')
        ]:
            mask=polygon(pts)&(alpha>0)
            owned[mask]=PARTS.index(name)
    feature = np.zeros_like(owned,dtype=bool)
    for x1,y1,x2,y2 in FEATURES[index]:
        feature[y1:y2+1,x1:x2+1]=True
    # Blush, mouth and ink remain attached to the face; interior skin is free
    # to move separately via the body rig.
    pigment = PIGMENTS[index]
    lower = SHADOWS[index]
    colors=a[:,:,:3].astype(float)
    different = np.minimum(np.linalg.norm(colors-pigment,axis=2),np.linalg.norm(colors-lower,axis=2))>43
    inside = ndi.binary_erosion(polygon(BODY_PATHS[index]),iterations=3)
    f = ndi.binary_fill_holes(feature & different & inside & (owned==0) & (alpha>0))
    owned[f]=PARTS.index("face")
    # Keep the one-pixel anti-aliased edge with its moving part. Otherwise
    # opaque source-edge remnants form a second outline on the body.
    distances,indices=ndi.distance_transform_edt(owned==0,return_indices=True)
    rim=(owned==0)&(alpha>0)&(distances<=1.45)
    owned[rim]=owned[indices[0][rim],indices[1][rim]]
    layers={"body":clean_body(tile,owned,index)}
    for k,name in enumerate(PARTS[1:],start=1):
        if name=='arrow' and index!=1:continue
        data=a.copy()
        data[:,:,3]=np.where(owned==k,alpha,0).astype('uint8')
        layers[name]=Image.fromarray(data)
    # Complete the short spans hidden by the grip in the neutral drawing.
    fill=Image.new('RGBA',(CELL,CELL))
    pen=ImageDraw.Draw(fill)
    if index==1:
        pen.line([(143,84),(145,96),(144,108),(139,123)],fill='#512c19',width=10)
        pen.line([(143,84),(145,96),(144,108),(139,123)],fill='#f6aa29',width=6)
    elif index==2:
        pen.line([(110,84),(106,126)],fill='#492a22',width=9)
        pen.line([(110,84),(106,126)],fill='#65c4a6',width=5)
    elif index==4:
        pen.ellipse((13,19,70,77),fill='#796f70',outline='#492b25',width=2)
    elif index==5:
        pen.line([(134,99),(114,130)],fill='#4b291b',width=11)
        pen.line([(134,99),(114,130)],fill='#9d652d',width=6)
    # Only fill places previously occupied by the hand. The empty regions
    # stay clear even when a weapon is held above the actor.
    under=np.asarray(fill).copy()
    # Continuous bow tip, grip, limbs / tool shaft are occluded by *both*
    # the arrow and gripping hand. Keep that geometry under both layers.
    hidden=(owned==PARTS.index('hand')) | (owned==PARTS.index('arrow'))
    under[:,:,3]=np.where(hidden,under[:,:,3],0)
    layers['weapon']=Image.alpha_composite(Image.fromarray(under), layers['weapon'])
    if index==1:
        # Rebuild the arrow-crossed arc on release, as well as its stretched
        # string. Both are covered by the original grip and shaft at rest.
        release=layers['weapon'].copy()
        restore=Image.new('RGBA',(CELL,CELL))
        pen=ImageDraw.Draw(restore)
        pen.line([(143,85),(145,96),(144,106),(140,120)],fill='#502919',width=10)
        pen.line([(143,85),(145,96),(144,106),(140,120)],fill='#f8b539',width=6)
        pen.line([(117,56),(93,99),(124,142)],fill='#573426',width=2)
        layers['weaponRelease']=Image.alpha_composite(restore,release)
    return layers

def face_variants(face, index):
    result={}
    # Small variants stay in the neutral face's coordinate frame, so the
    # runtime swaps just the facial overlay inside the same pose.
    for state in ['attack','hurt']:
        im=face.copy()
        draw=ImageDraw.Draw(im)
        for x,y in EYES[index]:
            if state=='hurt':
                draw.rectangle((x-6,y-8,x+6,y+7),fill=(0,0,0,0))
                draw.line([(x-4,y+1),(x,y-2),(x+4,y+1)],fill='#532618',width=2)
            else:
                draw.line([(x-4,y-6),(x+3,y-4)],fill='#532618',width=2)
        result[state]=im
    return result

def generate():
    image=Image.open(ROOT/'assets/geometry-actors.webp').convert('RGBA')
    atlas=Image.new('RGBA',(512,1024))
    roles={}
    x,y,height=1,1,0
    def store(part):
        nonlocal x,y,height
        w,h=part.size
        if x+w+1>atlas.width:
            x,y,height=1,y+height+2,0
        if y+h>atlas.height:raise ValueError("atlas overflow")
        rect=[x,y,w,h]
        atlas.paste(part,(x,y))
        x+=w+2
        height=max(height,h)
        return rect
    previews=[]
    for i,role in enumerate(ROLES):
        x0=i%3*CELL
        y0=i//3*CELL
        inp=image.crop((x0,y0,x0+CELL,y0+CELL))
        layers=split(inp,i)
        piv=dict(zip(PARTS,PIVOTS[i]))
        piv['arrow']=(82,102)
        skeleton=[]
        preview=Image.new('RGBA',(CELL,CELL))
        for name in ['body','legL','legR','face','armL','weapon','hand','arrow']:
            if name not in layers:continue
            part=layers[name]
            variants=face_variants(part,i) if name=='face' else {}
            if name=='weapon' and 'weaponRelease' in layers:
                variants['release']=layers['weaponRelease']
            bound=part.getchannel('A').getbbox()
            boxes=[q.getchannel('A').getbbox() for q in variants.values()]
            if boxes and bound:
                all_boxes=[bound,*boxes]
                bound=(min(b[0] for b in all_boxes),min(b[1] for b in all_boxes),max(b[2] for b in all_boxes),max(b[3] for b in all_boxes))
            if not bound:
                px,py=piv[name]
                bound=(px,py,px+1,py+1)
            parent = None if name=='body' else 'hand' if name in ['weapon','arrow'] and not (i==3 and name=='weapon') else 'body'
            item={'id':name,'parent':parent,'pivot':piv[name],'at':bound[:2],'rect':store(part.crop(bound))}
            if variants:item['variants']={state:store(im.crop(bound)) for state,im in variants.items()}
            skeleton.append(item)
            preview.alpha_composite(part)
        # This is paint order, independent of transform parentage.
        roles[role]=skeleton
        previews.append(preview)
    out=atlas.crop((0,0,atlas.width,y+height+1))
    out.save(ROOT/'assets/geometry-rig.webp','WEBP',lossless=True,method=6)
    metadata={'cell':CELL,'foot':[96,168],'roles':roles}
    (ROOT/'rig-data.js').write_text('// Generated by build_actor_rig.py from the approved Numori artwork.\n'+'globalThis.NumoriRigData = '+json.dumps(metadata,indent=2)+';\n',encoding='utf8')
    return previews

if __name__=='__main__':
    generate()
