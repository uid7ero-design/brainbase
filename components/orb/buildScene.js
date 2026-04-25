import * as THREE from "three";

const GV = `varying vec3 vN,vWP; void main(){ vN=normalize(normalMatrix*normal); vWP=(modelMatrix*vec4(position,1.0)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const GF = `uniform float uStr,uPow; uniform vec3 uCol; varying vec3 vN,vWP; void main(){ float fr=pow(1.0-max(dot(vN,normalize(cameraPosition-vWP)),0.0),uPow); gl_FragColor=vec4(uCol,fr*uStr); }`;

function mkGlowMat(str, pw, col) {
  return new THREE.ShaderMaterial({
    vertexShader: GV, fragmentShader: GF,
    uniforms: { uStr:{value:str}, uPow:{value:pw}, uCol:{value:new THREE.Color(col)} },
    transparent:true, side:THREE.BackSide, blending:THREE.AdditiveBlending, depthWrite:false,
  });
}

// Pure dark backdrop — clean gradient with a single controlled purple spotlight
function makeBackdrop() {
  const SZ = 512, cv = document.createElement('canvas');
  cv.width = cv.height = SZ;
  const ctx = cv.getContext('2d');

  // Very dark base — centre slightly warm, edges pure black
  const g = ctx.createRadialGradient(SZ*.5, SZ*.5, 0, SZ*.5, SZ*.5, SZ*.78);
  g.addColorStop(0.00, '#08080C');
  g.addColorStop(0.40, '#050508');
  g.addColorStop(0.80, '#020203');
  g.addColorStop(1.00, '#000000');
  ctx.fillStyle = g; ctx.fillRect(0, 0, SZ, SZ);

  // Purple spotlight — sits exactly behind where the speaker renders (y=50%)
  // 10–15% opacity as specified
  const sp = ctx.createRadialGradient(SZ*.5, SZ*.5, 0, SZ*.5, SZ*.5, SZ*.20);
  sp.addColorStop(0.00, 'rgba(80,20,160,0.13)');
  sp.addColorStop(0.60, 'rgba(60,10,120,0.04)');
  sp.addColorStop(1.00, 'rgba(0,0,0,0)');
  ctx.fillStyle = sp; ctx.fillRect(0, 0, SZ, SZ);

  // Heavy corner vignette — draws attention to the centre
  const v = ctx.createRadialGradient(SZ*.5, SZ*.5, 0, SZ*.5, SZ*.5, SZ*.70);
  v.addColorStop(0.0,  'rgba(0,0,0,0)');
  v.addColorStop(0.50, 'rgba(0,0,0,0.12)');
  v.addColorStop(1.0,  'rgba(0,0,0,0.98)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, SZ, SZ);

  return new THREE.CanvasTexture(cv);
}

// Centre cap: dark anodised metal, HLNΛ laser-etched mark
function makeCapTexture() {
  const SZ = 512, cv = document.createElement('canvas');
  cv.width = cv.height = SZ;
  const ctx = cv.getContext('2d');
  const cx = SZ / 2;

  // Dark anodised graphite — very slight centre highlight (dust-cap curvature)
  const base = ctx.createRadialGradient(cx, cx - 24, 0, cx, cx, SZ * .52);
  base.addColorStop(0.00, '#161220');
  base.addColorStop(0.50, '#0D0A18');
  base.addColorStop(1.00, '#070510');
  ctx.fillStyle = base;
  ctx.beginPath(); ctx.arc(cx, cx, SZ * .50, 0, Math.PI * 2); ctx.fill();

  // Machined outer ring — hairline white catchlight
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(cx, cx, SZ * .48, 0, Math.PI * 2); ctx.stroke();
  // Inner precision rings — subtle depth
  ctx.strokeStyle = 'rgba(255,255,255,0.045)'; ctx.lineWidth = 1.0;
  ctx.beginPath(); ctx.arc(cx, cx, SZ * .40, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.022)'; ctx.lineWidth = 0.7;
  ctx.beginPath(); ctx.arc(cx, cx, SZ * .30, 0, Math.PI * 2); ctx.stroke();

  // HLNΛ — wide-tracked, laser-etched into the metal
  // Pass 1: engraving depth — dark offset shadow simulates recessed groove
  ctx.save();
  ctx.shadowColor    = 'rgba(0,0,0,1)';
  ctx.shadowBlur     = 4;
  ctx.shadowOffsetY  = 2;
  ctx.fillStyle      = 'rgba(230,237,243,0.38)';
  ctx.font           = '300 30px system-ui, -apple-system, Helvetica, sans-serif';
  ctx.textAlign      = 'center';
  ctx.textBaseline   = 'middle';
  // Λ = Greek Capital Lambda (U+039B) — triangle, no crossbar
  const LETTERS = ['H', 'L', 'N', 'Λ'];
  const STEP    = 40;
  const START   = cx - (LETTERS.length - 1) * STEP * .5;
  LETTERS.forEach((l, i) => ctx.fillText(l, START + i * STEP, cx + 5));
  ctx.restore();

  // Pass 2: top-face highlight — tiny up-offset at lower opacity catches light
  ctx.fillStyle    = 'rgba(255,255,255,0.10)';
  ctx.font         = '300 30px system-ui, -apple-system, Helvetica, sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  LETTERS.forEach((l, i) => ctx.fillText(l, START + i * STEP, cx + 3));

  return new THREE.CanvasTexture(cv);
}

export function buildScene(el) {
  const W = window.innerWidth, H = window.innerHeight;
  let mouseX = 0, mouseY = 0;
  const onMouse = e => { mouseX = (e.clientX/W - .5)*2; mouseY = (e.clientY/H - .5)*2; };
  window.addEventListener('mousemove', onMouse);

  const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true, powerPreference:'high-performance' });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;';
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const cam   = new THREE.PerspectiveCamera(50, W/H, 0.1, 100);
  cam.position.z = 6;

  // ── Pure dark backdrop ────────────────────────────────────────────────────
  scene.add(new THREE.Mesh(
    new THREE.PlaneGeometry(24, 15),
    new THREE.MeshBasicMaterial({ map: makeBackdrop() })
  ));

  const group = new THREE.Group();
  scene.add(group);
  let tOX = 0, cOX = 0;

  // Physical size of speaker on screen
  const BASE_SCALE = 0.70;

  // ── Soft ambient disc — barely visible at idle, brightens when active ─────
  const ambientDisc = new THREE.Mesh(
    new THREE.CircleGeometry(2.4, 64),
    new THREE.MeshBasicMaterial({
      color: '#100520', transparent:true, opacity:0.10,
      blending: THREE.AdditiveBlending, depthWrite:false,
    })
  );
  ambientDisc.position.z = -0.12;
  group.add(ambientDisc);

  // ── Ripple rings — radiate outward, fade out ──────────────────────────────
  const RIPPLE_N   = 5;
  const RIPPLE_MIN = 1.70;
  const RIPPLE_MAX = 3.00;
  const ripplePts  = Array.from({length:129}, (_,i) => {
    const a = (i/128)*Math.PI*2;
    return new THREE.Vector3(Math.cos(a), Math.sin(a), -0.05);
  });
  const rippleGeo = new THREE.BufferGeometry().setFromPoints(ripplePts);
  const rippleRings = Array.from({length:RIPPLE_N}, (_, i) => {
    const mat = new THREE.LineBasicMaterial({
      color:'#7C3AED', transparent:true, opacity:0,
      blending:THREE.AdditiveBlending, depthWrite:false,
    });
    const line = new THREE.Line(rippleGeo.clone(), mat);
    group.add(line);
    return { line, mat, phaseOff: i / RIPPLE_N };
  });

  // ── Speaker cone ──────────────────────────────────────────────────────────
  const CONE_R  = 1.36;
  const N_RINGS = 64;
  const N_SEGS  = 128;
  const TOTAL   = (N_RINGS + 1) * N_SEGS;

  const conePos   = new Float32Array(TOTAL * 3);
  const coneColor = new Float32Array(TOTAL * 3);
  const coneRadii = new Float32Array(TOTAL);

  for (let ring = 0; ring <= N_RINGS; ring++) {
    const r = (ring / N_RINGS) * CONE_R;
    // Realistic speaker shading: darker at centre (dust cap shadow),
    // lighter graphite as cone surface catches ambient light toward the rim
    const rimBright = 0.08 + (r / CONE_R) * 0.82;
    for (let seg = 0; seg < N_SEGS; seg++) {
      const vi = ring*N_SEGS + seg;
      const a  = (seg/N_SEGS)*Math.PI*2;
      conePos[vi*3]   = Math.cos(a) * r;
      conePos[vi*3+1] = Math.sin(a) * r;
      conePos[vi*3+2] = 0;
      coneRadii[vi]   = r;
      // Neutral graphite — very subtle cool-grey undertone
      coneColor[vi*3]   = 0.052 * rimBright;
      coneColor[vi*3+1] = 0.050 * rimBright;
      coneColor[vi*3+2] = 0.058 * rimBright;
    }
  }

  const fi = [];
  for (let ring=0; ring<N_RINGS; ring++) for (let seg=0; seg<N_SEGS; seg++) {
    const a=ring*N_SEGS+seg, b=ring*N_SEGS+(seg+1)%N_SEGS;
    const c=(ring+1)*N_SEGS+seg, d=(ring+1)*N_SEGS+(seg+1)%N_SEGS;
    fi.push(a,c,b, b,c,d);
  }

  const conePosA   = new THREE.BufferAttribute(conePos,   3); conePosA.setUsage(THREE.DynamicDrawUsage);
  const coneColorA = new THREE.BufferAttribute(coneColor, 3); coneColorA.setUsage(THREE.DynamicDrawUsage);
  const coneGeo    = new THREE.BufferGeometry();
  coneGeo.setAttribute('position', conePosA);
  coneGeo.setAttribute('color',    coneColorA);
  coneGeo.setIndex(fi);
  group.add(new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({
    vertexColors:true, side:THREE.DoubleSide, transparent:true, opacity:0.98,
  })));

  // Concentric grooves — 3 ribs give physical depth and define the cone shape
  [0.40, 0.80, 1.18].forEach(r => {
    const pts = Array.from({length:129}, (_,i) => {
      const a=(i/128)*Math.PI*2;
      return new THREE.Vector3(Math.cos(a)*r, Math.sin(a)*r, 0.0015);
    });
    group.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color:'#0A0812', transparent:true, opacity:0.96 })
    ));
  });

  // ── Frame rings — 4 rings, hardware-grade ────────────────────────────────

  // 1. Outer graphite surround — thick matte ring
  group.add(new THREE.Mesh(
    new THREE.TorusGeometry(1.56, 0.056, 14, 240),
    new THREE.MeshBasicMaterial({ color:'#0F0D18', transparent:true, opacity:0.98 })
  ));

  // 2. Chrome accent band — thin, slightly lighter (machined edge)
  group.add(new THREE.Mesh(
    new THREE.TorusGeometry(1.48, 0.012, 14, 240),
    new THREE.MeshBasicMaterial({ color:'#201C2E', transparent:true, opacity:0.96 })
  ));

  // 3. Violet LED ring — the single brand-colour element
  group.add(new THREE.Mesh(
    new THREE.TorusGeometry(1.38, 0.024, 14, 240),
    new THREE.MeshBasicMaterial({ color:'#7C3AED', transparent:true, opacity:0.95 })
  ));
  // LED glow halo — low base opacity, driven by state
  const ledGlow = new THREE.MeshBasicMaterial({
    color:'#7C3AED', transparent:true, opacity:0.08,
    blending:THREE.AdditiveBlending, depthWrite:false,
  });
  group.add(new THREE.Mesh(new THREE.TorusGeometry(1.38, 0.024*5, 14, 240), ledGlow));

  // 4. Inner lip ring — defines the transition from frame to cone
  group.add(new THREE.Mesh(
    new THREE.TorusGeometry(1.28, 0.014, 14, 240),
    new THREE.MeshBasicMaterial({ color:'#0A0814', transparent:true, opacity:0.94 })
  ));

  // Key-light specular arc — top-left, simulates single overhead light source
  const kArc = Array.from({length:50}, (_,i) => {
    const a = Math.PI*.44 + (i/49)*Math.PI*.60;
    return new THREE.Vector3(Math.cos(a)*1.56, Math.sin(a)*1.56, 0.002);
  });
  group.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(kArc),
    new THREE.LineBasicMaterial({
      color:'#7A6E90', transparent:true, opacity:0.22,
      blending:THREE.AdditiveBlending, depthWrite:false,
    })
  ));

  // Bottom shadow arc — opposite side, simulates floor shadow (realism)
  const sArc = Array.from({length:36}, (_,i) => {
    const a = Math.PI*1.55 + (i/35)*Math.PI*.90;
    return new THREE.Vector3(Math.cos(a)*1.56, Math.sin(a)*1.56, 0.002);
  });
  group.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(sArc),
    new THREE.LineBasicMaterial({
      color:'#000000', transparent:true, opacity:0.55,
      blending:THREE.NormalBlending, depthWrite:false,
    })
  ));

  // ── Centre cap — dark anodised metal, HLNΛ engraved ──────────────────────
  group.add(new THREE.Mesh(
    new THREE.CircleGeometry(0.46, 64),
    new THREE.MeshBasicMaterial({ map: makeCapTexture() })
  ));

  // ── Glow spheres — tight and controlled ──────────────────────────────────
  const rimGlowMat  = mkGlowMat(0.55, 5.5, '#7C3AED');  // tight violet rim
  const capGlowMat  = mkGlowMat(0.52, 3.8, '#6D28D9');  // violet behind cap
  const auraGlowMat = mkGlowMat(0.06, 1.1, '#3B1480');  // barely visible outer aura
  group.add(new THREE.Mesh(new THREE.SphereGeometry(1.62, 32, 32), rimGlowMat));
  group.add(new THREE.Mesh(new THREE.SphereGeometry(0.50, 24, 24), capGlowMat));
  group.add(new THREE.Mesh(new THREE.SphereGeometry(2.20, 20, 20), auraGlowMat));

  // ── State machine ─────────────────────────────────────────────────────────
  const ST = {
    idle:       { glowStr:0.12, ripAmp:0.005, ripSpd:1.3, ripFreq:4.8, ringSp:0.10, ringOp:0.08 },
    listening:  { glowStr:0.55, ripAmp:0.048, ripSpd:3.2, ripFreq:7.2, ringSp:0.40, ringOp:0.42 },
    processing: { glowStr:0.76, ripAmp:0.080, ripSpd:5.0, ripFreq:9.2, ringSp:0.62, ringOp:0.56 },
    responding: { glowStr:0.60, ripAmp:0.062, ripSpd:4.0, ripFreq:7.8, ringSp:0.48, ringOp:0.46 },
  };
  let cur = {...ST.idle}, tgt = {...ST.idle};
  let speechLevel = 0, simT = 0;
  const LP = 0.026, lerp = (a,b,t) => a + (b-a)*t;

  function setState(s)       { tgt = {...(ST[s] ?? ST.idle)}; }
  function setOffset(x)      { tOX = x * 0.55; }
  function setSpeechLevel(v) { speechLevel = Math.max(speechLevel, v); }

  let raf;
  const clock = new THREE.Clock();

  function animate() {
    raf = requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    speechLevel *= Math.pow(0.04, dt);
    simT += dt;

    cur.glowStr = lerp(cur.glowStr, tgt.glowStr + speechLevel*0.35, LP*2);
    cur.ripAmp  = lerp(cur.ripAmp,  tgt.ripAmp  + speechLevel*0.05, LP);
    cur.ripSpd  = lerp(cur.ripSpd,  tgt.ripSpd,                     LP);
    cur.ripFreq = lerp(cur.ripFreq, tgt.ripFreq,                    LP);
    cur.ringSp  = lerp(cur.ringSp,  tgt.ringSp  + speechLevel*0.11, LP);
    cur.ringOp  = lerp(cur.ringOp,  tgt.ringOp  + speechLevel*0.20, LP*2);

    cOX = lerp(cOX, tOX, 0.025);
    group.position.x = cOX;
    // Subtle mouse parallax — gentle, not distracting
    group.rotation.y += (mouseX*0.05 - group.rotation.y)*0.040;
    group.rotation.x += (-mouseY*0.03 - group.rotation.x)*0.040;

    // ── Ripple rings ──────────────────────────────────────────────────────
    rippleRings.forEach(r => {
      const t = ((simT * cur.ringSp + r.phaseOff) % 1);
      r.line.scale.setScalar(RIPPLE_MIN + t * (RIPPLE_MAX - RIPPLE_MIN));
      r.mat.opacity = Math.pow(1 - t, 2.6) * cur.ringOp;
    });

    // ── Cone displacement ─────────────────────────────────────────────────
    const pa = conePosA.array;
    const ca = coneColorA.array;
    // Breathing: very slow, scale 1 → 1.015 → 1 as specified
    const breath = BASE_SCALE * (1.0 + Math.sin(simT*0.72)*0.0075);
    group.scale.setScalar(breath);

    for (let i = 0; i < TOTAL; i++) {
      const r = coneRadii[i];
      const wave =
        Math.sin(r*cur.ripFreq       - simT*cur.ripSpd)       * cur.ripAmp +
        Math.sin(r*cur.ripFreq*1.60  - simT*cur.ripSpd*0.66)  * cur.ripAmp*0.34 +
        speechLevel * 0.048 * Math.sin(r*10.5 - simT*6.5);
      pa[i*3+2] = wave;

      // Realistic radial shading: darker centre, lighter outer cone
      const rimBright = 0.08 + (r / CONE_R) * 0.82;
      const baseR     = 0.052 * rimBright;
      const baseG     = 0.050 * rimBright;
      const baseB     = 0.058 * rimBright;

      // Displacement drives violet glow — multiplier 13 = shimmer, not neon
      const disp   = Math.abs(wave);
      const bright = 0.010 + disp*13.0 + speechLevel*0.07*(1 - r/CONE_R);
      const c      = Math.min(1.0, bright);

      // #7C3AED = R:0.486 G:0.227 B:0.929
      ca[i*3]   = baseR * (1-c) + c * 0.486;
      ca[i*3+1] = baseG * (1-c) + c * 0.227;
      ca[i*3+2] = baseB * (1-c) + c * 0.929;
    }
    conePosA.needsUpdate   = true;
    coneColorA.needsUpdate = true;

    // ── Glow — single breathing sine, all glow in lockstep ───────────────
    const breathGlow = Math.sin(simT*0.72)*0.038;
    rimGlowMat.uniforms.uStr.value   = (cur.glowStr + breathGlow) * 0.86;
    capGlowMat.uniforms.uStr.value   = 0.30 + (cur.glowStr + breathGlow*.5) * 0.48;
    auraGlowMat.uniforms.uStr.value  = cur.glowStr * 0.12;
    ambientDisc.material.opacity     = 0.08 + cur.glowStr * 0.28;
    ledGlow.opacity                  = 0.04 + cur.glowStr*0.24 + breathGlow*0.04;

    renderer.render(scene, cam);
  }
  animate();

  return {
    setState, setOffset, setSpeechLevel,
    resize() {
      const w=window.innerWidth, h=window.innerHeight;
      renderer.setSize(w,h); cam.aspect=w/h; cam.updateProjectionMatrix();
    },
    dispose() {
      cancelAnimationFrame(raf);
      renderer.dispose();
      window.removeEventListener('mousemove', onMouse);
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    },
  };
}
