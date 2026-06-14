import { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';

// ─────────────────────────────────────────────────────────────────────────────
// Scenery — the procedural environment around the farm: a mountain ring with
// snow caps, pine forests, boulders, a lake, grass and birds, plus distance
// fog. Everything is SEEDED random (same world every visit), built once in
// useMemo, and instanced — the whole environment costs ~8 draw calls.
//
// Layout contract with FarmTwinPage:
//   • plots drag-clamp to ±70 ⇒ the zone max(|x|,|z|) < 75 is left untouched
//   • the flat slab stays visible up to r≈95; mountains rise beyond
//   • ENV (night/digital/wet) is mirrored via window.__twinEnv set by the page
// ─────────────────────────────────────────────────────────────────────────────

const SEED = 1337;

// Deterministic PRNG (mulberry32) — the world is random but stable.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 2-D value noise + fractional Brownian motion (smooth natural hills).
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const r = (ix, iz) => {
    const t = Math.sin(ix * 127.1 + iz * 311.7 + SEED * 0.137) * 43758.5453;
    return t - Math.floor(t);
  };
  return r(xi, zi) * (1 - u) * (1 - v) + r(xi + 1, zi) * u * (1 - v)
       + r(xi, zi + 1) * (1 - u) * v + r(xi + 1, zi + 1) * u * v;
}
function fbm(x, z, oct = 4) {
  let a = 0.5, f = 1, s = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, z * f); a *= 0.5; f *= 2.1; }
  return s;                                   // ~0..1
}
const ridged = (x, z) => 1 - Math.abs(2 * vnoise(x, z) - 1);   // sharp crests
const smoothstep = (a, b, t) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };

// Terrain height at world (x, z). Flat (slightly sunk under the slab) inside
// r<95, rising into a ridged mountain ring that peaks around r≈200.
function terrainH(x, z) {
  const r = Math.hypot(x, z);
  const m = smoothstep(95, 215, r);
  if (m <= 0) return -0.6;
  const rolling = fbm(x * 0.012, z * 0.012) * 14;
  const crest   = Math.pow(ridged(x * 0.018, z * 0.018), 2) * 26 * smoothstep(130, 215, r);
  return -0.6 + m * (3 + rolling + crest);
}

/* ── Mountain ring (one displaced, vertex-coloured, flat-shaded plane) ────── */
function Mountains() {
  const matRef = useRef();
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(600, 600, 110, 110);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const grassA = new THREE.Color('#7d9554'), grassB = new THREE.Color('#5f7a40');
    const rock   = new THREE.Color('#6d6f74'), rockD = new THREE.Color('#4f5258');
    const snow   = new THREE.Color('#eef3f8');
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = terrainH(x, z);
      pos.setY(i, h);
      // colour by altitude with noisy banding so strata never look painted on
      const n = vnoise(x * 0.05, z * 0.05);
      const snowline = 17 + n * 6, rockline = 6 + n * 3;
      if (h > snowline)      c.copy(snow);
      else if (h > rockline) c.copy(rock).lerp(rockD, vnoise(x * 0.09, z * 0.09)).lerp(snow, smoothstep(snowline - 3, snowline, h));
      else                   c.copy(grassA).lerp(grassB, n).lerp(rock, smoothstep(rockline - 2.5, rockline, h));
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }, []);
  useFrame(() => {
    const env = window.__twinEnv || {};
    if (matRef.current) matRef.current.emissiveIntensity = (env.night || 0) * 0.22;
  });
  return (
    <mesh geometry={geo} position={[0, 0, 0]} receiveShadow>
      <meshStandardMaterial ref={matRef} vertexColors flatShading roughness={1}
        metalness={0} emissive="#27314d" emissiveIntensity={0} />
    </mesh>
  );
}

/* ── Pine forest (two instanced meshes: trunks + canopies) ────────────────── */
function Pines() {
  const { trunks, crowns, count } = useMemo(() => {
    const rng = mulberry32(SEED * 7);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
    const t = [], cwn = [];
    let placed = 0, guard = 0;
    while (placed < 160 && guard++ < 3000) {
      const ang = rng() * Math.PI * 2;
      const r = 100 + rng() * 110;
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      const h = terrainH(x, z);
      if (h < 1.5 || h > 13) continue;                       // forests live mid-slope
      if (fbm(x * 0.02 + 9, z * 0.02 - 4) < 0.45) continue;  // clustered, not uniform
      const s = 0.9 + rng() * 1.7;
      const lean = (rng() - 0.5) * 0.12;
      Q.setFromEuler(new THREE.Euler(lean, rng() * Math.PI * 2, lean));
      P.set(x, h + 0.55 * s, z); S.set(s, s, s);
      t.push(M.clone().compose(P, Q, S));
      P.set(x, h + 1.9 * s, z);
      cwn.push(M.clone().compose(P, Q, S));
      placed++;
    }
    return { trunks: t, crowns: cwn, count: placed };
  }, []);
  const trunkRef = useRef(), crownRef = useRef();
  useEffect(() => {
    trunks.forEach((m, i) => trunkRef.current.setMatrixAt(i, m));
    crowns.forEach((m, i) => crownRef.current.setMatrixAt(i, m));
    trunkRef.current.instanceMatrix.needsUpdate = true;
    crownRef.current.instanceMatrix.needsUpdate = true;
  }, [trunks, crowns]);
  return (
    <group>
      <instancedMesh ref={trunkRef} args={[undefined, undefined, count]} castShadow>
        <cylinderGeometry args={[0.1, 0.18, 1.1, 5]} />
        <meshStandardMaterial color="#5b4632" roughness={1} flatShading />
      </instancedMesh>
      <instancedMesh ref={crownRef} args={[undefined, undefined, count]} castShadow>
        <coneGeometry args={[0.95, 2.6, 7]} />
        <meshStandardMaterial color="#2f5d3a" roughness={1} flatShading />
      </instancedMesh>
    </group>
  );
}

/* ── Boulders: big ones on the mountains, small ones near the field edge ──── */
function Rocks() {
  const { mats, count } = useMemo(() => {
    const rng = mulberry32(SEED * 13);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
    const list = [];
    // mountain boulders
    for (let i = 0; i < 55; i++) {
      const ang = rng() * Math.PI * 2, r = 105 + rng() * 130;
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      const h = terrainH(x, z); if (h < 0.5) continue;
      const s = 0.6 + rng() * 2.6;
      Q.setFromEuler(new THREE.Euler(rng() * 3, rng() * 3, rng() * 3));
      P.set(x, h + s * 0.25, z); S.set(s, s * (0.7 + rng() * 0.5), s);
      list.push(M.clone().compose(P, Q, S));
    }
    // meadow stones at the edge of the flat zone (never inside the plot square)
    for (let i = 0; i < 26; i++) {
      const ang = rng() * Math.PI * 2, r = 79 + rng() * 13;
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      if (Math.max(Math.abs(x), Math.abs(z)) < 76) continue;
      const s = 0.25 + rng() * 0.7;
      Q.setFromEuler(new THREE.Euler(rng() * 3, rng() * 3, rng() * 3));
      P.set(x, s * 0.3, z); S.set(s, s * 0.8, s);
      list.push(M.clone().compose(P, Q, S));
    }
    return { mats: list, count: list.length };
  }, []);
  const ref = useRef();
  useEffect(() => {
    mats.forEach((m, i) => ref.current.setMatrixAt(i, m));
    ref.current.instanceMatrix.needsUpdate = true;
  }, [mats]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} castShadow receiveShadow>
      <dodecahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#7c7f86" roughness={1} flatShading />
    </instancedMesh>
  );
}

/* ── Grass tufts on the meadow ring around the field ──────────────────────── */
function Grass() {
  const { mats, count } = useMemo(() => {
    const rng = mulberry32(SEED * 29);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
    const list = [];
    let guard = 0;
    while (list.length < 320 && guard++ < 4000) {
      const ang = rng() * Math.PI * 2, r = 74 + rng() * 19;
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      if (Math.max(Math.abs(x), Math.abs(z)) < 75) continue;
      const s = 0.5 + rng() * 0.9;
      Q.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.5, rng() * Math.PI, (rng() - 0.5) * 0.5));
      P.set(x, 0.18 * s, z); S.set(s * 0.5, s, s * 0.5);
      list.push(M.clone().compose(P, Q, S));
    }
    return { mats: list, count: list.length };
  }, []);
  const ref = useRef();
  useEffect(() => {
    mats.forEach((m, i) => ref.current.setMatrixAt(i, m));
    ref.current.instanceMatrix.needsUpdate = true;
  }, [mats]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]}>
      <coneGeometry args={[0.22, 0.8, 4]} />
      <meshStandardMaterial color="#86a456" roughness={1} flatShading />
    </instancedMesh>
  );
}

/* ── Lake — shader water with waves, sun glints, depth + natural shoreline ── */
const LAKE_POS = [46, -86];
const LAKE_R = 13;
// Irregular natural shoreline: radius multiplier per angle (deterministic).
const shore = (a) => 1 + 0.16 * Math.sin(a * 2.3 + 1.7) + 0.09 * Math.sin(a * 5.1 + 0.6) + 0.05 * Math.sin(a * 8.7);

// Tessellated disc following the shoreline — interior vertices so the water
// shader can actually displace waves (CircleGeometry is just a rim fan).
function makeLakeDisc(R, scale = 1, rings = 16, segs = 80) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= rings; i++) {
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const r = (i / rings) * R * shore(a) * scale;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
      uv.push(i / rings, j / segs);                       // uv.x = radial 0..1
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j, b = a + segs + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const WATER_VERT = /* glsl */`
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  // two crossing wave trains + a slow swell — analytic normals for lighting
  float waveH(vec2 p, float t) {
    return 0.055 * sin(p.x * 1.7 + t * 1.1)
         + 0.045 * sin((p.x * 0.6 + p.y * 1.4) + t * 1.7)
         + 0.030 * sin((p.y * 2.3 - p.x * 0.4) - t * 2.3)
         + 0.080 * sin((p.x + p.y) * 0.25 + t * 0.4);
  }
  void main() {
    vUv = uv;
    vec3 p = position;
    vec4 w = modelMatrix * vec4(p, 1.0);
    float h  = waveH(w.xz, uTime);
    float hx = waveH(w.xz + vec2(0.25, 0.0), uTime);
    float hz = waveH(w.xz + vec2(0.0, 0.25), uTime);
    // waves fade out at the shore so the waterline stays glued to the sand
    float edge = 1.0 - smoothstep(0.78, 1.0, uv.x);
    p.y += h * edge;
    vNormalW = normalize(vec3(-(hx - h) / 0.25 * edge, 1.0, -(hz - h) / 0.25 * edge));
    vWorld = (modelMatrix * vec4(p, 1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
  }
`;
const WATER_FRAG = /* glsl */`
  uniform float uTime;
  uniform float uNight;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    float r = vUv.x;                                  // 0 centre → 1 shoreline
    // depth colour: deep teal centre → clear green-blue shallows
    vec3 deep    = mix(vec3(0.04, 0.18, 0.27), vec3(0.01, 0.04, 0.10), uNight);
    vec3 shallow = mix(vec3(0.22, 0.52, 0.60), vec3(0.05, 0.12, 0.22), uNight);
    vec3 col = mix(deep, shallow, smoothstep(0.45, 1.0, r));
    // sky reflection via fresnel: grazing angles mirror the sky
    vec3 viewDir = normalize(cameraPosition - vWorld);
    float fresnel = pow(1.0 - max(dot(viewDir, vNormalW), 0.0), 2.2);
    vec3 sky = mix(vec3(0.62, 0.74, 0.86), vec3(0.05, 0.08, 0.18), uNight);
    col = mix(col, sky, fresnel * 0.65);
    // sun / moon glints off the wave normals
    vec3 sunDir = normalize(vec3(0.45, 0.75, 0.35));
    float spec = pow(max(dot(reflect(-sunDir, vNormalW), viewDir), 0.0), 90.0);
    vec3 glint = mix(vec3(1.0, 0.97, 0.85), vec3(0.75, 0.85, 1.0), uNight);
    col += glint * spec * (0.9 + uNight * 0.6);
    // animated foam band hugging the shoreline
    float foamN = hash(floor(vec2(vUv.y * 160.0, uTime * 2.0)));
    float foam = smoothstep(0.90, 0.985, r + 0.012 * sin(uTime * 1.6 + vUv.y * 50.0)) * (0.55 + 0.45 * foamN);
    col = mix(col, vec3(0.93, 0.97, 1.0), foam * (1.0 - 0.5 * uNight));
    // soft transparent edge so the waterline never aliases against the sand
    float alpha = 0.88 - fresnel * 0.1;
    alpha *= 1.0 - smoothstep(0.975, 1.0, r);
    gl_FragColor = vec4(col, alpha);
  }
`;

function Lake() {
  const matRef = useRef();
  const duckRefs = useRef([]);
  const waterGeo = useMemo(() => makeLakeDisc(LAKE_R, 1.0), []);
  const bedGeo   = useMemo(() => {
    const g = makeLakeDisc(LAKE_R, 1.12, 8, 80);
    // vertex-colour the bed: wet mud under the water → dry sand at the rim
    const posA = g.attributes.position, colors = new Float32Array(posA.count * 3);
    const mud = new THREE.Color('#4d4434'), sand = new THREE.Color('#c9b98a'), c = new THREE.Color();
    const uvA = g.attributes.uv;
    for (let i = 0; i < posA.count; i++) {
      c.copy(mud).lerp(sand, smoothstep(0.7, 1.0, uvA.getX(i)));
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  }, []);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uNight: { value: 0 } }), []);

  // shoreline props placed ON the irregular waterline (not a perfect circle)
  const { reeds, stones, pads, ducks } = useMemo(() => {
    const rng = mulberry32(SEED * 41);
    const rd = [], st = [], pd = [], dk = [];
    for (let i = 0; i < 16; i++) {
      const a = rng() * Math.PI * 2, rr = LAKE_R * shore(a) * (0.99 + rng() * 0.08);
      rd.push({ x: Math.cos(a) * rr, z: Math.sin(a) * rr, s: 0.7 + rng() * 0.8, rot: rng() * Math.PI });
    }
    for (let i = 0; i < 9; i++) {
      const a = rng() * Math.PI * 2, rr = LAKE_R * shore(a) * (0.97 + rng() * 0.1);
      st.push({ x: Math.cos(a) * rr, z: Math.sin(a) * rr, s: 0.3 + rng() * 0.55, rot: rng() * Math.PI * 2 });
    }
    for (let i = 0; i < 7; i++) {
      const a = rng() * Math.PI * 2, rr = LAKE_R * shore(a) * (0.55 + rng() * 0.3);
      pd.push({ x: Math.cos(a) * rr, z: Math.sin(a) * rr, s: 0.35 + rng() * 0.4, rot: rng() * Math.PI * 2 });
    }
    for (let i = 0; i < 3; i++) dk.push({ r: 3 + rng() * 5, ph: rng() * Math.PI * 2, sp: 0.06 + rng() * 0.05 });
    return { reeds: rd, stones: st, pads: pd, ducks: dk };
  }, []);

  useFrame(() => {
    const t = performance.now() * 0.001;
    const env = window.__twinEnv || {};
    uniforms.uTime.value = t;
    uniforms.uNight.value = env.night || 0;
    // ducks paddle slow arcs, bobbing on the swell, facing their heading
    duckRefs.current.forEach((d, i) => {
      if (!d) return;
      const k = ducks[i], a = t * k.sp + k.ph;
      const x = Math.cos(a) * k.r, z = Math.sin(a) * k.r;
      d.position.set(x, 0.16 + Math.sin(t * 1.3 + i * 2) * 0.035, z);
      d.rotation.y = -a;
    });
  });

  return (
    <group position={[LAKE_POS[0], 0, LAKE_POS[1]]}>
      {/* lakebed: wet mud → dry sand following the same shoreline */}
      <mesh geometry={bedGeo} position={[0, 0.02, 0]} receiveShadow>
        <meshStandardMaterial vertexColors roughness={1} />
      </mesh>
      {/* the water itself */}
      <mesh geometry={waterGeo} position={[0, 0.14, 0]}>
        <shaderMaterial vertexShader={WATER_VERT} fragmentShader={WATER_FRAG}
          uniforms={uniforms} transparent depthWrite={false} />
      </mesh>
      {/* half-submerged shoreline stones */}
      {stones.map((s, i) => (
        <mesh key={`s${i}`} position={[s.x, s.s * 0.18, s.z]} rotation={[s.rot, s.rot * 1.7, 0]} castShadow>
          <dodecahedronGeometry args={[s.s, 0]} />
          <meshStandardMaterial color="#8a8d94" roughness={1} flatShading />
        </mesh>
      ))}
      {/* lily pads drifting on the surface */}
      {pads.map((p, i) => (
        <mesh key={`p${i}`} position={[p.x, 0.165, p.z]} rotation={[-Math.PI / 2, 0, p.rot]}>
          <circleGeometry args={[p.s, 7, 0.5, Math.PI * 1.8]} />
          <meshStandardMaterial color="#3c6e3a" roughness={0.7} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {/* ducks */}
      {ducks.map((_, i) => (
        <group key={`d${i}`} ref={(el) => (duckRefs.current[i] = el)}>
          <mesh><sphereGeometry args={[0.22, 8, 6]} /><meshStandardMaterial color="#7a5b3a" roughness={0.9} /></mesh>
          <mesh position={[0.18, 0.16, 0]}><sphereGeometry args={[0.11, 8, 6]} /><meshStandardMaterial color="#3a5e35" roughness={0.9} /></mesh>
          <mesh position={[0.3, 0.16, 0]}><coneGeometry args={[0.035, 0.12, 5]} /><meshStandardMaterial color="#d99c2b" /></mesh>
        </group>
      ))}
      {/* reeds with cattails on the waterline */}
      {reeds.map((r, i) => (
        <group key={`r${i}`} position={[r.x, 0, r.z]} rotation={[0, r.rot, 0]} scale={[r.s, r.s, r.s]}>
          <mesh position={[0, 0.5, 0]}><cylinderGeometry args={[0.03, 0.05, 1, 4]} /><meshStandardMaterial color="#5d7a35" /></mesh>
          <mesh position={[0.12, 0.42, 0]} rotation={[0, 0, 0.25]}><cylinderGeometry args={[0.02, 0.04, 0.85, 4]} /><meshStandardMaterial color="#6b8a3e" /></mesh>
          <mesh position={[0, 1.05, 0]}><cylinderGeometry args={[0.07, 0.05, 0.3, 4]} /><meshStandardMaterial color="#6b5132" /></mesh>
        </group>
      ))}
    </group>
  );
}

/* ── Birds — two flocks circling at altitude, flapping ─────────────────────── */
function Birds() {
  const flocks = useMemo(() => ([
    { r: 70, h: 26, speed: 0.05, n: 5, phase: 0 },
    { r: 95, h: 34, speed: -0.035, n: 4, phase: 2.1 },
  ]), []);
  const refs = useRef([]);
  useFrame(() => {
    const t = performance.now() * 0.001;
    let k = 0;
    flocks.forEach((f) => {
      for (let i = 0; i < f.n; i++) {
        const b = refs.current[k++]; if (!b) continue;
        const a = t * f.speed + f.phase + i * 0.22;
        const x = Math.cos(a) * (f.r + i * 2.5);
        const z = Math.sin(a) * (f.r + i * 2.5);
        b.position.set(x, f.h + Math.sin(t * 1.4 + i) * 1.2, z);
        b.rotation.y = -a - Math.PI / 2 * Math.sign(f.speed);
        const flap = Math.sin(t * 9 + i * 1.7) * 0.65;
        if (b.children[0]) b.children[0].rotation.z = flap;
        if (b.children[1]) b.children[1].rotation.z = -flap;
      }
    });
  });
  let idx = 0;
  return (
    <group>
      {flocks.flatMap((f, fi) => Array.from({ length: f.n }, (_, i) => (
        <group key={`${fi}-${i}`} ref={(el) => (refs.current[idx++] = el)}>
          <mesh position={[-0.35, 0, 0]}><boxGeometry args={[0.7, 0.02, 0.18]} /><meshBasicMaterial color="#1e293b" /></mesh>
          <mesh position={[0.35, 0, 0]}><boxGeometry args={[0.7, 0.02, 0.18]} /><meshBasicMaterial color="#1e293b" /></mesh>
        </group>
      )))}
    </group>
  );
}

/* ── Distance fog that follows day/night and lifts in digital mode ─────────── */
function SceneFog() {
  const { scene } = useThree();
  const fog = useMemo(() => new THREE.Fog('#cfdbe8', 140, 420), []);
  const day = useMemo(() => new THREE.Color('#cfdbe8'), []);
  const night = useMemo(() => new THREE.Color('#0c1428'), []);
  useEffect(() => {
    scene.fog = fog;
    return () => { scene.fog = null; };
  }, [scene, fog]);
  useFrame(() => {
    const env = window.__twinEnv || {};
    fog.color.copy(day).lerp(night, env.night || 0);
    // the digital world has no atmosphere — push the fog out so the grid shows
    fog.far = 420 + (env.digital || 0) * 800;
    fog.near = 140 + (env.digital || 0) * 300;
  });
  return null;
}

export default function Scenery() {
  return (
    <group>
      <SceneFog />
      <Mountains />
      <Pines />
      <Rocks />
      <Grass />
      <Lake />
      <Birds />
    </group>
  );
}
