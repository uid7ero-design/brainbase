'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls }   from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { useAppStore }     from '../../lib/state/useAppStore';

const SPHERE_R = 5.5;

const DEMO_NODES = [
  { id: 'n0',  label: 'Machine Learning',      chunks: 8 },
  { id: 'n1',  label: 'Neural Networks',       chunks: 6 },
  { id: 'n2',  label: 'Transformers',          chunks: 7 },
  { id: 'n3',  label: 'Large Language Models', chunks: 9 },
  { id: 'n4',  label: 'Cybersecurity',         chunks: 5 },
  { id: 'n5',  label: 'Zero Trust',            chunks: 4 },
  { id: 'n6',  label: 'Threat Intelligence',   chunks: 4 },
  { id: 'n7',  label: 'Cloud Architecture',    chunks: 6 },
  { id: 'n8',  label: 'Kubernetes',            chunks: 5 },
  { id: 'n9',  label: 'Vector Databases',      chunks: 5 },
  { id: 'n10', label: 'Prompt Engineering',    chunks: 7 },
  { id: 'n11', label: 'AI Agents',             chunks: 8 },
  { id: 'n12', label: 'RAG',                   chunks: 6 },
  { id: 'n13', label: 'Embeddings',            chunks: 5 },
  { id: 'n14', label: 'DevSecOps',             chunks: 4 },
  { id: 'n15', label: 'Rust',                  chunks: 3 },
  { id: 'n16', label: 'WebAssembly',           chunks: 3 },
  { id: 'n17', label: 'Edge Computing',        chunks: 4 },
  { id: 'n18', label: 'Reinforcement Learning',chunks: 5 },
  { id: 'n19', label: 'Fine-tuning',           chunks: 4 },
];
const DEMO_LINKS = [
  { source: 'n0',  target: 'n1',  strength: 0.9  },
  { source: 'n1',  target: 'n2',  strength: 0.85 },
  { source: 'n2',  target: 'n3',  strength: 0.9  },
  { source: 'n3',  target: 'n10', strength: 0.88 },
  { source: 'n3',  target: 'n11', strength: 0.92 },
  { source: 'n3',  target: 'n12', strength: 0.87 },
  { source: 'n10', target: 'n11', strength: 0.82 },
  { source: 'n11', target: 'n12', strength: 0.85 },
  { source: 'n12', target: 'n9',  strength: 0.88 },
  { source: 'n9',  target: 'n13', strength: 0.9  },
  { source: 'n13', target: 'n1',  strength: 0.75 },
  { source: 'n0',  target: 'n18', strength: 0.8  },
  { source: 'n18', target: 'n19', strength: 0.85 },
  { source: 'n19', target: 'n3',  strength: 0.78 },
  { source: 'n4',  target: 'n5',  strength: 0.85 },
  { source: 'n4',  target: 'n6',  strength: 0.88 },
  { source: 'n4',  target: 'n14', strength: 0.82 },
  { source: 'n5',  target: 'n7',  strength: 0.72 },
  { source: 'n7',  target: 'n8',  strength: 0.85 },
  { source: 'n8',  target: 'n14', strength: 0.75 },
  { source: 'n7',  target: 'n17', strength: 0.78 },
  { source: 'n15', target: 'n16', strength: 0.8  },
  { source: 'n16', target: 'n17', strength: 0.72 },
  { source: 'n11', target: 'n4',  strength: 0.65 },
  { source: 'n6',  target: 'n3',  strength: 0.68 },
];

function fibSphere(n) {
  const pts = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y  = 1 - (i / Math.max(n - 1, 1)) * 2;
    const r  = Math.sqrt(Math.max(0, 1 - y * y));
    const th = phi * i;
    pts.push(new THREE.Vector3(Math.cos(th) * r * SPHERE_R, y * SPHERE_R, Math.sin(th) * r * SPHERE_R));
  }
  return pts;
}

function buildScene(container, nodes, links, onSelect) {
  const W = container.clientWidth;
  const H = container.clientHeight;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(W, H);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(W, H);
  labelRenderer.domElement.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;overflow:hidden;';
  container.appendChild(labelRenderer.domElement);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 200);
  camera.position.set(0, 0, 16);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping   = true;
  controls.dampingFactor   = 0.025;
  controls.autoRotate      = true;
  controls.autoRotateSpeed = 0.35;
  controls.minDistance     = 8;
  controls.maxDistance     = 32;
  controls.enablePan       = false;

  const n       = nodes.length;
  const basePts = fibSphere(n);
  const currPts = basePts.map(p => p.clone());
  const nodeById = new Map(nodes.map((nd, i) => [nd.id, { ...nd, index: i }]));

  const adj = new Map(nodes.map((_, i) => [i, new Map()]));
  for (const link of links) {
    const s = nodeById.get(link.source);
    const t = nodeById.get(link.target);
    if (!s || !t) continue;
    adj.get(s.index).set(t.index, link.strength ?? 0.5);
    adj.get(t.index).set(s.index, link.strength ?? 0.5);
  }

  const driftPh = Array.from({ length: n }, () => [
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2,
  ]);
  const driftFr = Array.from({ length: n }, () => [
    0.12 + Math.random() * 0.22,
    0.15 + Math.random() * 0.20,
    0.10 + Math.random() * 0.18,
  ]);

  const activation = new Float32Array(n);

  // ── Node geometry ──────────────────────────────────────────────────
  // NormalBlending so overlapping nodes don't additive-accumulate to white
  const nodePos  = new Float32Array(n * 3);
  const colors   = new Float32Array(n * 3);
  const sizes    = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    nodePos[i*3] = currPts[i].x; nodePos[i*3+1] = currPts[i].y; nodePos[i*3+2] = currPts[i].z;
    sizes[i] = Math.max(1.5, Math.min(3.5, 1.5 + (nodes[i]?.chunks ?? 1) * 0.22));
    colors[i*3] = 0.60; colors[i*3+1] = 0.25; colors[i*3+2] = 0.97;
  }

  const nodeGeo    = new THREE.BufferGeometry();
  const nodePosBuf = new THREE.BufferAttribute(nodePos, 3);
  const colorBuf   = new THREE.BufferAttribute(colors,  3);
  nodePosBuf.setUsage(THREE.DynamicDrawUsage);
  colorBuf.setUsage(THREE.DynamicDrawUsage);
  nodeGeo.setAttribute('position', nodePosBuf);
  nodeGeo.setAttribute('color',    colorBuf);
  nodeGeo.setAttribute('size',     new THREE.BufferAttribute(sizes, 1));

  const nodeMat = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: `
      attribute float size;
      attribute vec3  color;
      varying   vec3  vColor;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (70.0 / -mv.z);
        gl_Position  = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float core  = pow(max(0.0, 1.0 - d), 1.6);
        float white = pow(max(0.0, 1.0 - d * 5.0), 3.0);
        vec3  col   = mix(vColor, vec3(0.92, 0.85, 1.0), white);
        gl_FragColor = vec4(col, core);
      }`,
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.NormalBlending, vertexColors: true,
  });
  const pointsMesh = new THREE.Points(nodeGeo, nodeMat);
  scene.add(pointsMesh);

  // Subtle soft glow halo — additive but very low alpha, won't blob at small fraction
  const glowSizeArr = sizes.slice();
  const glowSizeBuf = new THREE.BufferAttribute(glowSizeArr, 1);
  const glowGeo     = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', nodePosBuf);
  glowGeo.setAttribute('size',     glowSizeBuf);
  const glowMat = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: `
      attribute float size;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (200.0 / -mv.z);
        gl_Position  = projectionMatrix * mv;
      }`,
    fragmentShader: `
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float a = pow(max(0.0, 1.0 - d), 3.5) * 0.09;
        gl_FragColor = vec4(0.55, 0.18, 0.97, a);
      }`,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
  scene.add(new THREE.Points(glowGeo, glowMat));

  // ── Edges ──────────────────────────────────────────────────────────
  const validLinks = links.filter(l => nodeById.get(l.source) && nodeById.get(l.target));
  const edgePos    = new Float32Array(validLinks.length * 6);
  const edgeGeo    = new THREE.BufferGeometry();
  const edgePosBuf = new THREE.BufferAttribute(edgePos, 3);
  edgePosBuf.setUsage(THREE.DynamicDrawUsage);
  edgeGeo.setAttribute('position', edgePosBuf);
  const edgeMat = new THREE.LineBasicMaterial({
    color: 0x8833ee, opacity: 0.28, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  scene.add(new THREE.LineSegments(edgeGeo, edgeMat));

  // ── Signal particles (synaptic action potentials) ──────────────────
  const MAX_SIG  = 500;
  const signals  = Array.from({ length: MAX_SIG }, () => ({ active: false, src: 0, dst: 0, t: 0, spd: 1, depth: 0 }));
  const sigPos    = new Float32Array(MAX_SIG * 3);
  const sigGeo    = new THREE.BufferGeometry();
  const sigPosBuf = new THREE.BufferAttribute(sigPos, 3);
  sigPosBuf.setUsage(THREE.DynamicDrawUsage);
  sigGeo.setAttribute('position', sigPosBuf);
  sigGeo.setDrawRange(0, 0);

  const sigMat = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: `
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 1.8 * (55.0 / -mv.z);
        gl_Position  = projectionMatrix * mv;
      }`,
    fragmentShader: `
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float a = pow(max(0.0, 1.0 - d), 1.5);
        gl_FragColor = vec4(0.88, 0.60, 1.0, a * 0.95);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  scene.add(new THREE.Points(sigGeo, sigMat));

  // ── Continuous ambient flow — 3 particles per edge, always running ──
  const FLOW_PER   = 3;
  const FLOW_COUNT = validLinks.length * FLOW_PER;
  const flowPos    = new Float32Array(FLOW_COUNT * 3);
  const flowT      = new Float32Array(FLOW_COUNT).map((_, i) => (i % FLOW_PER) / FLOW_PER);
  const flowSpd    = new Float32Array(FLOW_COUNT).map(() => 0.055 + Math.random() * 0.095);
  const flowGeo    = new THREE.BufferGeometry();
  const flowPosBuf = new THREE.BufferAttribute(flowPos, 3);
  flowPosBuf.setUsage(THREE.DynamicDrawUsage);
  flowGeo.setAttribute('position', flowPosBuf);
  const flowMat = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: `
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 1.5 * (55.0 / -mv.z);
        gl_Position  = projectionMatrix * mv;
      }`,
    fragmentShader: `
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float a = pow(max(0.0, 1.0 - d), 2.0);
        gl_FragColor = vec4(0.65, 0.28, 1.0, a * 0.88);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  scene.add(new THREE.Points(flowGeo, flowMat));

  function freeSignalSlot() {
    for (let i = 0; i < MAX_SIG; i++) if (!signals[i].active) return signals[i];
    return null;
  }

  function fireNeuron(idx, depth = 0) {
    if (idx < 0 || idx >= n) return;
    activation[idx] = Math.min(1.0, activation[idx] + 0.9);
    if (depth >= 3) return;
    const neighbors = adj.get(idx);
    if (!neighbors) return;
    for (const [nIdx, str] of neighbors) {
      if (Math.random() > 0.65 + str * 0.30) continue;
      const sig = freeSignalSlot();
      if (!sig) continue;
      sig.active = true; sig.src = idx; sig.dst = nIdx;
      sig.t = 0; sig.spd = 0.18 + Math.random() * 0.22; sig.depth = depth;
    }
  }

  let nextFireAt = 0;
  function scheduleNextFire(t) {
    nextFireAt = t + 0.15 + Math.random() * 0.35;
  }

  // ── Atmosphere sphere ──────────────────────────────────────────────
  const atmGeo = new THREE.SphereGeometry(SPHERE_R * 1.06, 80, 80);
  const atmMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      uniform float uTime;
      varying vec3  vNorm;
      void main() {
        vNorm = normalize(normalMatrix * normal);
        float w = sin(position.y * 2.4 + uTime * 0.7)  * 0.032
                + sin(position.x * 1.8 + uTime * 0.55) * 0.022
                + sin(position.z * 2.1 + uTime * 0.90) * 0.018;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position * (1.0 + w), 1.0);
      }`,
    fragmentShader: `
      varying vec3 vNorm;
      void main() {
        float rim  = 1.0 - abs(dot(vNorm, vec3(0,0,1)));
        float edge = pow(rim, 1.8) * 0.38;
        float band = pow(rim, 7.0) * 0.10;
        gl_FragColor = vec4(0.45, 0.12, 0.88, edge + band);
      }`,
    transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  scene.add(new THREE.Mesh(atmGeo, atmMat));

  const innerGeo = new THREE.SphereGeometry(SPHERE_R * 0.97, 32, 32);
  const innerMat = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader:   `varying vec3 vN; void main(){ vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vN; void main(){ float r=1.0-abs(dot(vN,vec3(0,0,1))); gl_FragColor=vec4(0.22,0.05,0.38,pow(r,5.0)*0.05); }`,
    transparent: true, side: THREE.FrontSide, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  scene.add(new THREE.Mesh(innerGeo, innerMat));

  // CSS2D labels
  const labelObjects = nodes.map((node, i) => {
    const div = document.createElement('div');
    div.textContent = node.label.length > 22 ? node.label.slice(0, 21) + '…' : node.label;
    div.style.cssText = `font:500 9px/1 'Inter',sans-serif;color:rgba(210,170,255,0);letter-spacing:.04em;text-shadow:0 0 8px rgba(168,85,247,.8);transition:color .25s;pointer-events:none;white-space:nowrap;padding:2px 0 0 6px;`;
    const obj = new CSS2DObject(div);
    obj.position.copy(currPts[i]);
    scene.add(obj);
    return { obj, div };
  });

  function setLabelState(i, state) {
    const { div } = labelObjects[i];
    if (state === 'hidden')   div.style.color = 'rgba(210,170,255,0)';
    if (state === 'dim')      div.style.color = 'rgba(210,170,255,0.22)';
    if (state === 'bright')   div.style.color = 'rgba(210,170,255,0.78)';
    if (state === 'selected') div.style.color = 'rgba(220,160,255,1)';
  }

  const ringGeo  = new THREE.RingGeometry(0.22, 0.32, 32);
  const ringMat  = new THREE.MeshBasicMaterial({ color: 0xb482ff, side: THREE.DoubleSide, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  scene.add(ringMesh);

  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 0.35;
  const mouse = new THREE.Vector2(-9999, -9999);
  let hovIndex = -1;
  let selIndex = -1;
  const camTarget = new THREE.Vector3();
  let camZooming  = false;

  function applySelection(idx) {
    selIndex = idx;
    onSelect(idx >= 0 ? {
      ...nodes[idx],
      neighbours: [...(adj.get(idx)?.entries() ?? [])]
        .sort((a, b) => b[1] - a[1]).slice(0, 6)
        .map(([j, s]) => ({ label: nodes[j]?.label, strength: s })),
    } : null);
    const neighbours = idx >= 0 ? adj.get(idx) : new Map();
    for (let i = 0; i < n; i++) {
      if (idx < 0)                setLabelState(i, i === hovIndex ? 'bright' : 'dim');
      else if (i === idx)         setLabelState(i, 'selected');
      else if (neighbours.has(i)) setLabelState(i, 'bright');
      else                        setLabelState(i, 'hidden');
    }
    if (idx >= 0) {
      ringMesh.position.copy(currPts[idx]);
      ringMat.opacity = 0.9;
      camTarget.copy(currPts[idx]).multiplyScalar(0.35);
      camZooming = true;
      fireNeuron(idx);
    } else {
      ringMat.opacity = 0;
      camTarget.set(0, 0, 0);
      camZooming = true;
    }
    controls.autoRotate = idx < 0;
  }

  function onMouseMove(e) {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.x =  ((e.clientX - r.left) / r.width)  * 2 - 1;
    mouse.y = -((e.clientY - r.top)  / r.height) * 2 + 1;
  }

  function onClick() {
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(pointsMesh);
    const idx  = hits.length ? hits[0].index : -1;
    applySelection(idx === selIndex ? -1 : idx);
  }

  renderer.domElement.addEventListener('mousemove', onMouseMove);
  renderer.domElement.addEventListener('click', onClick);
  nodes.forEach((_, i) => setLabelState(i, 'dim'));

  let rafId;
  const clock = new THREE.Clock();
  let lastT   = 0;

  function animate() {
    rafId = requestAnimationFrame(animate);
    const t  = clock.getElapsedTime();
    const dt = Math.min(t - lastT, 0.05);
    lastT = t;

    atmMat.uniforms.uTime.value = t;

    // Spontaneous firing
    if (t >= nextFireAt && n > 0) {
      const count = 1 + Math.floor(Math.random() * 2);
      for (let k = 0; k < count; k++) fireNeuron(Math.floor(Math.random() * n));
      scheduleNextFire(t);
    }

    // Liquid drift — project back onto sphere surface
    for (let i = 0; i < n; i++) {
      const b  = basePts[i];
      const ph = driftPh[i];
      const fr = driftFr[i];
      const A  = 0.62;
      let nx = b.x + Math.sin(t * fr[0] + ph[0]) * A + Math.cos(t * fr[1] * 0.65 + ph[1]) * A * 0.38;
      let ny = b.y + Math.sin(t * fr[1] + ph[1]) * A + Math.cos(t * fr[2] * 0.80 + ph[2]) * A * 0.38;
      let nz = b.z + Math.sin(t * fr[2] + ph[2]) * A + Math.cos(t * fr[0] * 0.55 + ph[0]) * A * 0.30;
      const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
      currPts[i].set(nx / len * SPHERE_R, ny / len * SPHERE_R, nz / len * SPHERE_R);
      nodePos[i*3]   = currPts[i].x;
      nodePos[i*3+1] = currPts[i].y;
      nodePos[i*3+2] = currPts[i].z;
      if (labelObjects[i]) labelObjects[i].obj.position.copy(currPts[i]);
    }
    nodePosBuf.needsUpdate = true;

    // Update edges to follow drifting nodes
    let ep = 0;
    for (const link of validLinks) {
      const s  = nodeById.get(link.source);
      const tg = nodeById.get(link.target);
      if (!s || !tg) { ep += 6; continue; }
      edgePos[ep++] = currPts[s.index].x;  edgePos[ep++] = currPts[s.index].y;  edgePos[ep++] = currPts[s.index].z;
      edgePos[ep++] = currPts[tg.index].x; edgePos[ep++] = currPts[tg.index].y; edgePos[ep++] = currPts[tg.index].z;
    }
    edgePosBuf.needsUpdate = true;

    // Advance flow particles along edges
    for (let i = 0; i < validLinks.length; i++) {
      const link = validLinks[i];
      const s  = nodeById.get(link.source);
      const tg = nodeById.get(link.target);
      if (!s || !tg) continue;
      for (let p = 0; p < FLOW_PER; p++) {
        const fi = i * FLOW_PER + p;
        flowT[fi] = (flowT[fi] + flowSpd[fi] * dt) % 1.0;
        const u = flowT[fi];
        flowPos[fi*3]   = currPts[s.index].x + (currPts[tg.index].x - currPts[s.index].x) * u;
        flowPos[fi*3+1] = currPts[s.index].y + (currPts[tg.index].y - currPts[s.index].y) * u;
        flowPos[fi*3+2] = currPts[s.index].z + (currPts[tg.index].z - currPts[s.index].z) * u;
      }
    }
    flowPosBuf.needsUpdate = true;

    // Decay activations and update node colors
    for (let i = 0; i < n; i++) {
      activation[i] *= 0.952;
      const a = Math.min(activation[i], 1);
      colors[i*3]   = 0.60 + a * 0.35;
      colors[i*3+1] = 0.25 - a * 0.10;
      colors[i*3+2] = 0.97 + a * 0.03;
    }
    colorBuf.needsUpdate = true;

    // Advance signal particles, cascade on arrival
    let sigCount = 0;
    for (let i = 0; i < MAX_SIG; i++) {
      const sig = signals[i];
      if (!sig.active) continue;
      sig.t += sig.spd * dt;
      if (sig.t >= 1.0) {
        sig.active = false;
        fireNeuron(sig.dst, sig.depth + 1);
        continue;
      }
      const src = currPts[sig.src];
      const dst = currPts[sig.dst];
      sigPos[sigCount*3]   = src.x + (dst.x - src.x) * sig.t;
      sigPos[sigCount*3+1] = src.y + (dst.y - src.y) * sig.t;
      sigPos[sigCount*3+2] = src.z + (dst.z - src.z) * sig.t;
      sigCount++;
    }
    sigPosBuf.needsUpdate = true;
    sigGeo.setDrawRange(0, sigCount);

    // Ring follows selected node
    if (selIndex >= 0) {
      ringMesh.position.copy(currPts[selIndex]);
      ringMesh.lookAt(camera.position);
      ringMat.opacity = 0.5 + Math.sin(t * 3.2) * 0.38;
    }

    // Hover
    raycaster.setFromCamera(mouse, camera);
    const hits   = raycaster.intersectObject(pointsMesh);
    const newHov = hits.length ? hits[0].index : -1;
    if (newHov !== hovIndex) {
      hovIndex = newHov;
      renderer.domElement.style.cursor = hovIndex >= 0 ? 'pointer' : 'default';
    }

    if (camZooming) {
      controls.target.lerp(camTarget, 0.05);
      if (controls.target.distanceTo(camTarget) < 0.01) camZooming = false;
    }

    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }
  animate();
  scheduleNextFire(0);

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
  }

  function dispose() {
    cancelAnimationFrame(rafId);
    renderer.domElement.removeEventListener('mousemove', onMouseMove);
    renderer.domElement.removeEventListener('click', onClick);
    controls.dispose();
    renderer.dispose();
    if (container.contains(renderer.domElement))      container.removeChild(renderer.domElement);
    if (container.contains(labelRenderer.domElement)) container.removeChild(labelRenderer.domElement);
  }

  return { resize, dispose };
}

// ── Inline variant — renders inside a container, no fullscreen overlay ──
export function InlineBrainGraph() {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const [selected, setSelected] = useState(null);
  const [ready,    setReady]    = useState(false);

  useEffect(() => {
    if (!mountRef.current) return;
    let disposed = false;
    const t = setTimeout(async () => {
      if (disposed || !mountRef.current) return;
      try {
        const r    = await fetch('/api/brain/graph');
        const data = await r.json();
        const nodes = data.nodes.length > 0 ? data.nodes : DEMO_NODES;
        const links = data.nodes.length > 0 ? data.links : DEMO_LINKS;
        if (!disposed && mountRef.current) {
          sceneRef.current = buildScene(mountRef.current, nodes, links, setSelected);
          setReady(true);
        }
      } catch {}
    }, 100);
    return () => {
      disposed = true;
      clearTimeout(t);
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onResize = () => sceneRef.current?.resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />

      {!ready && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'rgba(180,130,255,.5)', animation: 'agentPulse 1.2s ease-in-out infinite' }} />
        </div>
      )}

      {selected && (
        <div style={{ position: 'absolute', bottom: 10, left: 8, right: 8, borderRadius: 10, background: 'rgba(6,8,20,.94)', border: '1px solid rgba(180,130,255,.22)', backdropFilter: 'blur(12px)', padding: '10px 11px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(180,130,255,1)', flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.88)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.label}</span>
            <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.22)', cursor: 'pointer', fontSize: 12, padding: 0, lineHeight: 1 }}>✕</button>
          </div>
          {selected.neighbours?.length > 0 && (
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {selected.neighbours.slice(0, 3).map((nb, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 4, height: 4, borderRadius: '50%', background: `rgba(${Math.round(140 + nb.strength * 60)},${Math.round(60 + nb.strength * 40)},255,0.7)`, flexShrink: 0 }} />
                  <span style={{ fontSize: 9, color: 'rgba(255,255,255,.42)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nb.label}</span>
                  <span style={{ fontSize: 9, color: 'rgba(255,255,255,.18)' }}>{Math.round(nb.strength * 100)}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Full-screen overlay panel ──────────────────────────────────────
export function BrainGraphPanel() {
  const open    = useAppStore(s => s.brainGraphOpen);
  const setOpen = useAppStore(s => s.setBrainGraphOpen);

  const mountRef = useRef(null);
  const sceneRef = useRef(null);

  const [loading,  setLoading]  = useState(false);
  const [stats,    setStats]    = useState(null);
  const [selected, setSelected] = useState(null);
  const [isDemo,   setIsDemo]   = useState(false);

  const loadAndBuild = useCallback(async () => {
    if (!mountRef.current) return;
    setLoading(true);
    setSelected(null);
    sceneRef.current?.dispose();
    sceneRef.current = null;

    try {
      const r    = await fetch('/api/brain/graph');
      const data = await r.json();
      const nodes = data.nodes.length > 0 ? data.nodes : DEMO_NODES;
      const links = data.nodes.length > 0 ? data.links : DEMO_LINKS;
      const demo  = data.nodes.length === 0;
      setIsDemo(demo);
      setStats({ nodes: nodes.length, links: links.length });
      if (mountRef.current) {
        sceneRef.current = buildScene(mountRef.current, nodes, links, setSelected);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) { sceneRef.current?.dispose(); sceneRef.current = null; setStats(null); setSelected(null); return; }
    const t = setTimeout(loadAndBuild, 80);
    return () => clearTimeout(t);
  }, [open, loadAndBuild]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => sceneRef.current?.resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') { if (selected) setSelected(null); else setOpen(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, selected, setOpen]);

  if (!open) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 90, background: '#020408', display: 'flex', flexDirection: 'column' }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,.05)', flexShrink: 0, background: 'rgba(2,4,8,.94)', backdropFilter: 'blur(12px)' }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(180,130,255,.8)" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/></svg>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.80)', letterSpacing: '.04em' }}>BRAIN</span>
        {stats && <span style={{ fontSize: 10, color: 'rgba(255,255,255,.22)' }}>{stats.nodes} notes · {stats.links} connections</span>}
        {loading && <span style={{ fontSize: 10, color: 'rgba(168,85,247,.65)' }}>Building graph…</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={loadAndBuild} style={{ padding: '4px 10px', borderRadius: 6, background: 'rgba(168,85,247,.06)', border: '1px solid rgba(168,85,247,.22)', color: 'rgba(168,85,247,.75)', fontSize: 10, cursor: 'pointer' }}>Refresh</button>
          <button onClick={() => setOpen(false)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 16px', borderRadius: 8, background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.16)', color: 'rgba(255,255,255,.80)', fontSize: 12, fontWeight: 600, cursor: 'pointer', letterSpacing: '.01em' }}>
            ← Back to HLNA
          </button>
        </div>
      </div>

      <div ref={mountRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

        {!loading && isDemo && (
          <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 10, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
            <div style={{ padding: '5px 12px', borderRadius: 20, background: 'rgba(180,130,255,.08)', border: '1px solid rgba(180,130,255,.22)', fontSize: 10, color: 'rgba(180,130,255,.65)', letterSpacing: '.04em' }}>
              Demo graph — connect your Obsidian vault in the sidebar to see your real notes
            </div>
          </div>
        )}

        {selected && (
          <div style={{ position: 'absolute', top: 16, right: 16, width: 220, borderRadius: 12, background: 'rgba(6,8,20,.93)', border: '1px solid rgba(180,130,255,.28)', backdropFilter: 'blur(16px)', overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(180,130,255,1)', boxShadow: '0 0 8px rgba(180,130,255,.8)', flexShrink: 0, marginTop: 3 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.90)', lineHeight: 1.3, wordBreak: 'break-word' }}>{selected.label}</div>
                  <div style={{ fontSize: 10, color: 'rgba(180,130,255,.65)', marginTop: 3 }}>{selected.chunks} chunk{selected.chunks !== 1 ? 's' : ''} indexed</div>
                </div>
                <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.25)', cursor: 'pointer', fontSize: 13, padding: 0, flexShrink: 0 }}>✕</button>
              </div>
            </div>
            {selected.neighbours?.length > 0 && (
              <div style={{ padding: '10px 14px 12px' }}>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,.22)', letterSpacing: '.10em', fontWeight: 600, marginBottom: 8 }}>CONNECTED NOTES</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {selected.neighbours.map((nb, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: `rgba(${Math.round(140 + nb.strength * 60)},${Math.round(60 + nb.strength * 40)},255,0.8)`, flexShrink: 0 }} />
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,.55)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nb.label}</span>
                      <span style={{ fontSize: 9, color: 'rgba(255,255,255,.22)', flexShrink: 0 }}>{Math.round(nb.strength * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)', fontSize: 9, color: 'rgba(255,255,255,.13)', letterSpacing: '.06em', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          {selected ? 'CLICK AGAIN TO DESELECT · ESC TO CLOSE' : 'DRAG TO ROTATE · SCROLL TO ZOOM · CLICK A NODE'}
        </div>
      </div>
    </div>
  );
}
