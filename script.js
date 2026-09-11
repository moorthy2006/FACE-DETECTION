/* =========================================================
   FaceDetect — app logic
   Uses face-api.js (TensorFlow.js) for in-browser detection.
========================================================= */

const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';

let modelsReady = false;
let modelsLoading = null;

let currentMode = 'camera';   // 'camera' | 'upload'
let stream = null;
let detectionLoopId = null;
let uploadedImageLoaded = false;

/* ---------- Element refs ---------- */
const els = {
  navLinks: document.querySelectorAll('[data-nav]'),
  navToggle: document.getElementById('navToggle'),
  navLinksWrap: document.querySelector('.nav-links'),
  views: document.querySelectorAll('.view'),

  homeStartCamera: document.getElementById('homeStartCamera'),
  homeUploadImage: document.getElementById('homeUploadImage'),

  modeCameraBtn: document.getElementById('modeCameraBtn'),
  modeUploadBtn: document.getElementById('modeUploadBtn'),

  stage: document.getElementById('stage'),
  stageEmpty: document.getElementById('stageEmpty'),
  video: document.getElementById('video'),
  uploadedImage: document.getElementById('uploadedImage'),
  overlay: document.getElementById('overlay'),
  stageError: document.getElementById('stageError'),

  cameraControls: document.getElementById('cameraControls'),
  uploadControls: document.getElementById('uploadControls'),
  startCameraBtn: document.getElementById('startCameraBtn'),
  startDetectionBtn: document.getElementById('startDetectionBtn'),
  stopCameraBtn: document.getElementById('stopCameraBtn'),
  fileInput: document.getElementById('fileInput'),
  clearUploadBtn: document.getElementById('clearUploadBtn'),

  resultCount: document.getElementById('resultCount'),
  resultStatus: document.getElementById('resultStatus'),
  resultStatusText: document.getElementById('resultStatusText'),
  resultSource: document.getElementById('resultSource'),
};

/* =========================================================
   Navigation
========================================================= */
function goToView(target){
  els.views.forEach(v => v.classList.toggle('is-active', v.id === target));
  els.navLinks.forEach(l => {
    if (l.dataset.target) l.classList.toggle('is-active', l.dataset.target === target);
  });
  els.navLinksWrap.classList.remove('is-open');
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });

  if (target === 'detect') ensureModelsLoaded();
}

els.navLinks.forEach(link => {
  link.addEventListener('click', (e) => {
    if (!link.dataset.target) return;
    e.preventDefault();
    goToView(link.dataset.target);
  });
});

els.navToggle.addEventListener('click', () => {
  const isOpen = els.navLinksWrap.classList.toggle('is-open');
  els.navToggle.setAttribute('aria-expanded', String(isOpen));
});

els.homeStartCamera.addEventListener('click', () => {
  goToView('detect');
  setMode('camera');
});

els.homeUploadImage.addEventListener('click', () => {
  goToView('detect');
  setMode('upload');
});

/* =========================================================
   Model loading
========================================================= */
function ensureModelsLoaded(){
  if (modelsReady || modelsLoading) return modelsLoading;

  showStatus('loading', 'Loading detection model…');
  modelsLoading = faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL)
    .then(() => {
      modelsReady = true;
      showStatus('idle', 'Model ready — choose a source');
    })
    .catch(() => {
      showError('Could not load the face detection model. Check your internet connection and reload the page.');
      showStatus('warn', 'Model failed to load');
    });

  return modelsLoading;
}

/* =========================================================
   Mode switching (camera / upload)
========================================================= */
function setMode(mode){
  currentMode = mode;
  clearError();
  stopDetectionLoop();

  els.modeCameraBtn.classList.toggle('is-active', mode === 'camera');
  els.modeUploadBtn.classList.toggle('is-active', mode === 'upload');
  els.modeCameraBtn.setAttribute('aria-selected', String(mode === 'camera'));
  els.modeUploadBtn.setAttribute('aria-selected', String(mode === 'upload'));

  els.cameraControls.hidden = mode !== 'camera';
  els.uploadControls.hidden = mode !== 'upload';

  if (mode === 'camera') {
    els.uploadedImage.hidden = true;
    stopCamera();
    els.video.hidden = false;
    els.stageEmpty.hidden = !!stream === true ? true : false;
    els.stageEmpty.querySelector('p').textContent = 'Camera preview will appear here.';
    els.stageEmpty.hidden = false;
    resetResult('No source selected yet');
  } else {
    stopCamera();
    els.video.hidden = true;
    if (!uploadedImageLoaded) {
      els.stageEmpty.querySelector('p').textContent = 'Choose an image to get started.';
      els.stageEmpty.hidden = false;
    }
    resetResult('None selected');
  }
  clearOverlay();
}

els.modeCameraBtn.addEventListener('click', () => setMode('camera'));
els.modeUploadBtn.addEventListener('click', () => setMode('upload'));

/* =========================================================
   Result / status helpers
========================================================= */
function showStatus(kind, text){
  els.resultStatus.classList.remove('ok', 'warn');
  if (kind === 'ok') els.resultStatus.classList.add('ok');
  if (kind === 'warn') els.resultStatus.classList.add('warn');
  els.resultStatusText.textContent = text;
}

function resetResult(sourceLabel){
  els.resultCount.textContent = '—';
  showStatus('idle', 'Waiting to start');
  if (sourceLabel) els.resultSource.textContent = sourceLabel;
}

function updateResult(count, sourceLabel){
  els.resultCount.textContent = String(count);
  els.resultSource.textContent = sourceLabel;
  if (count > 0) {
    showStatus('ok', 'Detection successful');
  } else {
    showStatus('warn', 'No face detected');
  }
}

function showError(message){
  els.stageError.textContent = message;
  els.stageError.hidden = false;
}
function clearError(){
  els.stageError.hidden = true;
  els.stageError.textContent = '';
}

/* =========================================================
   Canvas overlay
========================================================= */
function sizeOverlayTo(mediaEl){
  const rect = mediaEl.getBoundingClientRect();
  const stageRect = els.stage.getBoundingClientRect();
  els.overlay.width = els.stage.clientWidth;
  els.overlay.height = els.stage.clientHeight;
}

function clearOverlay(){
  const ctx = els.overlay.getContext('2d');
  ctx.clearRect(0, 0, els.overlay.width, els.overlay.height);
}

function drawDetections(detections, mediaEl){
  sizeOverlayTo(mediaEl);
  const ctx = els.overlay.getContext('2d');
  clearOverlay();

  const displaySize = { width: els.overlay.width, height: els.overlay.height };
  const resized = faceapi.resizeResults(detections, {
    width: mediaEl.videoWidth || mediaEl.naturalWidth,
    height: mediaEl.videoHeight || mediaEl.naturalHeight,
  });

  // Scale from natural media size to the rendered (object-fit: contain) box.
  const naturalW = mediaEl.videoWidth || mediaEl.naturalWidth;
  const naturalH = mediaEl.videoHeight || mediaEl.naturalHeight;
  const boxW = els.overlay.width;
  const boxH = els.overlay.height;
  const scale = Math.min(boxW / naturalW, boxH / naturalH);
  const offsetX = (boxW - naturalW * scale) / 2;
  const offsetY = (boxH - naturalH * scale) / 2;

  ctx.strokeStyle = '#4CD9C0';
  ctx.lineWidth = 2.5;
  ctx.font = '600 13px Inter, sans-serif';
  ctx.fillStyle = '#4CD9C0';

  detections.forEach((det, i) => {
    const box = det.box;
    const x = box.x * scale + offsetX;
    const y = box.y * scale + offsetY;
    const w = box.width * scale;
    const h = box.height * scale;
    ctx.strokeRect(x, y, w, h);
    ctx.fillText(`Face ${i + 1}`, x + 2, y > 16 ? y - 6 : y + h + 14);
  });
}

/* =========================================================
   Camera flow
========================================================= */
els.startCameraBtn.addEventListener('click', startCamera);
els.stopCameraBtn.addEventListener('click', stopCamera);
els.startDetectionBtn.addEventListener('click', toggleDetectionLoop);

async function startCamera(){
  clearError();

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showError('Your browser does not support camera access. Try a recent version of Chrome, Firefox, or Edge.');
    return;
  }

  await ensureModelsLoaded();

  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    els.video.srcObject = stream;
    els.stageEmpty.hidden = true;
    els.video.hidden = false;

    els.startCameraBtn.hidden = true;
    els.stopCameraBtn.hidden = false;
    els.startDetectionBtn.disabled = false;

    els.resultSource.textContent = 'Live camera';
    showStatus('idle', 'Camera ready — start detection');
  } catch (err) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      showError('Camera access was denied. Allow camera permission in your browser settings and try again.');
    } else if (err.name === 'NotFoundError') {
      showError('No camera was found on this device.');
    } else {
      showError('Could not access the camera: ' + err.message);
    }
  }
}

function stopCamera(){
  stopDetectionLoop();
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  els.video.srcObject = null;
  els.startCameraBtn.hidden = false;
  els.stopCameraBtn.hidden = true;
  els.startDetectionBtn.disabled = true;
  els.startDetectionBtn.textContent = 'Start Detection';
  clearOverlay();
}

function toggleDetectionLoop(){
  if (detectionLoopId) {
    stopDetectionLoop();
  } else {
    startDetectionLoop();
  }
}

function startDetectionLoop(){
  els.startDetectionBtn.textContent = 'Stop Detection';
  showStatus('idle', 'Detecting…');

  const runFrame = async () => {
    if (!stream) return;
    try {
      const detections = await faceapi.detectAllFaces(
        els.video,
        new faceapi.TinyFaceDetectorOptions()
      );
      drawDetections(detections, els.video);
      updateResult(detections.length, 'Live camera');
    } catch (e) {
      // Skip a bad frame silently and keep the loop going.
    }
    detectionLoopId = requestAnimationFrame(runFrame);
  };
  detectionLoopId = requestAnimationFrame(runFrame);
}

function stopDetectionLoop(){
  if (detectionLoopId) {
    cancelAnimationFrame(detectionLoopId);
    detectionLoopId = null;
    els.startDetectionBtn.textContent = 'Start Detection';
  }
}

/* =========================================================
   Upload flow
========================================================= */
const ACCEPTED_TYPES = ['image/jpeg', 'image/png'];

els.fileInput.addEventListener('change', handleFileSelect);
els.clearUploadBtn.addEventListener('click', clearUpload);

async function handleFileSelect(e){
  clearError();
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const isAcceptedType = ACCEPTED_TYPES.includes(file.type);
  const hasAcceptedExt = /\.(jpe?g|png)$/i.test(file.name);
  if (!isAcceptedType && !hasAcceptedExt) {
    showError('Unsupported file type. Please upload a JPG, JPEG, or PNG image.');
    els.fileInput.value = '';
    return;
  }

  await ensureModelsLoaded();
  if (!modelsReady) return;

  const reader = new FileReader();
  reader.onerror = () => showError('Could not read that file. Please try a different image.');
  reader.onload = async (evt) => {
    els.uploadedImage.onload = async () => {
      uploadedImageLoaded = true;
      els.stageEmpty.hidden = true;
      els.uploadedImage.hidden = false;
      els.clearUploadBtn.hidden = false;
      els.resultSource.textContent = file.name;
      showStatus('idle', 'Analyzing image…');

      try {
        const detections = await faceapi.detectAllFaces(
          els.uploadedImage,
          new faceapi.TinyFaceDetectorOptions()
        );
        drawDetections(detections, els.uploadedImage);
        updateResult(detections.length, file.name);
      } catch (err) {
        showError('Something went wrong while analyzing this image. Please try another one.');
        showStatus('warn', 'Detection failed');
      }
    };
    els.uploadedImage.onerror = () => {
      showError('This file could not be opened as an image. Please choose a valid JPG or PNG.');
    };
    els.uploadedImage.src = evt.target.result;
  };
  reader.readAsDataURL(file);
}

function clearUpload(){
  uploadedImageLoaded = false;
  els.uploadedImage.src = '';
  els.uploadedImage.hidden = true;
  els.clearUploadBtn.hidden = true;
  els.fileInput.value = '';
  els.stageEmpty.querySelector('p').textContent = 'Choose an image to get started.';
  els.stageEmpty.hidden = false;
  clearOverlay();
  clearError();
  resetResult('None selected');
}

/* =========================================================
   Init
========================================================= */
setMode('camera');
window.addEventListener('resize', () => {
  if (currentMode === 'camera' && stream) sizeOverlayTo(els.video);
  if (currentMode === 'upload' && uploadedImageLoaded) sizeOverlayTo(els.uploadedImage);
});
