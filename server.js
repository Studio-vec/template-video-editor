// 템플릿 영상 편집기 - 로컬 서버
// 실행: node server.js  →  http://localhost:4321
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;

const PORT = process.env.PORT || 4321;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const TMP = path.join(ROOT, '.work');
const OUT = path.join(ROOT, 'output');
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const uploads = new Map(); // id -> { file, name, meta }
const jobs = new Map();    // id -> { status, progress, out, error, log }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mp4': 'video/mp4', '.png': 'image/png', '.json': 'application/json' };

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req, limit = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function probe(file) {
  return new Promise((resolve) => {
    const p = spawn(ffprobePath, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate:stream_tags=rotate:format=duration', '-show_streams', '-of', 'json', file]);
    let out = ''; p.stdout.on('data', d => out += d);
    p.on('close', () => {
      try {
        const j = JSON.parse(out);
        const v = j.streams.find(s => s.codec_type === 'video') || {};
        const a = j.streams.find(s => s.codec_type === 'audio');
        let rot = Number((v.tags && v.tags.rotate) || 0);
        if (v.side_data_list) for (const sd of v.side_data_list) if (sd.rotation) rot = Number(sd.rotation);
        let w = v.width, h = v.height;
        if (Math.abs(rot) % 180 === 90) [w, h] = [h, w];
        const [fn, fd] = String(v.r_frame_rate || '30/1').split('/').map(Number);
        resolve({ width: w, height: h, fps: fd ? fn / fd : 30, duration: Number(j.format.duration) || 0, hasAudio: !!a });
      } catch (e) { resolve(null); }
    });
  });
}
const even = n => Math.max(2, Math.round(n / 2) * 2);
const safeName = s => String(s).replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);

async function handleUpload(req, res, url) {
  const name = safeName(decodeURIComponent(url.searchParams.get('name') || 'video.mp4'));
  const id = crypto.randomBytes(8).toString('hex');
  const file = path.join(TMP, id + path.extname(name));
  const ws = fs.createWriteStream(file);
  req.pipe(ws);
  ws.on('finish', async () => {
    const meta = await probe(file);
    if (!meta || !meta.width) { fs.unlink(file, () => {}); return send(res, 400, { error: '영상 정보를 읽을 수 없습니다' }); }
    uploads.set(id, { file, name, meta });
    send(res, 200, { id, meta });
  });
  ws.on('error', e => send(res, 500, { error: e.message }));
}

async function handleRender(req, res) {
  const body = JSON.parse((await readBody(req)).toString('utf8'));
  const up = uploads.get(body.id);
  if (!up) return send(res, 404, { error: '업로드된 파일이 없습니다. 다시 추가해 주세요.' });
  const t = body.template;
  const W = even(t.width), H = even(t.height);
  const m = up.meta;
  // 영상 배치: 미리보기 canvas 에서 계산한 값을 그대로 사용 (미리보기 = 결과물)
  const pl = body.place;
  const sw = even(pl.w), sh = even(pl.h);
  const x = Math.round(pl.x + (pl.w - sw) / 2), y = Math.round(pl.y + (pl.h - sh) / 2);
  const fps = t.fps === 'source' ? Math.min(60, Math.round(m.fps * 1000) / 1000) : Number(t.fps) || 30;

  const jobId = crypto.randomBytes(8).toString('hex');
  const overlay = path.join(TMP, jobId + '_overlay.png');
  fs.writeFileSync(overlay, Buffer.from(String(body.overlay).split(',')[1], 'base64'));

  const outName = safeName(body.outName || ('edited_' + up.name)).replace(/\.[^.]+$/, '') + '.mp4';
  const outFile = path.join(OUT, outName);
  const bg = /^#[0-9a-f]{6}$/i.test(t.bgColor || '') ? '0x' + t.bgColor.slice(1) : 'black';
  const dur = m.duration || 0;

  const filter = [
    `color=c=${bg}:s=${W}x${H}:r=${fps}[bg]`,
    `[0:v]fps=${fps},scale=${sw}:${sh}:flags=lanczos,setsar=1[v]`,
    `[bg][v]overlay=x=${x}:y=${y}:shortest=1[b]`,
    `[b][1:v]overlay=0:0:format=auto,format=yuv420p[out]`,
  ].join(';');
  const args = ['-y', '-hide_banner', '-i', up.file, '-loop', '1', '-i', overlay,
    '-filter_complex', filter, '-map', '[out]', '-map', '0:a?',
    '-c:v', 'libx264', '-preset', t.preset || 'medium', '-crf', String(t.crf ?? 18), '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats'];
  if (dur) args.push('-t', String(dur));
  args.push(outFile);

  const job = { status: 'running', progress: 0, out: outName, error: null, log: '' };
  jobs.set(jobId, job);
  const p = spawn(ffmpegPath, args);
  p.stdout.on('data', d => {
    const mt = /out_time_us=(\d+)/g; let r, last;
    while ((r = mt.exec(String(d)))) last = r;
    if (last && dur) job.progress = Math.min(0.99, Number(last[1]) / 1e6 / dur);
  });
  p.stderr.on('data', d => { job.log = (job.log + d).slice(-4000); });
  p.on('close', code => {
    fs.unlink(overlay, () => {});
    if (code === 0) { job.status = 'done'; job.progress = 1; }
    else { job.status = 'error'; job.error = job.log.split('\n').filter(Boolean).slice(-3).join('\n'); }
  });
  send(res, 200, { jobId });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (p === '/api/health') return send(res, 200, { ok: true });
    if (req.method === 'POST' && p === '/api/upload') return handleUpload(req, res, url);
    if (req.method === 'POST' && p === '/api/render') return handleRender(req, res);
    if (req.method === 'GET' && p.startsWith('/api/job/')) {
      const j = jobs.get(p.slice(9)); return j ? send(res, 200, j) : send(res, 404, { error: 'no job' });
    }
    if (req.method === 'GET' && p.startsWith('/api/src/')) {
      const u = uploads.get(p.slice(9)); if (!u) return send(res, 404, 'not found', 'text/plain');
      return streamFile(req, res, u.file);
    }
    if (req.method === 'GET' && p.startsWith('/api/out/')) {
      const name = safeName(decodeURIComponent(p.slice(9)));
      const f = path.join(OUT, name);
      if (!fs.existsSync(f)) return send(res, 404, 'not found', 'text/plain');
      if (url.searchParams.get('dl')) res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
      return streamFile(req, res, f);
    }
    if (req.method === 'POST' && p === '/api/open-output') {
      spawn(process.platform === 'win32' ? 'explorer' : 'open', [OUT], { detached: true }); return send(res, 200, { ok: true });
    }
    // static
    let f = path.join(PUBLIC, p === '/' ? 'index.html' : path.normalize(p).replace(/^([\\/]\.\.)+/, ''));
    if (!f.startsWith(PUBLIC) || !fs.existsSync(f)) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, fs.readFileSync(f), MIME[path.extname(f)] || 'application/octet-stream');
  } catch (e) { send(res, 500, { error: e.message }); }
});

function streamFile(req, res, file) {
  const stat = fs.statSync(file);
  const type = MIME[path.extname(file).toLowerCase()] || 'video/mp4';
  const range = req.headers.range;
  if (range) {
    const [s, e] = range.replace('bytes=', '').split('-');
    const start = Number(s), end = e ? Number(e) : stat.size - 1;
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': type });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': type, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file).pipe(res);
  }
}

// 시작 시 이전 임시파일 정리
for (const f of fs.readdirSync(TMP)) fs.unlink(path.join(TMP, f), () => {});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  템플릿 영상 편집기 실행 중 → http://localhost:${PORT}`);
  console.log(`  결과물 폴더: ${OUT}\n`);
});
