const uploadForm = document.getElementById('uploadForm');
const imageInput = document.getElementById('imageInput');
const removeBtn = document.getElementById('removeBtn');
const resultContainer = document.getElementById('resultContainer');
const resultImage = document.getElementById('resultImage');
const resultBadge = document.getElementById('resultBadge');
const resultBar = document.getElementById('resultBar');
const downloadBtn = document.getElementById('downloadBtn');
const resetBtn = document.getElementById('resetBtn');
const message = document.getElementById('formMessage');
const statusEl = document.getElementById('status');
const dropTitle = document.getElementById('dropTitle');
const dropSub = document.getElementById('dropSub');
const fileMeta = document.getElementById('fileMeta');
const serverStatus = document.getElementById('serverStatus');
const dropzone = document.getElementById('dropzone');
const dropIcon = document.querySelector('.drop-icon');
const sourceThumb = document.getElementById('sourceThumb');
const sourceThumbImg = document.getElementById('sourceThumbImg');

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB (igual que el servidor)
const ALLOWED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
  'image/tiff'
];

let selectedFile = null;
let currentPreviewUrl = null;
let currentResultUrl = null;
let dragDepth = 0;

function showMessage(text, type = 'error') {
  if (!text) {
    message.hidden = true;
    message.textContent = '';
    message.className = 'alert';
    return;
  }
  message.textContent = text;
  message.className = type === 'ok' ? 'alert ok' : 'alert';
  message.hidden = false;
}

function setStatus(text) {
  statusEl.textContent = text || '';
}

function setServerStatus(text, state = '') {
  serverStatus.textContent = text;
  serverStatus.className = state ? `status ${state}` : 'status';
}

function validateFile(file) {
  if (!file) return 'No se seleccionó ninguna imagen';
  if (!ALLOWED_TYPES.includes(file.type)) {
    return 'Formato no soportado. Usa PNG, JPG, WEBP, GIF, AVIF, BMP o TIFF';
  }
  if (file.size > MAX_FILE_SIZE) {
    return 'La imagen supera el máximo de 20MB';
  }
  return null;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function resetResult() {
  if (currentResultUrl) {
    URL.revokeObjectURL(currentResultUrl);
    currentResultUrl = null;
  }
  resultImage.onload = null;
  resultImage.removeAttribute('src');
  resultBadge.hidden = true;
  resultBar.hidden = true;
  resultContainer.hidden = true;
  setStatus('');
}

function clearSelection() {
  selectedFile = null;
  imageInput.value = '';
  if (currentPreviewUrl) {
    URL.revokeObjectURL(currentPreviewUrl);
    currentPreviewUrl = null;
  }
  sourceThumbImg.removeAttribute('src');
  sourceThumb.hidden = true;
  dropIcon.removeAttribute('hidden');
  removeBtn.disabled = true;
  dropTitle.textContent = 'Elige una imagen, arrástrala o pégala (Ctrl+V)';
  dropSub.textContent = 'PNG · JPG · WEBP · GIF · AVIF · BMP · TIFF';
  fileMeta.textContent = 'Sin imagen seleccionada';
}

function selectFile(file) {
  resetResult();

  const validationError = validateFile(file);
  if (validationError) {
    clearSelection();
    showMessage(validationError);
    return false;
  }

  selectedFile = file;
  if (currentPreviewUrl) {
    URL.revokeObjectURL(currentPreviewUrl);
  }
  currentPreviewUrl = URL.createObjectURL(file);
  sourceThumbImg.src = currentPreviewUrl;
  sourceThumb.hidden = false;
  dropIcon.setAttribute('hidden', '');
  dropTitle.textContent = file.name;
  dropSub.textContent = `${file.type.replace('image/', '').toUpperCase()} · ${formatSize(file.size)}`;
  fileMeta.textContent = 'Lista para procesar';
  removeBtn.disabled = false;
  showMessage('');
  return true;
}

// Selección desde el input
imageInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    selectFile(file);
  } else {
    clearSelection();
  }
});

// Arrastrar y soltar
uploadForm.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth += 1;
  dropzone.hidden = false;
  uploadForm.classList.add('is-over');
});

uploadForm.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});

uploadForm.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    dropzone.hidden = true;
    uploadForm.classList.remove('is-over');
  }
});

uploadForm.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropzone.hidden = true;
  uploadForm.classList.remove('is-over');
  const file = e.dataTransfer?.files?.[0];
  if (file) {
    imageInput.files = e.dataTransfer.files;
    selectFile(file);
  }
});

// Evita que el navegador abra la imagen si se suelta fuera de la zona
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

// Procesar la imagen
uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!selectedFile) return;

  removeBtn.disabled = true;
  imageInput.disabled = true;
  removeBtn.classList.add('is-loading');
  removeBtn.setAttribute('aria-busy', 'true');
  removeBtn.querySelector('.label').textContent = 'Procesando';
  setServerStatus('procesando…', 'busy');
  resetResult();
  resultContainer.hidden = false;
  resultBar.hidden = false;
  setStatus('Recortando el fondo, esto puede tardar unos segundos…');
  showMessage('');

  const formData = new FormData();
  formData.append('image', selectedFile);

  try {
    const response = await fetch('/remove-bg', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      let errorMessage = 'Error al procesar la imagen';
      try {
        const errorData = await response.json();
        if (errorData && errorData.error) {
          errorMessage = errorData.error;
        }
      } catch (_) {}
      throw new Error(errorMessage);
    }

    const blob = await response.blob();
    if (currentResultUrl) {
      URL.revokeObjectURL(currentResultUrl);
    }
    currentResultUrl = URL.createObjectURL(blob);

    resultImage.onload = () => {
      resultBadge.textContent = `${resultImage.naturalWidth}×${resultImage.naturalHeight}`;
      resultBadge.hidden = false;
    };
    resultImage.src = currentResultUrl;

    resultBar.hidden = true;
    setStatus('Imagen procesada correctamente.');
    setServerStatus('motor listo', 'ok');
  } catch (error) {
    resultBar.hidden = true;
    resultContainer.hidden = true;
    showMessage(error.message || 'Error al procesar la imagen');
    setStatus('');
    setServerStatus('motor listo', 'ok');
  } finally {
    removeBtn.disabled = false;
    imageInput.disabled = false;
    removeBtn.classList.remove('is-loading');
    removeBtn.removeAttribute('aria-busy');
    removeBtn.querySelector('.label').textContent = 'Eliminar fondo';
  }
});

// Empezar de cero
resetBtn.addEventListener('click', () => {
  resetResult();
  clearSelection();
  showMessage('');
  imageInput.focus();
});

// Descargar la imagen
downloadBtn.addEventListener('click', () => {
  if (!currentResultUrl) return;
  const link = document.createElement('a');
  link.href = currentResultUrl;
  const originalName = selectedFile ? selectedFile.name.replace(/\.[^/.]+$/, '') : 'imagen';
  link.download = `${originalName}-sin-fondo.png`;
  link.click();
});

// Pegar imagen desde el portapapeles (Ctrl+V / Cmd+V)
window.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        const ext = file.type.split('/')[1] || 'png';
        const namedFile = file.name && file.name !== 'image.png' ? file : new File([file], `captura-${Date.now()}.${ext}`, { type: file.type });
        selectFile(namedFile);
        break;
      }
    }
  }
});

// Consultar estado real del servidor y del motor de IA
async function checkStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const data = await res.json();
    if (data.status === 'warming_up') {
      setServerStatus('calentando motor…', 'busy');
      setTimeout(checkStatus, 1500);
    } else if (data.status === 'busy') {
      setServerStatus('procesando…', 'busy');
      setTimeout(checkStatus, 2500);
    } else {
      setServerStatus('motor listo', 'ok');
    }
  } catch (_) {
    setServerStatus('sin conexión', 'busy');
    setTimeout(checkStatus, 5000);
  }
}

checkStatus();
