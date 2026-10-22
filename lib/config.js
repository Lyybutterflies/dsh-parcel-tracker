/**
 * lib/config.js —— 配置默认值 / 校验 / 掩码 / 原子持久化
 *
 * 契约来源：CONTRACT.md「统一数据形状 → Config」。
 * 关键安全约束：平台 cookie 是登录态凭据，**永远不能明文回传给前端**，
 * 所以对外一律走 maskConfig()，保存时用 unmaskConfig() 把旧明文补回去。
 */
import fs from 'node:fs'
import path from 'node:path'

/** 平台顺序（契约里 Config.platforms 的四个键） */
export const PLATFORM_KEYS = ['taobao', 'jd', 'douyin', 'pdd']

/** 轮询间隔上下限（分钟） */
export const MIN_REFRESH_MINUTES = 1
export const MAX_REFRESH_MINUTES = 1440

/** 单个平台配置的字段默认值 */
function defaultPlatformConfig() {
  return {
    enabled: true,
    cookie: '',
    endpoint: '',
    method: 'GET',
    headers: {},
    body: '',
    phoneParam: '',
    orderListPath: '',
    carrierNameMap: {},
  }
}

/** 契约里 Config 的完整默认值 */
export const DEFAULT_CONFIG = Object.freeze({
  phone: '',
  refreshMinutes: 15,
  trackRefreshMinutes: 10,
  showDelivered: true,
  trackEnabled: true,
  carrierOverrides: {},
  manualOrders: [],
  platforms: Object.freeze({
    taobao: Object.freeze(defaultPlatformConfig()),
    jd: Object.freeze(defaultPlatformConfig()),
    douyin: Object.freeze(defaultPlatformConfig()),
    pdd: Object.freeze(defaultPlatformConfig()),
  }),
})

/** 深拷贝一份可写的默认配置（避免调用方改到 DEFAULT_CONFIG 本体） */
export function cloneDefaultConfig() {
  const out = {
    phone: DEFAULT_CONFIG.phone,
    refreshMinutes: DEFAULT_CONFIG.refreshMinutes,
    trackRefreshMinutes: DEFAULT_CONFIG.trackRefreshMinutes,
    showDelivered: DEFAULT_CONFIG.showDelivered,
    trackEnabled: DEFAULT_CONFIG.trackEnabled,
    carrierOverrides: {},
    manualOrders: [],
    platforms: {},
  }
  for (const key of PLATFORM_KEYS) out.platforms[key] = defaultPlatformConfig()
  return out
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** 把任意输入夹到 [min,max] 区间内的整数；非法值回退 fallback */
export function clampInt(value, min, max, fallback) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  const i = Math.round(n)
  if (i < min) return min
  if (i > max) return max
  return i
}

/** 布尔值归一：接受 true/false/'true'/'false'/1/0 */
function toBool(value, fallback) {
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === 1) return true
  if (value === 'false' || value === 0) return false
  return fallback
}

/** 字符串归一：非字符串一律回退 fallback（不抛错，前端可能传任意类型） */
function toStr(value, fallback) {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return fallback
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return fallback
}

/** 归一单个平台的 headers（必须是 { [k]: string }） */
function normalizeHeaders(raw) {
  if (!isPlainObject(raw)) return {}
  const out = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k !== 'string' || !k) continue
    if (v === null || v === undefined) continue
    out[k] = typeof v === 'string' ? v : String(v)
  }
  return out
}

/** 归一 carrierNameMap（平台公司名 → 快递100 公司码） */
function normalizeStringMap(raw) {
  if (!isPlainObject(raw)) return {}
  const out = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k !== 'string' || !k) continue
    const s = toStr(v, '')
    if (s) out[k] = s
  }
  return out
}

/** 归一 carrierOverrides（运单号 → 快递公司码） */
function normalizeCarrierOverrides(raw) {
  if (!isPlainObject(raw)) return {}
  const out = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k !== 'string' || !k) continue
    const s = toStr(v, '')
    if (s) out[k] = s
  }
  return out
}

/** 归一手动订单条目（契约 Order 的子集） */
function normalizeManualOrder(raw) {
  if (!isPlainObject(raw)) return null
  const trackingNo = toStr(raw.trackingNo, '').trim()
  if (!trackingNo) return null
  const platform = toStr(raw.platform, 'manual').trim() || 'manual'
  const createdAt = Number(raw.createdAt)
  const updatedAt = Number(raw.updatedAt)
  return {
    id: toStr(raw.id, '') || `manual:${trackingNo}`,
    platform,
    title: toStr(raw.title, ''),
    trackingNo,
    carrier: toStr(raw.carrier, ''),
    carrierName: toStr(raw.carrierName, ''),
    status: toStr(raw.status, 'unknown'),
    statusText: toStr(raw.statusText, ''),
    createdAt: Number.isFinite(createdAt) ? createdAt : null,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : (Number.isFinite(createdAt) ? createdAt : null),
    tracking: isPlainObject(raw.tracking) ? raw.tracking : null,
    error: toStr(raw.error, ''),
  }
}

/**
 * 合并默认值 + 字段校验（类型/范围钳制）。
 * 非法输入不会抛错，只会退回默认值 —— 前端可能传任意形状。
 */
export function normalizeConfig(raw) {
  const base = cloneDefaultConfig()
  if (!isPlainObject(raw)) return base

  base.phone = toStr(raw.phone, base.phone).trim()
  base.refreshMinutes = clampInt(raw.refreshMinutes, MIN_REFRESH_MINUTES, MAX_REFRESH_MINUTES, base.refreshMinutes)
  base.trackRefreshMinutes = clampInt(raw.trackRefreshMinutes, MIN_REFRESH_MINUTES, MAX_REFRESH_MINUTES, base.trackRefreshMinutes)
  base.showDelivered = toBool(raw.showDelivered, base.showDelivered)
  base.trackEnabled = toBool(raw.trackEnabled, base.trackEnabled)
  base.carrierOverrides = normalizeCarrierOverrides(raw.carrierOverrides)

  if (Array.isArray(raw.manualOrders)) {
    const seen = new Set()
    base.manualOrders = []
    for (const item of raw.manualOrders) {
      const norm = normalizeManualOrder(item)
      if (!norm) continue
      if (seen.has(norm.id)) continue
      seen.add(norm.id)
      base.manualOrders.push(norm)
    }
  }

  const platforms = isPlainObject(raw.platforms) ? raw.platforms : {}
  for (const key of PLATFORM_KEYS) {
    const p = isPlainObject(platforms[key]) ? platforms[key] : {}
    const def = base.platforms[key]
    def.enabled = toBool(p.enabled, def.enabled)
    def.cookie = toStr(p.cookie, def.cookie)
    def.endpoint = toStr(p.endpoint, def.endpoint).trim()
    def.method = (toStr(p.method, def.method).trim().toUpperCase() || 'GET')
    def.headers = normalizeHeaders(p.headers)
    def.body = toStr(p.body, def.body)
    def.phoneParam = toStr(p.phoneParam, def.phoneParam).trim()
    def.orderListPath = toStr(p.orderListPath, def.orderListPath).trim()
    def.carrierNameMap = normalizeStringMap(p.carrierNameMap)
  }
  return base
}

/**
 * 读配置文件 → normalizeConfig；文件不存在/损坏返回默认配置拷贝。
 * 兼容两种内容：config 本体，或 state.json 那种 `{ config: {...} }` 包装。
 */
export function loadConfig(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(text)
    if (isPlainObject(parsed) && isPlainObject(parsed.config)) return normalizeConfig(parsed.config)
    return normalizeConfig(parsed)
  } catch (err) {
    return cloneDefaultConfig()
  }
}

/** 原子写：先写同目录 tmp 文件，再 rename 覆盖 */
export function saveConfig(filePath, config) {
  const dir = path.dirname(filePath)
  try { fs.mkdirSync(dir, { recursive: true }) } catch (err) { /* 目录已存在或不可创建时由写入报错 */ }
  const payload = JSON.stringify(normalizeConfig(config), null, 2)
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`)
  fs.writeFileSync(tmp, payload, 'utf8')
  try {
    fs.renameSync(tmp, filePath)
  } catch (err) {
    // 某些文件系统 rename 不覆盖已存在文件 → 退回 unlink + rename
    try { fs.unlinkSync(filePath) } catch (e2) {}
    fs.renameSync(tmp, filePath)
  }
  return true
}

/**
 * 返回给前端的掩码版本：
 * 每个平台的 cookie → { cookieSet: boolean, cookieLength: number }，**删除明文**。
 */
export function maskConfig(config) {
  const src = isPlainObject(config) ? config : {}
  const out = {
    phone: toStr(src.phone, ''),
    refreshMinutes: clampInt(src.refreshMinutes, MIN_REFRESH_MINUTES, MAX_REFRESH_MINUTES, DEFAULT_CONFIG.refreshMinutes),
    trackRefreshMinutes: clampInt(src.trackRefreshMinutes, MIN_REFRESH_MINUTES, MAX_REFRESH_MINUTES, DEFAULT_CONFIG.trackRefreshMinutes),
    showDelivered: toBool(src.showDelivered, DEFAULT_CONFIG.showDelivered),
    trackEnabled: toBool(src.trackEnabled, DEFAULT_CONFIG.trackEnabled),
    carrierOverrides: normalizeCarrierOverrides(src.carrierOverrides),
    manualOrders: Array.isArray(src.manualOrders) ? src.manualOrders.map(normalizeManualOrder).filter(Boolean) : [],
    platforms: {},
  }
  const platforms = isPlainObject(src.platforms) ? src.platforms : {}
  for (const key of PLATFORM_KEYS) {
    const p = isPlainObject(platforms[key]) ? platforms[key] : {}
    const cookie = toStr(p.cookie, '')
    out.platforms[key] = {
      enabled: toBool(p.enabled, true),
      cookieSet: cookie.length > 0,
      cookieLength: cookie.length,
      endpoint: toStr(p.endpoint, ''),
      method: (toStr(p.method, 'GET').trim().toUpperCase() || 'GET'),
      headers: normalizeHeaders(p.headers),
      body: toStr(p.body, ''),
      phoneParam: toStr(p.phoneParam, ''),
      orderListPath: toStr(p.orderListPath, ''),
      carrierNameMap: normalizeStringMap(p.carrierNameMap),
    }
  }
  return out
}

/**
 * 合并保存：前端回传的是**掩码后的** cookie（{ cookieSet, cookieLength }），
 * 不能把它当成明文写进 state —— 因此当 incoming 的 cookie 不是字符串时，
 * 保留 stored 里的旧明文（前端没改就是没改）。
 * 只有前端显式回传字符串（空串 = 用户主动清空）时才覆盖。
 */
export function unmaskConfig(stored, incoming) {
  const oldRaw = isPlainObject(stored) ? stored : {}
  const newRaw = isPlainObject(incoming) ? incoming : {}
  const oldPlatforms = isPlainObject(oldRaw.platforms) ? oldRaw.platforms : {}
  const newPlatforms = isPlainObject(newRaw.platforms) ? newRaw.platforms : {}

  const merged = {
    ...normalizeConfig(oldRaw),
  }
  // 顶层标量：incoming 有值才覆盖（掩码后的 config 里这些字段都是明文，可直接用）
  for (const key of ['phone', 'refreshMinutes', 'trackRefreshMinutes', 'showDelivered', 'trackEnabled', 'carrierOverrides', 'manualOrders']) {
    if (Object.prototype.hasOwnProperty.call(newRaw, key)) merged[key] = newRaw[key]
  }
  // 平台：逐个合并，cookie 特殊处理
  for (const key of PLATFORM_KEYS) {
    const oldP = isPlainObject(oldPlatforms[key]) ? oldPlatforms[key] : {}
    const newP = isPlainObject(newPlatforms[key]) ? newPlatforms[key] : {}
    const target = merged.platforms[key]
    for (const field of ['enabled', 'endpoint', 'method', 'headers', 'body', 'phoneParam', 'orderListPath', 'carrierNameMap']) {
      if (Object.prototype.hasOwnProperty.call(newP, field)) target[field] = newP[field]
    }
    if (Object.prototype.hasOwnProperty.call(newP, 'cookie')) {
      if (typeof newP.cookie === 'string') {
        target.cookie = newP.cookie // 用户显式填了新值（含空串 = 清空）
      } else {
        target.cookie = toStr(oldP.cookie, '') // 掩码对象 → 保留旧明文
      }
    }
  }
  return normalizeConfig(merged)
}
