/**
 * dsh-parcel-tracker — 平台请求封装（B 组 / lib/platforms/http.js）
 *
 * 职责：组装 URL / header / body、发请求、限时、把所有异常吞成结构化结果。
 * 不认识任何平台的响应字段，不解析订单（解析在 index.js 的深扫里）。
 *
 * 约定：
 * - 永远不抛异常，一律返回 { ok, status, json, text, error }。
 * - 缺 cookie 直接短路，不发请求（error = 'missing-cookie'）。
 * - 默认超时 12s，可用 ctx.timeoutMs 覆盖。
 * - 日志里绝不出现 cookie 明文。
 */

export const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
export const DEFAULT_ACCEPT = 'application/json, text/plain, */*'
export const DEFAULT_CONTENT_TYPE = 'application/json; charset=utf-8'
export const DEFAULT_TIMEOUT_MS = 12000

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * 合并 query：端点里已有的 query 保留不动（用户覆盖 endpoint 优先），
 * 新参数只补端点里没有的 key。
 * @param {string} endpoint
 * @param {Record<string, any>} [params]
 * @returns {string}
 */
export function buildUrl(endpoint, params = {}) {
  const raw = String(endpoint == null ? '' : endpoint).trim()
  if (!raw) return ''
  const keys = params && typeof params === 'object' ? Object.keys(params) : []
  if (!keys.length) return raw

  let url = raw
  let hash = ''
  const hashIdx = url.indexOf('#')
  if (hashIdx >= 0) {
    hash = url.slice(hashIdx)
    url = url.slice(0, hashIdx)
  }
  const qIdx = url.indexOf('?')
  const base = qIdx >= 0 ? url.slice(0, qIdx) : url
  const query = new URLSearchParams(qIdx >= 0 ? url.slice(qIdx + 1) : '')
  for (const key of keys) {
    const value = params[key]
    if (value === undefined || value === null || value === '') continue
    if (query.has(key)) continue
    query.append(key, String(value))
  }
  const qs = query.toString()
  return base + (qs ? '?' + qs : '') + hash
}

/**
 * 合并 header：平台默认头 + 用户头（用户覆盖默认），
 * 再自动补 UA / Accept / Referer / Content-Type / Cookie。
 * @param {object} platformCfg 该平台的 config（含 cookie / headers / method / body / endpoint）
 * @param {object} [defaults] 平台默认头
 * @returns {Record<string,string>}
 */
export function buildHeaders(platformCfg = {}, defaults = {}) {
  const cfg = platformCfg || {}
  const merged = { ...(defaults || {}) }
  const user = cfg.headers && typeof cfg.headers === 'object' ? cfg.headers : {}
  for (const key of Object.keys(user)) merged[key] = user[key]

  if (!hasHeader(merged, 'user-agent')) merged['User-Agent'] = DEFAULT_UA
  if (!hasHeader(merged, 'accept')) merged['Accept'] = DEFAULT_ACCEPT
  if (!hasHeader(merged, 'referer')) {
    const ref = String(cfg.referer || '').trim() || originOf(cfg.endpoint)
    if (ref) merged['Referer'] = ref
  }
  const method = String(cfg.method || 'GET').toUpperCase()
  if (BODY_METHODS.has(method) && String(cfg.body || '').trim() && !hasHeader(merged, 'content-type')) {
    merged['Content-Type'] = DEFAULT_CONTENT_TYPE
  }
  const cookie = String(cfg.cookie || '').trim()
  if (cookie && !hasHeader(merged, 'cookie')) merged['Cookie'] = cookie
  return merged
}

/**
 * body 模板替换：支持 '{{phone}}' / '{{anyParam}}' 占位符；GET/HEAD 一律忽略 body。
 * @param {string} method
 * @param {string|object|undefined} bodyTemplate
 * @param {Record<string, any>} [params]
 * @returns {string}
 */
export function buildBody(method, bodyTemplate, params = {}) {
  const m = String(method || 'GET').toUpperCase()
  if (!BODY_METHODS.has(m)) return ''
  let tpl = bodyTemplate
  if (tpl === undefined || tpl === null) return ''
  if (typeof tpl === 'object') tpl = JSON.stringify(tpl)
  tpl = String(tpl)
  if (!tpl) return ''
  return tpl.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, key) => {
    const value = lookupParam(params, key)
    return value === undefined || value === null ? '' : String(value)
  })
}

/**
 * 发一次请求。永远不抛异常。
 * @param {string} platform 平台标识（仅用于日志）
 * @param {object} platformCfg { endpoint, method, headers, body, cookie, params, defaultHeaders }
 * @param {object} [ctx] { logger, signal, timeoutMs }
 * @returns {Promise<{ok:boolean,status:number,json:any,text:string,error:string}>}
 */
export async function request(platform, platformCfg = {}, ctx = {}) {
  const tag = String(platform || 'platform')
  const cfg = { ...(platformCfg || {}) }
  const logger = ctx && ctx.logger

  const cookie = String(cfg.cookie || '').trim()
  if (!cookie) {
    log(logger, 'warn', `[${tag}] request skipped: missing cookie`)
    return { ok: false, status: 0, json: null, text: '', error: 'missing-cookie' }
  }
  const endpoint = String(cfg.endpoint || '').trim()
  if (!endpoint) {
    log(logger, 'warn', `[${tag}] request skipped: missing endpoint`)
    return { ok: false, status: 0, json: null, text: '', error: 'missing-endpoint' }
  }

  const method = String(cfg.method || 'GET').toUpperCase()
  const params = cfg.params && typeof cfg.params === 'object' ? cfg.params : {}
  const withBody = BODY_METHODS.has(method)
  // query 一律带上 params（GET/POST 同理，避免 POST 时手机号等参数丢失）；
  // body 只由 body 模板决定，模板里的 {{phone}} 等占位符会被替换。
  const url = buildUrl(endpoint, params)
  const body = withBody ? buildBody(method, cfg.body, params) : ''
  const headers = buildHeaders({ ...cfg, method, body }, cfg.defaultHeaders || {})
  const timeoutMs = Number(ctx.timeoutMs) > 0 ? Number(ctx.timeoutMs) : DEFAULT_TIMEOUT_MS

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const outer = ctx && ctx.signal
  const onAbort = () => controller.abort()
  if (outer) {
    if (outer.aborted) controller.abort()
    else if (typeof outer.addEventListener === 'function') outer.addEventListener('abort', onAbort)
  }

  const startedAt = Date.now()
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? body : undefined,
      signal: controller.signal,
      redirect: 'follow',
    })
    const buf = Buffer.from(await res.arrayBuffer())
    const text = decodeBody(buf, res.headers.get('content-type'))
    let json = null
    if (text) {
      try {
        json = JSON.parse(text)
      } catch {
        json = null
      }
    }
    const ok = res.status >= 200 && res.status < 300
    const error = ok ? '' : `http-${res.status}`
    log(logger, ok ? 'info' : 'warn', `[${tag}] ${method} status=${res.status} ms=${Date.now() - startedAt}`, {
      status: res.status,
      ms: Date.now() - startedAt,
      cookieLen: cookie.length,
      url: redactUrl(url),
    })
    return { ok, status: res.status, json, text, error }
  } catch (err) {
    let error = 'request-failed'
    if (timedOut) error = 'timeout'
    else if (controller.signal.aborted) error = 'aborted'
    else if (err && err.message) error = err.message
    log(logger, 'warn', `[${tag}] request failed: ${error}`, {
      ms: Date.now() - startedAt,
      cookieLen: cookie.length,
      url: redactUrl(url),
    })
    return { ok: false, status: 0, json: null, text: '', error }
  } finally {
    clearTimeout(timer)
    if (outer && typeof outer.removeEventListener === 'function') outer.removeEventListener('abort', onAbort)
  }
}

// ---------------------------------------------------------------- 内部工具

/**
 * 按 charset 解码响应体：淘宝/京东等 PC 老接口常返回 GBK/GB18030，
 * fetch 的 res.text() 一律按 UTF-8 解 → 中文变乱码。
 * @param {Buffer} buf
 * @param {string|null} contentType
 * @returns {string}
 */
function decodeBody(buf, contentType) {
  if (!buf || !buf.length) return ''
  const ct = String(contentType || '')
  if (/charset=(gbk|gb2312|gb18030)/i.test(ct)) return decodeGbk(buf)
  const utf8 = buf.toString('utf8')
  // 没有声明 charset 时先按 UTF-8；若出现替换字符再尝试 GB18030（中文页面常见）
  if (utf8.indexOf('\uFFFD') < 0) return utf8
  const gbk = decodeGbk(buf)
  return gbk.indexOf('\uFFFD') < 0 ? gbk : utf8
}

function decodeGbk(buf) {
  try {
    return new TextDecoder('gb18030').decode(buf)
  } catch {
    return buf.toString('utf8')
  }
}

function hasHeader(headers, name) {
  const lower = String(name).toLowerCase()
  for (const key of Object.keys(headers || {})) {
    if (String(key).toLowerCase() === lower) return true
  }
  return false
}

function originOf(url) {
  try {
    const u = new URL(String(url))
    return u.origin + '/'
  } catch {
    return ''
  }
}

function lookupParam(params, key) {
  if (!params || typeof params !== 'object') return undefined
  if (Object.prototype.hasOwnProperty.call(params, key)) return params[key]
  if (String(key).includes('.')) {
    let cur = params
    for (const seg of String(key).split('.')) {
      if (cur === undefined || cur === null) return undefined
      cur = cur[seg]
    }
    return cur
  }
  return undefined
}

const SENSITIVE_QUERY_KEYS = new Set(['sign', 'token', 'accesstoken', 'access_token', 'cookie', 'password', 'sessionid', 'session_id', 'ticket'])

function redactUrl(url) {
  const raw = String(url || '')
  const qIdx = raw.indexOf('?')
  if (qIdx < 0) return raw
  const base = raw.slice(0, qIdx)
  const query = new URLSearchParams(raw.slice(qIdx + 1))
  for (const key of Array.from(query.keys())) {
    if (SENSITIVE_QUERY_KEYS.has(String(key).toLowerCase())) query.set(key, '***')
  }
  return base + '?' + query.toString()
}

function log(logger, level, message, fields) {
  if (!logger) return
  try {
    if (typeof logger === 'function') {
      logger(message, fields || {})
      return
    }
    const fn =
      typeof logger[level] === 'function'
        ? logger[level]
        : typeof logger.info === 'function'
          ? logger.info
          : null
    if (fn) fn.call(logger, message, fields || {})
  } catch {
    /* 日志失败不能影响主流程 */
  }
}
