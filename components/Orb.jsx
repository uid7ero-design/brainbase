import { useState, useEffect, useRef } from "react";
import * as THREE from "three";

// ═══════════════════════════════════════════════════════════════
//  CYMATIC VERTEX — 6 modes + 4D time coordinates + breathing
//  Node lines (zero crossings) rise outward like sacred ridges
// ═══════════════════════════════════════════════════════════════
const CV = `
uniform float uT,uDist,uFreq,uBreath;
varying float vCym,vCym2;
varying vec3 vWP,vN;
void main(){
  vN=normalize(normalMatrix*normal);
  vWP=(modelMatrix*vec4(position,1.0)).xyz;
  vec3 p=normalize(position);
  float theta=acos(clamp(p.y,-1.0,1.0));
  float phi=atan(p.z,p.x);
  float f=uFreq;
  /* 4-dimensional time coordinates — slow rotation through W-space */
  float w=sin(uT*.055), dw=cos(uT*.041), uw=sin(uT*.033+.9);
  /* Six spherical-harmonic-like standing wave modes */
  float Y1=sin(f*theta       +uT*.060+w*.38)*cos(f*.750*phi-uT*.052+dw*.28);
  float Y2=sin(f*1.50*theta  -uT*.044+dw*.28)*cos(f*phi      +uT*.064+w*.22);
  float Y3=sin(f*.670*theta  +uT*.078+w*.18)*cos(f*1.33*phi  -uT*.038+dw*.36);
  float Y4=sin(f*2.00*theta  -uT*.026+dw*.44)*cos(f*1.50*phi +uT*.048+w*.26);
  float Y5=sin(f*1.25*theta  +uT*.049+uw*.36)*cos(f*.620*phi -uT*.072+dw*.18);
  float Y6=sin(f*.800*theta  -uT*.067+dw*.32)*cos(f*1.80*phi +uT*.040+w*.42);
  float b1=sin(uT*.100)*.5+.5, b2=cos(uT*.082)*.5+.5;
  float b3=sin(uT*.066+1.3)*.5+.5, b4=cos(uT*.055+.9)*.5+.5;
  float cymA=mix(mix(Y1,Y2,b1),mix(Y3,Y4,b2),b3*.38);
  float cymB=mix(Y5,Y6,b4);
  /* Interference cross-term creates hyper-fine Chladni sub-patterns */
  float cym=cymA*.72+cymB*.18+cymA*cymB*.24;
  vCym=cym; vCym2=cymB;
  /* Breathing — dual golden-ratio frequencies, never fully periodic */
  float br=1.0+sin(uT*uBreath)*.032+sin(uT*uBreath*2.618)*.016;
  float node=1.0-abs(cym);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position*br+normal*(node*node*uDist*br),1.0);
}`;

// ═══════════════════════════════════════════════════════════════
//  CYMATIC FRAGMENT — cosmic void → amethyst → ancient gold
//  Gold at node seams, celestial white at hyper-nodes
// ═══════════════════════════════════════════════════════════════
const CF = `
uniform float uT,uGlow;
uniform vec3 uVoid,uDeep,uMid,uGold,uCelest;
varying float vCym,vCym2;
varying vec3 vWP,vN;
void main(){
  vec3 vd=normalize(cameraPosition-vWP);
  float ndv=max(dot(normalize(vN),vd),0.0);
  float fr=pow(1.0-ndv,2.6);
  /* Node-line proximity — sharper = more defined sacred geometry lines */
  float nP=pow(1.0-abs(vCym),7.0);
  float nP2=pow(1.0-abs(vCym2),5.5);
  float hyper=sqrt(nP*nP2);
  float ph1=vCym*.5+.5, ph2=vCym2*.5+.5;
  /* Base: cosmic void deepening into amethyst in wave valleys */
  vec3 col=mix(uVoid,uDeep,ph2*.65);
  col=mix(col,uMid,ph1*.55);
  /* Gold sacred geometry seams */
  col=mix(col,uGold,nP*uGlow);
  /* Celestial white-gold at hyper-node intersections */
  col=mix(col,uCelest,hyper*uGlow*.90);
  /* Warm gold rim — holographic halo at edges */
  col+=uGold*fr*.50*uGlow;
  col+=uCelest*fr*fr*.22*uGlow;
  /* Structural shimmer — wave crests catch inner light */
  col*=sin(abs(vCym)*26.0+uT*4.8)*.042+.958;
  /* Interference fringes — beats between field A and B */
  col*=sin(vCym*14.0+vCym2*21.0+uT*8.5)*.020+.980;
  /* Bioluminescent breathing — light that lives */
  col+=uGold*(sin(uT*1.90)*.5+.5)*.028*uGlow;
  col+=uCelest*(cos(uT*1.44+1.1)*.5+.5)*nP*.020*uGlow;
  gl_FragColor=vec4(col,.88+nP*.10+fr*.04);
}`;

// ═══════════════════════════════════════════════════════════════
//  INNER PLASMA CORE — fast violet/magenta/gold, r=0.62
// ═══════════════════════════════════════════════════════════════
const PV=`uniform float uT;varying float vP;varying vec3 vWP,vN;
void main(){
  vN=normalize(normalMatrix*normal);vWP=(modelMatrix*vec4(position,1.0)).xyz;
  vec3 p=normalize(position);float theta=acos(clamp(p.y,-1.0,1.0));float phi=atan(p.z,p.x);
  float a=sin(9.*theta+uT*.52)*cos(7.*phi-uT*.44);
  float b=sin(5.*theta-uT*.35)*cos(10.*phi+uT*.40);
  float c=sin(13.*theta+uT*.24)*cos(5.*phi-uT*.48);
  vP=mix(a,b,sin(uT*.19)*.5+.5)*.70+c*.30;
  float n=1.0-abs(vP);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position+normal*(n*n*.052),1.0);
}`;
const PF=`uniform float uT,uGlow;varying float vP;varying vec3 vWP,vN;
void main(){
  vec3 vd=normalize(cameraPosition-vWP);float fr=pow(1.0-max(dot(normalize(vN),vd),0.0),2.8);
  float n=pow(1.0-abs(vP),5.8);float ph=vP*.5+.5;
  vec3 col=mix(vec3(.08,.00,.28),vec3(.48,.00,.72),ph*.88);
  col=mix(col,vec3(.95,.72,.05),n*uGlow*.88);
  col+=vec3(.00,.85,.72)*fr*.40*uGlow;
  col*=sin(abs(vP)*40.0+uT*14.0)*.065+.935;
  gl_FragColor=vec4(col*uGlow*.82,.52+n*.38+fr*.20);
}`;

const GV=`varying vec3 vN,vWP;void main(){vN=normalize(normalMatrix*normal);vWP=(modelMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const GF=`uniform float uStr,uPow;uniform vec3 uCol;varying vec3 vN,vWP;void main(){float fr=pow(1.0-max(dot(vN,normalize(cameraPosition-vWP)),0.0),uPow);gl_FragColor=vec4(uCol,fr*uStr);}`;

function rndSph(){const t=Math.random()*Math.PI*2,p=Math.acos(2*Math.random()-1);return new THREE.Vector3(Math.sin(p)*Math.cos(t),Math.cos(p),Math.sin(p)*Math.sin(t));}
function circGeo(r,n=256){const p=[];for(let i=0;i<=n;i++){const a=(i/n)*Math.PI*2;p.push(new THREE.Vector3(Math.cos(a)*r,0,Math.sin(a)*r));}return new THREE.BufferGeometry().setFromPoints(p);}

// ═══════════════════════════════════════════════════════════════
//  SCENE FACTORY
// ═══════════════════════════════════════════════════════════════
const NARC=20,APOOL=14,NT=10,NTP=26;

function buildScene(el){
  const W=el.clientWidth||460,H=el.clientHeight||460;
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:"high-performance"});
  renderer.setSize(W,H);renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0,0);
  el.appendChild(renderer.domElement);
  const scene=new THREE.Scene(),cam=new THREE.PerspectiveCamera(50,W/H,.1,50);cam.position.z=3.9;

  // ── Inner plasma core (violet / gold) ──────────────────────
  const plasmaMat=new THREE.ShaderMaterial({vertexShader:PV,fragmentShader:PF,uniforms:{uT:{value:0},uGlow:{value:1}},transparent:true});
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(.62,96,96),plasmaMat));

  // ── Cymatic sphere (192×192 — max smoothness) ───────────────
  const coreMat=new THREE.ShaderMaterial({
    vertexShader:CV,fragmentShader:CF,
    uniforms:{
      uT:{value:0},uDist:{value:.072},uFreq:{value:3.6},uGlow:{value:.88},uBreath:{value:.72},
      uVoid:  {value:new THREE.Color("#050210")},  // cosmic void
      uDeep:  {value:new THREE.Color("#130528")},  // deep amethyst
      uMid:   {value:new THREE.Color("#2A0A50")},  // rich violet
      uGold:  {value:new THREE.Color("#C8900A")},  // ancient gold — node lines
      uCelest:{value:new THREE.Color("#FFE878")},  // celestial light — hyper-nodes
    },transparent:true});
  const coreMesh=new THREE.Mesh(new THREE.SphereGeometry(1,192,192),coreMat);
  scene.add(coreMesh);

  // ── Glow shells — warm gold/violet halos ───────────────────
  const mkG=(r,s,p,c)=>{
    const m=new THREE.ShaderMaterial({vertexShader:GV,fragmentShader:GF,uniforms:{uStr:{value:s},uPow:{value:p},uCol:{value:new THREE.Color(c)}},transparent:true,side:THREE.BackSide,blending:THREE.AdditiveBlending,depthWrite:false});
    const mesh=new THREE.Mesh(new THREE.SphereGeometry(r,48,48),m);scene.add(mesh);return{mesh,mat:m};
  };
  mkG(1.08,.32,1.80,"#6B3200");       // warm amber inner glow
  const aura=mkG(1.75,.16,1.30,"#380060"); // deep violet aura
  mkG(2.80,.048,1.08,"#1A0030");      // far violet haze
  mkG(1.22,.10,2.40,"#4A0070");       // violet plasma halo

  // ── Wireframe icosahedron (sacred geometry shell) ───────────
  const icoMat=new THREE.LineBasicMaterial({color:"#7A4A00",transparent:true,opacity:.16,blending:THREE.AdditiveBlending,depthWrite:false});
  const ico=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.46,1)),icoMat);scene.add(ico);

  // ── Wireframe octahedron (inner lattice) ────────────────────
  const octMat=new THREE.LineBasicMaterial({color:"#3D0060",transparent:true,opacity:.10,blending:THREE.AdditiveBlending,depthWrite:false});
  const oct=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.OctahedronGeometry(1.20,2)),octMat);scene.add(oct);

  // ── Fibonacci lattice (500 golden-spiral surface points) ────
  const GOLDEN=Math.PI*(3-Math.sqrt(5)),fibPts=[];
  for(let i=0;i<500;i++){const y=1-(i/499)*2,r=Math.sqrt(Math.max(1-y*y,0)),a=GOLDEN*i;fibPts.push(new THREE.Vector3(Math.cos(a)*r*1.07,y*1.07,Math.sin(a)*r*1.07));}
  const fibGeo=new THREE.BufferGeometry().setFromPoints(fibPts);
  const fibMat=new THREE.PointsMaterial({size:.024,color:"#AA7800",transparent:true,opacity:.50,blending:THREE.AdditiveBlending,depthWrite:false});
  const fibPts3=new THREE.Points(fibGeo,fibMat);scene.add(fibPts3);

  // ── Hopf fiber rings (24 linked circles — 4D topology) ──────
  const hopfGroup=new THREE.Group();
  for(let k=0;k<24;k++){
    const eta=Math.PI/4,xi=(k/24)*Math.PI*2,pts=[];
    for(let i=0;i<=100;i++){
      const t=(i/100)*Math.PI*2;
      const z1r=Math.cos(eta)*Math.cos(t),z1i=Math.cos(eta)*Math.sin(t);
      const z2r=Math.sin(eta)*Math.cos(xi+t),z2i=Math.sin(eta)*Math.sin(xi+t);
      const d=1-z2i;if(Math.abs(d)<.08){pts.push(pts.length?pts[pts.length-1].clone():new THREE.Vector3());continue;}
      const v=new THREE.Vector3((z1r/d)*.78,(z1i/d)*.78,(z2r/d)*.78);
      if(v.length()>3.2)v.setLength(3.2);pts.push(v);
    }
    const col=k%3===0?"#5A1A80":k%3===1?"#380060":"#7A2000";
    hopfGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:col,transparent:true,opacity:.14,blending:THREE.AdditiveBlending,depthWrite:false})));
  }
  scene.add(hopfGroup);

  // ── Frequency rings — ancient gold palette ──────────────────
  // Rings represent harmonic resonance bands, like rings of Saturn
  const RDEFS=[
    {r:1.60,tks:48,tkM:.10,iX:Math.PI*.28,iZ:0,           spd: .065,op:.45,rc:"#8B5C00",tc:"#C88000",mc:"#FFD700"},
    {r:1.82,tks:64,tkM:.07,iX:Math.PI*.62,iZ:Math.PI*.10, spd:-.050,op:.32,rc:"#5A0080",tc:"#8800BB",mc:"#CC44FF"},
    {r:1.46,tks:36,tkM:.13,iX:Math.PI*.85,iZ:Math.PI*.22, spd: .092,op:.40,rc:"#7A4400",tc:"#AA6600",mc:"#FFB830"},
    {r:2.00,tks:80,tkM:.05,iX:Math.PI*.15,iZ:Math.PI*.33, spd:-.040,op:.20,rc:"#3D0060",tc:"#660099",mc:"#9944CC"},
    {r:1.32,tks:32,tkM:.14,iX:Math.PI*.50,iZ:Math.PI*.48, spd: .118,op:.48,rc:"#9B6400",tc:"#CC8800",mc:"#FFD040"},
  ];
  const rings=RDEFS.map(c=>{
    const g=new THREE.Group();
    g.add(new THREE.Line(circGeo(c.r),new THREE.LineBasicMaterial({color:c.rc,transparent:true,opacity:c.op,blending:THREE.AdditiveBlending,depthWrite:false})));
    const tPts=[];
    for(let i=0;i<c.tks;i++){
      const a=(i/c.tks)*Math.PI*2;
      const h=(Math.abs(Math.sin(a*3+.5))*.40+Math.abs(Math.sin(a*7+1.2))*.30+Math.abs(Math.sin(a*13+.8))*.20+.10)*c.tkM;
      tPts.push(new THREE.Vector3(Math.cos(a)*c.r,0,Math.sin(a)*c.r),new THREE.Vector3(Math.cos(a)*(c.r+h),0,Math.sin(a)*(c.r+h)));
    }
    g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(tPts),new THREE.LineBasicMaterial({color:c.tc,transparent:true,opacity:c.op*.68,blending:THREE.AdditiveBlending,depthWrite:false})));
    const mPts=[];for(let i=0;i<12;i++){const a=(i/12)*Math.PI*2;mPts.push(new THREE.Vector3(Math.cos(a)*c.r,0,Math.sin(a)*c.r));}
    g.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(mPts),new THREE.PointsMaterial({size:.040,color:c.mc,transparent:true,opacity:Math.min(c.op*1.3,1),blending:THREE.AdditiveBlending,depthWrite:false})));
    g.rotation.x=c.iX;g.rotation.z=c.iZ;g.userData=c;scene.add(g);return g;
  });

  // ── Electric arcs (gold + violet) ───────────────────────────
  const AA=[],AL=[];
  for(let i=0;i<APOOL;i++){
    const buf=new Float32Array(NARC*3),attr=new THREE.BufferAttribute(buf,3),geo=new THREE.BufferGeometry();
    geo.setAttribute("position",attr);geo.setDrawRange(0,NARC);
    const line=new THREE.Line(geo,new THREE.LineBasicMaterial({color:i%2===0?"#FFB030":"#AA44FF",transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false}));
    line.userData={life:0,maxLife:1,active:false};scene.add(line);AA.push(attr);AL.push(line);
  }
  function spawnArc(i){
    const p1=rndSph(),p2=rndSph(),ctrl=new THREE.Vector3((p1.x+p2.x)*.5+(Math.random()-.5)*.6,(p1.y+p2.y)*.5+(Math.random()-.5)*.6,(p1.z+p2.z)*.5+(Math.random()-.5)*.6),a=AA[i];
    for(let j=0;j<NARC;j++){const t=j/(NARC-1),mt=1-t;a.setXYZ(j,mt*mt*p1.x+2*mt*t*ctrl.x+t*t*p2.x,mt*mt*p1.y+2*mt*t*ctrl.y+t*t*p2.y,mt*mt*p1.z+2*mt*t*ctrl.z+t*t*p2.z);}
    a.needsUpdate=true;AL[i].userData={life:0,maxLife:.65+Math.random()*.95,active:true};
  }

  // ── Plasma tendrils — 10 ancient tentacles ──────────────────
  const tendrils=[];
  const TCOLS=["#FFB030","#8800FF","#FF6600","#FFDD00","#CC00FF","#FF8800","#9944FF","#FFE040","#6600AA","#FF9900"];
  for(let k=0;k<NT;k++){
    const tB=(k/NT)*Math.PI*2,pB=Math.acos(2*(k/(NT-1)-.5||.01));
    const dx=Math.sin(pB)*Math.cos(tB),dy=Math.cos(pB),dz=Math.sin(pB)*Math.sin(tB);
    let px=dy*0-dz*1,py=dz*0-dx*0,pz=dx*1-dy*0;const pL=Math.sqrt(px*px+py*py+pz*pz)||1;px/=pL;py/=pL;pz/=pL;
    const qx=dy*pz-dz*py,qy=dz*px-dx*pz,qz=dx*py-dy*px;
    const buf=new Float32Array(NTP*3),attr=new THREE.BufferAttribute(buf,3),geo=new THREE.BufferGeometry();
    geo.setAttribute("position",attr);geo.setDrawRange(0,NTP);
    const mat=new THREE.LineBasicMaterial({color:TCOLS[k],transparent:true,opacity:.18,blending:THREE.AdditiveBlending,depthWrite:false});
    scene.add(new THREE.Line(geo,mat));
    tendrils.push({attr,mat,dx,dy,dz,px,py,pz,qx,qy,qz,phase:(k/NT)*Math.PI*2});
  }

  // ── Particle halo (warm amber) ───────────────────────────────
  const pBuf=new Float32Array(280*3);
  for(let i=0;i<280;i++){const r=1.75+Math.random()*1.4,t=Math.random()*Math.PI*2,p=Math.acos(2*Math.random()-1);pBuf[i*3]=r*Math.sin(p)*Math.cos(t);pBuf[i*3+1]=r*Math.cos(p);pBuf[i*3+2]=r*Math.sin(p)*Math.sin(t);}
  const pGeo=new THREE.BufferGeometry();pGeo.setAttribute("position",new THREE.BufferAttribute(pBuf,3));
  const particles=new THREE.Points(pGeo,new THREE.PointsMaterial({size:.022,color:"#AA7700",transparent:true,opacity:.42,blending:THREE.AdditiveBlending,depthWrite:false}));
  scene.add(particles);

  // ── Pulse rings ──────────────────────────────────────────────
  const PL=[],PGT=circGeo(1,128);
  for(let i=0;i<3;i++){const m=new THREE.LineBasicMaterial({color:"#FFD040",transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false});const l=new THREE.Line(PGT,m);l.rotation.x=Math.PI*.5;l.userData={phase:i/3};scene.add(l);PL.push(l);}

  // ── State config ─────────────────────────────────────────────
  const ST={
    idle:      {d:.072,g:.88,f:3.6,s:.55,br:.72,a:.16,io:.16,oo:.10,ar:.32,tOp:.16},
    thinking:  {d:.145,g:1.70,f:6.5,s:2.10,br:1.80,a:.48,io:.46,oo:.26,ar:5.60,tOp:.36},
    responding:{d:.085,g:1.95,f:4.8,s:1.20,br:1.15,a:.56,io:.34,oo:.18,ar:2.50,tOp:.26},
  };
  let tD=.072,cD=.072,tG=.88,cG=.88,tF=3.6,cF=3.6,tS=.55,cS=.55,tBR=.72,cBR=.72;
  let tA=.16,tIO=.16,tOO=.10,ar=.32,tOp=.16,simT=0,lastR=0,pulse=0,cur="idle";
  function setState(s){cur=s;const p=ST[s]||ST.idle;tD=p.d;tG=p.g;tF=p.f;tS=p.s;tBR=p.br;tA=p.a;tIO=p.io;tOO=p.oo;ar=p.ar;tOp=p.tOp;}

  let raf;const clk=new THREE.Clock();
  function animate(){
    raf=requestAnimationFrame(animate);
    const real=clk.getElapsedTime(),dt=Math.min(real-lastR,.05);lastR=real;const lp=.024;
    cD+=(tD-cD)*lp;cG+=(tG-cG)*lp;cF+=(tF-cF)*(lp*.34);cS+=(tS-cS)*lp;cBR+=(tBR-cBR)*(lp*.5);
    aura.mat.uniforms.uStr.value+=(tA-aura.mat.uniforms.uStr.value)*lp;
    icoMat.opacity+=(tIO-icoMat.opacity)*lp;octMat.opacity+=(tOO-octMat.opacity)*lp;
    simT+=dt*cS;

    coreMat.uniforms.uT.value=simT;coreMat.uniforms.uDist.value=cD;
    coreMat.uniforms.uGlow.value=cG;coreMat.uniforms.uFreq.value=cF;coreMat.uniforms.uBreath.value=cBR;
    coreMesh.rotation.y=simT*.010;
    plasmaMat.uniforms.uT.value=simT*1.5;plasmaMat.uniforms.uGlow.value=cG*.68;
    ico.rotation.y=simT*-.018;ico.rotation.x=simT*.008;
    oct.rotation.y=simT*.026;oct.rotation.z=simT*-.011;
    fibPts3.rotation.y=simT*.016;fibPts3.rotation.x=simT*.005;fibMat.opacity=.38+Math.sin(simT*.34)*.13;
    hopfGroup.rotation.x=simT*.020;hopfGroup.rotation.y=simT*.013;hopfGroup.rotation.z=simT*.008;
    hopfGroup.children.forEach((l,i)=>{l.material.opacity=.08+Math.sin(simT*.44+i*.38)*.06+cG*.05;});
    rings.forEach(r=>{r.rotation.y+=dt*r.userData.spd;});
    particles.rotation.y=simT*.011;particles.rotation.z=simT*.005;
    AL.forEach((l,i)=>{
      if(l.userData.active){l.userData.life+=dt;const p=l.userData.life/l.userData.maxLife;if(p>=1){l.material.opacity=0;l.userData.active=false;}else l.material.opacity=Math.sin(p*Math.PI)*(cur==="thinking"?.78:.46);}
      else if(Math.random()<dt*ar)spawnArc(i);
    });
    tendrils.forEach(td=>{
      const w=Math.sin(simT*.58+td.phase)*.28,w2=Math.cos(simT*.72+td.phase*1.3)*.17,a=td.attr;
      for(let i=0;i<NTP;i++){const t=i/(NTP-1),r=1.0+t*1.8,wv=Math.sin(t*Math.PI*2.5+simT*1.0+td.phase)*w*t,wv2=Math.cos(t*Math.PI*3.5+simT*.78+td.phase)*w2*t;a.setXYZ(i,td.dx*r+td.px*wv+td.qx*wv2,td.dy*r+td.py*wv+td.qy*wv2,td.dz*r+td.pz*wv+td.qz*wv2);}
      a.needsUpdate=true;td.mat.opacity+=(tOp-td.mat.opacity)*.04;
    });
    if(cur==="responding"){pulse+=dt*1.55;PL.forEach(pl=>{const p=(pulse+pl.userData.phase)%1;pl.scale.setScalar(1+p*2.2);pl.material.opacity=(1-p)*.65;});}
    else{PL.forEach(pl=>{pl.material.opacity*=.90;});pulse=0;}
    renderer.render(scene,cam);
  }
  animate();
  return{setState,resize(){const w=el.clientWidth,h=el.clientHeight;renderer.setSize(w,h);cam.aspect=w/h;cam.updateProjectionMatrix();},dispose(){cancelAnimationFrame(raf);renderer.dispose();if(el.contains(renderer.domElement))el.removeChild(renderer.domElement);}};
}

// ═══════════════════════════════════════════════════════════════
//  REACT COMPONENT — transparent, floats on any background
// ═══════════════════════════════════════════════════════════════
export function Orb({state="idle",size=460}){
  const mRef=useRef(null),sRef=useRef(null);
  useEffect(()=>{const el=mRef.current;if(!el)return;const sc=buildScene(el);sRef.current=sc;const ro=new ResizeObserver(()=>sc.resize());ro.observe(el);return()=>{ro.disconnect();sc.dispose();sRef.current=null;};},[]);
  useEffect(()=>{sRef.current?.setState(state);},[state]);
  return <div ref={mRef} style={{width:size,height:size,flexShrink:0}}/>;
}

// ═══════════════════════════════════════════════════════════════
//  DEMO — orb floating on the EXACT lavender page background
//  so you can see precisely how it looks on your dashboard
// ═══════════════════════════════════════════════════════════════
const META={
  idle:      {label:"Resting",    sub:"Ancient lattice at peace",        dot:"#AA6600"},
  thinking:  {label:"Ascending",  sub:"Cymatic fields accelerating",     dot:"#8844FF"},
  responding:{label:"Transmitting",sub:"Sacred geometry projecting",     dot:"#FFBB30"},
};

export default function OrbDemo(){
  const [state,setState]=useState("idle");
  const m=META[state];
  return(
    <div style={{
      minHeight:"100vh",
      /* ← exact same gradient as your BrainBase page */
      background:"linear-gradient(160deg,#EEF0FF 0%,#F5F3FF 50%,#EDEAFB 100%)",
      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      fontFamily:"'DM Sans',-apple-system,sans-serif",
    }}>

      {/* Orb floats directly — no dark frame, no container */}
      <div style={{position:"relative",display:"flex",alignItems:"center",justifyContent:"center"}}>
        {/* Subtle warm halo on the page (matches gold palette) */}
        <div style={{position:"absolute",width:560,height:560,borderRadius:"50%",background:"radial-gradient(circle,rgba(160,90,0,.07),transparent 62%)",filter:"blur(50px)",pointerEvents:"none"}}/>
        <Orb state={state} size={480}/>
      </div>

      {/* Status */}
      <div style={{marginTop:4,textAlign:"center"}}>
        <div style={{fontSize:14,fontWeight:600,color:"#2D1A6E",letterSpacing:"-.01em"}}>{m.label}</div>
        <div style={{fontSize:12,color:"#9898B0",marginTop:3}}>{m.sub}</div>
      </div>

      {/* Controls */}
      <div style={{marginTop:24,display:"flex",gap:10}}>
        {[["idle","Idle"],["thinking","Thinking"],["responding","Responding"]].map(([s,lbl])=>{
          const a=state===s;
          return(<button key={s} onClick={()=>setState(s)} style={{padding:"8px 20px",fontSize:12,fontWeight:600,borderRadius:20,border:`1.5px solid ${a?"rgba(160,100,0,.5)":"rgba(0,0,0,.1)"}`,background:a?"rgba(160,100,0,.08)":"rgba(255,255,255,.6)",color:a?"#8B5000":"#6E6E8A",cursor:"pointer",transition:"all .2s",backdropFilter:"blur(8px)"}}>{lbl}</button>);
        })}
      </div>
    </div>
  );
}
