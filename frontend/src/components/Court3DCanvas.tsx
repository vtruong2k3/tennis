import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Point3D } from '../api/court3DMap';
import type { HeatmapData } from '../api/useArData';
import {
  COURT_WIDTH_M,
  COURT_LENGTH_M,
  SINGLES_WIDTH_M,
  HALF_DOUBLES_WIDTH,
  HALF_SINGLES_WIDTH,
  HALF_COURT_LENGTH,
  SERVICE_BOX_LENGTH,
  NET_HEIGHT_CENTER,
  NET_HEIGHT_POST,
} from '../api/court3DMap';

interface Court3DCanvasProps {
  points3D: Point3D[];
  bounces3D: Point3D[];
  cameraAngle: 'isometric' | 'aerial' | 'baseline';
  showHeatmap: boolean;
  showTrail: boolean;
  showShadow: boolean;
  progress: number; // 0 to 1
  heatmapData: HeatmapData | null;
}

export const Court3DCanvas: React.FC<Court3DCanvasProps> = ({
  points3D,
  bounces3D,
  cameraAngle,
  showHeatmap,
  showTrail,
  showShadow,
  progress,
  heatmapData,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  // Đối tượng 3D cần cập nhật khi props thay đổi
  const ballMeshRef = useRef<THREE.Mesh | null>(null);
  const ballShadowRef = useRef<THREE.Mesh | null>(null);
  const trajectoryTubeRef = useRef<THREE.Mesh | null>(null);
  const trajectoryShadowRef = useRef<THREE.Line | null>(null);
  const bouncesGroupRef = useRef<THREE.Group | null>(null);
  const heatmapMeshRef = useRef<THREE.Mesh | null>(null);
  const curveRef = useRef<THREE.CatmullRomCurve3 | null>(null);

  // Mục tiêu camera lerp
  const targetCamPos = useRef<THREE.Vector3>(new THREE.Vector3(15, 12, 16));
  const targetLookAt = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));

  // 1. KHỞI TẠO THREE.JS SCENE
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 450;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#070b13');
    scene.fog = new THREE.FogExp2('#070b13', 0.015);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(15, 12, 16);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.02; // Không cho camera chìm dưới sàn
    controls.minDistance = 5;
    controls.maxDistance = 45;
    controlsRef.current = controls;

    // Ánh sáng (Lights)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight1.position.set(10, 20, 15);
    dirLight1.castShadow = true;
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x4cd7f6, 0.4);
    dirLight2.position.set(-15, 10, -15);
    scene.add(dirLight2);

    // DỰNG SÂN TENNIS 3D
    buildCourt3D(scene);

    // Bóng Tennis 3D
    const ballGeo = new THREE.SphereGeometry(0.12, 32, 32);
    const ballMat = new THREE.MeshStandardMaterial({
      color: 0xcaf300,
      emissive: 0x84a900,
      emissiveIntensity: 0.6,
      roughness: 0.3,
    });
    const ballMesh = new THREE.Mesh(ballGeo, ballMat);
    ballMesh.castShadow = true;
    ballMesh.position.set(0, -10, 0); // Ẩn ban đầu
    scene.add(ballMesh);
    ballMeshRef.current = ballMesh;

    // Bóng đổ trên mặt sân (Shadow Disc)
    const shadowGeo = new THREE.CircleGeometry(0.16, 24);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.set(0, 0.02, 0);
    scene.add(shadowMesh);
    ballShadowRef.current = shadowMesh;

    // Group chứa các điểm nảy (Bounces)
    const bouncesGroup = new THREE.Group();
    scene.add(bouncesGroup);
    bouncesGroupRef.current = bouncesGroup;

    // Resize Handler
    const handleResize = () => {
      if (!container || !camera || !renderer) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Animation Loop
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);

      if (controls) {
        controls.update();
      }

      if (renderer && scene && camera) {
        renderer.render(scene, camera);
      }
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      controls.dispose();
      if (container) container.innerHTML = '';
    };
  }, []);

  // 2. CẬP NHẬT GÓC CAMERA KHI THAY ĐỔI PRESET
  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    if (cameraAngle === 'isometric') {
      camera.up.set(0, 1, 0);
      camera.position.set(16, 13, 16);
      controls.target.set(0, 0, 0);
      controls.update();
    } else if (cameraAngle === 'aerial') {
      // Sân nằm NGANG: Chiều dài 23.77m (trục Z) nằm ngang từ TRÁI sang PHẢI
      // Chiều rộng 10.97m (trục X) nằm dọc từ DƯỚI lên TRÊN
      // Lưới tennis chạy thẳng đứng ở chính GIỮA sân
      camera.up.set(1, 0, 0);
      camera.position.set(0, 21.5, 0);
      controls.target.set(0, 0, 0);
      controls.update();
    } else if (cameraAngle === 'baseline') {
      camera.up.set(0, 1, 0);
      camera.position.set(0, 3.2, -18);
      controls.target.set(0, 1.2, 2);
      controls.update();
    }
  }, [cameraAngle]);

  // 3. VẼ ĐƯỜNG BAY 3D (TUBE + SHADOW) VÀ ĐIỂM NẢY BOUNCES
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Xóa tube cũ
    if (trajectoryTubeRef.current) {
      scene.remove(trajectoryTubeRef.current);
      trajectoryTubeRef.current.geometry.dispose();
      trajectoryTubeRef.current = null;
    }
    // Xóa shadow line cũ
    if (trajectoryShadowRef.current) {
      scene.remove(trajectoryShadowRef.current);
      trajectoryShadowRef.current.geometry.dispose();
      trajectoryShadowRef.current = null;
    }
    // Xóa bounces cũ
    if (bouncesGroupRef.current) {
      while (bouncesGroupRef.current.children.length > 0) {
        const obj = bouncesGroupRef.current.children[0] as THREE.Mesh;
        bouncesGroupRef.current.remove(obj);
        obj.geometry?.dispose();
      }
    }

    if (!points3D || points3D.length < 2) {
      curveRef.current = null;
      return;
    }

    // Tạo Curve 3D từ các điểm
    const vectors = points3D.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    const curve = new THREE.CatmullRomCurve3(vectors, false, 'catmullrom', 0.2);
    curveRef.current = curve;

    // Tube 3D phát sáng
    if (showTrail) {
      const tubeGeo = new THREE.TubeGeometry(curve, Math.min(256, points3D.length * 6), 0.045, 8, false);
      const tubeMat = new THREE.MeshStandardMaterial({
        color: 0xcaf300,
        emissive: 0xa2c600,
        emissiveIntensity: 0.8,
        roughness: 0.2,
      });
      const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
      scene.add(tubeMesh);
      trajectoryTubeRef.current = tubeMesh;
    }

    // Shadow line trên sàn
    if (showShadow) {
      const shadowPts = points3D.map((p) => new THREE.Vector3(p.x, 0.025, p.z));
      const shadowGeo = new THREE.BufferGeometry().setFromPoints(shadowPts);
      const shadowMat = new THREE.LineBasicMaterial({
        color: 0x4cd7f6,
        transparent: true,
        opacity: 0.45,
        linewidth: 1.5,
      });
      const shadowLine = new THREE.Line(shadowGeo, shadowMat);
      scene.add(shadowLine);
      trajectoryShadowRef.current = shadowLine;
    }

    // Vẽ các điểm nảy Bounces (Vòng tiếp đất)
    if (bouncesGroupRef.current) {
      bounces3D.forEach((b, idx) => {
        // Vòng tròn nảy ngoài (Ripple)
        const ringGeo = new THREE.RingGeometry(0.18, 0.28, 32);
        const ringMat = new THREE.MeshBasicMaterial({
          color: idx === bounces3D.length - 1 ? 0xcaf300 : 0x4cd7f6,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.85,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(b.x, 0.03, b.z);
        bouncesGroupRef.current?.add(ring);

        // Chấm tâm tiếp đất
        const dotGeo = new THREE.CircleGeometry(0.08, 16);
        const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.rotation.x = -Math.PI / 2;
        dot.position.set(b.x, 0.035, b.z);
        bouncesGroupRef.current?.add(dot);
      });
    }
  }, [points3D, bounces3D, showTrail, showShadow]);

  // 4. CẬP NHẬT VỊ TRÍ QUẢ BÓNG THEO PROGRESS
  useEffect(() => {
    const curve = curveRef.current;
    const ball = ballMeshRef.current;
    const shadow = ballShadowRef.current;
    if (!curve || !ball || !shadow) return;

    const clampedProgress = Math.min(Math.max(progress, 0), 1);
    const pos = curve.getPointAt(clampedProgress);

    ball.position.copy(pos);
    shadow.position.set(pos.x, 0.025, pos.z);

    // Kích thước bóng đổ phụ thuộc vào độ cao của bóng
    const scale = Math.max(0.6, 1.4 - pos.y * 0.25);
    shadow.scale.set(scale, scale, scale);
    if (shadow.material instanceof THREE.Material) {
      (shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.15, 0.5 - pos.y * 0.1);
    }
  }, [progress]);

  // 5. VẼ LỚP HEATMAP 3D LÊN MẶT SÂN
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (heatmapMeshRef.current) {
      scene.remove(heatmapMeshRef.current);
      heatmapMeshRef.current.geometry.dispose();
      if (heatmapMeshRef.current.material instanceof THREE.Material) {
        heatmapMeshRef.current.material.dispose();
      }
      heatmapMeshRef.current = null;
    }

    if (!showHeatmap || !heatmapData || !heatmapData.players) return;

    // Tạo canvas để sinh texture bản đồ nhiệt
    const cvs = document.createElement('canvas');
    cvs.width = 256;
    cvs.height = 512;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, cvs.width, cvs.height);

    const binsX = heatmapData.bins?.x || 22;
    const binsY = heatmapData.bins?.y || 48;
    const cellW = cvs.width / binsX;
    const cellH = cvs.height / binsY;

    // Vẽ tế bào nhiệt cho từng VĐV
    heatmapData.players.forEach((p) => {
      const isP1 = p.playerIndex === 0;
      const color = isP1 ? 'rgba(76, 215, 246,' : 'rgba(202, 243, 0,';

      let maxCount = 1;
      p.cells.forEach(([, , count]) => {
        if (count > maxCount) maxCount = count;
      });

      p.cells.forEach(([bx, by, count]) => {
        const alpha = Math.min(0.85, (count / maxCount) * 0.75 + 0.15);
        ctx.fillStyle = `${color}${alpha})`;
        ctx.beginPath();
        // Xoay trục theo chiều sân: bx ngang, by dọc
        const px = bx * cellW + cellW / 2;
        const py = by * cellH + cellH / 2;
        const radius = Math.max(cellW, cellH) * 0.9;
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
      });
    });

    const texture = new THREE.CanvasTexture(cvs);
    texture.generateMipmaps = true;

    const heatGeo = new THREE.PlaneGeometry(COURT_WIDTH_M, COURT_LENGTH_M);
    const heatMat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    });
    const heatMesh = new THREE.Mesh(heatGeo, heatMat);
    heatMesh.rotation.x = -Math.PI / 2;
    heatMesh.position.set(0, 0.015, 0); // Đặt ngay sát trên mặt sân
    scene.add(heatMesh);
    heatmapMeshRef.current = heatMesh;
  }, [showHeatmap, heatmapData]);

  return <div ref={containerRef} className="w-full h-full min-h-[460px] relative cursor-grab active:cursor-grabbing" />;
};

// ==========================================
// HÀM DỰNG SÂN TENNIS 3D QUỐC TẾ (ITF STANDARD)
// ==========================================
function buildCourt3D(scene: THREE.Scene) {
  // 1. Vùng thềm chạy xung quanh sân (Run-off Apron)
  const apronGeo = new THREE.PlaneGeometry(20, 36);
  const apronMat = new THREE.MeshStandardMaterial({
    color: 0x09111f,
    roughness: 0.85,
    metalness: 0.1,
  });
  const apron = new THREE.Mesh(apronGeo, apronMat);
  apron.rotation.x = -Math.PI / 2;
  apron.receiveShadow = true;
  scene.add(apron);

  // 2. Mặt sân đánh đôi (Doubles Court)
  const courtGeo = new THREE.PlaneGeometry(COURT_WIDTH_M, COURT_LENGTH_M);
  const courtMat = new THREE.MeshStandardMaterial({
    color: 0x11213d, // Indigo tournament blue
    roughness: 0.75,
    metalness: 0.15,
  });
  const court = new THREE.Mesh(courtGeo, courtMat);
  court.rotation.x = -Math.PI / 2;
  court.position.y = 0.005;
  court.receiveShadow = true;
  scene.add(court);

  // 3. Mặt sân đánh đơn (Singles Infield Court)
  const singlesGeo = new THREE.PlaneGeometry(SINGLES_WIDTH_M, COURT_LENGTH_M);
  const singlesMat = new THREE.MeshStandardMaterial({
    color: 0x17325c, // Sáng hơn một tông để nhận diện vùng đánh đơn
    roughness: 0.7,
    metalness: 0.15,
  });
  const singlesCourt = new THREE.Mesh(singlesGeo, singlesMat);
  singlesCourt.rotation.x = -Math.PI / 2;
  singlesCourt.position.y = 0.008;
  singlesCourt.receiveShadow = true;
  scene.add(singlesCourt);

  // 4. VẠCH SÂN MÀU TRẮNG PHẢN QUANG (White Court Lines)
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const lineY = 0.012;
  const lineThick = 0.06; // 6cm

  // Hàm phụ tạo vạch
  const addLine = (w: number, l: number, x: number, z: number) => {
    const geo = new THREE.PlaneGeometry(w, l);
    const m = new THREE.Mesh(geo, lineMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, lineY, z);
    scene.add(m);
  };

  // Hai đường Baselines (cuối sân)
  addLine(COURT_WIDTH_M, lineThick * 1.5, 0, -HALF_COURT_LENGTH);
  addLine(COURT_WIDTH_M, lineThick * 1.5, 0, HALF_COURT_LENGTH);

  // Hai đường biên đôi (Doubles Sidelines)
  addLine(lineThick, COURT_LENGTH_M, -HALF_DOUBLES_WIDTH, 0);
  addLine(lineThick, COURT_LENGTH_M, HALF_DOUBLES_WIDTH, 0);

  // Hai đường biên đơn (Singles Sidelines)
  addLine(lineThick, COURT_LENGTH_M, -HALF_SINGLES_WIDTH, 0);
  addLine(lineThick, COURT_LENGTH_M, HALF_SINGLES_WIDTH, 0);

  // Hai đường giao bóng Service Lines (cách lưới 6.4m)
  addLine(SINGLES_WIDTH_M, lineThick, 0, -SERVICE_BOX_LENGTH);
  addLine(SINGLES_WIDTH_M, lineThick, 0, SERVICE_BOX_LENGTH);

  // Đường phân cách giao bóng trung tâm (Center Service Line)
  addLine(lineThick, SERVICE_BOX_LENGTH * 2, 0, 0);

  // Vạch đánh dấu tâm cuối sân (Center Marks)
  addLine(lineThick, 0.4, 0, -HALF_COURT_LENGTH + 0.2);
  addLine(lineThick, 0.4, 0, HALF_COURT_LENGTH - 0.2);

  // 5. LƯỚI TENNIS 3D (Tennis Net)
  const netLen = COURT_WIDTH_M + 1.8;
  const netGeo = new THREE.PlaneGeometry(netLen, NET_HEIGHT_CENTER);
  const netCanvas = document.createElement('canvas');
  netCanvas.width = 64;
  netCanvas.height = 64;
  const netCtx = netCanvas.getContext('2d');
  if (netCtx) {
    netCtx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    netCtx.fillRect(0, 0, 64, 64);
    netCtx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    netCtx.lineWidth = 4;
    netCtx.strokeRect(0, 0, 64, 64);
  }
  const netTex = new THREE.CanvasTexture(netCanvas);
  netTex.wrapS = THREE.RepeatWrapping;
  netTex.wrapT = THREE.RepeatWrapping;
  netTex.repeat.set(50, 4);

  const netMat = new THREE.MeshStandardMaterial({
    map: netTex,
    transparent: true,
    opacity: 0.75,
    side: THREE.DoubleSide,
  });
  const netMesh = new THREE.Mesh(netGeo, netMat);
  netMesh.position.set(0, NET_HEIGHT_CENTER / 2, 0);
  scene.add(netMesh);

  // Dải băng trắng đỉnh lưới (Top Net Tape)
  const tapeGeo = new THREE.BoxGeometry(netLen, 0.07, 0.04);
  const tapeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const tape = new THREE.Mesh(tapeGeo, tapeMat);
  tape.position.set(0, NET_HEIGHT_CENTER + 0.02, 0);
  scene.add(tape);

  // 2 Cột căng lưới (Net Posts)
  const postGeo = new THREE.CylinderGeometry(0.06, 0.06, NET_HEIGHT_POST, 16);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8, roughness: 0.3 });

  const postL = new THREE.Mesh(postGeo, postMat);
  postL.position.set(-netLen / 2, NET_HEIGHT_POST / 2, 0);
  scene.add(postL);

  const postR = new THREE.Mesh(postGeo, postMat);
  postR.position.set(netLen / 2, NET_HEIGHT_POST / 2, 0);
  scene.add(postR);
}

