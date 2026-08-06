import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

// =====================================================================
// --- State & Constants ---
// =====================================================================
let currentVrm = null;

let activeGesture = null;
let gestureTime = 0;
let gestureDuration = 0;

let renderer, scene, camera, controls, transformControls;
let lookAtTarget;

const clock = new THREE.Clock();

// Default VRM Model
const DEFAULT_VRM_URL = '/Aria 2.0.vrm';

// GLTF Loader with VRM plugin
const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

// DOM Elements
const controlsPanel = document.getElementById('controlsPanel');
const panelToggleBtn = document.getElementById('panelToggleBtn');

const openFileBtn = document.getElementById('openFileBtn');
const filePicker = document.getElementById('filePicker');
const dropOverlay = document.getElementById('drop-overlay');

const tabAnimationBtn = document.getElementById('tabAnimationBtn');
const tabPoseBtn = document.getElementById('tabPoseBtn');
const tabFaceBtn = document.getElementById('tabFaceBtn');
const tabCustomBtn = document.getElementById('tabCustomBtn');

const animationPanel = document.getElementById('animationPanel');
const posePanel = document.getElementById('posePanel');
const facePanel = document.getElementById('facePanel');
const customPanel = document.getElementById('customPanel');

const handlesToggle = document.getElementById('handlesToggle');
const resetPoseBtn = document.getElementById('resetPoseBtn');
const resetFaceBtn = document.getElementById('resetFaceBtn');
const followMouseToggle = document.getElementById('followMouseToggle');
const poseSlidersContainer = document.getElementById('poseSlidersContainer');

const expressionSlidersContainer = document.getElementById('expressionSlidersContainer');
const lookAtSlidersContainer = document.getElementById('lookAtSlidersContainer');

// Chat UI Elements
const chatLog = document.getElementById('chatLog');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const micBtn = document.getElementById('micBtn');
const pdfBtn = document.getElementById('pdfBtn');
const pdfPicker = document.getElementById('pdfPicker');
const modelNameSpan = document.getElementById('modelName') || { textContent: '' };
const statusDiv = document.getElementById('status') || { textContent: '', style: {} };

function setStatus(text, color = null) {
    if (statusDiv) {
        statusDiv.textContent = text;
        if (color) statusDiv.style.color = color;
    }
}

// Procedural Animation State Variables (Breathing & Eye Blinking)
let breathTimer = 0;
let breathSpeed = 2.0;
let targetBreathSpeed = 2.0;
let breathPhase = 0;
let naturalBreathTimer = 0;
let modelBasePosY = 0;
let isModelDragging = false;
let modelDragStart = { x: 0, y: 0 };
let modelPosStart = { x: 0, y: 0 };

let blinkTimer = 0;
let nextBlinkTime = 3.0;
let isBlinking = false;
let blinkDuration = 0.15;
let currentBlinkElapsed = 0;

let lastMouseMoveTime = 0;

// Expression Lerping & Emotion Blending State
let currentExpressions = { happy: 0, angry: 0, sad: 0, relaxed: 0, surprised: 0 };
let targetExpressions = { happy: 0, angry: 0, sad: 0, relaxed: 0, surprised: 0 };
let moodResetTimer = null;

function scheduleMoodResetToNormal(delayMs = 2000) {
    if (moodResetTimer) {
        clearTimeout(moodResetTimer);
        moodResetTimer = null;
    }
    moodResetTimer = setTimeout(() => {
        setMoodSmooth('relaxed');
    }, delayMs);
}

let feetShadowMesh = null;
let studioGroup = null;

// Audio-Driven Lip Sync System
let audioCtx = null;
let audioAnalyser = null;
let currentAudioElement = null;
let isAudioPlaying = false;
let isSpeaking = false;

// =====================================================================
// --- 1. SETUP THREE.JS SCENE ---
// =====================================================================
function init() {
    const container = document.getElementById('canvas-container');
    const width = container ? container.clientWidth : window.innerWidth;
    const height = container ? container.clientHeight : window.innerHeight;

    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;

    renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
        precision: 'mediump'
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.0));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.BasicShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    if (container) container.appendChild(renderer.domElement);

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(30.0, width / height, 0.1, 20.0);
    camera.position.set(0.0, 1.25, 2.2);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0.0, 1.05, 0.0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.5;
    controls.maxDistance = 6.0;
    controls.update();

    // LookAt Mouse target object
    lookAtTarget = new THREE.Object3D();
    lookAtTarget.position.set(0, 1.15, 2.0);
    scene.add(lookAtTarget);

    // Build 3D Studio Environment
    buildRealisticStudioEnvironment();

    // Setup 3D Pose Control Gizmos
    setupTransformControls();

    // Setup Eye Cursor Tracking
    setupEyeTrackingOnly();
    setupEventListeners();
    setupChatSystem();

    // Load initial VRM Model
    loadVRM(DEFAULT_VRM_URL, 'Aria 2.0.vrm').catch(console.error);

    // Start render loop
    animate();
}

const targetMousePos = { x: 0, y: 1.15, z: 2.0 };

function setupEyeTrackingOnly() {
    const updateTarget = (clientX, clientY) => {
        lastMouseMoveTime = performance.now();
        targetMousePos.x = ((clientX / window.innerWidth) - 0.5) * 4.5;
        targetMousePos.y = -((clientY / window.innerHeight) - 0.5) * 3.0 + 1.15;
    };

    window.addEventListener('pointermove', (e) => updateTarget(e.clientX, e.clientY));
    window.addEventListener('touchmove', (e) => {
        if (e.touches && e.touches[0]) {
            updateTarget(e.touches[0].clientX, e.touches[0].clientY);
        }
    }, { passive: true });
    window.addEventListener('touchstart', (e) => {
        if (e.touches && e.touches[0]) {
            updateTarget(e.touches[0].clientX, e.touches[0].clientY);
        }
    }, { passive: true });
}

function buildRealisticStudioEnvironment() {
    if (studioGroup) scene.remove(studioGroup);

    studioGroup = new THREE.Group();

    // Pure Natural White Studio Lighting for True Vibrant 3D Model Colors
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.45);
    studioGroup.add(ambientLight);

    const mainLight = new THREE.DirectionalLight(0xfff5ea, 1.25);
    mainLight.position.set(1.5, 3.5, 2.0);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 512;
    mainLight.shadow.mapSize.height = 512;
    mainLight.shadow.bias = -0.0001;
    studioGroup.add(mainLight);

    // Direct frontal fill light to completely eliminate dark facial/body shadows
    const frontFillLight = new THREE.DirectionalLight(0xffffff, 0.95);
    frontFillLight.position.set(0.0, 1.5, 3.0);
    studioGroup.add(frontFillLight);

    const backLight = new THREE.DirectionalLight(0xffffff, 0.6);
    backLight.position.set(-2.0, 2.5, -2.5);
    studioGroup.add(backLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
    fillLight.position.set(-2.5, 1.5, 2.0);
    studioGroup.add(fillLight);

    // Seamless Curved Studio Backdrop (Cyclorama) - NO HORIZONTAL SPLIT LINE
    const cycGeo = new THREE.CylinderGeometry(16, 16, 14, 32, 1, true, -Math.PI / 2, Math.PI);
    const cycMat = new THREE.MeshStandardMaterial({
        color: 0x0a101b,
        roughness: 0.85,
        metalness: 0.05,
        side: THREE.BackSide
    });
    const cyc = new THREE.Mesh(cycGeo, cycMat);
    cyc.position.set(0, 6.0, 0);
    studioGroup.add(cyc);

    // Seamless Floor matching backdrop
    const floorGeo = new THREE.CircleGeometry(16, 32);
    const floorMat = new THREE.MeshStandardMaterial({
        color: 0x0a101b,
        roughness: 0.85,
        metalness: 0.05
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    studioGroup.add(floor);

    // Soft Feet Shadow
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.65)');
    grad.addColorStop(0.5, 'rgba(0, 0, 0, 0.25)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);

    const shadowTex = new THREE.CanvasTexture(canvas);
    const shadowGeo = new THREE.PlaneGeometry(1.6, 1.6);
    const shadowMat = new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        depthWrite: false
    });
    feetShadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    feetShadowMesh.rotation.x = -Math.PI / 2;
    feetShadowMesh.position.set(0, 0.005, 0);
    studioGroup.add(feetShadowMesh);

    scene.fog = new THREE.FogExp2(0x0a101b, 0.015);
    scene.add(studioGroup);
}

// =====================================================================
// --- PROCEDURAL ANIMATIONS: POSE, BREATHING & BLINKING ---
// =====================================================================
function applyNaturalHumanPose(vrm) {
    if (!vrm || !vrm.humanoid) return;

    const leftUpperArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
    const leftLowerArm = vrm.humanoid.getNormalizedBoneNode('leftLowerArm');
    const leftHand = vrm.humanoid.getNormalizedBoneNode('leftHand');

    const rightUpperArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
    const rightLowerArm = vrm.humanoid.getNormalizedBoneNode('rightLowerArm');
    const rightHand = vrm.humanoid.getNormalizedBoneNode('rightHand');

    const leftShoulder = vrm.humanoid.getNormalizedBoneNode('leftShoulder');
    const rightShoulder = vrm.humanoid.getNormalizedBoneNode('rightShoulder');
    const spine = vrm.humanoid.getNormalizedBoneNode('spine');
    const head = vrm.humanoid.getNormalizedBoneNode('head');

    if (leftShoulder) leftShoulder.rotation.set(0, 0, 0);
    if (rightShoulder) rightShoulder.rotation.set(0, 0, 0);
    if (spine) spine.rotation.set(0, 0, 0);
    if (head) head.rotation.set(0, 0, 0);

    // Natural human resting arm positions
    if (leftUpperArm) leftUpperArm.rotation.set(0.08, 0.05, -1.22);
    if (rightUpperArm) rightUpperArm.rotation.set(0.08, -0.05, 1.22);

    if (leftLowerArm) leftLowerArm.rotation.set(0, 0.1, -0.12);
    if (rightLowerArm) rightLowerArm.rotation.set(0, -0.1, 0.12);

    if (leftHand) leftHand.rotation.set(0, 0, -0.05);
    if (rightHand) rightHand.rotation.set(0, 0, 0.05);
}

// =====================================================================
// --- VRMA ANIMATION LOADER & PROCEDURAL MOTION ENGINE ---
// =====================================================================
function stopAllAnimations() {
    activeGesture = null;
    gestureTime = 0;

    if (currentVrm) {
        applyNaturalHumanPose(currentVrm);
    }

    setStatus('Motions reset to rest pose', '#4ade80');
}

function triggerGesture(name) {
    if (!currentVrm || !currentVrm.humanoid) return;

    activeGesture = String(name).toLowerCase().trim();
    gestureTime = 0;

    switch (activeGesture) {
        case 'nod':
            gestureDuration = 1.8;
            setStatus('👍 Nodding in agreement...', '#38bdf8');
            break;
        case 'shake':
            gestureDuration = 2.2;
            setStatus('🙅 Shaking head...', '#38bdf8');
            break;
        case 'bow':
            gestureDuration = 3.0;
            setStatus('🙇 Respectful bow...', '#38bdf8');
            setMoodSmooth('relaxed');
            break;
        default:
            activeGesture = null;
            break;
    }
}

function updateGesture(delta) {
    if (!activeGesture || !currentVrm || !currentVrm.humanoid) return;

    gestureTime += delta;
    const rawT = gestureTime / gestureDuration;

    if (rawT >= 1.0) {
        activeGesture = null;
        setStatus('Ready', '#4ade80');
        applyNaturalHumanPose(currentVrm);
        return;
    }

    // Smooth Ease-in Ease-out envelope (0 -> 1 -> 0)
    const envelope = Math.sin(rawT * Math.PI);

    const h = currentVrm.humanoid;
    const head = h.getNormalizedBoneNode('head');
    const neck = h.getNormalizedBoneNode('neck');
    const spine = h.getNormalizedBoneNode('spine');
    const chest = h.getNormalizedBoneNode('chest');
    const leftUpperArm = h.getNormalizedBoneNode('leftUpperArm');
    const rightUpperArm = h.getNormalizedBoneNode('rightUpperArm');

    const lerpRate = Math.min(1.0, delta * 12.0);

    switch (activeGesture) {
        case 'nod': {
            const nodAngle = Math.sin(rawT * Math.PI * 3.5) * 0.20 * envelope;
            if (head) head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, nodAngle, lerpRate);
            if (neck) neck.rotation.x = THREE.MathUtils.lerp(neck.rotation.x, nodAngle * 0.45, lerpRate);
            break;
        }
        case 'shake': {
            const shakeAngle = Math.sin(rawT * Math.PI * 3.5) * 0.24 * envelope;
            if (head) head.rotation.y = THREE.MathUtils.lerp(head.rotation.y, shakeAngle, lerpRate);
            if (neck) neck.rotation.y = THREE.MathUtils.lerp(neck.rotation.y, shakeAngle * 0.45, lerpRate);
            break;
        }
        case 'bow': {
            const bowProgress = Math.sin(rawT * Math.PI);
            if (spine) spine.rotation.x = THREE.MathUtils.lerp(spine.rotation.x, bowProgress * 0.32, lerpRate);
            if (chest) chest.rotation.x = THREE.MathUtils.lerp(chest.rotation.x, bowProgress * 0.18, lerpRate);
            if (head) head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, bowProgress * 0.22, lerpRate);
            if (leftUpperArm) leftUpperArm.rotation.x = THREE.MathUtils.lerp(leftUpperArm.rotation.x, 0.08 + bowProgress * 0.15, lerpRate);
            if (rightUpperArm) rightUpperArm.rotation.x = THREE.MathUtils.lerp(rightUpperArm.rotation.x, 0.08 + bowProgress * 0.15, lerpRate);
            break;
        }
    }
}

function updateIdleBreathing(deltaTime) {
    if (!currentVrm || !currentVrm.humanoid) return;

    breathTimer += deltaTime;

    const spine = currentVrm.humanoid.getNormalizedBoneNode('spine');
    const chest = currentVrm.humanoid.getNormalizedBoneNode('chest');
    const upperChest = currentVrm.humanoid.getNormalizedBoneNode('upperChest');
    const head = currentVrm.humanoid.getNormalizedBoneNode('head');

    const breathCycle = Math.sin(breathPhase);

    // Only apply idle pose when NOT in pose editing mode and NO gesture is active
    if (activeTab !== 'pose' && !activeGesture) {
        applyNaturalHumanPose(currentVrm);

        if (chest) chest.rotation.x = breathCycle * 0.035;
        if (upperChest) upperChest.rotation.x = breathCycle * 0.025;
        if (spine) spine.rotation.x = breathCycle * 0.018;
        if (head) {
            head.rotation.x = breathCycle * 0.012;
            head.rotation.y = Math.sin(breathPhase * 0.4) * 0.015;
        }

        const leftUpperArm = currentVrm.humanoid.getNormalizedBoneNode('leftUpperArm');
        const rightUpperArm = currentVrm.humanoid.getNormalizedBoneNode('rightUpperArm');
        if (leftUpperArm) leftUpperArm.rotation.z = -1.22 - breathCycle * 0.012;
        if (rightUpperArm) rightUpperArm.rotation.z = 1.22 + breathCycle * 0.012;
    }

    // Automatic Eye Blinking System (3-5s random interval)
    blinkTimer += deltaTime;
    const expressionManager = currentVrm.expressionManager;

    if (expressionManager && expressionManager.expressionMap && expressionManager.expressionMap['blink']) {
        if (!isBlinking && blinkTimer >= nextBlinkTime) {
            isBlinking = true;
            currentBlinkElapsed = 0;
            blinkTimer = 0;
            nextBlinkTime = 3.0 + Math.random() * 2.0;
        }

        if (isBlinking) {
            currentBlinkElapsed += deltaTime;
            const progress = currentBlinkElapsed / blinkDuration;
            if (progress >= 1.0) {
                isBlinking = false;
                try { expressionManager.setValue('blink', 0); } catch (e) { }
            } else {
                const blinkWeight = Math.sin(progress * Math.PI);
                try { expressionManager.setValue('blink', blinkWeight); } catch (e) { }
            }
        }
    }
}

function naturalBreathing(t, delta) {
    naturalBreathTimer += delta;
    if (naturalBreathTimer > 7) {
        targetBreathSpeed = 1.8 + Math.random() * 0.5;
        naturalBreathTimer = 0;
    }

    breathSpeed += (targetBreathSpeed - breathSpeed) * (delta * 0.9);
    breathPhase += delta * breathSpeed;

    if (currentVrm && currentVrm.scene) {
        const floatY = Math.sin(breathPhase) * 0.018 + Math.sin(breathPhase * 2.2) * 0.004;
        const floatX = Math.cos(breathPhase * 0.4) * 0.004;
        currentVrm.scene.position.y = modelBasePosY + floatY;
        currentVrm.scene.position.x = floatX;
    }
}

function setMoodSmooth(moodInput, defaultIntensity = 1) {
    ['happy', 'angry', 'sad', 'relaxed', 'surprised'].forEach(exp => {
        targetExpressions[exp] = 0;
    });

    if (!moodInput) return;

    if (typeof moodInput === 'string') {
        if (moodInput.includes(':') || moodInput.includes(',')) {
            const parts = moodInput.split(',');
            parts.forEach(part => {
                const subParts = part.trim().split(':');
                const cleanMood = subParts[0].toLowerCase().trim();
                const intensity = subParts[1] !== undefined ? parseFloat(subParts[1]) : defaultIntensity;
                if (targetExpressions.hasOwnProperty(cleanMood)) {
                    targetExpressions[cleanMood] = isNaN(intensity) ? defaultIntensity : intensity;
                }
            });
        } else {
            const cleanMood = moodInput.toLowerCase().trim();
            if (targetExpressions.hasOwnProperty(cleanMood)) {
                targetExpressions[cleanMood] = defaultIntensity;
            }
        }
    }
}

function updateExpressions(delta) {
    if (!currentVrm || !currentVrm.expressionManager) return;
    const manager = currentVrm.expressionManager;

    const lerpFactor = 1.0 - Math.exp(-delta * 7.5);

    ['happy', 'angry', 'sad', 'relaxed', 'surprised'].forEach(exp => {
        if (!manager.expressionMap || !manager.expressionMap[exp]) return;

        let target = targetExpressions[exp] || 0;
        if ((exp === 'happy' || exp === 'relaxed') && target > 0.35) {
            target = 0.35;
        }

        const current = currentExpressions[exp] || 0;
        const newVal = THREE.MathUtils.lerp(current, target, lerpFactor);
        currentExpressions[exp] = newVal;
        try {
            manager.setValue(exp, newVal);
        } catch (e) { }
    });

    try {
        if (manager.expressionMap) {
            if (manager.expressionMap['blink']) manager.setValue('blink', 0);
            if (manager.expressionMap['blinkLeft']) manager.setValue('blinkLeft', 0);
            if (manager.expressionMap['blinkRight']) manager.setValue('blinkRight', 0);
        }
    } catch (e) {}

    if (activeTab === 'face') {
        syncExpressionSliders();
    }
}

// =====================================================================
// --- VRM MODEL LOADING & INSTANT CACHING ---
// =====================================================================
async function getCachedVRMUrl(url) {
    // Use direct HTTP resource path so browser HTTP cache handles caching with zero CSP blob restrictions
    return url;
}

async function loadVRM(url, displayName = 'Aria 2.0.vrm') {
    setStatus('Loading VRM Model...', '#38bdf8');
    const resolvedUrl = await getCachedVRMUrl(url);

    return new Promise((resolve, reject) => {
        loader.load(
            resolvedUrl,
            (gltf) => {
                try {
                    const vrm = gltf.userData.vrm;
                    if (!vrm) {
                        throw new Error('No VRM data found in GLTF');
                    }

                    // Fast-path rendering & RAM optimization
                    VRMUtils.rotateVRM0(vrm);

                    vrm.scene.traverse((obj) => {
                        if (obj.isMesh) {
                            obj.frustumCulled = true;
                            obj.castShadow = true;
                            obj.receiveShadow = true;

                            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                            mats.forEach((mat) => {
                                if (!mat) return;
                                mat.precision = 'mediump';

                                // Disable duplicate texture mipmap buffers to keep RAM strictly at 250-300MB
                                ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap'].forEach((texKey) => {
                                    if (mat[texKey]) {
                                        mat[texKey].generateMipmaps = false;
                                        mat[texKey].minFilter = THREE.LinearFilter;
                                        mat[texKey].magFilter = THREE.LinearFilter;
                                    }
                                });
                            });
                        }
                    });

                    // Release GLTF parser binary cache from memory
                    if (gltf.parser) {
                        try { gltf.parser = null; } catch (e) {}
                    }

                    if (currentVrm) {
                        scene.remove(currentVrm.scene);
                        VRMUtils.deepDispose(currentVrm.scene);
                    }

                    scene.add(vrm.scene);

                    // Pre-compile shaders into GPU memory for zero frame stutter
                    renderer.compile(scene, camera);

                    currentVrm = vrm;
                    window.vrm = vrm;

                    // CRITICAL FIX: Initialize base Y for breathing
                    modelBasePosY = vrm.scene.position.y;

                    applyNaturalHumanPose(vrm);

                    if (vrm.lookAt && lookAtTarget) {
                        vrm.lookAt.target = lookAtTarget;
                    }

                    if (modelNameSpan) modelNameSpan.textContent = displayName;

                    // CRITICAL FIX: Rebuild UI panels now that model is loaded
                    buildPoseUI();
                    const loader = document.getElementById('stageLoading');
                    if (loader) loader.hidden = true;

                    setStatus(`Loaded: ${displayName} (Motion Ready)`, '#4ade80');
                    resolve(vrm);
                } catch (err) {
                    console.error('Error processing VRM:', err);
                    setStatus('Error processing VRM', '#f87171');
                    reject(err);
                }
            },
            (progress) => {
                if (progress.total > 0) {
                    const percent = (100.0 * (progress.loaded / progress.total)).toFixed(0);
                    setStatus(`Loading VRM Model... ${percent}%`);
                }
            },
            (error) => {
                console.error('Error loading VRM:', error);
                setStatus('Failed to load VRM model', '#f87171');
                reject(error);
            }
        );
    });
}

// =====================================================================
// --- POSE EDITING & 3D GIZMO ---
// =====================================================================
const POSE_BONE_GROUPS = [
    { label: 'Body', detail: false, bones: ['hips', 'spine', 'chest', 'neck', 'head'] },
    { label: 'Left Arm', detail: false, bones: ['leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand'] },
    { label: 'Right Arm', detail: false, bones: ['rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand'] },
    { label: 'Left Leg', detail: false, bones: ['leftUpperLeg', 'leftLowerLeg', 'leftFoot'] },
    { label: 'Right Leg', detail: false, bones: ['rightUpperLeg', 'rightLowerLeg', 'rightFoot'] }
];

const HANDLE_BONES = POSE_BONE_GROUPS.filter(g => !g.detail).flatMap(g => g.bones);

let selectedBoneName = null;
const sliderRefs = new Map();
const handleByBone = new Map();
const boneHandlesGroup = new THREE.Group();
boneHandlesGroup.visible = false;

const HANDLE_GEOMETRY = new THREE.SphereGeometry(0.025, 12, 8);

function setupTransformControls() {
    scene.add(boneHandlesGroup);

    transformControls = new TransformControls(camera, renderer.domElement);
    transformControls.setMode('rotate');
    transformControls.setSpace('local');
    if (transformControls.isObject3D) {
        scene.add(transformControls);
    } else if (transformControls.getHelper) {
        scene.add(transformControls.getHelper());
    }

    transformControls.addEventListener('dragging-changed', (e) => {
        if (controls) controls.enabled = !e.value;
    });

    transformControls.addEventListener('objectChange', () => {
        if (selectedBoneName) syncSlidersFromBone(selectedBoneName);
    });
}

function createBoneHandle(boneName) {
    const material = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.45,
        depthTest: false
    });
    const mesh = new THREE.Mesh(HANDLE_GEOMETRY, material);
    mesh.renderOrder = 999;
    mesh.userData.boneName = boneName;
    boneHandlesGroup.add(mesh);
    handleByBone.set(boneName, mesh);
}

function disposeBoneHandles() {
    handleByBone.forEach((mesh) => {
        boneHandlesGroup.remove(mesh);
        mesh.material.dispose();
    });
    handleByBone.clear();
}

function buildBoneRow(boneName) {
    const row = document.createElement('div');
    row.className = 'bone-row';

    const label = document.createElement('span');
    label.className = 'bone-label';
    label.textContent = boneName;
    row.appendChild(label);

    const inputs = {};
    const readouts = {};

    ['x', 'y', 'z'].forEach((axis) => {
        const wrap = document.createElement('span');
        wrap.className = 'bone-axis-wrap';

        const input = document.createElement('input');
        input.type = 'range';
        input.min = -180;
        input.max = 180;
        input.step = 1;
        input.value = 0;

        const readout = document.createElement('span');
        readout.className = 'bone-readout';
        readout.textContent = '0°';

        wrap.appendChild(input);
        wrap.appendChild(readout);
        row.appendChild(wrap);

        inputs[axis] = input;
        readouts[axis] = readout;
    });

    sliderRefs.set(boneName, { row, inputs, readouts });
    return row;
}

function buildPoseUI() {
    if (!poseSlidersContainer) return;
    poseSlidersContainer.innerHTML = '';
    sliderRefs.clear();
    disposeBoneHandles();
    selectedBoneName = null;
    if (transformControls) transformControls.detach();

    if (!currentVrm) return;

    POSE_BONE_GROUPS.forEach((group) => {
        const presentBones = group.bones.filter((name) => currentVrm.humanoid.getNormalizedBoneNode(name));
        if (presentBones.length === 0) return;

        const heading = document.createElement('h4');
        heading.className = 'bone-group-title';
        heading.textContent = group.label;
        poseSlidersContainer.appendChild(heading);

        presentBones.forEach((boneName) => {
            poseSlidersContainer.appendChild(buildBoneRow(boneName));
            if (HANDLE_BONES.includes(boneName)) {
                createBoneHandle(boneName);
            }
        });
    });
}

function syncSlidersFromBone(boneName) {
    const refs = sliderRefs.get(boneName);
    if (!refs || !currentVrm) return;
    const node = currentVrm.humanoid.getNormalizedBoneNode(boneName);
    if (!node) return;
    ['x', 'y', 'z'].forEach((axis) => {
        const deg = THREE.MathUtils.radToDeg(node.rotation[axis]);
        refs.inputs[axis].value = deg;
        refs.readouts[axis].textContent = `${Math.round(deg)}°`;
    });
}

function syncAllSliders() {
    sliderRefs.forEach((_refs, boneName) => syncSlidersFromBone(boneName));
}

function deselectBone() {
    if (selectedBoneName) {
        const handle = handleByBone.get(selectedBoneName);
        if (handle) handle.material.color.set(0x38bdf8);
        const refs = sliderRefs.get(selectedBoneName);
        if (refs) refs.row.classList.remove('selected');
    }
    selectedBoneName = null;
    if (transformControls) transformControls.detach();
}

// =====================================================================
// --- FACE & GAZE EDITING ---
// =====================================================================
const FACE_PRESET_GROUPS = [
    {
        label: 'Emotions',
        names: ['happy', 'angry', 'sad', 'relaxed', 'surprised', 'neutral']
    }
];

const expressionSliderRefs = new Map();

function buildExpressionRow(name) {
    const row = document.createElement('div');
    row.className = 'face-row';

    const label = document.createElement('span');
    label.className = 'bone-label';
    label.textContent = name;
    row.appendChild(label);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = 0;
    input.max = 1;
    input.step = 0.01;
    input.value = 0;
    row.appendChild(input);

    const readout = document.createElement('span');
    readout.className = 'bone-readout';
    readout.textContent = '0.00';
    row.appendChild(readout);

    expressionSliderRefs.set(name, { row, input, readout });
    return row;
}

function buildFaceUI() {
    if (!expressionSlidersContainer) return;
    expressionSlidersContainer.innerHTML = '';
    expressionSliderRefs.clear();

    if (!currentVrm) return;

    const expressionManager = currentVrm.expressionManager;
    if (expressionManager) {
        const presetMap = expressionManager.presetExpressionMap || expressionManager.expressionMap || {};

        FACE_PRESET_GROUPS.forEach((group) => {
            const presentNames = group.names.filter((name) => presetMap[name]);
            if (presentNames.length === 0) return;

            const heading = document.createElement('h4');
            heading.className = 'bone-group-title';
            heading.textContent = group.label;
            expressionSlidersContainer.appendChild(heading);

            presentNames.forEach((name) => {
                expressionSlidersContainer.appendChild(buildExpressionRow(name));
            });
        });
    }
}

function syncExpressionSliders() {
    if (!currentVrm || !currentVrm.expressionManager) return;
    expressionSliderRefs.forEach((refs, name) => {
        if (!currentVrm.expressionManager.expressionMap || !currentVrm.expressionManager.expressionMap[name]) return;

        const weight = currentVrm.expressionManager.getValue(name) ?? 0;
        refs.input.value = weight;
        refs.readout.textContent = weight.toFixed(2);
    });
}

// =====================================================================
// --- TAB LIFECYCLE ---
// =====================================================================
let activeTab = 'animation';

function setActiveTab(tabName) {
    const wasTab = activeTab;
    activeTab = tabName;

    if (tabAnimationBtn) tabAnimationBtn.classList.toggle('active', tabName === 'animation');
    if (tabPoseBtn) tabPoseBtn.classList.toggle('active', tabName === 'pose');
    if (tabFaceBtn) tabFaceBtn.classList.toggle('active', tabName === 'face');
    if (tabCustomBtn) tabCustomBtn.classList.toggle('active', tabName === 'custom');

    if (animationPanel) animationPanel.hidden = tabName !== 'animation';
    if (posePanel) posePanel.hidden = tabName !== 'pose';
    if (facePanel) facePanel.hidden = tabName !== 'face';
    if (customPanel) customPanel.hidden = tabName !== 'custom';

    if (wasTab === 'pose' && tabName !== 'pose') {
        deselectBone();
        boneHandlesGroup.visible = false;
    }
    if (tabName === 'pose') {
        if (currentVrm) syncAllSliders();
        if (handlesToggle) boneHandlesGroup.visible = handlesToggle.checked;
    }
    if (tabName === 'face') {
        syncExpressionSliders();
    }
}

// =====================================================================
// --- AUDIO-DRIVEN LIP SYNC SYSTEM ---
// =====================================================================
const visemeTargets = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
const visemeCurrent = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };

function resetVisemeTargets() {
    Object.keys(visemeTargets).forEach(v => visemeTargets[v] = 0);
}

function updateVisemeSmoothly(delta = 0.016) {
    if (!currentVrm) return;
    const manager = currentVrm.expressionManager;
    if (!manager) return;

    const visemeNames = ['aa', 'ih', 'ou', 'ee', 'oh'];
    const hasAnyViseme = visemeNames.some(v => manager.expressionMap && manager.expressionMap[v]);
    if (!hasAnyViseme) return;

    if (isAudioPlaying && audioAnalyser) {
        const dataArray = new Uint8Array(audioAnalyser.frequencyBinCount);
        audioAnalyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        const volume = Math.min(1.0, (average / 110) * 1.6);

        const time = clock.getElapsedTime() * 14;
        visemeTargets.aa = Math.max(0, Math.sin(time) * volume * 0.85);
        visemeTargets.ih = Math.max(0, Math.cos(time * 1.3) * volume * 0.55);
        visemeTargets.oh = Math.max(0, Math.sin(time * 0.7) * volume * 0.65);
        visemeTargets.ee = Math.max(0, Math.cos(time * 0.9) * volume * 0.45);
    } else if (isSpeaking) {
        const time = clock.getElapsedTime() * 15;
        const speechVolume = 0.65 + Math.sin(time * 0.5) * 0.25;
        visemeTargets.aa = Math.max(0, Math.sin(time) * speechVolume * 0.85);
        visemeTargets.ih = Math.max(0, Math.cos(time * 1.4) * speechVolume * 0.5);
        visemeTargets.oh = Math.max(0, Math.sin(time * 0.8) * speechVolume * 0.6);
        visemeTargets.ee = Math.max(0, Math.cos(time * 1.1) * speechVolume * 0.4);
    } else {
        resetVisemeTargets();
    }

    const lipFactor = 1.0 - Math.exp(-delta * 20.0);

    Object.keys(visemeTargets).forEach(vowel => {
        const target = visemeTargets[vowel];
        const curr = visemeCurrent[vowel];
        const next = curr + (target - curr) * lipFactor;
        visemeCurrent[vowel] = next;
        try {
            manager.setValue(vowel, next);
        } catch (e) { }
    });
}

let globalAudioElement = null;
let globalAudioSource = null;

function unlockAudioContext() {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    } catch (e) {}
}
window.addEventListener('click', unlockAudioContext, { passive: true });
window.addEventListener('touchstart', unlockAudioContext, { passive: true });
window.addEventListener('keydown', unlockAudioContext, { passive: true });

function playRealFemaleAudio(base64Audio) {
    if (!base64Audio) return false;

    try {
        unlockAudioContext();

        const mimeType = base64Audio.startsWith('UklGR') ? 'audio/wav' : 'audio/mp3';
        const audioSrc = `data:${mimeType};base64,${base64Audio}`;

        if (!globalAudioElement) {
            globalAudioElement = new Audio();
        } else {
            globalAudioElement.pause();
            globalAudioElement.currentTime = 0;
        }

        globalAudioElement.src = audioSrc;
        globalAudioElement.playbackRate = 1.0;
        currentAudioElement = globalAudioElement;

        try {
            if (audioCtx && !globalAudioSource) {
                globalAudioSource = audioCtx.createMediaElementSource(globalAudioElement);
                audioAnalyser = audioCtx.createAnalyser();
                audioAnalyser.fftSize = 128;
                globalAudioSource.connect(audioAnalyser);
                audioAnalyser.connect(audioCtx.destination);
            }
        } catch (ctxErr) {
            console.warn("MediaElementSource connection warning:", ctxErr);
        }

        globalAudioElement.onplay = () => {
            isAudioPlaying = true;
            if (audioCtx && audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
        };

        globalAudioElement.onended = globalAudioElement.onerror = () => {
            isAudioPlaying = false;
            resetVisemeTargets();
            scheduleMoodResetToNormal(1500);
        };

        const playPromise = globalAudioElement.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                isAudioPlaying = true;
            }).catch((err) => {
                console.warn("Audio play promise error (retrying on user click):", err);
            });
        }

        return true;
    } catch (err) {
        console.error("Audio playback error:", err);
        return false;
    }
}

function speakWithFakeLipSync(text) {
    if (!text || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();

    const cleanText = text
        .replace(/!\[.*?\]\(.*?\)/gi, '')
        .replace(/\[MOOD:[^\]]+\]/gi, '')
        .replace(/\[GESTURE:[^\]]+\]/gi, '')
        .replace(/\[ACTION:[^\]]+\]/gi, '')
        .replace(/[*_~#`]/g, '')
        .trim();

    if (!cleanText) return;

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = /[\u0900-\u097F]/.test(cleanText) ? 'hi-IN' : 'en-US';
    utterance.rate = 1.0;
    utterance.pitch = 1.15;

    const voices = window.speechSynthesis.getVoices();
    const femaleVoice = voices.find(v => 
        (v.lang.includes('hi') || v.lang.includes('en')) && 
        (v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('google') || v.name.toLowerCase().includes('swara') || v.name.toLowerCase().includes('heera') || v.name.toLowerCase().includes('kalpana') || v.name.toLowerCase().includes('zira') || v.name.toLowerCase().includes('samantha') || v.name.toLowerCase().includes('victoria'))
    ) || voices.find(v => v.lang.includes('hi')) || voices[0];

    if (femaleVoice) {
        utterance.voice = femaleVoice;
    }

    utterance.onstart = () => {
        isSpeaking = true;
    };

    utterance.onend = utterance.onerror = () => {
        isSpeaking = false;
        resetVisemeTargets();
        scheduleMoodResetToNormal(1500);
    };

    window.speechSynthesis.speak(utterance);
}

function speak(text, audioContent = null) {
    if (!text) return;

    if (audioContent && playRealFemaleAudio(audioContent)) {
        return;
    }

    speakWithFakeLipSync(text);
}

// =====================================================================
// --- AI CHAT SYSTEM ---
// =====================================================================
function processAIReply(replyText) {
    if (!replyText) return '';

    const moodMatch = replyText.match(/\[MOOD:([^\]]+)\]/i);
    const mood = moodMatch ? moodMatch[1].trim() : 'relaxed';

    const cleanText = replyText
        .replace(/\[MOOD:[^\]]+\]/gi, '')
        .replace(/\[GESTURE:[^\]]+\]/gi, '')
        .replace(/\[ACTION:[^\]]+\]/gi, '')
        .trim();

    setMoodSmooth(mood);
    return cleanText;
}

function autoReact(replyText, audioContent = null) {
    if (!replyText) return '';

    const cleanText = processAIReply(replyText);

    if (audioContent) {
        playRealFemaleAudio(audioContent);
    } else {
        speakWithFakeLipSync(cleanText);
    }

    return cleanText;
}

function addToLog(sender, text, moodTag = null, imageUrl = null, audioContent = null) {
    if (!chatLog) return;
    const bubble = document.createElement('div');
    bubble.className = `msg-bubble ${sender === 'You' ? 'msg-user' : 'msg-ai'}`;

    let hasImage = false;
    let contentHtml = text.replace(/!\[([^\]]*)\]\((https?:\/\/[^\)]+)\)/g, (match, alt, url) => {
        hasImage = true;
        return `<div style="margin-top:8px;"><img src="${url}" alt="${alt}" style="max-width:100%; border-radius:12px; display:block; box-shadow:0 4px 14px rgba(0,0,0,0.35); border:1px solid rgba(255,255,255,0.15);" loading="lazy" /></div>`;
    });

    if (imageUrl && !hasImage) {
        contentHtml += `<div style="margin-top:8px;"><img src="${imageUrl}" alt="Generated Image" style="max-width:100%; border-radius:12px; display:block; box-shadow:0 4px 14px rgba(0,0,0,0.35); border:1px solid rgba(255,255,255,0.15);" loading="lazy" /></div>`;
    }

    bubble.innerHTML = contentHtml;

    if (audioContent && sender !== 'You') {
        const voiceCard = document.createElement('div');
        voiceCard.style.cssText = "margin-top:8px; display:inline-flex; align-items:center; gap:8px; background:rgba(56, 189, 248, 0.15); border:1px solid rgba(56, 189, 248, 0.3); padding:4px 10px; border-radius:16px; cursor:pointer; font-size:0.75rem; color:#38bdf8; font-weight:600;";
        voiceCard.innerHTML = `<span style="font-size:12px;">🔊</span> <span>Voice Note</span>`;
        voiceCard.title = "Click to replay voice message";
        voiceCard.addEventListener('click', () => {
            playRealFemaleAudio(audioContent);
        });
        bubble.appendChild(voiceCard);
    }

    if (moodTag && sender !== 'You') {
        const tag = document.createElement('div');
        tag.className = 'msg-tag';
        tag.textContent = `Mood: ${moodTag}`;
        bubble.appendChild(tag);
    }

    chatLog.appendChild(bubble);
    chatLog.scrollTop = chatLog.scrollHeight;
}

async function sendChatMessage(userText) {
    const text = userText || chatInput.value.trim();
    if (!text) return;

    if (chatInput) chatInput.value = '';

    addToLog('You', text);

    try {
        setStatus('Thinking...', '#818cf8');

        const moodMode = 'yuki';
        const voiceSelect = document.getElementById('voiceSelect');
        const voiceName = voiceSelect ? voiceSelect.value : 'Zephyr';

        const res = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text, moodMode: moodMode, voiceName: voiceName })
        });
        const data = await res.json();
        const fullReply = data.reply || '';

        const moodMatch = fullReply.match(/\[MOOD:(\w+)\]/i);
        const moodTag = moodMatch ? moodMatch[1] : null;

        let gestureTag = data.gesture || data.action || null;
        if (!gestureTag || gestureTag === 'none') {
            const gestureMatch = fullReply.match(/\[(GESTURE|ACTION):(\w+)\]/i);
            if (gestureMatch) gestureTag = gestureMatch[2].toLowerCase();
        }

        // Auto gesture detection on frontend fallback
        if (!gestureTag || gestureTag === 'none') {
            const lowerText = fullReply.toLowerCase();
            if (lowerText.match(/thank you|thanks|bow|feet|charnon|charan|samaan|seva|honored/)) {
                gestureTag = 'bow';
            } else if (lowerText.match(/no|nahi|galat|wrong|sorry|apologize|cannot|mat/)) {
                gestureTag = 'shake';
            } else if (lowerText.match(/yes|ji master|ha|haan|sahi|bilkul|right away|sure|ok|samajh|karti|thik/)) {
                gestureTag = 'nod';
            }
        }

        if (gestureTag && gestureTag !== 'none') {
            triggerGesture(gestureTag);
        }

        const cleanReply = autoReact(fullReply, data.audioContent || data.audio);

        setStatus(`Speaking: "${cleanReply.substring(0, 30)}..."`, '#4ade80');

        addToLog('AI', cleanReply, moodTag, data.imageUrl, data.audioContent || data.audio);
    } catch (err) {
        console.error('Chat error:', err);
        addToLog('AI', 'Sorry, server error occurred!');
    }
}

function setupDraggableChatWidget() {
    const chatWidget = document.querySelector('.chat-widget');
    const chatHeader = document.querySelector('.chat-header');

    if (!chatWidget || !chatHeader) return;

    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    chatHeader.style.cursor = 'grab';

    const onPointerDown = (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;

        isDragging = true;
        chatHeader.style.cursor = 'grabbing';

        const rect = chatWidget.getBoundingClientRect();
        chatWidget.style.bottom = 'auto';
        chatWidget.style.right = 'auto';
        chatWidget.style.left = `${rect.left}px`;
        chatWidget.style.top = `${rect.top}px`;

        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        offsetX = clientX - rect.left;
        offsetY = clientY - rect.top;

        e.preventDefault();
    };

    const onPointerMove = (e) => {
        if (!isDragging) return;

        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        let newX = clientX - offsetX;
        let newY = clientY - offsetY;

        const maxWidth = window.innerWidth - chatWidget.offsetWidth;
        const maxHeight = window.innerHeight - chatWidget.offsetHeight;

        newX = Math.max(10, Math.min(newX, maxWidth - 10));
        newY = Math.max(10, Math.min(newY, maxHeight - 10));

        chatWidget.style.left = `${newX}px`;
        chatWidget.style.top = `${newY}px`;
    };

    const onPointerUp = () => {
        if (isDragging) {
            isDragging = false;
            chatHeader.style.cursor = 'grab';
        }
    };

    chatHeader.addEventListener('mousedown', onPointerDown);
    chatHeader.addEventListener('touchstart', onPointerDown, { passive: false });

    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('touchmove', onPointerMove, { passive: false });

    window.addEventListener('mouseup', onPointerUp);
    window.addEventListener('touchend', onPointerUp);
}

function setupChatSystem() {
    setupDraggableChatWidget();

    if (sendBtn) sendBtn.onclick = () => sendChatMessage();
    if (chatInput) {
        chatInput.onkeydown = (e) => {
            if (e.key === 'Enter') sendChatMessage();
        };
    }

    const testVoiceBtn = document.getElementById('testVoiceBtn');
    if (testVoiceBtn) {
        testVoiceBtn.onclick = async () => {
            const voiceSelect = document.getElementById('voiceSelect');
            const selectedVoice = voiceSelect ? voiceSelect.value : 'Zephyr';
            setStatus(`Testing voice (${selectedVoice})...`, '#38bdf8');
            try {
                const res = await fetch('/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: "Namaste Master! Voice test sequence initiated.", moodMode: 'normal', voiceName: selectedVoice })
                });
                const data = await res.json();
                const audio = data.audioContent || data.audio;
                if (audio) {
                    playRealFemaleAudio(audio);
                    setStatus(`Playing voice test (${selectedVoice})`, '#4ade80');
                } else {
                    setStatus(`Voice test ready (${selectedVoice})`, '#4ade80');
                }
            } catch (e) {
                console.error("Voice test error:", e);
                setStatus('Voice test failed', '#f87171');
            }
        };
    }
    const pdfPicker = document.getElementById('pdfPicker');
    if (pdfBtn && pdfPicker) {
        pdfBtn.onclick = () => pdfPicker.click();
        pdfPicker.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            setStatus(`Reading document: ${file.name}...`, '#c084fc');
            const reader = new FileReader();
            reader.onload = (evt) => {
                const textContent = evt.target.result;
                const docSnippet = typeof textContent === 'string' ? textContent.substring(0, 3000) : 'Document uploaded successfully';
                sendChatMessage(`📄 Master, maine ek PDF document upload kiya hai: "${file.name}". Kripya isey summarize karein:\n\n${docSnippet}`);
            };
            reader.readAsText(file);
        };
    }

    let isListening = false;
    let autoSendTimer = null;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const voiceIndicator = document.getElementById('voiceIndicator');

    if (micBtn) {
        if (!SpeechRecognition) {
            micBtn.onclick = () => {
                alert('Speech Recognition is not supported in this browser. Please use Google Chrome or Microsoft Edge.');
            };
        } else {
            const recognition = new SpeechRecognition();
            recognition.continuous = true; // Continuous listening - won't cut off when pausing
            recognition.interimResults = true; // Real-time interim live speech transcription
            recognition.lang = 'hi-IN'; // Multi-lingual Hindi/English recognition

            const startListening = () => {
                if (isListening) return;
                isListening = true;
                if (chatInput) {
                    chatInput.value = ''; // Clear for fresh dictation
                    chatInput.placeholder = 'Listening... Speak to Aria!';
                }
                micBtn.classList.add('listening');
                if (voiceIndicator) voiceIndicator.classList.add('active');
                setStatus('🎤 Listening... Speak now in Hindi or English!', '#38bdf8');
                try { recognition.start(); } catch (e) {}
            };

            const stopListening = () => {
                clearTimeout(autoSendTimer);
                isListening = false;
                micBtn.classList.remove('listening');
                if (voiceIndicator) voiceIndicator.classList.remove('active');
                if (chatInput) chatInput.placeholder = 'Message Aria...';
                try { recognition.stop(); } catch (e) {}
            };

            micBtn.onclick = () => {
                if (isListening) {
                    const textToSend = chatInput ? chatInput.value.trim() : '';
                    stopListening();
                    if (textToSend) {
                        sendChatMessage(textToSend);
                    }
                } else {
                    startListening();
                }
            };

            recognition.onresult = (event) => {
                let finalTranscript = '';
                let interimTranscript = '';
                for (let i = 0; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        finalTranscript += event.results[i][0].transcript;
                    } else {
                        interimTranscript += event.results[i][0].transcript;
                    }
                }
                const currentText = (finalTranscript + interimTranscript).trim();
                if (chatInput && currentText) {
                    chatInput.value = currentText;
                }

                // Automatically send message after 2 seconds of silence
                clearTimeout(autoSendTimer);
                if (chatInput && chatInput.value.trim() !== '') {
                    autoSendTimer = setTimeout(() => {
                        if (isListening) {
                            const val = chatInput.value.trim();
                            stopListening();
                            if (val) sendChatMessage(val);
                        }
                    }, 2000);
                }
            };

            recognition.onerror = (event) => {
                if (event.error === 'not-allowed') {
                    stopListening();
                    alert('Microphone blocked! Please click the lock icon next to the URL and allow microphone access.');
                }
            };

            // Auto-restart if browser tries to kill the mic before the user clicks stop
            recognition.onend = () => {
                if (isListening) {
                    try { recognition.start(); } catch (e) {}
                }
            };
        }
    }
}

// =====================================================================
// --- EVENT LISTENERS & USER FILE LOADING ---
// =====================================================================
function setupEventListeners() {
    if (panelToggleBtn && controlsPanel) {
        panelToggleBtn.onclick = () => {
            controlsPanel.hidden = !controlsPanel.hidden;
        };
    }

    if (tabAnimationBtn) tabAnimationBtn.onclick = () => setActiveTab('animation');
    if (tabPoseBtn) tabPoseBtn.onclick = () => setActiveTab('pose');
    if (tabFaceBtn) tabFaceBtn.onclick = () => setActiveTab('face');
    if (tabCustomBtn) tabCustomBtn.onclick = () => setActiveTab('custom');

    if (openFileBtn && filePicker) {
        openFileBtn.onclick = () => filePicker.click();
        filePicker.onchange = async (e) => {
            await handleFiles(e.target.files);
            filePicker.value = '';
        };
    }

    const openVrmaBtn = document.getElementById('openVrmaBtn');
    const vrmaFilePicker = document.getElementById('vrmaFilePicker');
    if (openVrmaBtn && vrmaFilePicker) {
        openVrmaBtn.onclick = () => vrmaFilePicker.click();
        vrmaFilePicker.onchange = async (e) => {
            await handleFiles(e.target.files);
            vrmaFilePicker.value = '';
        };
    }

    if (resetPoseBtn) {
        resetPoseBtn.onclick = () => {
            if (currentVrm) applyNaturalHumanPose(currentVrm);
        };
    }

    if (resetFaceBtn) {
        resetFaceBtn.onclick = () => {
            setMoodSmooth('neutral');
        };
    }

    if (handlesToggle) {
        handlesToggle.onchange = () => {
            if (activeTab === 'pose') {
                boneHandlesGroup.visible = handlesToggle.checked;
            }
        };
    }

    if (followMouseToggle) {
        followMouseToggle.onchange = () => {
            if (currentVrm && currentVrm.lookAt) {
                currentVrm.lookAt.enabled = followMouseToggle.checked;
            }
        };
    }

    window.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (dropOverlay) dropOverlay.classList.add('visible');
    });
    window.addEventListener('dragleave', (e) => {
        if (e.clientX <= 0 || e.clientY <= 0) {
            if (dropOverlay) dropOverlay.classList.remove('visible');
        }
    });
    window.addEventListener('drop', async (e) => {
        e.preventDefault();
        if (dropOverlay) dropOverlay.classList.remove('visible');
        await handleFiles(e.dataTransfer.files);
    });

    window.addEventListener('resize', onWindowResize);
}

async function handleFiles(fileList) {
    for (const file of fileList) {
        const lower = file.name.toLowerCase();

        if (lower.endsWith('.vrma')) {
            const url = URL.createObjectURL(file);
            try {
                await loadVRMA(url, file.name);
            } finally {
                URL.revokeObjectURL(url);
            }
        } else if (lower.endsWith('.vrm')) {
            const url = URL.createObjectURL(file);
            try {
                await loadVRM(url, file.name);
            } finally {
                URL.revokeObjectURL(url);
            }
        }
    }
}

function updateResponsiveCameraFraming() {
    const isMobile = window.innerWidth <= 768;
    const targetX = 0.0;
    const camY = isMobile ? 1.35 : 1.25;
    const camZ = isMobile ? 2.6 : 2.2;

    if (camera && controls) {
        camera.position.set(targetX, camY, camZ);
        controls.target.set(targetX, 1.05, 0.0);
        controls.update();
    }
    if (currentVrm && currentVrm.scene) {
        currentVrm.scene.position.x = targetX;
    }
    if (feetShadowMesh) {
        feetShadowMesh.position.x = targetX;
    }
}

function onWindowResize() {
    if (camera && renderer) {
        const container = document.getElementById('canvas-container');
        const width = container ? container.clientWidth : window.innerWidth;
        const height = container ? container.clientHeight : window.innerHeight;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
        updateResponsiveCameraFraming();
    }
}

// Global API
function setMood(mood) {
    setMoodSmooth(mood);
}

window.vrm = currentVrm;
window.setMood = setMood;
window.setMoodSmooth = setMoodSmooth;
window.speak = speak;
window.autoReact = autoReact;
window.triggerGesture = triggerGesture;
window.stopAllAnimations = stopAllAnimations;

// =====================================================================
// --- RENDER ANIMATION LOOP ---
// =====================================================================
function animate() {
    requestAnimationFrame(animate);

    const rawDelta = clock.getDelta();
    if (document.hidden) return;

    const deltaTime = Math.min(rawDelta, 0.066);
    const elapsedTime = clock.getElapsedTime();

    if (lookAtTarget && targetMousePos) {
        const eyeLerp = 1.0 - Math.exp(-deltaTime * 9.0);
        lookAtTarget.position.x += (targetMousePos.x - lookAtTarget.position.x) * eyeLerp;
        lookAtTarget.position.y += (targetMousePos.y - lookAtTarget.position.y) * eyeLerp;
        lookAtTarget.position.z = 2.0;
    }

    if (currentVrm) {
        if (activeGesture) {
            updateGesture(deltaTime);
        }

        // Cap spring bone physics calculation step for lightweight 60fps performance
        const physicsDelta = Math.min(deltaTime, 0.033);
        currentVrm.update(physicsDelta);

        // Keep Eye Gaze tracking mouse cursor in 3D space
        if (currentVrm.lookAt && lookAtTarget) {
            currentVrm.lookAt.target = lookAtTarget;
        }
    }

    // 1. Smooth facial expression transitions
    updateExpressions(deltaTime);

    // 2. Dynamic breathing height oscillation
    naturalBreathing(elapsedTime, deltaTime);

    // 3. Continuous Natural Breathing Pose & Auto Eye Blinking
    updateIdleBreathing(deltaTime);

    // 4. Lip Sync Visemes
    updateVisemeSmoothly(deltaTime);

    if (controls) controls.update();
    if (renderer && scene && camera) renderer.render(scene, camera);
}

// Initialize on load
if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// =====================================================================
// --- AUTONOMOUS SELF-HEALING & UI EXCEPTION SHIELD ---
// =====================================================================
function reportClientErrorToSelfHealing(errorMsg, source = 'Browser UI') {
    try {
        fetch('/api/self-heal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: errorMsg, source })
        }).then(r => r.json()).then(data => {
            if (data && data.healthScore) {
                updateSelfHealingBadge(data.healthScore);
            }
        }).catch(() => {});
    } catch (e) {}
}

window.onerror = (message, source, lineno, colno, error) => {
    const errText = `${message} at ${source}:${lineno}:${colno}`;
    reportClientErrorToSelfHealing(errText, 'window.onerror');
    return false;
};

window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason?.message || String(event.reason);
    reportClientErrorToSelfHealing(`Unhandled Promise Rejection: ${reason}`, 'unhandledrejection');
});

async function pollSelfHealingStatus() {
    try {
        const res = await fetch('/api/self-heal');
        if (res.ok) {
            const data = await res.json();
            if (data && data.healthScore !== undefined) {
                updateSelfHealingBadge(data.healthScore, data.autoHealedCount);
            }
        }
    } catch (e) {}
}

function updateSelfHealingBadge(healthScore = 100, autoHealedCount = 0) {
    const badge = document.getElementById('selfHealBadge');
    if (badge) {
        badge.innerHTML = `<i class="dot" style="background: #4ade80; box-shadow: 0 0 8px #4ade80;"></i>💚 Self-Healing: Active | Health: ${healthScore}%`;
        badge.title = `Autonomous Self-Healing Active (${autoHealedCount} issues auto-repaired)`;
    }
}

setInterval(pollSelfHealingStatus, 15000);
pollSelfHealingStatus();

// =====================================================================
// --- LIVE HARDWARE CPU & SYSTEM MONITORING ---
// =====================================================================
async function pollCpuSystemMonitor() {
    try {
        const res = await fetch('/api/system');
        if (res.ok) {
            const data = await res.json();

            // 1. CPU Utilization
            const cpuVal = document.getElementById('cpuVal');
            const cpuBar = document.getElementById('cpuBar');
            if (cpuVal) cpuVal.innerHTML = `${data.cpuPercent}<span>%</span>`;
            if (cpuBar) cpuBar.style.width = `${data.cpuPercent}%`;

            // 2. RAM Memory Usage
            const ramVal = document.getElementById('ramVal');
            const ramBar = document.getElementById('ramBar');
            if (ramVal) ramVal.innerHTML = `${data.ramPercent}<span>%</span>`;
            if (ramBar) ramBar.style.width = `${data.ramPercent}%`;

            // 3. RAM Details
            const ramDetail = document.getElementById('ramDetail');
            if (ramDetail) ramDetail.innerHTML = `${data.usedRAMGB} GB <small>/ ${data.totalRAMGB} GB</small>`;

            // 4. CPU Model
            const cpuModel = document.getElementById('cpuModel');
            if (cpuModel) cpuModel.textContent = `${data.cpuCores} Cores (${data.cpuModel})`;

            // 5. Host & OS
            const osHost = document.getElementById('osHost');
            if (osHost) osHost.textContent = `${data.hostname} (${data.os})`;

            // 6. Uptime
            const sysUptime = document.getElementById('sysUptime');
            if (sysUptime) sysUptime.innerHTML = `${data.uptimeHours}<small>hrs</small>`;
        }
    } catch (e) {}
}

setInterval(pollCpuSystemMonitor, 3000);
pollCpuSystemMonitor();