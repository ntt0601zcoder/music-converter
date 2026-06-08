// Cloudflare Worker: serves the static SPA, plus two API routes that let the
// browser load audio from a URL (bypassing CORS):
//   GET /api/fetch?url=<direct media URL>   → proxies the bytes back
//   GET /api/youtube?url=<youtube URL>       → best-effort audio extraction
//
// YouTube extraction (youtubei.js) is best-effort: YouTube frequently blocks
// datacenter IPs, so it may fail in production even though it works locally.
import { Innertube } from 'youtubei.js/cf-worker';

interface Env {
  ASSETS: { fetch: (req: Request) => Promise<Response> };
}

const CORS = { 'access-control-allow-origin': '*' } as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
  });
}

/** Block obviously-internal hosts to limit SSRF abuse. */
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === 'localhost' ||
    h.endsWith('.internal') ||
    h.endsWith('.local') ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h === '::1' ||
    h === '[::1]'
  );
}

const FETCH_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
  accept: '*/*',
};

async function handleProxy(reqUrl: URL): Promise<Response> {
  const target = reqUrl.searchParams.get('url');
  if (!target) return json({ error: 'Thiếu tham số url' }, 400);
  let t: URL;
  try {
    t = new URL(target);
  } catch {
    return json({ error: 'URL không hợp lệ' }, 400);
  }
  if (t.protocol !== 'http:' && t.protocol !== 'https:')
    return json({ error: 'Chỉ hỗ trợ http(s)' }, 400);
  if (isBlockedHost(t.hostname)) return json({ error: 'Host bị chặn' }, 400);

  let resp: Response;
  try {
    resp = await fetch(t.toString(), { headers: FETCH_HEADERS, redirect: 'follow' });
  } catch (e) {
    return json({ error: 'Không tải được link: ' + (e instanceof Error ? e.message : e) }, 502);
  }
  if (!resp.ok) return json({ error: `Link trả về ${resp.status}` }, 502);

  const ct = resp.headers.get('content-type') ?? 'application/octet-stream';
  const headers: Record<string, string> = { ...CORS, 'content-type': ct };
  const len = resp.headers.get('content-length');
  if (len) headers['content-length'] = len;
  return new Response(resp.body, { headers });
}

function parseYouTubeId(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1) || null;
    if (u.hostname.endsWith('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)/);
      if (m) return m[1];
    }
  } catch {
    /* not a url */
  }
  return null;
}

async function handleYouTube(reqUrl: URL): Promise<Response> {
  const link = reqUrl.searchParams.get('url') ?? '';
  const id = parseYouTubeId(link);
  if (!id) return json({ error: 'Link YouTube không hợp lệ' }, 400);

  try {
    // The WEB client needs signature deciphering (runs JS), which Cloudflare
    // Workers forbid (no eval). The IOS/ANDROID clients return DIRECT stream
    // URLs with no cipher, so we use those and skip the player entirely.
    const yt = await Innertube.create({ retrieve_player: false });
    let info;
    try {
      info = await yt.getInfo(id, 'IOS');
    } catch {
      info = await yt.getInfo(id, 'ANDROID');
    }
    const title = info.basic_info?.title ?? id;
    const format = info.chooseFormat({ type: 'audio', quality: 'best' });
    const streamUrl = (format as { url?: string }).url;
    if (!streamUrl) throw new Error('Không lấy được URL audio trực tiếp');

    const upstream = await fetch(streamUrl, { headers: FETCH_HEADERS, redirect: 'follow' });
    if (!upstream.ok) throw new Error(`stream YouTube trả về ${upstream.status}`);
    return new Response(upstream.body, {
      headers: {
        ...CORS,
        'content-type': upstream.headers.get('content-type') ?? 'audio/mp4',
        'x-title': encodeURIComponent(title),
      },
    });
  } catch (e) {
    return json(
      {
        error:
          'Không lấy được audio từ YouTube. YouTube hiện khóa stream sau token xác thực ' +
          '(không trích xuất tự động được). Cách chắc chắn: tải bằng yt-dlp/trình tải YouTube ' +
          'rồi upload file. Chi tiết: ' +
          (e instanceof Error ? e.message : String(e)),
      },
      502,
    );
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: { ...CORS, 'access-control-allow-methods': 'GET, OPTIONS' },
      });
    }
    if (url.pathname === '/api/fetch') return handleProxy(url);
    if (url.pathname === '/api/youtube') return handleYouTube(url);
    return env.ASSETS.fetch(request);
  },
};
