import * as THREE from "three";

// ── Constants ──────────────────────────────────────────────────────────────
const BRAIN_R = 1.18;
const NODE_N  = 84;

// Rim-glow atmosphere shader (BackSide)
const GV = `varying vec3 vN,vWP; void main(){ vN=normalize(normalMatrix*normal); vWP=(modelMatrix*vec4(position,1.0)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const GF = `uniform float uStr,uPow; uniform vec3 uCol; varying vec3 vN,vWP; void main(){ float fr=pow(1.0-max(dot(vN,normalize(cameraPosition-vWP)),0.0),uPow); gl_FragColor=vec4(uCol,fr*uStr); }`;

// Node point-sprite — no vertexColors flag (avoids Three.js attribute conflict)
const NODE_VS = `
attribute float size;
attribute vec3  color;
varying   vec3  vColor;
void main(){
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * (300.0 / -mv.z);
  gl_Position  = projectionMatrix * mv;
}`;
const NODE_FS = `
varying vec3 vColor;
void main(){
  float d     = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float core  = pow(max(0.0, 1.0 - d * 1.1), 5.0);
  float glow  = pow(max(0.0, 1.0 - d), 1.3) * 0.55;
  float white = pow(max(0.0, 1.0 - d * 4.8), 8.0);
  vec3  col   = mix(vColor, vec3(1.0,1.0,1.2), white);
  gl_FragColor = vec4(col, core + glow);
}`;

// ── Helpers ────────────────────────────────────────────────────────────────
function randomCluster(n, R) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const r     = R * (0.28 + 0.72 * Math.pow(Math.random(), 0.5));
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    pts.push(new THREE.Vector3(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta),
    ));
  }
  return pts;
}

function proximityEdges(pts, maxDist, maxPerNode) {
  const cnt = new Int32Array(pts.length);
  const edges = [];
  for (let i = 0; i < pts.length; i++) {
    if (cnt[i] >= maxPerNode) continue;
    for (let j = i + 1; j < pts.length; j++) {
      if (cnt[i] >= maxPerNode || cnt[j] >= maxPerNode) continue;
      if (pts[i].distanceTo(pts[j]) < maxDist) {
        edges.push([i, j]);
        cnt[i]++; cnt[j]++;
      }
    }
  }
  return edges;
}

function mkGlowMat(r, str, pw, col) {
  return new THREE.ShaderMaterial({
    vertexShader:GV, fragmentShader:GF,
    uniforms:{ uStr:{value:str}, uPow:{value:pw}, uCol:{value:new THREE.Color(col)} },
    transparent:true, side:THREE.BackSide, blending:THREE.AdditiveBlending, depthWrite:false,
  });
}

// ── Main ───────────────────────────────────────────────────────────────────
export function buildScene(el) {
  const W = window.innerWidth, H = window.innerHeight;
  let mouseX = 0, mouseY = 0;
  const onMouse = e => { mouseX=(e.clientX/W-.5)*2; mouseY=(e.clientY/H-.5)*2; };
  window.addEventListener("mousemove", onMouse);

  const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true, powerPreference:"high-performance" });
  renderer.setSize(W,H); renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setClearColor(0x000000,0);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;";
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const cam   = new THREE.PerspectiveCamera(50, W/H, 0.1, 100);
  cam.position.z = 6.5;

  const driftGroup = new THREE.Group();
  scene.add(driftGroup);

  // ── Atmosphere glow — 3 layered halos ─────────────────────────────────────
  function addGlow(r,str,pw,col) {
    const mat = mkGlowMat(r,str,pw,col);
    driftGroup.add(new THREE.Mesh(new THREE.SphereGeometry(r,48,48), mat));
    return mat;
  }
  const innerGlow = addGlow(BRAIN_R*1.40, 0.24, 2.2, "#00CFEA");
  const midGlow   = addGlow(BRAIN_R*1.95, 0.10, 1.5, "#0058BB");
  const outerGlow = addGlow(BRAIN_R*2.90, 0.05, 1.0, "#001530");

  // ── Equatorial ring ────────────────────────────────────────────────────────
  const eqPts = Array.from({length:257},(_,i)=>{ const a=(i/256)*Math.PI*2; return new THREE.Vector3(Math.cos(a)*BRAIN_R*1.44,0,Math.sin(a)*BRAIN_R*1.44); });
  const eqMat = new THREE.LineBasicMaterial({ color:"#00CFEA", transparent:true, opacity:0.55, blending:THREE.AdditiveBlending, depthWrite:false });
  driftGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(eqPts), eqMat));

  function mkRing(r,rx,rz,col,op) {
    const pts = Array.from({length:129},(_,i)=>{ const a=(i/128)*Math.PI*2; return new THREE.Vector3(Math.cos(a)*r,0,Math.sin(a)*r); });
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({color:col,transparent:true,opacity:op,blending:THREE.AdditiveBlending,depthWrite:false}));
    l.rotation.x=rx; l.rotation.z=rz; driftGroup.add(l); return l;
  }
  const ring2 = mkRing(BRAIN_R*1.65, Math.PI*.70, Math.PI*.10, "#80F0FF", 0.18);
  const ring3 = mkRing(BRAIN_R*1.82, Math.PI*.30, Math.PI*.22, "#00CFEA", 0.08);

  // ── Brain nodes ────────────────────────────────────────────────────────────
  const brainGroup = new THREE.Group();
  driftGroup.add(brainGroup);

  let nodesMesh = null, edgesMesh = null;
  let nodeColorBuf = null, nodeSizeBuf = null, nodePosBuf = null;
  let nodeCount = 0, basePosArr = null, baseSizes = null;
  const phases = [], nodeDrift = [];
  let coronaFlash = null;

  function buildBrainMesh(pts, edges) {
    if (nodesMesh) { brainGroup.remove(nodesMesh); nodesMesh.geometry.dispose(); nodesMesh.material.dispose(); nodesMesh=null; }
    if (edgesMesh) { brainGroup.remove(edgesMesh); edgesMesh.geometry.dispose(); edgesMesh.material.dispose(); edgesMesh=null; }
    phases.length=0; nodeDrift.length=0;

    const n = pts.length;
    nodeCount = n;
    const pos=new Float32Array(n*3), colors=new Float32Array(n*3), sizes=new Float32Array(n);

    pts.forEach((p,i) => {
      pos[i*3]=p.x; pos[i*3+1]=p.y; pos[i*3+2]=p.z;
      const dist = p.length()/BRAIN_R;
      sizes[i] = 1.4+(1.0-dist)*1.4+Math.random()*0.8;
      colors[i*3]=0; colors[i*3+1]=0.55; colors[i*3+2]=1.0;
      phases.push(Math.random()*Math.PI*2);
      // Per-node drift params — small amplitude so edges stay plausible
      nodeDrift.push({
        ax:(Math.random()-.5)*0.055, ay:(Math.random()-.5)*0.055, az:(Math.random()-.5)*0.055,
        fx:0.22+Math.random()*0.45,  fy:0.22+Math.random()*0.45,  fz:0.22+Math.random()*0.45,
      });
    });
    basePosArr = Float32Array.from(pos);
    baseSizes  = Float32Array.from(sizes);
    coronaFlash = new Float32Array(n);

    nodePosBuf  = new THREE.BufferAttribute(pos,3);    nodePosBuf.setUsage(THREE.DynamicDrawUsage);
    nodeColorBuf= new THREE.BufferAttribute(colors,3); nodeColorBuf.setUsage(THREE.DynamicDrawUsage);
    nodeSizeBuf = new THREE.BufferAttribute(sizes,1);  nodeSizeBuf.setUsage(THREE.DynamicDrawUsage);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', nodePosBuf);
    geo.setAttribute('color',    nodeColorBuf);
    geo.setAttribute('size',     nodeSizeBuf);
    nodesMesh = new THREE.Points(geo, new THREE.ShaderMaterial({
      vertexShader:NODE_VS, fragmentShader:NODE_FS,
      transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
    }));
    brainGroup.add(nodesMesh);

    const edgePos=[];
    for (const [si,ti] of edges) {
      if (si>=n||ti>=n) continue;
      edgePos.push(pts[si].x,pts[si].y,pts[si].z, pts[ti].x,pts[ti].y,pts[ti].z);
    }
    if (edgePos.length) {
      const eg=new THREE.BufferGeometry();
      eg.setAttribute('position', new THREE.Float32BufferAttribute(edgePos,3));
      edgesMesh = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({color:0x00AADD,opacity:0.20,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));
      brainGroup.add(edgesMesh);
    }
  }

  const demoPts   = randomCluster(NODE_N, BRAIN_R);
  const demoEdges = proximityEdges(demoPts, 0.64, 5);
  buildBrainMesh(demoPts, demoEdges);

  fetch('/api/brain/graph').then(r=>r.json()).then(data => {
    if (!data.nodes?.length) return;
    const n=Math.min(data.nodes.length,120), pts=randomCluster(n,BRAIN_R);
    const idxMap=new Map(data.nodes.slice(0,n).map((nd,i)=>[nd.id,i]));
    const de=(data.links??[]).reduce((acc,lk)=>{ const si=idxMap.get(lk.source),ti=idxMap.get(lk.target); if(si!=null&&ti!=null)acc.push([si,ti]); return acc; },[]);
    buildBrainMesh(pts,[...de,...proximityEdges(pts,0.55,3)]);
  }).catch(()=>{});

  // ── Celestial bodies — 4 distinct 3D types ────────────────────────────────
  // tiltX = orbital inclination: 0=flat equatorial, π/2=polar
  const CEL_CFG = [
    { r:2.80, speed: 0.28, phase:0.00, tiltX:0.62, size:0.160, col:"#FF6600", col2:"#FF2200", type:'blackhole' },
    { r:3.60, speed:-0.18, phase:2.09, tiltX:1.18, size:0.120, col:"#88EEFF", col2:"#ffffff", type:'pulsar'  },
    { r:2.20, speed: 0.46, phase:4.19, tiltX:0.92, size:0.130, col:"#00AAFF", col2:"#00CFEA", type:'crystal' },
    { r:4.15, speed: 0.11, phase:1.05, tiltX:0.38, size:0.095, col:"#60D8FF", col2:"#00CFEA", type:'nebula'  },
  ];

  const celestials = CEL_CFG.map(cfg => {
    const body = new THREE.Group();
    scene.add(body);

    const extras = {}; // holds type-specific refs for animation

    if (cfg.type === 'blackhole') {
      // ── Black hole: dark event horizon + photon ring + accretion disk ────────
      // Solid black sphere — actually occludes geometry behind it
      body.add(new THREE.Mesh(
        new THREE.SphereGeometry(cfg.size*0.80, 28, 28),
        new THREE.MeshBasicMaterial({ color:0x000000 })
      ));
      // Tight photon ring — high-power rim glow, orange-white
      const photonMat = mkGlowMat(cfg.size*0.88, 1.05, 9.0, "#FFCC44");
      body.add(new THREE.Mesh(new THREE.SphereGeometry(cfg.size*0.88, 32, 32), photonMat));
      // Broader orange corona
      body.add(new THREE.Mesh(new THREE.SphereGeometry(cfg.size*1.35, 32, 32), mkGlowMat(cfg.size*1.35, 0.38, 3.2, "#FF4400")));
      // Accretion disk — 5 concentric tori, innermost white-hot, outermost deep red
      const DISKS = [
        { r:1.05, w:0.07, col:'#FFFFFF', op:0.75, spd:2.4 },
        { r:1.32, w:0.09, col:'#FFEE55', op:0.58, spd:1.7 },
        { r:1.66, w:0.09, col:'#FF8811', op:0.42, spd:1.2 },
        { r:2.02, w:0.08, col:'#FF3300', op:0.26, spd:0.9 },
        { r:2.42, w:0.06, col:'#881100', op:0.14, spd:0.6 },
      ];
      const diskTilt = Math.PI*0.25;
      const diskMeshes = DISKS.map(d => {
        const m = new THREE.Mesh(
          new THREE.TorusGeometry(cfg.size*d.r, cfg.size*d.w, 3, 80),
          new THREE.MeshBasicMaterial({ color:d.col, transparent:true, opacity:d.op, side:THREE.DoubleSide, blending:THREE.AdditiveBlending, depthWrite:false })
        );
        m.rotation.x = diskTilt;
        body.add(m);
        return { mesh:m, speed:d.spd };
      });
      extras.diskMeshes = diskMeshes;
      extras.photonMat  = photonMat;
      extras.spinRate   = null;

    } else if (cfg.type === 'pulsar') {
      // ── Neutron star: sphere + two polar jet cones ────────────────────────
      body.add(new THREE.Mesh(
        new THREE.SphereGeometry(cfg.size,20,20),
        new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:0.95})
      ));
      // Tight inner glow
      body.add(new THREE.Mesh(
        new THREE.SphereGeometry(cfg.size*0.55,16,16),
        new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:0.80,blending:THREE.AdditiveBlending})
      ));
      const jetMat1 = new THREE.MeshBasicMaterial({color:cfg.col,transparent:true,opacity:0.28,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide});
      const jetMat2 = jetMat1.clone();
      const jGeo = new THREE.ConeGeometry(cfg.size*0.38, cfg.size*3.8, 8, 1, true);
      const j1 = new THREE.Mesh(jGeo, jetMat1); j1.position.y =  cfg.size*1.9;
      const j2 = new THREE.Mesh(jGeo, jetMat2); j2.rotation.z = Math.PI; j2.position.y = -cfg.size*1.9;
      body.add(j1, j2);
      extras.jetMat1 = jetMat1; extras.jetMat2 = jetMat2;
      extras.spinRate = { y:3.2, z:0 };

    } else if (cfg.type === 'crystal') {
      // ── Crystalline icosahedron: wireframe shell + bright core ────────────
      const icoGeo = new THREE.IcosahedronGeometry(cfg.size*1.15, 1);
      body.add(new THREE.Mesh(icoGeo, new THREE.MeshBasicMaterial({
        color:cfg.col, wireframe:true, transparent:true, opacity:0.50,
        blending:THREE.AdditiveBlending, depthWrite:false,
      })));
      // Solid faces (very transparent)
      body.add(new THREE.Mesh(icoGeo, new THREE.MeshBasicMaterial({
        color:cfg.col, transparent:true, opacity:0.08,
        blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide,
      })));
      // White hot core
      body.add(new THREE.Mesh(
        new THREE.SphereGeometry(cfg.size*0.42,12,12),
        new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:0.80,blending:THREE.AdditiveBlending})
      ));
      extras.spinRate = { y:0.38, z:0.22 };

    } else if (cfg.type === 'nebula') {
      // ── Nebula: soft sphere + orbiting particle torus ─────────────────────
      body.add(new THREE.Mesh(
        new THREE.SphereGeometry(cfg.size*0.55,14,14),
        new THREE.MeshBasicMaterial({color:cfg.col,transparent:true,opacity:0.82})
      ));
      // Particle ring orbiting the body (as a child group that rotates)
      const ringGroup = new THREE.Group();
      const pCount = 80;
      const pBuf = new Float32Array(pCount*3);
      for (let i=0; i<pCount; i++) {
        const a  = (i/pCount)*Math.PI*2 + (Math.random()-.5)*0.25;
        const pr = cfg.size*1.65+(Math.random()-.5)*cfg.size*0.35;
        const py = (Math.random()-.5)*cfg.size*0.28;
        pBuf[i*3]=Math.cos(a)*pr; pBuf[i*3+1]=py; pBuf[i*3+2]=Math.sin(a)*pr;
      }
      const pGeo = new THREE.BufferGeometry();
      pGeo.setAttribute('position', new THREE.BufferAttribute(pBuf,3));
      ringGroup.add(new THREE.Points(pGeo, new THREE.PointsMaterial({
        size:0.025, color:cfg.col, transparent:true, opacity:0.75,
        blending:THREE.AdditiveBlending, depthWrite:false,
      })));
      ringGroup.rotation.x = 0.6;
      body.add(ringGroup);
      extras.particleRing = ringGroup;
      extras.spinRate = { y:0.20, z:0 };
    }

    // Orbital path line (faint, in driftGroup so it drifts with brain)
    const orbitPts = Array.from({length:129},(_,i)=>{
      const a=(i/128)*Math.PI*2, ox=Math.cos(a)*cfg.r, oz=Math.sin(a)*cfg.r;
      return new THREE.Vector3(ox, -oz*Math.sin(cfg.tiltX), oz*Math.cos(cfg.tiltX));
    });
    driftGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(orbitPts),
      new THREE.LineBasicMaterial({color:cfg.col,transparent:true,opacity:0.06,blending:THREE.AdditiveBlending,depthWrite:false})
    ));

    // Connection line from celestial to brain center
    const connAttr = new THREE.BufferAttribute(new Float32Array(6),3);
    const connGeo  = new THREE.BufferGeometry();
    connGeo.setAttribute('position', connAttr); connGeo.setDrawRange(0,2);
    const conn = new THREE.Line(connGeo, new THREE.LineBasicMaterial({color:cfg.col,transparent:true,opacity:0.12,blending:THREE.AdditiveBlending,depthWrite:false}));
    scene.add(conn);

    return { body, connAttr, conn, ...cfg, ...extras };
  });

  // ── Global starfield ───────────────────────────────────────────────────────
  {
    const buf=new Float32Array(1400*3);
    for (let i=0;i<1400;i++){ const r=3.0+Math.random()*9,t=Math.random()*Math.PI*2,p=Math.acos(2*Math.random()-1); buf[i*3]=r*Math.sin(p)*Math.cos(t);buf[i*3+1]=r*Math.cos(p);buf[i*3+2]=r*Math.sin(p)*Math.sin(t); }
    const geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.BufferAttribute(buf,3));
    scene.add(new THREE.Points(geo,new THREE.PointsMaterial({size:0.025,color:"#00CFEA",transparent:true,opacity:0.18,blending:THREE.AdditiveBlending,depthWrite:false})));
  }

  // ── State machine ──────────────────────────────────────────────────────────
  // Idle intentionally lively — breathAmp + pulseSpd are high to keep it animated
  const ST = {
    idle:       { rotSpd:0.30, glowStr:0.28, satScale:1.05, eqOp:0.60, edgeOp:0.22, breathAmp:0.025, pulseSpd:1.00 },
    listening:  { rotSpd:0.72, glowStr:0.58, satScale:1.38, eqOp:0.84, edgeOp:0.38, breathAmp:0.030, pulseSpd:1.55 },
    processing: { rotSpd:1.55, glowStr:0.86, satScale:1.85, eqOp:1.00, edgeOp:0.56, breathAmp:0.048, pulseSpd:2.50 },
    responding: { rotSpd:0.52, glowStr:0.68, satScale:1.58, eqOp:0.90, edgeOp:0.45, breathAmp:0.035, pulseSpd:2.00 },
  };
  let cur={...ST.idle}, tgt={...ST.idle};
  let speechLevel=0, tOX=-0.32, cOX=-0.32, simT=0;

  function setState(s)       { tgt={ ...ST[s]??ST.idle }; }
  function setOffset(x)      { tOX=x; }
  function setSpeechLevel(v) { speechLevel=Math.max(speechLevel,v); }

  const LP=0.030, lerp=(a,b,t)=>a+(b-a)*t;
  let raf;
  const clock=new THREE.Clock();

  function animate() {
    raf=requestAnimationFrame(animate);
    const dt=Math.min(clock.getDelta(),0.05);
    speechLevel*=Math.pow(0.08,dt);
    simT+=dt;

    cur.rotSpd    = lerp(cur.rotSpd,    tgt.rotSpd,                        LP);
    cur.glowStr   = lerp(cur.glowStr,   tgt.glowStr + speechLevel*0.65,    LP*2);
    cur.satScale  = lerp(cur.satScale,  tgt.satScale,                      LP);
    cur.eqOp      = lerp(cur.eqOp,      tgt.eqOp,                          LP);
    cur.edgeOp    = lerp(cur.edgeOp,    tgt.edgeOp,                        LP);
    cur.breathAmp = lerp(cur.breathAmp, tgt.breathAmp,                     LP);
    cur.pulseSpd  = lerp(cur.pulseSpd,  tgt.pulseSpd,                      LP);
    cOX=lerp(cOX, tOX, 0.022);

    // Drift + mouse parallax
    const dX=cOX+Math.sin(simT*.11)*.55, dY=Math.sin(simT*.073)*.35;
    driftGroup.position.x+=(dX-driftGroup.position.x)*.04;
    driftGroup.position.y+=(dY-driftGroup.position.y)*.04;
    driftGroup.rotation.y+=(mouseX*.20-driftGroup.rotation.y)*.055;
    driftGroup.rotation.x+=(-mouseY*.14-driftGroup.rotation.x)*.055;

    // Brain multi-axis tumble (gives organic idle life)
    brainGroup.rotation.y += dt*cur.rotSpd*0.13;
    brainGroup.rotation.x  = Math.sin(simT*0.13)*0.22;
    brainGroup.rotation.z  = Math.sin(simT*0.09)*0.14;

    // Breathing — scale amplitude driven by state
    const breathe = 1.0 + Math.sin(simT*0.85)*cur.breathAmp + Math.sin(simT*1.7)*cur.breathAmp*0.4 + speechLevel*0.08;
    brainGroup.scale.setScalar(breathe);

    // Atmosphere glow layers
    innerGlow.uniforms.uStr.value = cur.glowStr;
    midGlow.uniforms.uStr.value   = cur.glowStr*0.42;
    outerGlow.uniforms.uStr.value = cur.glowStr*0.20;

    // Rings
    eqMat.opacity    = cur.eqOp + Math.sin(simT*1.1)*0.07;
    ring2.rotation.y = simT*0.016;
    ring3.rotation.y = simT*-0.022;

    // ── Celestial bodies ────────────────────────────────────────────────────
    celestials.forEach(cel => {
      // Orbital position
      const angle = simT*cel.speed + cel.phase;
      const ox=Math.cos(angle)*cel.r, oz=Math.sin(angle)*cel.r;
      const lx=ox, ly=-oz*Math.sin(cel.tiltX), lz=oz*Math.cos(cel.tiltX);
      const wx=lx+driftGroup.position.x, wy=ly+driftGroup.position.y, wz=lz;
      cel.body.position.set(wx,wy,wz);

      // Bobbing scale
      const bob = 0.88 + Math.sin(simT*1.4+cel.phase)*0.14;
      cel.body.scale.setScalar(cur.satScale*bob);

      // Self-rotation per type
      if (cel.spinRate) {
        cel.body.rotation.y += dt*cel.spinRate.y;
        if (cel.spinRate.z) cel.body.rotation.z += dt*cel.spinRate.z;
      }

      // Pulsar jet opacity pulse
      if (cel.jetMat1) {
        const jp = 0.18+Math.sin(simT*9.0+cel.phase)*0.18+cur.glowStr*0.12;
        cel.jetMat1.opacity = jp; cel.jetMat2.opacity = jp;
      }

      // Black hole: disk rotation (each ring spins at its own speed, faster when active)
      if (cel.diskMeshes) {
        cel.diskMeshes.forEach(({mesh, speed}) => {
          mesh.rotation.z += dt * speed * (0.55 + cur.glowStr*0.80);
        });
      }
      // Photon ring strobe
      if (cel.photonMat) {
        cel.photonMat.uniforms.uStr.value = 0.85 + Math.sin(simT*4.2+cel.phase)*0.16 + cur.glowStr*0.24;
      }

      // Nebula particle ring rotation
      if (cel.particleRing) cel.particleRing.rotation.y += dt*0.55;

      // Connection line
      cel.connAttr.setXYZ(0, driftGroup.position.x, driftGroup.position.y, 0);
      cel.connAttr.setXYZ(1, wx, wy, wz);
      cel.connAttr.needsUpdate=true;
      cel.conn.material.opacity = 0.08+cur.glowStr*0.14;
    });

    // ── Node animation: drift + color pulse + corona flashes ───────────────
    if (nodesMesh && nodeColorBuf && nodeCount>0) {
      const pArr = nodePosBuf.array;
      const col  = nodeColorBuf.array;
      const sz   = nodeSizeBuf.array;
      const spch = speechLevel;
      const pspd = cur.pulseSpd;
      const gstr = cur.glowStr;

      // Sparse corona flash trigger (~2–3 per second)
      if (Math.random() < 0.04+spch*0.12) {
        coronaFlash[Math.floor(Math.random()*nodeCount)] = 0.7+Math.random()*0.3;
      }

      for (let i=0; i<nodeCount; i++) {
        // Per-node position drift — gentle float
        const d=nodeDrift[i];
        pArr[i*3]   = basePosArr[i*3]   + Math.sin(simT*d.fx + phases[i]  )*d.ax*(1+spch);
        pArr[i*3+1] = basePosArr[i*3+1] + Math.sin(simT*d.fy + phases[i]+1)*d.ay*(1+spch);
        pArr[i*3+2] = basePosArr[i*3+2] + Math.sin(simT*d.fz + phases[i]+2)*d.az*(1+spch);

        // Color pulse
        const wave  = 0.58+Math.sin(simT*pspd + phases[i])*0.42*gstr;
        const boost = 1.0+spch*(0.65+Math.sin(simT*3.5+phases[i]*1.3)*0.4);
        const flash = coronaFlash[i];
        col[i*3]   = flash*0.25;
        col[i*3+1] = 0.52*wave + flash*0.25;
        col[i*3+2] = 1.0*wave*boost + flash;
        if (flash>0.001) coronaFlash[i]*=0.86;

        // Size pulse
        sz[i] = baseSizes[i]*(1.0+spch*0.45+Math.sin(simT*pspd*0.6+phases[i])*0.12*gstr + flash*0.4);
      }
      nodePosBuf.needsUpdate  = true;
      nodeColorBuf.needsUpdate= true;
      nodeSizeBuf.needsUpdate = true;
      if (edgesMesh) edgesMesh.material.opacity = cur.edgeOp + Math.sin(simT*2.1)*0.04;
    }

    renderer.render(scene,cam);
  }
  animate();

  return {
    setState, setOffset, setSpeechLevel,
    resize() { const w=window.innerWidth,h=window.innerHeight; renderer.setSize(w,h); cam.aspect=w/h; cam.updateProjectionMatrix(); },
    dispose() { cancelAnimationFrame(raf); renderer.dispose(); window.removeEventListener("mousemove",onMouse); if(el.contains(renderer.domElement))el.removeChild(renderer.domElement); },
  };
}
