globalThis.Battle = (() => {
    "use strict";
    // Distances are world units. Troops share the same population and production cost.
    const settings = {width:3000, height:1800, armyLimit:1000, hqHp:1400, hqRadius:66, siegeDamage:0.34,
        captureRadius:116, captureSeconds:30, giantRespawn:28, cellSize:40, separation:13, scanSteps:11, maxEffects:180, chargeDistance:56, guardReach:39};
    const defense = {
        base: {radius:settings.hqRadius, hp:settings.hqHp, range:220, damage:24, period:0.2, shotSpeed:520, muzzle:46, push:5},
        tower: {radius:41, hp:720, range:200, damage:22, period:0.2, shotSpeed:520, muzzle:49, push:5},
    };
    const mortar = { interval: 5, radius: 38, arcHeight: 72, minFlight: 0.48, flightSpeed: 380 };
    // Both the map painter and movement use the same west-to-east road centers.
    const routes = {
        bridge: [{x:360,y:900},{x:1500,y:900},{x:2640,y:900}],
        supply: [{x:360,y:900},{x:475,y:900},{x:960,y:1220},{x:1500,y:1220},
            {x:2040,y:1220},{x:2525,y:900},{x:2640,y:900}],
    };
    const types = {
        archer:{name:"궁병",hp:63,damage:9,period:0.94,range:145,speed:48,push:3,shot:"arrow",shotSpeed:350},
        shield:{name:"방패병",hp:155,damage:7.5,period:1.0,range:21,speed:43,push:11,resist:0.75,guard:0.36},
        charger:{name:"돌격병",hp:88,damage:11.5,period:0.93,range:25,speed:76,push:10,charge:33},
        spear:{name:"창병",hp:91,damage:10,period:0.95,range:51,speed:50,push:20,brace:true},
        thrower:{name:"투척병",hp:60,damage:5.8,period:1.66,range:111,speed:45,push:8,shot:"stone",shotSpeed:202,blast:30}
    };
    const giants = {
        bulwark: {name:"방패 거인",role:"방패 휩쓸기",unitType:"shield",radius:24,hp:1200,damage:45,period:0.95,range:34,speed:43,push:24,resist:0.95,guard:0.50,blast:56},
        breaker: {name:"공성 거인",role:"타워 돌파",unitType:"spear",radius:22,hp:760,damage:84,period:1.15,range:45,speed:52,push:32,resist:0.82,siegePower:2.3,blast:66},
        lobber: {name:"투석 거인",role:"원거리 폭발",unitType:"thrower",radius:21,hp:620,damage:62,period:1.55,range:160,speed:42,push:21,resist:0.78,shot:"stone",shotSpeed:250,blast:80},
    };
    const largestGiantRadius = Math.max(...Object.values(giants).map(giant => giant.radius));
    const roles = Object.freeze({
        archer: {description:"뒤에서 화살을 쏴요. 적이 붙으면 장전하면서 물러나요.", strongAgainst:["spear"]},
        shield: {description:"앞에서 날아오는 화살을 막고, 바로 뒤 아군을 지켜요.", strongAgainst:["archer"]},
        charger: {description:"빠르게 달려 가까운 원거리 병력을 노려요.", strongAgainst:["archer","thrower"]},
        spear: {description:"긴 창으로 돌격을 멈추고 역습해요.", strongAgainst:["charger"]},
        thrower: {description:"뭉친 적에게 돌을 던져 여럿을 한꺼번에 때려요.", strongAgainst:["shield"]},
    });
    const clamp = (n, min, max) => Math.max(min, Math.min(max,n));
    function distance2(a,b) {
        const dx=a.x-b.x, dy=a.y-b.y;
        return dx*dx+dy*dy;
    }
    const emptyCounts = () => Object.fromEntries(Object.keys(types).map(key=>[key,0]));
    function structure(kind,id,x,y,side,route) {
        const spec=defense[kind];
        return {kind,id,x,y,side,route,isBase:kind==="base",isStructure:true,radius:spec.radius,
            hp:spec.hp,maxHp:spec.hp,cooldown:0,lastShot:null,lastShotKind:null,shotCount:0};
    }
    class Field {
        constructor(seed=1) {
            this.seed=Number(seed)>>>0;
            this.time=0; this.tick=0; this.nextId=1; this.winner=-1;
            this.units=[]; this.projectiles=[]; this.effects=[];
            this.damageFx = new Map();
            this.shotSerial = 0;
            this.counts=[emptyCounts(),emptyCounts()];
            this.giantCounts=[{bulwark:0,breaker:0,lobber:0},{bulwark:0,breaker:0,lobber:0}];
            this.totals=[0,0];
            this.threat=[false,false];
            this.bases=[360,2640].map((x,side)=>structure("base",-1-side,x,900,side));
            const towerX=875;
            const [,fork,bend]=routes.supply;
            const towerY=fork.y+(bend.y-fork.y)*(towerX-fork.x)/(bend.x-fork.x);
            this.towers=[towerX,settings.width-towerX].map((x,side)=>({
                bridge:structure("tower",-3-2*side,x,900,side,"bridge"),
                supply:structure("tower",-4-2*side,x,towerY,side,"supply"),
            }));
            this.defenders=[...this.bases,...this.towers.flatMap(Object.values)];
            this.station={...routes.supply[3],kind:"giantCamp",owner:-1,claimant:-1,progress:0,
                presence:[0,0],giantKind:null,nextSpawn:null,lastRecruit:null,recruits:[0,0],rotation:0};
            this.giantOrder=[];
            this.mines=[this.station];
            this.appearGiant();
            this.focus={x:1500,y:900};
            this.stats={attacks:0,hits:0,shots:0,defenseShots:0,defenseHits:0,defenseBlasts:0,towerLosses:[0,0],blasts:0,
                deaths:[0,0],captures:[0,0],firstCombat:null,firstCapture:null,firstBaseHit:null,peak:0,charges:[0,0],braces:[0,0],blocks:[0,0]};
            this.metrics={collisionCandidates:0,targetCandidates:0,searches:0};
            this.grid=new NumoriGameKit.UniformGrid({width:3000,height:1800,cellSize:settings.cellSize,groups:2,outside:"clamp"});
            this.scratch=[];
        }
        count(side){return this.totals[side];}
        random(key){return NumoriGameKit.statelessRandom(this.seed,key)/4294967296;}
        appearGiant() {
            const camp=this.station;
            if (!this.giantOrder.length) {
                const order=Object.keys(giants);
                for(let i=order.length-1;i>0;i--) {
                    const j=Math.floor(this.random(0x719ca1 + 3*camp.rotation + i)*(i+1));
                    [order[i],order[j]]=[order[j],order[i]];
                }
                if (order[0]===camp.lastRecruit?.giantKind) [order[0],order[1]]=[order[1],order[0]];
                this.giantOrder=order;
            }
            camp.giantKind=this.giantOrder.shift();
            camp.rotation++;
            camp.nextSpawn=null;
            camp.owner=-1;
        }
        deployUnit(side,type,spec,x,y,{route,waypoint,offset,giantKind}={}) {
            const id=this.nextId++, facing=side===0?1:-1;
            this.units.push({id,x,y,side,type,spec,hp:spec.hp,maxHp:spec.hp,born:this.time,giantKind,radius:spec.radius,
                hit:0,attack:0,moving:true,facing,cooldown:this.random(id)*0.6,windup:0,target:null,
                route,waypoint,offset:offset ?? (this.random(id+7919)-0.5)*112,
                travel:0,walkDistance:0,braced:false,chargeReady:false,recoil:0,vx:0,vy:0,sx:0,sy:0});
            if(giantKind) this.giantCounts[side][giantKind]++;
            else this.counts[side][type]++;
            this.totals[side]++;
        }
        effect(kind,x,y,side,life=0.35, detail = {}) {
            if(this.effects.length>=settings.maxEffects && !["summon","bonus","capture","destroy","towerDestroy"].includes(kind)) return;
            this.effects.push({kind,x,y,side,age:0,life,...detail});
        }
        spawn(side,type,count,bonus=false,{attackMultiplier=1,hpMultiplier=1,equation=null,opening=false,route="bridge"}={}) {
            if(this.winner!==-1 || !Object.hasOwn(types,type) || !(side===0 || side===1) || !Number.isSafeInteger(count) || count<1) return 0;
            if (!Object.hasOwn(routes,route)) return 0;
            if (opening) route = "bridge";
            count=Math.min(count,settings.armyLimit-this.count(side));
            if(count<=0)return 0;
            const base=this.bases[side], archetype=types[type], facing=side===0?1:-1;
            const hp=archetype.hp*hpMultiplier, damage=archetype.damage*attackMultiplier;
            if(!Number.isFinite(hpMultiplier) || !Number.isFinite(attackMultiplier) ||
                !(hp>0) || !Number.isFinite(hp) || damage<0 || !Number.isFinite(damage)) return 0;
            // Each projectile carries its firing batch's spec until impact.
            const spec=hpMultiplier===1 && attackMultiplier===1 ? archetype : {...archetype,hp,damage};
            const cols=Math.ceil(Math.sqrt(count*0.72));
            const rows=Math.ceil(count/cols);
            const spacing=Math.min(15,390/Math.max(cols,rows));
            const angle=this.random(this.nextId)*0.28-0.14;
            const cos=Math.cos(angle), sin=Math.sin(angle);
            let launchX=base.x+facing*115;
            if (opening) {
                // A late first deployment defends from its own side of the approaching front.
                const halfDepth = spacing * ((rows - 1) * cos + (cols - 1) * Math.abs(sin)) / 2;
                let forward = (settings.width / 2 - base.x) * facing - 220;
                for (const foe of this.units) {
                    if (foe.side !== side && foe.hp > 0)
                        forward = Math.min(forward, (foe.x - base.x) * facing - 70 - halfDepth);
                }
                launchX = clamp(base.x + facing * forward, 20 + halfDepth, settings.width - 20 - halfDepth);
            }
            for(let i=0;i<count;i++) {
                const lateral=(i%cols-(cols-1)/2)*spacing, depth=(Math.floor(i/cols)-(rows-1)/2)*spacing;
                const x=launchX+depth*cos-lateral*sin, y=base.y+depth*sin+lateral*cos;
                this.deployUnit(side,type,spec,x,y,{route,waypoint:route==="supply"?(side===0?2:4):1});
            }
            this.stats.peak=Math.max(this.stats.peak,this.units.length);
            this.effect(bonus?"bonus":"summon",launchX,base.y,side,bonus?1.45:1.1,{type,count,equation,route});
            return count;
        }
        acquire(u) {
            const radius = Math.max(u.spec.charge ? 174 : 132, u.spec.range + 50);
            const near = this.grid.queryCircle(u.x, u.y, radius, this.scratch, 1 - u.side);
            this.metrics.targetCandidates += near.length;
            this.metrics.searches++;
            let target = null;
            let best = Infinity;
            const tower = this.towers[1-u.side][u.route];
            const separatedLanes = Math.abs(u.x - tower.x) < 175 || Math.abs(u.x - this.towers[u.side][u.route].x) < 175;
            const facing = u.side === 0 ? 1 : -1;
            const beforeTower = tower.hp > 0 && (u.x - tower.x) * facing < 0;
            for (const foe of near) {
                if (foe.hp <= 0) continue;
                if (separatedLanes && foe.route !== u.route) continue;
                if (beforeTower && (foe.x - tower.x) * facing > tower.radius) continue;
                const distance = distance2(u, foe);
                if (distance > radius * radius) continue;
                // A cavalry unit can slip around a front line to catch a nearby ranged unit.
                // It still fights the nearest enemy when an opponent closes to contact.
                const flank = u.spec.charge && foe.spec.shot && distance > 34 ** 2;
                const priority = flank ? 0.48 : 1;
                if (distance * priority < best) {
                    target = foe;
                    best = distance * priority;
                }
            }
            return target;
        }
        contact(u,dt) {
            // Ordinary pairs keep the cheap local search. A giant handles its larger pairs itself.
            const radius=u.radius ?? 0;
            const search=settings.separation+(radius ? (radius+largestGiantRadius)*0.6 : 0);
            const near=this.grid.queryCircle(u.x,u.y,search,this.scratch);
            this.metrics.collisionCandidates+=near.length;
            for(let i=0;i<near.length;i++) {
                const other=near[i];
                if(other===u || other.hp<=0) continue;
                const otherRadius=other.radius ?? 0;
                if(!radius && otherRadius || !!radius===!!otherRadius && other.id<=u.id) continue;
                const reach=settings.separation+(radius+otherRadius)*0.6;
                let dx=u.x-other.x,dy=u.y-other.y,d2=dx*dx+dy*dy;
                if(d2>=reach*reach) continue;
                if(d2<0.00001){dx=u.id%2?0.01:-0.01; dy=0;d2=0.0001;}
                const d=Math.sqrt(d2), force=(reach-d)/d*Math.min(0.45,dt*6);
                const weight=radius && !otherRadius ? 0.38 : 1;
                u.sx+=dx*force*weight; u.sy+=dy*force*weight;
                other.sx-=dx*force; other.sy-=dy*force;
            }
        }
        recordDamage(target, source, amount, style, burst) {
            if (!(amount > 0)) return;
            // Ordinary hits share one short per-target window. Each stone impact has
            // one distinct record for its victims; siege damage stays with the HQ.
            const area = burst && !target.isStructure;
            const key = area ? 'area/' + burst.serial : target.id + '/' + style + '/' + Math.floor(this.tick / 5);
            const previous = this.damageFx.get(key);
            if (previous) {
                previous.uniformAmount = previous.uniformAmount && Math.abs(amount - previous.unitAmount) < 1e-9;
                previous.amount += amount;
                previous.hits++;
                previous.kills += Number(target.hp === 0);
                previous.last = this.time;
                return;
            }
            if (this.damageFx.size >= 112) this.damageFx.delete(this.damageFx.keys().next().value);
            const dx = target.x - source.x;
            const dy = target.y - source.y;
            const distance = Math.hypot(dx, dy) || 1;
            this.damageFx.set(key, {
                born: this.time, last: this.time, amount, hits: 1, unitAmount: amount, uniformAmount: true, kills: Number(target.hp === 0),
                x: area ? burst.x : target.x, y: area ? burst.y : target.y,
                dx: dx / distance, dy: dy / distance, style, side: source.side, targetSide: target.side,
                base: !!target.isStructure, targetId: area ? null : target.id,
                spread: this.random((area ? burst.serial : Math.abs(target.id)) + this.tick),
            });
        }
        damage(target,source,power,push,style="melee",burst=null) {
            if(target.hp<=0) return;
            const previousHp = target.hp;
            const siegePower = target.isStructure ? (source.spec?.siegePower ?? 1) : 1;
            target.hp=Math.max(0,target.hp-power*siegePower*(target.isBase?settings.siegeDamage:1));
            this.recordDamage(target, source, previousHp - target.hp, style, burst);
            if(target.kind==="tower") {
                if(!target.hp) {
                    this.stats.towerLosses[target.side]++;
                    this.effect("towerDestroy",target.x,target.y,target.side,1.15,{route:target.route});
                }
                return;
            }
            if(target.isBase) {
                this.stats.firstBaseHit??=this.time;
                if(target.hp<=0 && this.winner===-1) {
                    this.winner=source.side;
                    this.effect("destroy",target.x,target.y,target.side,2);
                }
                return;
            }
            if(source.isStructure) this.stats.defenseHits++;
            else {this.stats.firstCombat??=this.time; this.stats.hits++;}
            target.hit=1;
            const dx=target.x-source.x,dy=target.y-source.y,d=Math.sqrt(dx*dx+dy*dy)||1;
            const impulse=push*(1-(target.spec.resist||0));
            target.vx+=dx/d*impulse; target.vy+=dy/d*impulse;
            if(!target.hp){
                this.stats.deaths[target.side]++;
                if(target.giantKind) this.giantCounts[target.side][target.giantKind]--;
                else this.counts[target.side][target.type]--;
                this.totals[target.side]--;
                this.effect("death",target.x,target.y,target.side,0.55,{seed:target.id,dx:dx/d,dy:dy/d});
            }
            this.focus.x+=(target.x-this.focus.x)*0.07; this.focus.y+=(target.y-this.focus.y)*0.07;
        }
        strike(u, target) {
            const s = u.spec;
            this.stats.attacks++;
            const dx = target.x - u.x;
            const dy = target.y - u.y;
            const distance = Math.hypot(dx, dy) || 1;
            const direction = {dx: dx / distance, dy: dy / distance};
            if (s.shot) {
                const duration = Math.max(0.14, distance / s.shotSpeed);
                this.projectiles.push({x:u.x,y:u.y,z:4,side:u.side,kind:s.shot,dx,dy,
                    serial:++this.shotSerial,startX:u.x,startY:u.y,endX:target.x,endY:target.y,age:0,duration,target,spec:s,
                    giantKind:u.giantKind});
                this.stats.shots++;
            } else if (u.giantKind && s.blast) {
                this.applyBlast({x:target.x,y:target.y,serial:++this.shotSerial,...direction},u,target,s.blast,"giantBlast");
            } else {
                const charged = s.charge && u.travel >= settings.chargeDistance;
                const stopped = charged && target.braced && direction.dx * target.facing <= 0;
                if (stopped) {
                    this.stats.braces[target.side]++;
                    target.lastBraceTime = this.time;
                    this.effect("brace", target.x, target.y, target.side, 0.43, {dx:-direction.dx,dy:-direction.dy});
                    u.recoil = Math.max(u.recoil, 0.54);
                    this.damage(u, target, target.spec.damage * 2.6, 55, "brace");
                    this.damage(target, u, s.damage * 0.12, 0, "charge");
                } else {
                    if (charged) {
                        this.stats.charges[u.side]++;
                        this.effect("charge", target.x, target.y, u.side, 0.36, direction);
                    }
                    let power = s.damage;
                    let push = s.push;
                    if (s.charge && target.spec?.shot) power *= charged ? 1.35 : 1.28;
                    if (charged) {
                        power *= 1.62;
                        push += s.charge;
                    }
                    if (s.brace && target.spec?.charge) {
                        if (target.travel >= settings.chargeDistance) {
                            this.stats.braces[u.side]++;
                            u.lastBraceTime = this.time;
                            this.effect("brace", u.x, u.y, u.side, 0.43, direction);
                        }
                        target.travel = 0;
                        target.chargeReady = false;
                        target.recoil = Math.max(target.recoil, 0.34);
                        power *= 2.2;
                    }
                    this.damage(target, u, power, push, charged ? "charge" : s.brace ? "thrust" : "melee");
                }
            }
            u.travel = 0;
            u.chargeReady = false;
        }
        fireDefenses(dt) {
            for(const building of this.defenders) {
                if(building.hp<=0) continue;
                building.cooldown=Math.max(0,building.cooldown-dt);
                if(building.cooldown>1e-8) continue;
                const spec=defense[building.kind];
                const near=this.grid.queryCircle(building.x,building.y,spec.range,this.scratch,1-building.side);
                let target=null, best=spec.range**2;
                for(const foe of near) {
                    if(foe.hp<=0 || (building.route && building.route!==foe.route)) continue;
                    const distance=distance2(building,foe);
                    if(distance<best || (target && distance===best && foe.id<target.id)) {
                        best=distance;
                        target=foe;
                    }
                }
                if(!target) continue;
                const distance=Math.sqrt(best)||1;
                const lob = ++building.shotCount % mortar.interval === 0;
                const kind = lob ? "mortar" : "bolt";
                building.lastShot=this.time;
                building.lastShotKind=kind;
                building.cooldown=spec.period;
                this.projectiles.push({x:building.x,y:building.y,z:spec.muzzle,side:building.side,kind,
                    sourceId:building.id,dx:(target.x-building.x)/distance,dy:(target.y-building.y)/distance,
                    serial:++this.shotSerial,startX:building.x,startY:building.y,endX:target.x,endY:target.y,
                    age:0,duration:lob ? Math.max(mortar.minFlight,distance/mortar.flightSpeed) :
                        Math.max(0.16,distance/spec.shotSpeed),target,spec,
                    arcHeight:lob ? mortar.arcHeight : 0,splashRadius:lob ? mortar.radius : 0});
                this.stats.defenseShots++;
            }
        }
        arrowGuard(target, shot) {
            let guard = target.spec?.guard && (shot.startX - target.x) * target.facing >= 0 ? target : null;
            if (guard || target.isStructure || target.hp <= 0 ||
                !this.counts[target.side].shield && !this.giantCounts[target.side].bulwark) return guard;
            const nearby = this.grid.queryCircle(target.x, target.y, settings.guardReach, this.scratch, target.side);
            const dx = shot.startX - target.x;
            const dy = shot.startY - target.y;
            const distance = Math.hypot(dx, dy) || 1;
            let foremost = 5;
            for (const ally of nearby) {
                if (!ally.spec.guard || ally.hp <= 0 || (shot.startX - ally.x) * ally.facing < 0) continue;
                const offsetX = ally.x - target.x;
                const offsetY = ally.y - target.y;
                const lead = (offsetX * dx + offsetY * dy) / distance;
                const lateral = Math.abs(offsetX * dy - offsetY * dx) / distance;
                if (lead > foremost && lead < distance && lateral < (ally.radius ?? 11)) {
                    foremost = lead;
                    guard = ally;
                }
            }
            return guard;
        }
        applyBlast(impact, source, target, radius, style) {
            const spec=source.spec;
            const radialFalloff=style==="blast";
            const near=this.grid.queryCircle(impact.x,impact.y,radius,this.scratch,1-source.side);
            for (const foe of near) {
                const distance=distance2(impact,foe);
                if (distance>radius*radius) continue;
                const scale=radialFalloff ? 1-0.45*Math.sqrt(distance)/radius : 1;
                this.damage(foe,source,spec.damage*scale,spec.push,style,impact);
            }
            this.stats.blasts++;
            if (style==="defenseBlast") this.stats.defenseBlasts++;
            this.effect(style,impact.x,impact.y,source.side,0.68,
                {seed:impact.serial,dx:impact.dx,dy:impact.dy,radius,giantKind:source.giantKind});
            if (target.isStructure) this.damage(target,source,spec.damage,0,style,impact);
        }
        advanceShots(dt) {
            let keep=0;
            for(const p of this.projectiles) {
                p.age+=dt;
                const t=Math.min(1,p.age/p.duration);
                if(p.kind!=="stone" && p.kind!=="mortar" && p.target.hp>0) {p.endX=p.target.x;p.endY=p.target.y;}
                p.x=p.startX+(p.endX-p.startX)*t; p.y=p.startY+(p.endY-p.startY)*t;
                const launchHeight = p.sourceId ? p.spec.muzzle : 4;
                const arc = p.arcHeight ?? (p.kind==="stone" ? 48 : 12);
                p.z=4+(launchHeight-4)*(1-t)+arc*4*t*(1-t);
                if(t<1){this.projectiles[keep++]=p;continue;}
                const s=p.spec, source={x:p.startX,y:p.startY,side:p.side,isStructure:!!p.sourceId,spec:s,giantKind:p.giantKind};
                const splashRadius = p.splashRadius || s.blast;
                if(splashRadius){
                    const style = p.kind==="mortar" ? "defenseBlast" : p.giantKind ? "giantBlast" : "blast";
                    this.applyBlast(p,source,p.target,splashRadius,style);
                } else {
                    const guard = this.arrowGuard(p.target, p);
                    if (guard) {
                        const dx = guard.x - source.x;
                        const dy = guard.y - source.y;
                        const distance = Math.hypot(dx, dy) || 1;
                        this.stats.blocks[guard.side]++;
                        guard.lastBlockTime = this.time;
                        this.effect("block", guard.x, guard.y, guard.side, 0.25, {dx:-dx/distance,dy:-dy/distance});
                        this.damage(guard,source,s.damage*guard.spec.guard,s.push*0.25,"blocked");
                    } else this.damage(p.target,source,s.damage,s.push,p.kind);
                }
            }
            this.projectiles.length=keep;
        }
        advanceUnit(u,dt) {
            const s=u.spec, foeBase=this.bases[1-u.side], dir=u.side===0?1:-1;
            const tower=this.towers[1-u.side][u.route], gate=tower.x-dir*tower.radius*0.55;
            const waitingAtTower=tower.hp>0 && (u.x-tower.x)*dir<0;
            if(u.target && (u.target.hp<=0 || distance2(u,u.target)>65000))u.target=null;
            if(waitingAtTower && u.target && (u.target.x-tower.x)*dir>tower.radius) u.target=null;
            if(!u.windup && (this.tick+u.id)%settings.scanSteps===0) u.target=this.acquire(u);
            const road=routes[u.route];
            let waypoint=road[u.waypoint];
            const atStation = u.route==="supply" && u.waypoint===3;
            const fullArmyCanAdvance = atStation && this.station.claimant===u.side &&
                this.station.progress===1 && this.count(u.side)>=settings.armyLimit;
            if (waypoint && waypoint.x!==foeBase.x && (u.x-waypoint.x)*dir>=-20 &&
                (!atStation || !this.station.giantKind || fullArmyCanAdvance)) {
                u.waypoint+=dir;
                waypoint=road[u.waypoint];
            }
            const approachTower = waitingAtTower && (u.route==="bridge" || (u.waypoint-3)*dir>0) &&
                (tower.x-u.x)*dir <= Math.max(165,s.range+tower.radius+8);
            const nearBase = !waitingAtTower && distance2(u,foeBase)<(s.range+foeBase.radius+6)**2;
            const target=u.target || (approachTower?tower:nearBase?foeBase:null);
            u.structureTarget=target?.isStructure ? target : null;
            let gx,gy;
            if(target){gx=target.x; gy=target.y;}
            else {gx=waypoint.x; gy=waypoint.y+u.offset*Math.min(1,Math.abs(foeBase.x-u.x)/220);}
            const dx=gx-u.x,dy=gy-u.y,d=Math.sqrt(dx*dx+dy*dy)||0.001;
            const range=s.range+(target?.radius||0);
            const inRange=target && d<=range;
            // Spearmen plant their feet when an opposing charge enters their reach.
            // Bracing is visible before impact, with no manual order required.
            u.braced = !!(s.brace && target && !target.isStructure && d <= s.range + 8 && !u.recoil);
            u.recoil = Math.max(0, u.recoil - dt);
            u.chargeReady = !!(s.charge && u.travel >= settings.chargeDistance && !u.recoil);
            u.cooldown-=dt; u.attack=Math.max(0,u.attack-dt*3.8); u.hit=Math.max(0,u.hit-dt*4.6);
            u.facing=Math.abs(dx)>0.5?Math.sign(dx):u.facing;
            if(u.recoil>0) {
                u.windup=0;
            } else if(u.windup>0) {
                u.windup=Math.max(0,u.windup-dt);
                if(!u.windup && target && d<range+14) this.strike(u,target);
            } else if(inRange && u.cooldown<=0) {
                u.windup=0.12; u.cooldown=s.period;
                u.attack=1;
            }
            // Archers step away while reloading if a melee enemy has pushed inside their range.
            const retreat = s.shot === "arrow" && target && !target.isStructure && !target.spec.shot &&
                d < 59 && d > 7 && u.cooldown > 0.24 && (u.x - this.bases[u.side].x) * dir > 120;
            u.moving = (!inRange || retreat) && !u.braced && u.windup === 0 && u.recoil === 0;
            if (u.moving) {
                const stride = (retreat ? -0.66 : u.chargeReady && target && !target.isStructure ? 1.2 : 1);
                const move=Math.min(d,s.speed*dt)*stride;
                u.x+=dx/d*move; u.y+=dy/d*move;
                u.walkDistance += Math.abs(move);
                if (move > 0) u.travel+=move;
            }
            const decay=Math.max(0,1-5*dt);
            u.x=clamp(u.x+u.vx*dt+clamp(u.sx,-4,4),20,settings.width-20);
            if(waitingAtTower && (u.x-gate)*dir>0) u.x=gate;
            u.y=clamp(u.y+u.vy*dt+clamp(u.sy,-4,4),20,settings.height-20);
            u.vx*=decay;u.vy*=decay;
            if(Math.abs(u.x-foeBase.x)<290 && Math.abs(u.y-foeBase.y)<300)this.threat[1-u.side]=true;
        }
        capture(dt) {
            const camp=this.station;
            camp.presence.fill(0);
            if (!camp.giantKind) {
                if (this.time + 1e-8 < camp.nextSpawn) return;
                this.appearGiant();
            }
            for (const u of this.units) {
                if (u.route==="supply" && !u.giantKind && distance2(u,camp)<settings.captureRadius**2)
                    camp.presence[u.side]++;
            }
            const [a,b]=camp.presence;
            if(a===b) {
                if(!a) {camp.progress=0;camp.claimant=-1;}
                return;
            }
            const leader=a>b?0:1;
            if(leader!==camp.claimant) {camp.progress=0;camp.claimant=leader;}
            const progress=camp.progress+dt/settings.captureSeconds;
            camp.progress=progress>=1-1e-8 ? 1 : progress;
            if(camp.progress<1 || this.count(leader)>=settings.armyLimit) return;

            const giantKind=camp.giantKind, spec=giants[giantKind];
            this.deployUnit(leader,spec.unitType,spec,camp.x,camp.y,
                {route:"supply",waypoint:leader===0?4:2,offset:0,giantKind});
            camp.owner=leader;
            camp.claimant=-1;
            camp.progress=0;
            camp.giantKind=null;
            camp.nextSpawn=this.time+settings.giantRespawn;
            camp.lastRecruit={side:leader,time:this.time,giantKind};
            camp.recruits[leader]++;
            this.stats.firstCapture??=this.time;
            this.stats.captures[leader]++;
            this.stats.peak=Math.max(this.stats.peak,this.units.length);
            this.effect("capture",camp.x,camp.y,leader,1,{giantKind});
        }
        step(dt) {
            if(this.winner!==-1 || !(dt>0))return;
            this.time+=dt; this.tick++;
            for (const [key, floating] of this.damageFx) {
                if (this.time - floating.last >= 0.88) this.damageFx.delete(key);
            }
            const metrics=this.metrics;
            metrics.collisionCandidates=metrics.targetCandidates=metrics.searches=0;
            this.threat.fill(false);
            this.grid.clear();
            for(const u of this.units) {
                u.sx=u.sy=0; this.grid.insert(u,u.x,u.y,u.side);
            }
            for(const u of this.units)this.contact(u,dt);
            this.advanceShots(dt);
            this.fireDefenses(dt);
            for(const u of this.units)if(u.hp>0)this.advanceUnit(u,dt);
            let keep=0;
            for(const u of this.units)if(u.hp>0)this.units[keep++]=u;
            this.units.length=keep;this.capture(dt);
            keep=0;
            for(const e of this.effects){e.age+=dt;if(e.age<e.life)this.effects[keep++]=e;}
            this.effects.length=keep;
        }
    }
    return {types,giants,roles,settings,routes,defense,create:seed=>new Field(seed)};
})();




