/* ---------- Инициализация UI ---------- */
const fileInput = document.getElementById('fileInput');
const origCanvas = document.getElementById('origCanvas');
const outCanvas = document.getElementById('outCanvas');
const methodSel = document.getElementById('method');
const paramsDiv = document.getElementById('params');
const applyBtn = document.getElementById('applyBtn');
const resetBtn = document.getElementById('resetBtn');
const btnToggleSamples = document.getElementById('btnToggleSamples');
const btnDownload = document.getElementById('btnDownload');
const origMeta = document.getElementById('origMeta');
const outMeta = document.getElementById('outMeta');
const sampleList = document.getElementById('sampleList');

const oc = origCanvas.getContext('2d');
const out = outCanvas.getContext('2d');

let originalImage = null;
let originalImageData = null;
let lastResultData = null;

/* ---------- helpers ---------- */
function updateMeta() {
  if (!originalImageData) { origMeta.textContent = 'Исходник: —'; outMeta.textContent = 'Результат: —'; return; }
  origMeta.textContent = `Исходник: ${originalImageData.width}×${originalImageData.height}, ${originalImageData.data.length/ (originalImageData.width*originalImageData.height) * 8} bit (RGBA buffer)`;
  if (lastResultData) outMeta.textContent = `Результат: ${lastResultData.width}×${lastResultData.height}`; else outMeta.textContent = 'Результат: —';
}

function clamp(v,min=0,max=255){ return v<min?min:(v>max?max:v); }

/* ---------- parameter UI ---------- */
function renderParams() {
  const method = methodSel.value;
  paramsDiv.innerHTML = '';

  if (method === 'brightness') {
    paramsDiv.innerHTML = `
      <label>Яркость (offset) <input id="p_brightness" type="range" min="-255" max="255" value="0" /></label>
      <div class="small">Offset: <span id="p_brightness_val">0</span></div>
    `;
    const r = paramsDiv.querySelector('#p_brightness');
    const v = paramsDiv.querySelector('#p_brightness_val');
    r.addEventListener('input', ()=> v.textContent = r.value);
  } else if (method === 'contrast') {
    paramsDiv.innerHTML = `
      <label>Контраст (factor) <input id="p_contrast" type="range" min="0" max="3" step="0.01" value="1" /></label>
      <div class="small">Фактор: <span id="p_contrast_val">1</span></div>
    `;
    const r = paramsDiv.querySelector('#p_contrast');
    const v = paramsDiv.querySelector('#p_contrast_val');
    r.addEventListener('input', ()=> v.textContent = r.value);
  } else if (method === 'local_mean') {
    paramsDiv.innerHTML = `
      <label>Окно (size) <input id="p_win" type="number" min="3" max="201" step="2" value="25" /></label>
      <label>Сдвиг (C) <input id="p_C" type="number" step="1" value="0" /></label>
    `;
  } else if (method === 'niblack') {
    paramsDiv.innerHTML = `
      <label>Окно (size) <input id="p_win" type="number" min="3" max="201" step="2" value="25" /></label>
      <label>k (обычно -0.2..-0.5) <input id="p_k" type="number" step="0.05" value="-0.2" /></label>
    `;
  } else if (method === 'sauvola') {
    paramsDiv.innerHTML = `
      <label>Окно (size) <input id="p_win" type="number" min="3" max="201" step="2" value="25" /></label>
      <label>k (0..0.5) <input id="p_k" type="number" step="0.01" value="0.34" /></label>
      <label>R (dynamic range, default 128) <input id="p_R" type="number" step="1" value="128" /></label>
    `;
  } else if (method === 'stretch') {
    paramsDiv.innerHTML = `
      <div class="small">Линейное растяжение контраста: автоматически растягивает min→0 и max→255</div>
    `;
  } else {
    paramsDiv.innerHTML = `<div class="small">Параметры отсутствуют для этого метода</div>`;
  }
}

/* ---------- image loading & canvas ---------- */
function fitCanvasToImage(img, canvas) {
  const maxW = 640;
  let w = img.width, h = img.height;
  if (w > maxW) { const r = maxW / w; w = maxW; h = Math.round(h*r); }
  canvas.width = w; canvas.height = h;
}

function loadImageIntoCanvas(img) {
  originalImage = img;
  fitCanvasToImage(img, origCanvas);
  fitCanvasToImage(img, outCanvas);
  oc.clearRect(0,0,origCanvas.width,origCanvas.height);
  oc.drawImage(img,0,0, origCanvas.width, origCanvas.height);
  originalImageData = oc.getImageData(0,0,origCanvas.width, origCanvas.height);
  out.clearRect(0,0,outCanvas.width,outCanvas.height);
  lastResultData = null;
  updateMeta();
}

/* ---------- core processing helpers ---------- */

function getGrayArray(imageData) {
  const w = imageData.width, h = imageData.height;
  const data = imageData.data;
  const gray = new Float32Array(w*h);
  for (let i=0, p=0;i<w*h;i++, p+=4) {
    gray[i] = 0.299*data[p] + 0.587*data[p+1] + 0.114*data[p+2];
  }
  return {gray, w, h};
}

function putGrayToRGBA(gray, w, h) {
  const id = new ImageData(w,h);
  const outd = id.data;
  for (let i=0, p=0;i<w*h;i++, p+=4) {
    const v = clamp(Math.round(gray[i]));
    outd[p]=outd[p+1]=outd[p+2]=v;
    outd[p+3]=255;
  }
  return id;
}

/* efficient integral images for mean/std computations */
function integralImage(gray, w, h) {
  const I = new Float64Array((w+1)*(h+1));
  for (let y=1;y<=h;y++) {
    let rowSum = 0;
    for (let x=1;x<=w;x++) {
      const val = gray[(y-1)*w + (x-1)];
      rowSum += val;
      I[y*(w+1)+x] = I[(y-1)*(w+1)+x] + rowSum;
    }
  }
  return I;
}
function integralImageSq(gray, w, h) {
  const I = new Float64Array((w+1)*(h+1));
  for (let y=1;y<=h;y++) {
    let rowSum = 0;
    for (let x=1;x<=w;x++) {
      const val = gray[(y-1)*w + (x-1)];
      rowSum += val*val;
      I[y*(w+1)+x] = I[(y-1)*(w+1)+x] + rowSum;
    }
  }
  return I;
}
function sumRegion(I, w, x1,y1,x2,y2) {
  const W = w+1;
  return I[y2*W + x2] - I[y1-1*W + x2] - I[y2*W + x1-1] + I[(y1-1)*W + x1-1];
}

/* ---------- Algorithms ---------- */

// Per-pixel ops (operate on RGBA ImageData)
function negative(imageData) {
  const outId = new ImageData(imageData.width, imageData.height);
  const d = imageData.data, od = outId.data;
  for (let i=0;i<d.length;i+=4) {
    od[i]   = 255 - d[i];
    od[i+1] = 255 - d[i+1];
    od[i+2] = 255 - d[i+2];
    od[i+3] = d[i+3];
  }
  return outId;
}
function brightness(imageData, offset) {
  const outId = new ImageData(imageData.width, imageData.height);
  const d = imageData.data, od = outId.data;
  for (let i=0;i<d.length;i+=4) {
    od[i] = clamp(d[i] + offset);
    od[i+1] = clamp(d[i+1] + offset);
    od[i+2] = clamp(d[i+2] + offset);
    od[i+3] = d[i+3];
  }
  return outId;
}
function contrast(imageData, factor) {
  const outId = new ImageData(imageData.width, imageData.height);
  const d = imageData.data, od = outId.data;
  for (let i=0;i<d.length;i+=4) {
    od[i]   = clamp((d[i]-128)*factor + 128);
    od[i+1] = clamp((d[i+1]-128)*factor + 128);
    od[i+2] = clamp((d[i+2]-128)*factor + 128);
    od[i+3] = d[i+3];
  }
  return outId;
}
function linearStretch(imageData) {
  const w=imageData.width,h=imageData.height,d=imageData.data;
  let min=255,max=0;
  for (let i=0;i<d.length;i+=4) {
    const lum = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
    if (lum < min) min = lum;
    if (lum > max) max = lum;
  }
  if (max<=min) return imageData;
  const outId = new ImageData(w,h); const od = outId.data;
  for (let i=0;i<d.length;i+=4) {
    od[i] = clamp((d[i]-min)*255/(max-min));
    od[i+1] = clamp((d[i+1]-min)*255/(max-min));
    od[i+2] = clamp((d[i+2]-min)*255/(max-min));
    od[i+3] = d[i+3];
  }
  return outId;
}

/* Local thresholding algorithms (work on grayscale arrays) */
function localMeanThreshold(gray,w,h,win,C=0) {
  const half = Math.floor(win/2);
  const I = integralImage(gray,w,h);
  const out = new Float32Array(w*h);
  for (let y=0;y<h;y++){
    const y1 = Math.max(0,y-half), y2 = Math.min(h-1,y+half);
    for (let x=0;x<w;x++){
      const x1 = Math.max(0,x-half), x2 = Math.min(w-1,x+half);
      const area = (x2-x1+1)*(y2-y1+1);
      const sum = I[(y2+1)*(w+1)+(x2+1)] - I[(y1)*(w+1)+(x2+1)] - I[(y2+1)*(w+1)+(x1)] + I[(y1)*(w+1)+(x1)];
      const mean = sum/area;
      const idx = y*w+x;
      out[idx] = gray[idx] > mean - C ? 255 : 0;
    }
  }
  return out;
}

function niblackThreshold(gray,w,h,win,k=-0.2) {
  const half = Math.floor(win/2);
  const I = integralImage(gray,w,h);
  const I2 = integralImageSq(gray,w,h);
  const out = new Float32Array(w*h);
  for (let y=0;y<h;y++){
    const y1 = Math.max(0,y-half), y2 = Math.min(h-1,y+half);
    for (let x=0;x<w;x++){
      const x1 = Math.max(0,x-half), x2 = Math.min(w-1,x+half);
      const area = (x2-x1+1)*(y2-y1+1);
      const sum = I[(y2+1)*(w+1)+(x2+1)] - I[(y1)*(w+1)+(x2+1)] - I[(y2+1)*(w+1)+(x1)] + I[(y1)*(w+1)+(x1)];
      const sum2 = I2[(y2+1)*(w+1)+(x2+1)] - I2[(y1)*(w+1)+(x2+1)] - I2[(y2+1)*(w+1)+(x1)] + I2[(y1)*(w+1)+(x1)];
      const mean = sum/area;
      const varr = (sum2/area) - (mean*mean);
      const std = varr>0?Math.sqrt(varr):0;
      const thresh = mean + k * std;
      out[y*w+x] = gray[y*w+x] > thresh ? 255 : 0;
    }
  }
  return out;
}

function sauvolaThreshold(gray,w,h,win,k=0.34,R=128) {
  const half = Math.floor(win/2);
  const I = integralImage(gray,w,h);
  const I2 = integralImageSq(gray,w,h);
  const out = new Float32Array(w*h);
  for (let y=0;y<h;y++){
    const y1 = Math.max(0,y-half), y2 = Math.min(h-1,y+half);
    for (let x=0;x<w;x++){
      const x1 = Math.max(0,x-half), x2 = Math.min(w-1,x+half);
      const area = (x2-x1+1)*(y2-y1+1);
      const sum = I[(y2+1)*(w+1)+(x2+1)] - I[(y1)*(w+1)+(x2+1)] - I[(y2+1)*(w+1)+(x1)] + I[(y1)*(w+1)+(x1)];
      const sum2 = I2[(y2+1)*(w+1)+(x2+1)] - I2[(y1)*(w+1)+(x2+1)] - I2[(y2+1)*(w+1)+(x1)] + I2[(y1)*(w+1)+(x1)];
      const mean = sum/area;
      const varr = (sum2/area) - (mean*mean);
      const std = varr>0?Math.sqrt(varr):0;
      const thresh = mean * (1 + k * ((std / R) - 1));
      out[y*w+x] = gray[y*w+x] > thresh ? 255 : 0;
    }
  }
  return out;
}

/* ---------- main apply logic ---------- */

function applySelected() {
  if (!originalImageData) return alert('Загрузите изображение сначала');

  const method = methodSel.value;
  let resultImageData = null;

  if (['negative','brightness','contrast','stretch'].includes(method)) {
    if (method === 'negative') resultImageData = negative(originalImageData);
    else if (method === 'brightness') {
      const offset = Number(document.getElementById('p_brightness').value || 0);
      resultImageData = brightness(originalImageData, offset);
    } else if (method === 'contrast') {
      const factor = Number(document.getElementById('p_contrast').value || 1);
      resultImageData = contrast(originalImageData, factor);
    } else if (method === 'stretch') {
      resultImageData = linearStretch(originalImageData);
    }
    out.clearRect(0,0,outCanvas.width,outCanvas.height);
    outCanvas.width = originalImageData.width;
    outCanvas.height = originalImageData.height;
    out.putImageData(resultImageData, 0, 0);
    lastResultData = resultImageData;
    updateMeta();
    return;
  }

  const {gray,w,h} = getGrayArray(originalImageData);
  const win = Number((document.getElementById('p_win') && document.getElementById('p_win').value) || 25);

  if (method === 'local_mean') {
    const C = Number(document.getElementById('p_C')?.value || 0);
    const bin = localMeanThreshold(gray,w,h,win,C);
    const id = putGrayToRGBA(bin,w,h);
    outCanvas.width = w; outCanvas.height = h;
    out.putImageData(id,0,0);
    lastResultData = id;
    updateMeta();
    return;
  }
  if (method === 'niblack') {
    const k = Number(document.getElementById('p_k')?.value || -0.2);
    const bin = niblackThreshold(gray,w,h,win,k);
    const id = putGrayToRGBA(bin,w,h);
    outCanvas.width = w; outCanvas.height = h;
    out.putImageData(id,0,0);
    lastResultData = id;
    updateMeta();
    return;
  }
  if (method === 'sauvola') {
    const k = Number(document.getElementById('p_k')?.value || 0.34);
    const R = Number(document.getElementById('p_R')?.value || 128);
    const bin = sauvolaThreshold(gray,w,h,win,k,R);
    const id = putGrayToRGBA(bin,w,h);
    outCanvas.width = w; outCanvas.height = h;
    out.putImageData(id,0,0);
    lastResultData = id;
    updateMeta();
    return;
  }
}

/* ---------- reset & download ---------- */
function reset() {
  if (!originalImage) return;
  loadImageIntoCanvas(originalImage);
}
function downloadResult() {
  if (!lastResultData) return alert('Сначала примените метод');
  const a = document.createElement('a');
  a.href = outCanvas.toDataURL('image/png');
  a.download = 'result.png';
  a.click();
}

/* ---------- File input ---------- */
fileInput.addEventListener('change', (e)=>{
  const f = e.target.files[0];
  if (!f) return;
  const img = new Image();
  const url = URL.createObjectURL(f);
  img.onload = () => { loadImageIntoCanvas(img); URL.revokeObjectURL(url); };
  img.onerror = ()=>{ alert('Невозможно загрузить изображение'); URL.revokeObjectURL(url); };
  img.src = url;
});

/* ---------- sample images generator ---------- */
function makeCanvasCopy(w=512,h=320, drawFn) {
  const c = document.createElement('canvas'); c.width=w;c.height=h;
  const g = c.getContext('2d');
  drawFn(g,w,h);
  const img = new Image();
  img.src = c.toDataURL('image/png');
  return img;
}
function createSamples() {
  sampleList.innerHTML = '';
  const samples = [];

  samples.push({name:'Low contrast', img: makeCanvasCopy(640,360,(g,w,h)=>{
    const grd = g.createLinearGradient(0,0,w,0);
    grd.addColorStop(0,'#808080'); grd.addColorStop(1,'#b0b0b0');
    g.fillStyle = grd; g.fillRect(0,0,w,h);
    g.fillStyle='rgba(0,0,0,0.25)'; g.fillRect(0,0,w,h);
  })});

  samples.push({name:'Blurred pattern', img: makeCanvasCopy(640,360,(g,w,h)=>{
    for (let y=0;y<h;y+=6) for (let x=0;x<w;x+=6) {
      const c = Math.floor(128 + 120*Math.sin((x+y)/14));
      g.fillStyle = `rgb(${c},${(c+60)%255},${(200-c)%255})`;
      g.fillRect(x,y,6,6);
    }
    const tmp = document.createElement('canvas'); tmp.width=320; tmp.height=180;
    const tg = tmp.getContext('2d'); tg.drawImage(g.canvas,0,0,tmp.width,tmp.height);
    g.clearRect(0,0,w,h); g.drawImage(tmp,0,0,w,h);
  })});

  samples.push({name:'Salt&Pepper', img: makeCanvasCopy(640,360,(g,w,h)=>{
    g.fillStyle='#ddd'; g.fillRect(0,0,w,h);
    g.fillStyle='#222'; g.font='bold 72px serif'; g.fillText('Test', 80, 180);
    const id = g.getImageData(0,0,w,h); for (let i=0;i<id.data.length;i+=4) {
      if (Math.random() < 0.04) { const v = Math.random()<0.5?0:255; id.data[i]=id.data[i+1]=id.data[i+2]=v; }
    } g.putImageData(id,0,0);
  })});

  samples.push({name:'Noisy', img: makeCanvasCopy(640,360,(g,w,h)=>{
    for (let y=0;y<h;y++) {
      const r = Math.round(120 + 100*Math.sin(y/30));
      g.fillStyle = `rgb(${r},${r/1.3},${255-r/2})`; g.fillRect(0,y,w,1);
    }
    const id = g.getImageData(0,0,w,h);
    for (let i=0;i<id.data.length;i+=4) {
      const n = (Math.random()-0.5)*40;
      id.data[i]=clamp(id.data[i]+n); id.data[i+1]=clamp(id.data[i+1]+n); id.data[i+2]=clamp(id.data[i+2]+n);
    } g.putImageData(id,0,0);
  })});

  samples.forEach(s=>{
    const btn = document.createElement('button');
    btn.textContent = s.name;
    btn.onclick = ()=> {
      const img = s.img;
      img.onload = ()=> loadImageIntoCanvas(img);
      if (img.complete) loadImageIntoCanvas(img);
    };
    sampleList.appendChild(btn);
  });
}

/* ---------- wiring ---------- */
methodSel.addEventListener('change', renderParams);
applyBtn.addEventListener('click', applySelected);
resetBtn.addEventListener('click', reset);
btnDownload.addEventListener('click', downloadResult);

btnToggleSamples.addEventListener('click', () => {
  if (!sampleList.children.length) createSamples();
  sampleList.classList.toggle('active');
});

/* initial */
const methods = [
  { value: 'negative', label: 'Инверсия (Negative)' },
  { value: 'brightness', label: 'Яркость (Brightness offset)' },
  { value: 'contrast', label: 'Контраст (Contrast factor)' },
  { value: 'stretch', label: 'Линейное контрастирование (Linear stretch)' },
  { value: 'local_mean', label: 'Локальный порог (Local mean)' },
  { value: 'niblack', label: 'Порог Ниблака (Niblack)' },
  { value: 'sauvola', label: 'Порог Саувола (Sauvola adaptive)' }
];

methodSel.innerHTML = '';
methods.forEach(m => {
  const opt = document.createElement('option');
  opt.value = m.value;
  opt.textContent = m.label;
  methodSel.appendChild(opt);
});

renderParams();
updateMeta();