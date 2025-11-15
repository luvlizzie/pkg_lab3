let cvReady = false;
let cvVersion = '';

function onOpenCvReady() {
    cvReady = true;
    cvVersion = cv.version;
    document.getElementById('opencvStatus').innerHTML = '✅ OpenCV.js загружен! Версия: ' + cvVersion;
    console.log('OpenCV.js готов! Версия:', cvVersion);
    addOpenCvMethods();
}

function imageDataToMat(imageData) {
    const mat = cv.matFromImageData(imageData);
    return mat;
}

function matToImageData(mat, ctx) {
    cv.imshow(ctx.canvas, mat);
    return ctx.getImageData(0, 0, mat.cols, mat.rows);
}

function applyOpenCVFilter(imageData, filterType, params = {}) {
    if (!cvReady) {
        alert('OpenCV.js еще не загружен!');
        return null;
    }

    try {
        const src = imageDataToMat(imageData);
        const dst = new cv.Mat();
        
        const srcBGR = new cv.Mat();
        cv.cvtColor(src, srcBGR, cv.COLOR_RGBA2BGR);
        
        switch(filterType) {
            case 'cv_brightness':
                const offset = params.offset || 0;
                cv.convertScaleAbs(srcBGR, dst, 1, offset);
                break;
                
            case 'cv_contrast':
                const factor = params.factor || 1;
                cv.convertScaleAbs(srcBGR, dst, factor, 0);
                break;
                
            case 'cv_linear_stretch':
                cv.normalize(srcBGR, dst, 0, 255, cv.NORM_MINMAX);
                break;
                
            case 'cv_negative':
                cv.bitwise_not(srcBGR, dst);
                break;
                
            case 'cv_local_mean':
                const grayMean = new cv.Mat();
                cv.cvtColor(srcBGR, grayMean, cv.COLOR_BGR2GRAY);
                cv.adaptiveThreshold(grayMean, dst, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY, params.blockSize || 11, params.C || 2);
                grayMean.delete();
                break;
                
            case 'cv_local_gaussian':
                const grayGaussian = new cv.Mat();
                cv.cvtColor(srcBGR, grayGaussian, cv.COLOR_BGR2GRAY);
                cv.adaptiveThreshold(grayGaussian, dst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, params.blockSize || 11, params.C || 2);
                grayGaussian.delete();
                break;
                
            case 'cv_adaptive':
                const grayAdaptive = new cv.Mat();
                cv.cvtColor(srcBGR, grayAdaptive, cv.COLOR_BGR2GRAY);
                cv.adaptiveThreshold(grayAdaptive, dst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, params.blockSize || 11, params.C || 2);
                grayAdaptive.delete();
                break;
                
            default:
                srcBGR.copyTo(dst);
                break;
        }
        
        const resultRGBA = new cv.Mat();
        if (filterType.includes('local_') || filterType.includes('adaptive')) {
            const colorResult = new cv.Mat();
            cv.cvtColor(dst, colorResult, cv.COLOR_GRAY2BGR);
            cv.cvtColor(colorResult, resultRGBA, cv.COLOR_BGR2RGBA);
            colorResult.delete();
        } else {
            cv.cvtColor(dst, resultRGBA, cv.COLOR_BGR2RGBA);
        }
        
        out.clearRect(0, 0, outCanvas.width, outCanvas.height);
        outCanvas.width = resultRGBA.cols;
        outCanvas.height = resultRGBA.rows;
        cv.imshow(outCanvas, resultRGBA);
        
        const result = out.getImageData(0, 0, resultRGBA.cols, resultRGBA.rows);
        
        src.delete();
        srcBGR.delete();
        dst.delete();
        resultRGBA.delete();
        
        return result;
        
    } catch (error) {
        console.error('OpenCV ошибка:', error);
        alert('Ошибка OpenCV: ' + error.message);
        return null;
    }
}

function addOpenCvMethods() {
    const opencvMethods = [
        { value: 'cv_negative', label: 'OpenCV: Инверсия (Negative)' },
        { value: 'cv_brightness', label: 'OpenCV: Яркость (Brightness)' },
        { value: 'cv_contrast', label: 'OpenCV: Контраст (Contrast)' },
        { value: 'cv_linear_stretch', label: 'OpenCV: Линейное контрастирование' },
        { value: 'cv_local_mean', label: 'OpenCV: Локальный порог (Mean)' },
        { value: 'cv_local_gaussian', label: 'OpenCV: Локальный порог (Gaussian)' },
        { value: 'cv_adaptive', label: 'OpenCV: Адаптивная пороговая обработка' }
    ];
    
    const methodSel = document.getElementById('method');
    opencvMethods.forEach(method => {
        const opt = document.createElement('option');
        opt.value = method.value;
        opt.textContent = method.label;
        methodSel.appendChild(opt);
    });
}

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

function updateMeta() {
  if (!originalImageData) { origMeta.textContent = 'Исходник: —'; outMeta.textContent = 'Результат: —'; return; }
  origMeta.textContent = `Исходник: ${originalImageData.width}×${originalImageData.height}, ${originalImageData.data.length/ (originalImageData.width*originalImageData.height) * 8} bit (RGBA buffer)`;
  if (lastResultData) outMeta.textContent = `Результат: ${lastResultData.width}×${lastResultData.height}`; else outMeta.textContent = 'Результат: —';
}

function renderParams() {
  const method = methodSel.value;
  paramsDiv.innerHTML = '';

  if (method === 'cv_brightness') {
    paramsDiv.innerHTML = `
      <label>Яркость (offset) <input id="p_offset" type="range" min="-255" max="255" value="0" /></label>
      <div class="small">Offset: <span id="p_offset_val">0</span></div>
    `;
    const r = paramsDiv.querySelector('#p_offset');
    const v = paramsDiv.querySelector('#p_offset_val');
    r.addEventListener('input', ()=> v.textContent = r.value);
  } else if (method === 'cv_contrast') {
    paramsDiv.innerHTML = `
      <label>Контраст (factor) <input id="p_factor" type="range" min="0" max="3" step="0.01" value="1" /></label>
      <div class="small">Фактор: <span id="p_factor_val">1</span></div>
    `;
    const r = paramsDiv.querySelector('#p_factor');
    const v = paramsDiv.querySelector('#p_factor_val');
    r.addEventListener('input', ()=> v.textContent = r.value);
  } else if (method === 'cv_local_mean' || method === 'cv_local_gaussian' || method === 'cv_adaptive') {
    paramsDiv.innerHTML = `
      <label>Block Size <input id="p_blockSize" type="number" min="3" max="21" step="2" value="11" /></label>
      <label>C <input id="p_C" type="number" min="-10" max="10" value="2" /></label>
      <div class="small">Block Size должно быть нечетным</div>
    `;
  } else {
    paramsDiv.innerHTML = `<div class="small">Параметры не требуются</div>`;
  }
}

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

function applySelected() {
  if (!originalImageData) return alert('Загрузите изображение сначала');

  const method = methodSel.value;
  let resultImageData = null;

  if (!cvReady) return alert('OpenCV.js еще не загружен!');
    
  const params = {};
  
  switch(method) {
      case 'cv_brightness':
          params.offset = Number(document.getElementById('p_offset')?.value || 0);
          break;
      case 'cv_contrast':
          params.factor = Number(document.getElementById('p_factor')?.value || 1);
          break;
      case 'cv_local_mean':
      case 'cv_local_gaussian':
      case 'cv_adaptive':
          params.blockSize = Number(document.getElementById('p_blockSize')?.value || 11);
          params.C = Number(document.getElementById('p_C')?.value || 2);
          break;
  }
  
  resultImageData = applyOpenCVFilter(originalImageData, method, params);
  if (resultImageData) {
      lastResultData = resultImageData;
      updateMeta();
  }
}

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

fileInput.addEventListener('change', (e)=>{
  const f = e.target.files[0];
  if (!f) return;
  const img = new Image();
  const url = URL.createObjectURL(f);
  img.onload = () => { loadImageIntoCanvas(img); URL.revokeObjectURL(url); };
  img.onerror = ()=>{ alert('Невозможно загрузить изображение'); URL.revokeObjectURL(url); };
  img.src = url;
});

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
      id.data[i]=Math.max(0,Math.min(255,id.data[i]+n)); 
      id.data[i+1]=Math.max(0,Math.min(255,id.data[i+1]+n)); 
      id.data[i+2]=Math.max(0,Math.min(255,id.data[i+2]+n));
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

methodSel.addEventListener('change', renderParams);
applyBtn.addEventListener('click', applySelected);
resetBtn.addEventListener('click', reset);
btnDownload.addEventListener('click', downloadResult);

btnToggleSamples.addEventListener('click', () => {
  if (!sampleList.children.length) createSamples();
  sampleList.classList.toggle('active');
});

renderParams();
updateMeta();
