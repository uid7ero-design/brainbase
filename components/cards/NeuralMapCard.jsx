'use client';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { useAppStore } from '../../lib/state/useAppStore';

const SPHERE_R = 4;

function fibSphere(n) {
  const pts = [], phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / Math.max(n - 1, 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = phi * i;
    pts.push(new THREE.Vector3(Math.cos(th) * r * SPHERE_R, y * SPHERE_R, Math.sin(th) * r * SPHERE_R));
  }
  return pts;
}

function buildMiniScene(container, nodes, links) {
  const W = container.clientWidth;
  const H = container.clientHeight;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(W, H);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 200);
  camera.position.set(0, 0, 12);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping   = true;
  controls.dampingFactor   = 0.04;
  controls.autoRotate      = true;
  controls.autoRotateSpeed = 0.7;
  controls.enableZoom      = false;
  controls.enablePan       = false;
  controls.enableRotate    = false;

  // Sample up to 80 nodes evenly
  const sample = nodes.length > 80
    ? nodes.filter((_, i) => i % Math.ceil(nodes.length / 80) === 0).slice(0, 80)
    : nodes;
  const sampleIds = new Set(sample.map(n => n.id));
  const sampleLinks = links.filter(l => sampleIds.has(l.source) && sampleIds.has(l.target));

  const n        = sample.length;
  const positions = fibSphere(n);
  const nodeById  = new Map(sample.map((nd, i) => [nd.id, i]));

  // Nodes
  const nodePos  = new Float32Array(n * 3);
  const colors   = new Float32Array(n * 3);
  const sizes    = new Float32Array(n);
  positions.forEach((p, i) => {
    nodePos[i*3] = p.x; nodePos[i*3+1] = p.y; nodePos[i*3+2] = p.z;
    sizes[i] = Math.max(2, Math.min(5, 2 + (sample[i]?.chunks ?? 1) * 0.3));
    colors[i*3] = 0; colors[i*3+1] = 0.55; colors[i*3+2] = 1.0;
  });

  const nodeGeo = new THREE.BufferGeometry();
  nodeGeo.setAttribute('position', new THREE.BufferAttribute(nodePos, 3));
  nodeGeo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
  nodeGeo.setAttribute('size',     new THREE.BufferAttribute(sizes, 1));

  const nodeMat = new THREE.ShaderMaterial({
    vertexShader: `
      attribute float size;
      attribute vec3  color;
      varying   vec3  vColor;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (120.0 / -mv.z);
        gl_Position  = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float core = pow(max(0.0, 1.0 - d), 3.5);
        float halo = pow(max(0.0, 1.0 - d), 1.2) * 0.18;
        gl_FragColor = vec4(vColor, core + halo);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  scene.add(new THREE.Points(nodeGeo, nodeMat));

  // Edges
  const edgePos = [];
  for (const link of sampleLinks) {
    const si = nodeById.get(link.source), ti = nodeById.get(link.target);
    if (si == null || ti == null) continue;
    const s = positions[si], t = positions[ti];
    edgePos.push(s.x, s.y, s.z, t.x, t.y, t.z);
  }
  if (edgePos.length) {
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3));
    scene.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({
      color: 0x0099dd, opacity: 0.18, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })));
  }

  // Atmosphere
  const atmMat = new THREE.ShaderMaterial({
    vertexShader:   `varying vec3 vN; void main(){ vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vN; void main(){ float r=1.0-abs(dot(vN,vec3(0,0,1))); gl_FragColor=vec4(0.0,0.4,0.8,pow(r,2.5)*0.12); }`,
    transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(SPHERE_R * 1.08, 24, 24), atmMat));

  let rafId;
  function animate() {
    rafId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  return {
    dispose() {
      cancelAnimationFrame(rafId);
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    },
  };
}

export function NeuralMapCard() {
  const setBrainGraphOpen = useAppStore(s => s.setBrainGraphOpen);
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const [nodeCount, setNodeCount] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/brain/graph')
      .then(r => r.json())
      .then(data => {
        if (cancelled || !mountRef.current) return;
        const nodes = data.nodes?.length ? data.nodes : null;
        const links = data.links ?? [];
        if (!nodes) return;
        setNodeCount(nodes.length);
        sceneRef.current = buildMiniScene(mountRef.current, nodes, links);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  return (
    <div
      onClick={() => setBrainGraphOpen(true)}
      style={{
        position: 'absolute', bottom: 108, right: 16,
        width: 194, height: 152, zIndex: 15,
        borderRadius: 12, overflow: 'hidden', cursor: 'pointer',
        background: 'rgba(4,6,18,.72)',
        border: '1px solid rgba(180,130,255,.22)',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 0 24px rgba(180,130,255,.08)',
        transition: 'border-color .25s, box-shadow .25s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(180,130,255,.50)'; e.currentTarget.style.boxShadow = '0 0 32px rgba(180,130,255,.18)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(180,130,255,.22)'; e.currentTarget.style.boxShadow = '0 0 24px rgba(180,130,255,.08)'; }}
    >
      {/* 3D canvas */}
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Overlay label */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '9px 11px', pointerEvents: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'rgba(180,130,255,.9)', boxShadow: '0 0 6px rgba(180,130,255,.8)' }} />
          <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(180,130,255,.85)', letterSpacing: '.08em' }}>BRAIN</span>
        </div>
        {nodeCount != null && (
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'rgba(255,255,255,.85)', lineHeight: 1, letterSpacing: '-.02em' }}>{nodeCount}</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,.30)', marginTop: 2 }}>notes connected</div>
          </div>
        )}
      </div>

      {/* Expand hint */}
      <div style={{ position: 'absolute', bottom: 8, right: 9, pointerEvents: 'none' }}>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="rgba(180,130,255,.40)" strokeWidth="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
      </div>
    </div>
  );
}
