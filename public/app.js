import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { VRMLoaderPlugin, VRMUtils, VRMExpressionPresetName } from '@pixiv/three-vrm';
import { createVRMAnimationClip, VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';

// =====================================================================
// --- State & Constants ---
// =====================================================================
let currentVrm = null;
let currentMixer = null;
let currentAction = undefined;
let vrmaAnimationClip = undefined;

let renderer, scene, camera, controls, transformControls;
let lookAtTarget;

const clock = new THREE.Clock();
const CROSSFADE_DURATION = 0.5;

// Default VRM Model
const DEFAULT_VRM_URL = '/Aria.vrm';

// 11 VRMA Motion Clips
const VRMA_ANIMATIONS = [
    { name: '😡 Angry', url: '/VRMA/Angry.vrma' },
    { name: '😳 Blush', url: '/VRMA/Blush.vrma' },
    { name: '👏 Clapping', url: '/VRMA/Clapping.vrma' },
    { name: '👋 Goodbye', url: '/VRMA/Goodbye.vrma' },
    { name: '🦘 Jump', url: '/VRMA/Jump.vrma' },
    { name: '👀 Look Around', url: '/VRMA/LookAround.vrma' },
    { name: '😌 Relax', url: '/VRMA/Relax.vrma' },
    { name: '😢 Sad', url: '/VRMA/Sad.vrma' },
    { name: '😴 Sleepy', url: '/VRMA/Sleepy.vrma' },
    { name: '😲 Surprised', url: '/VRMA/Surprised.vrma' },
    { name: '🤔 Thinking', url: '/VRMA/Thinking.vrma' }
];

// GLTF Loader with plugins
const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));
loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

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

const playBtn = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');
const stopBtn = document.getElementById('stopBtn');
const vrmaButtonsContainer = document.getElementById('vrmaButtonsContainer');

const handlesToggle = document.getElementById('handlesToggle');
const resetPoseBtn = document.getElementById('resetPoseBtn');
const poseSlidersContainer = document.getElementById('poseSlidersContainer');
const poseSlidersDetailContainer = document.getElementById('poseSlidersDetailContainer');

const followMouseToggle = document.getElementById('followMouseToggle');
const resetFaceBtn = document.getElementById('resetFaceBtn');
const expressionSlidersContainer = document.getElementById('expressionSlidersContainer');
const lookAtSlidersContainer = document.getElementById('lookAtSlidersContainer');

// Chat UI Elements
const chatLog = document.getElementById('chatLog');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const micBtn = document.getElementById('micBtn');
const modelNameSpan = document.getElementById('modelName') || { textContent: '' };
const statusDiv = document.getElementById('status') || { textContent: '', style: {} };

function setStatus(text, color = null) {
    if (statusDiv) {
        statusDiv.textContent = text;
        if (color) statusDiv.style.color = color;
    }
}

// Idle Breathing & Blinking State Variables
let breathTimer = 0;
let blinkTimer = 0;
let nextBlinkTime = 3;
let isBlinking = false;
let blinkDuration = 0.15;
let currentBlinkElapsed = 0;

let isWaving = false;
let isSpeaking = false;

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

// Eye Saccades, Idle Micro-Movements & Dynamic Breathing State
let lastSaccade = 0;
let lastMouseMoveTime = 0;
let gazeTargetObject = null;
let gazeTargetPos = new THREE.Vector3(0, 0, 1.5);
let breathSpeed = 2.0;
let targetBreathSpeed = 2.0;
let breathPhase = 0;
let naturalBreathTimer = 0;
let modelBasePosY = 0;
let isModelDragging = false;
let modelDragStart = { x: 0, y: 0 };
let modelPosStart = { x: 0, y: 0 };

let waveProgress = 0;
let waveState = 'idle';
let waveTime = 0;

let feetShadowMesh = null;
let isWalkingAround = false;
let roomWalkTime = 0;
let roomPathT = 0;
let targetWalkAngle = 0;
let currentWalkAngle = 0;

function toggleRoomWalk() {
    isWalkingAround = !isWalkingAround;
    if (!isWalkingAround && currentVrm && currentVrm.scene) {
        currentVrm.scene.rotation.y = 0;
        currentVrm.scene.position.z = 0;
        applyNaturalHumanPose(currentVrm);
    }
}

// Audio-Driven Real Female Voice Lip Sync System
let audioCtx = null;
let audioAnalyser = null;
let currentAudioElement = null;
let isAudioPlaying = false;

// =====================================================================
// --- 1. SETUP THREE.JS SCENE ---
// =====================================================================
function init() {
    const container = document.getElementById('canvas-container');

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(30.0, window.innerWidth / window.innerHeight, 0.1, 20.0);
    camera.position.set(-0.35, 1.25, 2.2);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(-0.35, 1.05, 0.0);
    controls.enableDamping = true;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.5;
    controls.maxDistance = 6.0;
    controls.update();

    // LookAt Mouse target object
    lookAtTarget = new THREE.Object3D();
    camera.add(lookAtTarget);

    // Build 3D Realistic Studio Room Environment & Lighting
    buildRealisticStudioEnvironment();

    // Setup 3D Avatar dragging
    setupModelDragging();

    // Event listeners & Chat setup
    setupEventListeners();
    setupChatSystem();

    // Load initial VRM Model
    loadVRM(DEFAULT_VRM_URL, 'Aria.vrm');

    // Start render loop
    animate();
}

function setupModelDragging() {
    if (!renderer) return;

    renderer.domElement.addEventListener('pointerdown', (e) => {
        if (e.shiftKey || e.button === 2 || e.button === 1) {
            if (!currentVrm || !currentVrm.scene) return;
            isModelDragging = true;
            modelDragStart = { x: e.clientX, y: e.clientY };
            modelPosStart = { x: currentVrm.scene.position.x, y: currentVrm.scene.position.y };
        }
    });

    window.addEventListener('pointermove', (e) => {
        if (!isModelDragging || !currentVrm || !currentVrm.scene) return;

        const dx = (e.clientX - modelDragStart.x) * 0.003;
        const dy = (e.clientY - modelDragStart.y) * 0.003;

        currentVrm.scene.position.x = modelPosStart.x + dx;
        modelBasePosY = modelPosStart.y - dy;
    });

    window.addEventListener('pointerup', () => {
        isModelDragging = false;
    });
}

let studioGroup = null;

function buildRealisticStudioEnvironment() {
    if (studioGroup) scene.remove(studioGroup);

    studioGroup = new THREE.Group();

    // 1. Ambient & Key Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.1);
    studioGroup.add(ambientLight);

    const mainLight = new THREE.DirectionalLight(0xfffaed, 1.4);
    mainLight.position.set(1.5, 3.5, 2.0);
    mainLight.castShadow = true;
    studioGroup.add(mainLight);

    const backLight = new THREE.DirectionalLight(0xa855f7, 1.3);
    backLight.position.set(-2.0, 2.5, -2.5);
    studioGroup.add(backLight);

    const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.7);
    fillLight.position.set(-2.5, 1.5, 2.0);
    studioGroup.add(fillLight);

    // 2. Reflective Studio Floor
    const floorGeo = new THREE.PlaneGeometry(18, 18);
    const floorMat = new THREE.MeshStandardMaterial({
        color: 0x0b0f19,
        roughness: 0.2,
        metalness: 0.45
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    studioGroup.add(floor);

    // Subtle floor grid accent
    const grid = new THREE.GridHelper(14, 28, 0x6366f1, 0x1e1b4b);
    grid.position.y = 0.002;
    studioGroup.add(grid);

    // 3. Realistic Dark Studio Back Wall
    const wallGeo = new THREE.BoxGeometry(18, 10, 0.3);
    const wallMat = new THREE.MeshStandardMaterial({
        color: 0x0d1117,
        roughness: 0.65,
        metalness: 0.25
    });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.set(0, 5.0, -4.0);
    studioGroup.add(wall);

    // 4. Decorative Vertical Accent Slats & LED Neon Strips
    const slatGeo = new THREE.BoxGeometry(0.12, 10, 0.15);
    const slatMat = new THREE.MeshStandardMaterial({
        color: 0x1f2937,
        roughness: 0.4,
        metalness: 0.3
    });

    for (let i = -8; i <= 8; i += 1.8) {
        const slat = new THREE.Mesh(slatGeo, slatMat);
        slat.position.set(i, 5.0, -3.8);
        studioGroup.add(slat);
    }

    // Cyan LED Neon Strip
    const ledCyanGeo = new THREE.BoxGeometry(0.08, 8.0, 0.08);
    const ledCyanMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const ledCyan = new THREE.Mesh(ledCyanGeo, ledCyanMat);
    ledCyan.position.set(-3.2, 4.0, -3.75);
    studioGroup.add(ledCyan);

    const cyanLight = new THREE.PointLight(0x38bdf8, 2.5, 7);
    cyanLight.position.set(-3.2, 4.0, -3.2);
    studioGroup.add(cyanLight);

    // Purple LED Neon Strip
    const ledPurpleGeo = new THREE.BoxGeometry(0.08, 8.0, 0.08);
    const ledPurpleMat = new THREE.MeshBasicMaterial({ color: 0xa855f7 });
    const ledPurple = new THREE.Mesh(ledPurpleGeo, ledPurpleMat);
    ledPurple.position.set(3.2, 4.0, -3.75);
    studioGroup.add(ledPurple);

    const purpleLight = new THREE.PointLight(0xa855f7, 2.5, 7);
    purpleLight.position.set(3.2, 4.0, -3.2);
    studioGroup.add(purpleLight);

    // 5. Soft Contact Radial Shadow under Avatar Feet
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.8)');
    grad.addColorStop(0.5, 'rgba(0, 0, 0, 0.35)');
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
    feetShadowMesh.position.set(-0.35, 0.005, 0);
    studioGroup.add(feetShadowMesh);

    // 6. Overhead Soft Studio Spotlight
    const spotLight = new THREE.SpotLight(0xfffaed, 3.5, 14, Math.PI / 4, 0.45, 1);
    spotLight.position.set(-0.35, 5.0, 2.5);
    spotLight.target.position.set(-0.35, 1.0, 0);
    studioGroup.add(spotLight);
    studioGroup.add(spotLight.target);

    // Exponential Depth Fog
    scene.fog = new THREE.FogExp2(0x0b0f19, 0.04);

    scene.add(studioGroup);
}

// =====================================================================
// --- NATURAL HUMAN IDLE POSE & BREATHING ---
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

    // Natural human resting arm positions (hanging straight DOWN beside hips)
    if (leftUpperArm) {
        leftUpperArm.rotation.set(0.08, 0.05, -1.22);
    }
    if (!isWaving && rightUpperArm) {
        rightUpperArm.rotation.set(0.08, -0.05, 1.22);
    }

    if (leftLowerArm) {
        leftLowerArm.rotation.set(0, 0.1, -0.12);
    }
    if (!isWaving && rightLowerArm) {
        rightLowerArm.rotation.set(0, -0.1, 0.12);
    }

    if (leftHand) {
        leftHand.rotation.set(0, 0, -0.05);
    }
    if (!isWaving && rightHand) {
        rightHand.rotation.set(0, 0, 0.05);
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
    const subtleSway = Math.sin(breathTimer * 0.8);

    // Continuous natural arms down + breathing motion when no VRMA animation is playing
    if (!currentAction && activeTab !== 'pose') {
        applyNaturalHumanPose(currentVrm);

        if (chest) chest.rotation.x = breathCycle * 0.02;
        if (upperChest) upperChest.rotation.x = breathCycle * 0.015;
        if (spine) spine.rotation.x = breathCycle * 0.01;
        if (head) {
            head.rotation.x = breathCycle * 0.008;
            head.rotation.y = subtleSway * 0.012;
        }

        // Add subtle natural arm motion synced with breathing (absolute assignment)
        const leftUpperArm = currentVrm.humanoid.getNormalizedBoneNode('leftUpperArm');
        const rightUpperArm = currentVrm.humanoid.getNormalizedBoneNode('rightUpperArm');
        if (leftUpperArm) leftUpperArm.rotation.z = -1.22 - breathCycle * 0.006;
        if (!isWaving && rightUpperArm) rightUpperArm.rotation.z = 1.22 + breathCycle * 0.006;
    }

    // Automatic Realistic Eye Blinking System
    blinkTimer += deltaTime;
    const expressionManager = currentVrm.expressionManager;

    if (expressionManager) {
        if (!isBlinking && blinkTimer >= nextBlinkTime) {
            isBlinking = true;
            currentBlinkElapsed = 0;
            blinkTimer = 0;
            nextBlinkTime = 2.5 + Math.random() * 3.5;
        }

        if (isBlinking) {
            currentBlinkElapsed += deltaTime;
            const progress = currentBlinkElapsed / blinkDuration;
            if (progress >= 1.0) {
                isBlinking = false;
                try { expressionManager.setValue('blink', 0); } catch(e){}
            } else {
                const blinkWeight = Math.sin(progress * Math.PI);
                try { expressionManager.setValue('blink', blinkWeight); } catch(e){}
            }
        }
    }
}

// 1. Smooth Facial Expressions & Emotion Blending
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
    } else if (typeof moodInput === 'object') {
        Object.keys(moodInput).forEach(k => {
            const cleanMood = k.toLowerCase().trim();
            if (targetExpressions.hasOwnProperty(cleanMood)) {
                targetExpressions[cleanMood] = moodInput[k];
            }
        });
    }
}

function updateExpressions(delta) {
    if (!currentVrm || !currentVrm.expressionManager) return;
    ['happy', 'angry', 'sad', 'relaxed', 'surprised'].forEach(exp => {
        const current = currentExpressions[exp] || 0;
        const target = targetExpressions[exp] || 0;
        const newVal = THREE.MathUtils.lerp(current, target, delta * 3.5);
        currentExpressions[exp] = newVal;
        try {
            currentVrm.expressionManager.setValue(exp, newVal);
        } catch (e) {}
    });
    if (activeTab === 'face') {
        syncExpressionSliders();
    }
}

// 3. Micro-Movements (Idle Mein Bhi Life)
function idleMicroMovements(t) {
    if (!currentVrm || !currentVrm.humanoid) return;
    if (activeTab === 'pose' || currentAction) return;

    const head = currentVrm.humanoid.getNormalizedBoneNode('head');
    const spine = currentVrm.humanoid.getNormalizedBoneNode('spine');

    if (head) {
        head.rotation.z = Math.sin(t * 0.4) * 0.02 + Math.sin(t * 1.3) * 0.01;
    }
    if (spine) {
        spine.rotation.z = Math.sin(t * 0.3) * 0.015;
    }
}

// 4. Eye Gaze / Cursor Tracking & Saccades
function updateGaze(t, delta) {
    if (!currentVrm || !currentVrm.lookAt) return;

    const timeSinceLastMouseMove = performance.now() - lastMouseMoveTime;

    if (timeSinceLastMouseMove < 2500 && lookAtTarget) {
        // Dynamically follow user mouse cursor across screen!
        currentVrm.lookAt.target = lookAtTarget;
    } else {
        // Smoothly blend to gentle random human gaze saccades when mouse is still
        if (!gazeTargetObject) {
            gazeTargetObject = new THREE.Object3D();
            scene.add(gazeTargetObject);
        }

        if (t - lastSaccade > 2 + Math.random() * 3) {
            lastSaccade = t;
            gazeTargetPos.set(
                (Math.random() - 0.5) * 0.8,
                (Math.random() - 0.5) * 0.5 + 1.2,
                2.0
            );
        }

        gazeTargetObject.position.lerp(gazeTargetPos, delta * 3);
        currentVrm.lookAt.target = gazeTargetObject;
    }
}

// 5. Breathing Variability (Smooth Phase Accumulation with Zero Phase Jumps)
function naturalBreathing(t, delta) {
    naturalBreathTimer += delta;
    if (naturalBreathTimer > 8) {
        targetBreathSpeed = 1.8 + Math.random() * 0.6;
        naturalBreathTimer = 0;
    }

    // Smoothly lerp breathing speed to target (prevents sudden step changes)
    breathSpeed += (targetBreathSpeed - breathSpeed) * (delta * 0.8);

    // Continuous phase accumulation prevents sine wave phase-jump jerks completely
    breathPhase += delta * breathSpeed;

    if (currentVrm && currentVrm.scene) {
        currentVrm.scene.position.y = modelBasePosY + Math.sin(breathPhase) * 0.015;
    }
}

// 6. Realistic 3D Room Walking & Path Traversal
function updateRoomWalkAnimation(delta) {
    if (!isWalkingAround || !currentVrm || !currentVrm.humanoid || isWaving || isModelDragging) return;

    roomWalkTime += delta * 4.2;
    roomPathT += delta * 0.22;

    const humanoid = currentVrm.humanoid;
    const leftUpperLeg = humanoid.getNormalizedBoneNode('leftUpperLeg');
    const rightUpperLeg = humanoid.getNormalizedBoneNode('rightUpperLeg');
    const leftLowerLeg = humanoid.getNormalizedBoneNode('leftLowerLeg');
    const rightLowerLeg = humanoid.getNormalizedBoneNode('rightLowerLeg');

    const leftUpperArm = humanoid.getNormalizedBoneNode('leftUpperArm');
    const rightUpperArm = humanoid.getNormalizedBoneNode('rightUpperArm');
    const spine = humanoid.getNormalizedBoneNode('spine');
    const hips = humanoid.getNormalizedBoneNode('hips');

    // Room traversal path bounds
    const radiusX = 1.35;
    const radiusZ = 0.75;

    const nextX = -0.35 + Math.sin(roomPathT) * radiusX;
    const nextZ = Math.cos(roomPathT * 0.5) * radiusZ;

    const currX = currentVrm.scene.position.x;
    const currZ = currentVrm.scene.position.z;

    const dx = nextX - currX;
    const dz = nextZ - currZ;

    if (Math.abs(dx) > 0.0005 || Math.abs(dz) > 0.0005) {
        targetWalkAngle = Math.atan2(dx, dz);
        currentWalkAngle = THREE.MathUtils.lerp(currentWalkAngle, targetWalkAngle, delta * 3.5);
        currentVrm.scene.rotation.y = currentWalkAngle;
    }

    currentVrm.scene.position.x = nextX;
    currentVrm.scene.position.z = nextZ;

    if (feetShadowMesh) {
        feetShadowMesh.position.x = nextX;
        feetShadowMesh.position.z = nextZ;
    }

    // Leg stride cycles
    const stride = Math.sin(roomWalkTime);
    if (leftUpperLeg) leftUpperLeg.rotation.x = stride * 0.38;
    if (rightUpperLeg) rightUpperLeg.rotation.x = -stride * 0.38;

    if (leftLowerLeg) leftLowerLeg.rotation.x = Math.max(0, -stride) * 0.45;
    if (rightLowerLeg) rightLowerLeg.rotation.x = Math.max(0, stride) * 0.45;

    // Arm counter-swing
    if (leftUpperArm) leftUpperArm.rotation.x = -stride * 0.24;
    if (rightUpperArm && !isWaving) rightUpperArm.rotation.x = stride * 0.24;

    // Hip & spine sway
    if (hips) hips.rotation.y = Math.sin(roomWalkTime) * 0.08;
    if (spine) spine.rotation.z = Math.sin(roomWalkTime) * 0.03;
}

// =====================================================================
// --- 2. VRM & VRMA LOADING ---
// =====================================================================
async function loadVRM(url, displayName = 'Aria.vrm') {
    setStatus('Loading VRM Model...', '#38bdf8');

    try {
        loader.load(
            url,
            (gltf) => {
                const vrm = gltf.userData.vrm;
                VRMUtils.removeUnnecessaryVertices(gltf.scene);
                VRMUtils.removeUnnecessaryJoints(gltf.scene);
                VRMUtils.combineSkeletons(gltf.scene);
                VRMUtils.combineMorphs(vrm);

                vrm.scene.traverse((obj) => {
                    obj.frustumCulled = false;
                    if (obj.isMesh) {
                        obj.castShadow = true;
                        obj.receiveShadow = true;
                    }
                });

                if (currentVrm) {
                    scene.remove(currentVrm.scene);
                    VRMUtils.deepDispose(currentVrm.scene);
                }

                if (currentAction) {
                    currentAction.stop();
                    currentAction = undefined;
                }
                vrmaAnimationClip = undefined;

                scene.add(vrm.scene);
                VRMUtils.rotateVRM0(vrm);

                currentVrm = vrm;
                window.vrm = vrm;

                currentMixer = new THREE.AnimationMixer(vrm.scene);

                // Apply Natural Human Resting Pose (Arms Down!)
                applyNaturalHumanPose(vrm);

                if (vrm.lookAt && lookAtTarget) {
                    vrm.lookAt.target = lookAtTarget;
                }

                if (modelNameSpan) modelNameSpan.textContent = displayName;
                setStatus(`✅ ${displayName} Loaded!`, '#4ade80');
            },
            (progress) => {
                if (progress.total > 0) {
                    const percent = (100.0 * (progress.loaded / progress.total)).toFixed(0);
                    setStatus(`Loading VRM Model... ${percent}%`);
                }
            },
            (error) => {
                console.error('Error loading VRM:', error);
                setStatus('❌ Failed to load VRM model', '#f87171');
            }
        );
    } catch (err) {
        console.error('Error in loadVRM:', err);
    }
}

async function loadVRMA(url) {
    if (!currentVrm) {
        setStatus('Please load a VRM model first.');
        throw new Error('No VRM model loaded');
    }

    setStatus('Loading VRMA animation...');

    return new Promise((resolve, reject) => {
        loader.load(
            url,
            (gltf) => {
                const vrmAnimationData = gltf.userData.vrmAnimations && gltf.userData.vrmAnimations[0];
                if (vrmAnimationData) {
                    const clip = createVRMAnimationClip(vrmAnimationData, currentVrm);
                    if (clip) {
                        setStatus('✅ Motion loaded successfully!', '#4ade80');
                        resolve(clip);
                    } else {
                        reject(new Error('Could not create AnimationClip from VRMA'));
                    }
                } else {
                    reject(new Error('No VRMA animation data found'));
                }
            },
            (progress) => {
                if (progress.total > 0) {
                    const percent = (100.0 * (progress.loaded / progress.total)).toFixed(0);
                    setStatus(`Loading VRMA... ${percent}%`);
                }
            },
            (error) => {
                console.error('Error loading VRMA:', error);
                setStatus('❌ Failed to load VRMA animation', '#f87171');
                reject(error);
            }
        );
    });
}

// =====================================================================
// --- 3. ANIMATION PLAYBACK CONTROLS ---
// =====================================================================
function playAnimation() {
    if (currentVrm && vrmaAnimationClip && currentMixer) {
        if (currentAction && currentAction.getClip() === vrmaAnimationClip) {
            currentAction.paused = false;
            setStatus('▶ Playing Motion', '#38bdf8');
            return;
        }

        try {
            const oldAction = currentAction;
            const mixer = currentMixer;
            const newAction = mixer.clipAction(vrmaAnimationClip);

            newAction.setLoop(THREE.LoopRepeat);
            newAction.clampWhenFinished = true;
            newAction.reset();

            if (oldAction) {
                newAction.crossFadeFrom(oldAction, CROSSFADE_DURATION, false);
                newAction.play();
                const oldClip = oldAction.getClip();
                setTimeout(() => {
                    if (currentMixer === mixer && (!currentAction || currentAction.getClip() !== oldClip)) {
                        mixer.uncacheClip(oldClip);
                    }
                }, CROSSFADE_DURATION * 1000 + 100);
            } else {
                newAction.play();
            }

            currentAction = newAction;
            statusDiv.textContent = '▶ Playing Motion';
        } catch (error) {
            console.error('Error playing animation:', error);
        }
    }
}

function pauseAnimation() {
    if (currentAction) {
        currentAction.paused = !currentAction.paused;
        statusDiv.textContent = currentAction.paused ? '⏸ Paused' : '▶ Playing Motion';
    }
}

function stopAnimation() {
    if (currentAction) {
        currentAction.stop();
        currentAction = undefined;
        currentMixer.stopAllAction();

        if (currentVrm) {
            currentVrm.humanoid.resetNormalizedPose();
            currentVrm.humanoid.resetRawPose();
            applyNaturalHumanPose(currentVrm);
            currentVrm.expressionManager?.resetValues();
            currentVrm.lookAt?.reset();
            if (activeTab === 'pose') syncAllSliders();
            if (activeTab === 'face') syncFaceUI();
        }
        statusDiv.textContent = '⏹ Animation Stopped';
    }
}

let vrmaLoadToken = 0;
async function selectAnimation(url) {
    const token = ++vrmaLoadToken;
    vrmaAnimationClip = undefined;
    updateButtons();

    try {
        const clip = await loadVRMA(url);
        if (token !== vrmaLoadToken) return;

        vrmaAnimationClip = clip;
        playAnimation();
    } catch (error) {
        console.error('Error selecting animation:', error);
    } finally {
        if (token === vrmaLoadToken) updateButtons();
    }
}

function populateVRMAButtons() {
    if (!vrmaButtonsContainer) return;
    vrmaButtonsContainer.innerHTML = '';
    VRMA_ANIMATIONS.forEach(({ name, url }) => {
        addVrmaButton(name, url);
    });
}

function addVrmaButton(name, url) {
    if (!vrmaButtonsContainer) return;
    const btn = document.createElement('button');
    btn.className = 'vrma-btn';
    btn.textContent = name;
    btn.onclick = () => selectAnimation(url);
    vrmaButtonsContainer.appendChild(btn);
}

function updateButtons() {
    const hasVrm = currentVrm !== null;
    const hasVrma = vrmaAnimationClip !== undefined;

    if (vrmaButtonsContainer) {
        vrmaButtonsContainer.querySelectorAll('.vrma-btn').forEach(btn => {
            btn.disabled = !hasVrm;
        });
    }

    if (playBtn) playBtn.disabled = !(hasVrm && hasVrma);
    if (pauseBtn) pauseBtn.disabled = !(hasVrm && hasVrma);
    if (stopBtn) stopBtn.disabled = !(hasVrm && hasVrma);
}

// =====================================================================
// --- 4. POSE EDITING & 3D GIZMO ---
// =====================================================================
const POSE_BONE_GROUPS = [
    { label: 'Body', detail: false, bones: ['hips', 'spine', 'chest', 'neck', 'head'] },
    { label: 'Left Arm', detail: false, bones: ['leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand'] },
    { label: 'Right Arm', detail: false, bones: ['rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand'] },
    { label: 'Left Leg', detail: false, bones: ['leftUpperLeg', 'leftLowerLeg', 'leftFoot'] },
    { label: 'Right Leg', detail: false, bones: ['rightUpperLeg', 'rightLowerLeg', 'rightFoot'] },
    { label: 'Torso / Head Detail', detail: true, bones: ['upperChest', 'leftEye', 'rightEye', 'jaw', 'leftToes', 'rightToes'] },
    {
        label: 'Left Fingers', detail: true, bones: [
            'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal',
            'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
            'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
            'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
            'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal'
        ]
    },
    {
        label: 'Right Fingers', detail: true, bones: [
            'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
            'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
            'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
            'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
            'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal'
        ]
    }
];

const HANDLE_BONES = POSE_BONE_GROUPS.filter(g => !g.detail).flatMap(g => g.bones);

const BONE_AXIS_LIMITS = {
    hips: { x: [-180, 180], y: [-180, 180], z: [-180, 180] },
    spine: { x: [-30, 30], y: [-30, 30], z: [-30, 30] },
    neck: { x: [-40, 40], y: [-60, 60], z: [-30, 30] },
    head: { x: [-45, 45], y: [-70, 70], z: [-40, 40] },
    shoulder: { x: [-15, 15], y: [-30, 30], z: [-30, 30] },
    upperArm: { x: [-135, 135], y: [-135, 135], z: [-135, 135] },
    lowerArm: { x: [-45, 45], y: [-150, 150], z: [-45, 45] },
    hand: { x: [-60, 60], y: [-45, 45], z: [-80, 80] },
    upperLeg: { x: [-120, 120], y: [-60, 60], z: [-60, 60] },
    lowerLeg: { x: [-150, 150], y: [-30, 30], z: [-30, 30] },
    foot: { x: [-60, 60], y: [-30, 30], z: [-30, 30] },
    default: { x: [-90, 90], y: [-90, 90], z: [-90, 90] }
};

function getBoneLimits(boneName) {
    for (const key in BONE_AXIS_LIMITS) {
        if (boneName.toLowerCase().includes(key.toLowerCase())) return BONE_AXIS_LIMITS[key];
    }
    return BONE_AXIS_LIMITS.default;
}

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
    transformControls.setSize(0.4);
    scene.add(transformControls.getHelper());

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

function updateBoneHandles() {
    if (!currentVrm) return;
    handleByBone.forEach((mesh, boneName) => {
        const node = currentVrm.humanoid.getRawBoneNode(boneName);
        if (node) node.getWorldPosition(mesh.position);
    });
}

function buildBoneRow(boneName) {
    const limits = getBoneLimits(boneName);
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
        input.min = limits[axis][0];
        input.max = limits[axis][1];
        input.step = 1;
        input.value = 0;
        input.dataset.bone = boneName;
        input.dataset.axis = axis;

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
    if (!poseSlidersContainer || !poseSlidersDetailContainer) return;
    poseSlidersContainer.innerHTML = '';
    poseSlidersDetailContainer.innerHTML = '';
    sliderRefs.clear();
    disposeBoneHandles();
    selectedBoneName = null;

    if (!currentVrm) return;

    POSE_BONE_GROUPS.forEach((group) => {
        const presentBones = group.bones.filter((name) => currentVrm.humanoid.getNormalizedBoneNode(name));
        if (presentBones.length === 0) return;

        const targetContainer = group.detail ? poseSlidersDetailContainer : poseSlidersContainer;
        const heading = document.createElement('h4');
        heading.className = 'bone-group-title';
        heading.textContent = group.label;
        targetContainer.appendChild(heading);

        presentBones.forEach((boneName) => {
            targetContainer.appendChild(buildBoneRow(boneName));
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

function selectBone(boneName) {
    if (!currentVrm || !transformControls) return;
    const node = currentVrm.humanoid.getNormalizedBoneNode(boneName);
    if (!node) return;

    if (selectedBoneName && selectedBoneName !== boneName) {
        const prevHandle = handleByBone.get(selectedBoneName);
        if (prevHandle) prevHandle.material.color.set(0x38bdf8);
        const prevRefs = sliderRefs.get(selectedBoneName);
        if (prevRefs) prevRefs.row.classList.remove('selected');
    }

    selectedBoneName = boneName;
    transformControls.attach(node);

    const handle = handleByBone.get(boneName);
    if (handle) handle.material.color.set(0xfc5c7d);

    const refs = sliderRefs.get(boneName);
    if (refs) {
        refs.row.classList.add('selected');
        refs.row.scrollIntoView({ block: 'nearest' });
    }
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

// Raycasting for handle selection
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
let pointerDownPos = null;

// =====================================================================
// --- 5. FACE & GAZE EDITING ---
// =====================================================================
const FACE_PRESET_GROUPS = [
    {
        label: 'Emotions', names: [
            VRMExpressionPresetName.Happy, VRMExpressionPresetName.Angry, VRMExpressionPresetName.Sad,
            VRMExpressionPresetName.Relaxed, VRMExpressionPresetName.Surprised, VRMExpressionPresetName.Neutral
        ]
    },
    {
        label: 'Mouth Visemes', names: [
            VRMExpressionPresetName.Aa, VRMExpressionPresetName.Ih, VRMExpressionPresetName.Ou,
            VRMExpressionPresetName.Ee, VRMExpressionPresetName.Oh
        ]
    },
    {
        label: 'Blink', names: [
            VRMExpressionPresetName.Blink, VRMExpressionPresetName.BlinkLeft, VRMExpressionPresetName.BlinkRight
        ]
    }
];

const expressionSliderRefs = new Map();
let lookAtRefs = null;

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
    input.dataset.expression = name;
    row.appendChild(input);

    const readout = document.createElement('span');
    readout.className = 'bone-readout';
    readout.textContent = '0.00';
    row.appendChild(readout);

    expressionSliderRefs.set(name, { row, input, readout });
    return row;
}

function buildLookAtRow(axis, labelText) {
    const row = document.createElement('div');
    row.className = 'face-row';

    const label = document.createElement('span');
    label.className = 'bone-label';
    label.textContent = labelText;
    row.appendChild(label);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = -90;
    input.max = 90;
    input.step = 1;
    input.value = 0;
    input.dataset.lookat = axis;
    row.appendChild(input);

    const readout = document.createElement('span');
    readout.className = 'bone-readout';
    readout.textContent = '0°';
    row.appendChild(readout);

    return { row, input, readout };
}

function buildFaceUI() {
    if (!expressionSlidersContainer || !lookAtSlidersContainer) return;
    expressionSlidersContainer.innerHTML = '';
    expressionSliderRefs.clear();
    lookAtSlidersContainer.innerHTML = '';
    lookAtRefs = null;

    if (!currentVrm) return;

    const expressionManager = currentVrm.expressionManager;
    if (expressionManager) {
        const presetMap = expressionManager.presetExpressionMap;
        FACE_PRESET_GROUPS.forEach((group) => {
            const presentNames = group.names.filter((name) => presetMap && presetMap[name]);
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

    const hasLookAt = !!currentVrm.lookAt;
    const yawRow = buildLookAtRow('yaw', 'Yaw (Left/Right)');
    const pitchRow = buildLookAtRow('pitch', 'Pitch (Up/Down)');
    lookAtSlidersContainer.appendChild(yawRow.row);
    lookAtSlidersContainer.appendChild(pitchRow.row);
    lookAtRefs = { yaw: yawRow, pitch: pitchRow };

    yawRow.input.disabled = !hasLookAt;
    pitchRow.input.disabled = !hasLookAt;
    if (followMouseToggle) {
        followMouseToggle.disabled = !hasLookAt;
        if (!hasLookAt) followMouseToggle.checked = false;
    }
}

function syncExpressionSliders() {
    if (!currentVrm || !currentVrm.expressionManager) return;
    expressionSliderRefs.forEach((refs, name) => {
        const weight = currentVrm.expressionManager.getValue(name) ?? 0;
        refs.input.value = weight;
        refs.readout.textContent = weight.toFixed(2);
    });
}

function syncLookAtSliders() {
    if (!lookAtRefs || !currentVrm || !currentVrm.lookAt) return;
    const { yaw, pitch } = currentVrm.lookAt;
    lookAtRefs.yaw.input.value = yaw;
    lookAtRefs.yaw.readout.textContent = `${Math.round(yaw)}°`;
    lookAtRefs.pitch.input.value = pitch;
    lookAtRefs.pitch.readout.textContent = `${Math.round(pitch)}°`;
}

function syncFaceUI() {
    syncExpressionSliders();
    syncLookAtSliders();
}

window.addEventListener('pointermove', (e) => {
    lastMouseMoveTime = performance.now();
    if (lookAtTarget) {
        const x = ((e.clientX / window.innerWidth) - 0.5) * 6.0;
        const y = -((e.clientY / window.innerHeight) - 0.5) * 4.0 + 1.2;
        lookAtTarget.position.set(x, y, 2.0);
    }
});

// =====================================================================
// --- 6. TAB LIFECYCLE & FREEZING ---
// =====================================================================
let activeTab = 'animation';

function freezeAnimationForEditing() {
    if (!currentVrm || !currentAction) return;

    const capturedPose = new Map();
    sliderRefs.forEach((_refs, boneName) => {
        const node = currentVrm.humanoid.getNormalizedBoneNode(boneName);
        if (node) capturedPose.set(boneName, node.quaternion.clone());
    });

    const capturedExpressions = new Map();
    currentVrm.expressionManager?.expressions.forEach((expression) => {
        capturedExpressions.set(expression.expressionName, expression.weight);
    });

    currentAction.stop();
    if (currentMixer) currentMixer.stopAllAction();
    currentAction = undefined;

    capturedPose.forEach((quat, boneName) => {
        const node = currentVrm.humanoid.getNormalizedBoneNode(boneName);
        if (node) node.quaternion.copy(quat);
    });
    capturedExpressions.forEach((weight, name) => {
        currentVrm.expressionManager?.setValue(name, weight);
    });
}

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

    if (tabName !== 'animation') {
        freezeAnimationForEditing();
    }

    if (wasTab === 'pose' && tabName !== 'pose') {
        deselectBone();
        boneHandlesGroup.visible = false;
    }
    if (tabName === 'pose') {
        if (currentVrm) syncAllSliders();
        if (handlesToggle) boneHandlesGroup.visible = handlesToggle.checked;
    }
    if (tabName === 'face') {
        syncFaceUI();
    }
}

// =====================================================================
// --- 7. AUDIO-DRIVEN REAL FEMALE VOICE LIP SYNC SYSTEM ---
// =====================================================================
const visemeTargets = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
const visemeCurrent = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };

function resetVisemeTargets() {
    Object.keys(visemeTargets).forEach(v => visemeTargets[v] = 0);
}

function updateVisemeSmoothly() {
    if (!currentVrm) return;
    const manager = currentVrm.expressionManager || currentVrm.blendShapeProxy;
    if (!manager) return;

    if (isAudioPlaying && audioAnalyser) {
        const dataArray = new Uint8Array(audioAnalyser.frequencyBinCount);
        audioAnalyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        const volume = Math.min(1.0, (average / 120) * 1.5);

        const time = clock.getElapsedTime() * 12;
        visemeTargets.aa = Math.max(0, Math.sin(time) * volume * 0.9);
        visemeTargets.ih = Math.max(0, Math.cos(time * 1.3) * volume * 0.6);
        visemeTargets.oh = Math.max(0, Math.sin(time * 0.7) * volume * 0.7);
        visemeTargets.ee = Math.max(0, Math.cos(time * 0.9) * volume * 0.5);
    } else if (isSpeaking) {
        const time = clock.getElapsedTime() * 14;
        const speechVolume = 0.65 + Math.sin(time * 0.5) * 0.25;
        visemeTargets.aa = Math.max(0, Math.sin(time) * speechVolume * 0.85);
        visemeTargets.ih = Math.max(0, Math.cos(time * 1.4) * speechVolume * 0.5);
        visemeTargets.oh = Math.max(0, Math.sin(time * 0.8) * speechVolume * 0.6);
        visemeTargets.ee = Math.max(0, Math.cos(time * 1.1) * speechVolume * 0.4);
    }

    Object.keys(visemeTargets).forEach(vowel => {
        const target = visemeTargets[vowel];
        const curr = visemeCurrent[vowel];
        const next = curr + (target - curr) * 0.35;
        visemeCurrent[vowel] = next;
        try {
            manager.setValue(vowel, next);
        } catch(e){}
    });
}

function playRealFemaleAudio(base64Audio) {
    if (!base64Audio) return false;

    try {
        if (currentAudioElement) {
            currentAudioElement.pause();
            currentAudioElement = null;
        }

        const audioUrl = `data:audio/mp3;base64,${base64Audio}`;
        const audio = new Audio(audioUrl);
        audio.playbackRate = 1.30;
        currentAudioElement = audio;

        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        const source = audioCtx.createMediaElementSource(audio);
        audioAnalyser = audioCtx.createAnalyser();
        audioAnalyser.fftSize = 256;
        source.connect(audioAnalyser);
        audioAnalyser.connect(audioCtx.destination);

        audio.onplay = () => { isAudioPlaying = true; };
        audio.onended = audio.onerror = () => {
            isAudioPlaying = false;
            resetVisemeTargets();
            scheduleMoodResetToNormal(1500); // 1.5s after audio finishes, return face to normal relaxed expression
        };

        audio.play();
        return true;
    } catch (err) {
        console.error("Audio playback error:", err);
        return false;
    }
}

function selectBestFemaleVoice() {
    if (!('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices();

    // 1. Dedicated Hindi Female Voice (hi-IN, Google हिन्दी, Swara, Kalpana, etc.)
    const hindiFemale = voices.find(v =>
        (v.lang.includes('hi') || v.name.toLowerCase().includes('hindi')) &&
        (v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('google') || v.name.toLowerCase().includes('swara') || v.name.toLowerCase().includes('kalpana') || v.name.toLowerCase().includes('neural'))
    );
    if (hindiFemale) return hindiFemale;

    // 2. Any Hindi Voice
    const anyHindi = voices.find(v => v.lang.includes('hi') || v.name.toLowerCase().includes('hindi'));
    if (anyHindi) return anyHindi;

    // 3. Indian English / General Female Voice
    const indianFemale = voices.find(v => (v.lang.includes('en-IN') || v.lang.includes('en_IN')));
    if (indianFemale) return indianFemale;

    const anyFemale = voices.find(v =>
        v.name.includes('Female') || v.name.includes('Zira') || v.name.includes('Jenny') || v.name.includes('Aria') || v.name.includes('Samantha') || v.name.includes('Google')
    );
    return anyFemale || voices[0];
}

function mapCharToViseme(char) {
    const c = char.toLowerCase();
    if (c === 'a') return 'aa';
    if (c === 'i' || c === 'y') return 'ih';
    if (c === 'u' || c === 'w') return 'ou';
    if (c === 'e') return 'ee';
    if (c === 'o') return 'oh';
    return null;
}

function speakWithLipSync(audioBase64) {
    return playRealFemaleAudio(audioBase64);
}

function speakWithFakeLipSync(text) {
    if (!text || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'hi-IN';
    utterance.rate = 1.30;

    const femaleVoice = selectBestFemaleVoice();
    if (femaleVoice) utterance.voice = femaleVoice;

    utterance.onboundary = (event) => {
        if (event.name === 'word' && currentVrm?.expressionManager) {
            try {
                currentVrm.expressionManager.setValue('aa', 0.4 + Math.random() * 0.5);
                setTimeout(() => {
                    currentVrm.expressionManager.setValue('aa', 0);
                }, 120);
            } catch(e){}
        }
    };

    utterance.onend = utterance.onerror = () => {
        try { currentVrm?.expressionManager?.setValue('aa', 0); } catch(e){}
        scheduleMoodResetToNormal(1500); // 1.5s after speech finishes, return face to normal relaxed expression
    };

    window.speechSynthesis.speak(utterance);
}

function speak(text, audioContent = null, moodTag = 'relaxed') {
    if (!text) return;

    if (audioContent && speakWithLipSync(audioContent)) {
        return;
    }

    speakWithFakeLipSync(text);
}

// =====================================================================
// --- 8. AUTO REACT & AI CHAT SYSTEM ---
// =====================================================================
function nodHead() {
    if (!currentVrm || !currentVrm.humanoid) return;
    const head = currentVrm.humanoid.getNormalizedBoneNode('head');
    if (!head) return;

    let t = 0;
    const nodInterval = setInterval(() => {
        t += 0.2;
        head.rotation.x = Math.sin(t * 4) * 0.15;
        if (t > 1.5) {
            clearInterval(nodInterval);
            head.rotation.x = 0;
        }
    }, 30);
}

function thinkPose() {
    if (!currentVrm || !currentVrm.humanoid) return;
    const head = currentVrm.humanoid.getNormalizedBoneNode('head');
    const rightUpperArm = currentVrm.humanoid.getNormalizedBoneNode('rightUpperArm');
    const rightLowerArm = currentVrm.humanoid.getNormalizedBoneNode('rightLowerArm');

    if (head) head.rotation.z = 0.15;
    if (rightUpperArm) rightUpperArm.rotation.set(0.4, -0.2, -0.6);
    if (rightLowerArm) rightLowerArm.rotation.set(0, -0.5, 0.4);

    setTimeout(() => {
        if (head) head.rotation.z = 0;
        applyNaturalHumanPose(currentVrm);
    }, 2000);
}

function pointForward() {
    if (!currentVrm || !currentVrm.humanoid) return;
    const rightUpperArm = currentVrm.humanoid.getNormalizedBoneNode('rightUpperArm');
    const rightLowerArm = currentVrm.humanoid.getNormalizedBoneNode('rightLowerArm');

    if (rightUpperArm) rightUpperArm.rotation.set(0.8, 0.2, -0.4);
    if (rightLowerArm) rightLowerArm.rotation.set(0, -0.1, 0.1);

    setTimeout(() => {
        applyNaturalHumanPose(currentVrm);
    }, 2000);
}

function triggerGesture(gesture) {
    if (!gesture || gesture === 'none') return;
    const g = gesture.toLowerCase().trim();
    switch (g) {
        case 'wave':
        case 'hi':
        case 'hello':
        case 'goodbye':
            waveHand();
            break;
        case 'nod':
            nodHead();
            break;
        case 'point':
            pointForward();
            break;
        case 'think':
            thinkPose();
            break;
        case 'dance':
        case 'jump':
            selectAnimation('/VRMA/Jump.vrma').catch(() => waveHand());
            break;
        case 'relax':
        case 'blush':
            selectAnimation('/VRMA/Blush.vrma').catch(() => nodHead());
            break;
        default:
            break;
    }
}

function processAIReply(replyText) {
    if (!replyText) return '';

    const moodMatch = replyText.match(/\[MOOD:([^\]]+)\]/i);
    const gestureMatch = replyText.match(/\[GESTURE:([^\]]+)\]/i) || replyText.match(/\[ACTION:([^\]]+)\]/i);

    const mood = moodMatch ? moodMatch[1].trim() : 'relaxed';
    const gesture = gestureMatch ? gestureMatch[1].trim().toLowerCase() : 'none';

    const cleanText = replyText
        .replace(/\[MOOD:[^\]]+\]/gi, '')
        .replace(/\[GESTURE:[^\]]+\]/gi, '')
        .replace(/\[ACTION:[^\]]+\]/gi, '')
        .trim();

    setMoodSmooth(mood);
    triggerGesture(gesture);

    return cleanText;
}

function autoReact(replyText, audioContent = null) {
    if (!replyText) return '';

    const cleanText = processAIReply(replyText);

    if (audioContent) {
        speakWithLipSync(audioContent);
    } else {
        speakWithFakeLipSync(cleanText);
    }

    return cleanText;
}

function addToLog(sender, text, moodTag = null) {
    if (!chatLog) return;
    const bubble = document.createElement('div');
    bubble.className = `msg-bubble ${sender === 'You' ? 'msg-user' : 'msg-ai'}`;
    bubble.textContent = text;

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
        setStatus('🧠 Aria is thinking...', '#818cf8');

        const res = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text })
        });
        const data = await res.json();
        const fullReply = data.reply || '';

        const moodMatch = fullReply.match(/\[MOOD:(\w+)\]/i);
        const moodTag = moodMatch ? moodMatch[1] : null;

        const cleanReply = autoReact(fullReply, data.audioContent);

        setStatus(`✅ Speaking: "${cleanReply.substring(0, 30)}..."`, '#4ade80');

        addToLog('AI', cleanReply, moodTag);
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

    if (sendBtn) {
        sendBtn.onclick = () => sendChatMessage();
    }
    if (chatInput) {
        chatInput.onkeydown = (e) => {
            if (e.key === 'Enter') sendChatMessage();
        };
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition && micBtn) {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.lang = 'en-US';

        micBtn.onclick = () => {
            try {
                recognition.start();
                micBtn.classList.add('listening');
                statusDiv.textContent = '🎙 Listening... Speak now!';
            } catch (err) {
                recognition.stop();
                micBtn.classList.remove('listening');
            }
        };

        recognition.onresult = async (event) => {
            micBtn.classList.remove('listening');
            const transcript = event.results[0][0].transcript;
            statusDiv.textContent = '✅ Speech recognized!';
            await sendChatMessage(transcript);
        };

        recognition.onerror = recognition.onend = () => {
            micBtn.classList.remove('listening');
        };
    }
}

// =====================================================================
// --- 9. EVENT LISTENERS & USER FILE LOADING ---
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

    if (playBtn) playBtn.onclick = playAnimation;
    if (pauseBtn) pauseBtn.onclick = pauseAnimation;
    if (stopBtn) stopBtn.onclick = stopAnimation;

    if (openFileBtn && filePicker) {
        openFileBtn.onclick = () => filePicker.click();
        filePicker.onchange = async (e) => {
            await handleFiles(e.target.files);
            filePicker.value = '';
        };
    }

    // Drag & Drop
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

        if (lower.endsWith('.vrm')) {
            const url = URL.createObjectURL(file);
            try {
                await loadVRM(url, file.name);
            } finally {
                URL.revokeObjectURL(url);
            }
        } else if (lower.endsWith('.vrma')) {
            const url = URL.createObjectURL(file);
            addVrmaButton(`📄 ${file.name.replace(/\.vrma$/i, '')}`, url);
            updateButtons();
            await selectAnimation(url);
        }
    }
}

function updateResponsiveCameraFraming() {
    const isMobile = window.innerWidth <= 768;
    const targetX = isMobile ? 0.0 : -0.35;
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
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        updateResponsiveCameraFraming();
    }
}

// =====================================================================
// --- 10. GLOBAL FUNCTIONS & API ---
// =====================================================================
function setMood(mood) {
    setMoodSmooth(mood);
}

function waveHand() {
    if (!currentVrm || !currentVrm.humanoid) return;
    if (waveState !== 'idle') return;

    isWaving = true;
    waveState = 'raising';
    waveProgress = 0;
    waveTime = 0;
}

function updateWavingAnimation(delta) {
    if (waveState === 'idle' || !currentVrm || !currentVrm.humanoid) return;

    const upperArm = currentVrm.humanoid.getNormalizedBoneNode('rightUpperArm');
    const lowerArm = currentVrm.humanoid.getNormalizedBoneNode('rightLowerArm');
    const hand = currentVrm.humanoid.getNormalizedBoneNode('rightHand');

    if (!upperArm || !lowerArm || !hand) return;

    const upperArmStart = { x: 0.08, y: -0.05, z: 1.22 };
    const lowerArmStart = { x: 0, y: -0.1, z: 0.12 };
    const handStart = { x: 0, y: 0, z: 0.05 };

    const upperArmTarget = { x: 0.2, y: -0.3, z: -1.25 };
    const lowerArmTarget = { x: 0.0, y: -0.6, z: -0.85 };

    if (waveState === 'raising') {
        waveProgress += delta * 2.2;
        if (waveProgress >= 1) {
            waveProgress = 1;
            waveState = 'waving';
            waveTime = 0;
        }

        const ease = 0.5 - Math.cos(waveProgress * Math.PI) / 2;
        upperArm.rotation.x = THREE.MathUtils.lerp(upperArmStart.x, upperArmTarget.x, ease);
        upperArm.rotation.y = THREE.MathUtils.lerp(upperArmStart.y, upperArmTarget.y, ease);
        upperArm.rotation.z = THREE.MathUtils.lerp(upperArmStart.z, upperArmTarget.z, ease);

        lowerArm.rotation.x = THREE.MathUtils.lerp(lowerArmStart.x, lowerArmTarget.x, ease);
        lowerArm.rotation.y = THREE.MathUtils.lerp(lowerArmStart.y, lowerArmTarget.y, ease);
        lowerArm.rotation.z = THREE.MathUtils.lerp(lowerArmStart.z, lowerArmTarget.z, ease);
    } else if (waveState === 'waving') {
        waveTime += delta * 7.0;

        upperArm.rotation.x = upperArmTarget.x;
        upperArm.rotation.y = upperArmTarget.y;
        upperArm.rotation.z = upperArmTarget.z;

        lowerArm.rotation.x = lowerArmTarget.x;
        lowerArm.rotation.y = lowerArmTarget.y;
        lowerArm.rotation.z = lowerArmTarget.z + Math.sin(waveTime * 0.8) * 0.06;

        hand.rotation.z = Math.sin(waveTime) * 0.35;
        hand.rotation.x = Math.sin(waveTime) * 0.15;

        if (waveTime > 14.0) {
            waveState = 'lowering';
            waveProgress = 0;
        }
    } else if (waveState === 'lowering') {
        waveProgress += delta * 2.2;
        if (waveProgress >= 1) {
            waveProgress = 1;
            waveState = 'idle';
            isWaving = false;
            applyNaturalHumanPose(currentVrm);
            return;
        }

        const ease = 0.5 - Math.cos(waveProgress * Math.PI) / 2;
        upperArm.rotation.x = THREE.MathUtils.lerp(upperArmTarget.x, upperArmStart.x, ease);
        upperArm.rotation.y = THREE.MathUtils.lerp(upperArmTarget.y, upperArmStart.y, ease);
        upperArm.rotation.z = THREE.MathUtils.lerp(upperArmTarget.z, upperArmStart.z, ease);

        lowerArm.rotation.x = THREE.MathUtils.lerp(lowerArmTarget.x, lowerArmStart.x, ease);
        lowerArm.rotation.y = THREE.MathUtils.lerp(lowerArmTarget.y, lowerArmStart.y, ease);
        lowerArm.rotation.z = THREE.MathUtils.lerp(lowerArmTarget.z, lowerArmStart.z, ease);

        hand.rotation.z = THREE.MathUtils.lerp(hand.rotation.z, handStart.z, ease);
        hand.rotation.x = THREE.MathUtils.lerp(hand.rotation.x, handStart.x, ease);
    }
}

window.vrm = currentVrm;
window.setMood = setMood;
window.setMoodSmooth = setMoodSmooth;
window.waveHand = waveHand;
window.nodHead = nodHead;
window.thinkPose = thinkPose;
window.pointForward = pointForward;
window.triggerGesture = triggerGesture;
window.processAIReply = processAIReply;
window.speakWithLipSync = speakWithLipSync;
window.speakWithFakeLipSync = speakWithFakeLipSync;
window.speak = speak;
window.autoReact = autoReact;
window.selectAnimation = selectAnimation;
window.applyNaturalHumanPose = applyNaturalHumanPose;
window.toggleRoomWalk = toggleRoomWalk;

// =====================================================================
// --- 11. RENDER ANIMATION LOOP ---
// =====================================================================
function animate() {
    requestAnimationFrame(animate);

    const deltaTime = clock.getDelta();
    const elapsedTime = clock.getElapsedTime();

    if (currentMixer) {
        currentMixer.update(deltaTime);
    }
    if (currentVrm) {
        currentVrm.update(deltaTime); // springBoneManager automatically updated
    }

    // 1. Smooth facial expression transitions & lerps
    updateExpressions(deltaTime);

    // 2. Idle micro-movements (subtle head tilt & sway)
    idleMicroMovements(elapsedTime);

    // 3. Eye saccades (natural random looking around)
    updateGaze(elapsedTime, deltaTime);

    // 4. Dynamic variable breathing & floating
    naturalBreathing(elapsedTime, deltaTime);

    // 5. Continuous Natural Human Breathing & Auto Blinking System
    updateIdleBreathing(deltaTime);

    // 6. Frame-Driven Smooth Waving Motion
    updateWavingAnimation(deltaTime);

    // 7. Realistic 3D Room Walking & Path Traversal
    updateRoomWalkAnimation(deltaTime);

    // 8. Dynamic Real-Time Viseme & Audio-Driven Lip Sync
    updateVisemeSmoothly();

    if (controls) controls.update();
    if (renderer && scene && camera) renderer.render(scene, camera);
}

// Initialize on load
if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
