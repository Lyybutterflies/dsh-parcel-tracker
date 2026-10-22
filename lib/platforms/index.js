/**
 * dsh-parcel-tracker — 平台适配器注册表 + 通用深扫提取（B 组 / lib/platforms/index.js）
 *
 * 设计前提（决定了这里的实现方式）：
 *  - 四家平台的订单接口都没有公开文档、带签名、响应结构随时会变；
 *  - 实测均没有「手机号直查」的公开接口（无登录态时分别返回
 *    FAIL_SYS_API_NOT_FOUNDED / no access / Url does not match / HTTP 424）。
 *  => 所以解析层不能硬编码某一种响应结构，一律走「通用深扫提取」：
 *     递归遍历 JSON，在「直接含有运单号字段」的对象上产出一条归一 Order。
 *
 * 本文件不依赖 A 组（aggregate.js / config.js）与 C 组（carriers.js）的存在：
 *  - normalizeStatus 在本地实现了一份（不动态导入 aggregate.js）；
 *  - carriers.js 通过 `await import('../carriers.js').catch(() => null)` 动态导入，
 *    不存在时快递公司码留空字符串。
 */

import taobao from './taobao.js'
import jd from './jd.js'
import douyin from './douyin.js'
import pdd from './pdd.js'

export const PLATFORMS = ['taobao', 'jd', 'douyin', 'pdd']

const ADAPTERS = {
  taobao,
  jd,
  douyin,
  pdd,
}

// ---------------------------------------------------------------- 正则一览

/** 运单号候选字段名（契约正则，原文保留） */
export const TRACKING_FIELD_PATTERN =
  /(mailNo|trackingNo|waybillCode|logisticsNo|shippingId|voucherNo|deliveryNo|expressNo|waybillId|logisticsId|运单号|快递单号)/i
/** 快递公司候选字段名（契约正则，原文保留） */
export const CARRIER_FIELD_PATTERN =
  /(expressCompany|carrierCode|deliveryCompany|logisticsName|shippingType|companyName|company)/i
/** 标题候选字段名（契约正则，原文保留） */
export const TITLE_FIELD_PATTERN =
  /(goodsName|productName|itemName|title|subject|orderTitle|goodsTitle)/i
/** 订单状态候选字段名（契约正则，原文保留） */
export const STATUS_FIELD_PATTERN = /(orderStatus|status|state|phase|orderState|statusName)/i
/** 时间候选字段名（契约正则，原文保留） */
export const TIME_FIELD_PATTERN =
  /(createTime|orderTime|create_time|orderCreateTime|payTime|createDate|gmtCreate)/i

// 分级（优先级）正则：靠前的先命中，避免「泛用字段名」抢走「专用字段名」。
const TRACKING_PATTERNS = [TRACKING_FIELD_PATTERN]
const CARRIER_PATTERNS = [
  /(expressCompany|carrierCode|deliveryCompany|logisticsName|shippingType|companyName)/i,
  /^company$/i,
]
const TITLE_PATTERNS = [TITLE_FIELD_PATTERN]
const TITLE_FALLBACK_PATTERNS = [/(skuName|commodityName)/i]
const STATUS_PATTERNS = [
  /(orderStatus|orderState|statusName|statusDesc|statusText)/i,
  /^(status|state|phase|statusValue|orderStatusValue)$/i,
]
const TIME_PATTERNS = [
  /(createTime|orderTime|orderCreateTime|payTime|createDate|gmtCreate|gmtModified)/i,
  /^(time|orderDate|createAt)$/i,
]

// ---------------------------------------------------------------- 状态归一

export const STATUS_TEXT = {
  pending: '待揽收',
  in_transit: '运输中',
  delivered: '已签收',
  unknown: '未知',
}

/** 抖音数字状态的启发式映射（允许用户用 platformCfg.statusMap 覆盖） */
export const PLATFORM_STATUS_NUM_MAP = {
  douyin: { 0: 'pending', 1: 'in_transit', 2: 'delivered', 3: 'unknown' },
}

const DELIVERED_WORDS = [
  '已签收', '签收成功', '交易成功', '订单完成', '已完成', '已送达', '收货成功', '已收货',
  'delivered', 'signed', 'completed', 'finished', 'done',
]
const PENDING_WORDS = [
  '待付款', '待支付', '待发货', '待揽收', '待收货', '待配送', '待出库', '待处理', '待取件',
  '未发货', '未支付', 'pending', 'created', 'unpaid', 'awaiting',
]
const IN_TRANSIT_WORDS = [
  '已发货', '运输中', '运输途中', '派送中', '配送中', '已揽收', '已取件', '已出库', '已转运',
  'in_transit', 'shipped', 'shipping', 'transit', 'delivering', 'on_the_way', 'picked_up',
]

/**
 * 本地状态归一（不依赖 A 组 aggregate.js）。
 * @param {any} raw 平台原始状态值
 * @param {string} [platform] 平台标识（用于数字状态启发式）
 * @param {object} [statusMap] 用户自定义映射 { raw: 'pending'|'in_transit'|'delivered'|'unknown' }
 * @returns {'pending'|'in_transit'|'delivered'|'unknown'}
 */
export function normalizeStatus(raw, platform = '', statusMap = null) {
  if (raw === undefined || raw === null || raw === '') return 'unknown'

  if (statusMap && typeof statusMap === 'object') {
    for (const key of Object.keys(statusMap)) {
      if (String(key) === String(raw)) {
        const v = String(statusMap[key])
        if (STATUS_TEXT[v]) return v
      }
    }
  }

  if (typeof raw === 'number') {
    const numMap = PLATFORM_STATUS_NUM_MAP[platform]
    if (numMap && numMap[raw]) return numMap[raw]
    return 'unknown'
  }

  const text = String(raw).trim()
  if (!text) return 'unknown'
  if (STATUS_TEXT[text]) return text
  if (/^-?\d+$/.test(text)) {
    const numMap = PLATFORM_STATUS_NUM_MAP[platform]
    if (numMap && numMap[Number(text)]) return numMap[Number(text)]
    return 'unknown'
  }
  const lower = text.toLowerCase()
  if (DELIVERED_WORDS.some((w) => lower.includes(w))) return 'delivered'
  if (PENDING_WORDS.some((w) => lower.includes(w))) return 'pending'
  if (IN_TRANSIT_WORDS.some((w) => lower.includes(w))) return 'in_transit'
  return 'unknown'
}

/**
 * A 组 aggregate.js 的动态导入（可能不存在 / 可能还没写完 → 不依赖它）。
 * A 组提供更完整的 normalizeStatus（含快递100 state 码与平台数字状态）。
 */
let aggregateModulePromise = null
async function loadAggregate() {
  if (aggregateModulePromise) return aggregateModulePromise
  aggregateModulePromise = import('../aggregate.js')
    .then((mod) => (mod && typeof mod.normalizeStatus === 'function' ? mod : null))
    .catch(() => null)
  return aggregateModulePromise
}

/**
 * 状态归一（异步版，优先级）：
 *   1. 用户 statusMap 显式覆盖
 *   2. 平台专属数字状态映射（抖音）
 *   3. A 组 aggregate.normalizeStatus()（若存在）
 *   4. 本地实现（兜底，永远可用）
 * @param {any} raw
 * @param {string} platform
 * @param {object|null} statusMap
 * @returns {Promise<'pending'|'in_transit'|'delivered'|'unknown'>}
 */
export async function resolveStatus(raw, platform = '', statusMap = null) {
  if (raw === undefined || raw === null || raw === '') return 'unknown'

  if (statusMap && typeof statusMap === 'object') {
    for (const key of Object.keys(statusMap)) {
      if (String(key) === String(raw)) {
        const v = String(statusMap[key])
        if (STATUS_TEXT[v]) return v
      }
    }
  }

  // 平台专属数字状态优先（抖音 0/1/2/3 的启发式映射）
  const numMap = PLATFORM_STATUS_NUM_MAP[platform]
  const isNumeric = typeof raw === 'number' || /^-?\d+$/.test(String(raw).trim())
  if (numMap && isNumeric) {
    const n = Number(raw)
    if (numMap[n]) return numMap[n]
  }

  const aggregate = await loadAggregate()
  if (aggregate) {
    try {
      const v = aggregate.normalizeStatus(raw)
      if (v && STATUS_TEXT[v]) return v
    } catch {
      /* 用本地兜底 */
    }
  }
  return normalizeStatus(raw, platform, statusMap)
}

// ---------------------------------------------------------------- 时间解析

/**
 * 统一时间解析：字符串 / 秒 / 毫秒 → epoch ms（无法解析返回 null）。
 * 10 位当秒、13 位当毫秒；'2026-10-20 12:00:00' 按本机本地时间解析。
 * @param {any} raw
 * @returns {number|null}
 */
export function parseTime(raw) {
  if (raw === undefined || raw === null || raw === '') return null
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.getTime()
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw <= 0) return null
    if (raw < 1e11) return Math.round(raw * 1000) // 秒
    return Math.round(raw) // 毫秒
  }
  const text = String(raw).trim()
  if (!text) return null
  if (/^\d+$/.test(text)) return parseTime(Number(text))
  const normalized = text.replace(/\//g, '-').replace(' ', 'T')
  let ms = Date.parse(normalized)
  if (Number.isNaN(ms)) ms = Date.parse(text)
  if (Number.isNaN(ms)) {
    // '2026-10-20 12:00:00' 在部分引擎上需要毫秒补零
    const m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2}):(\d{1,2})/)
    if (m) {
      ms = new Date(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4]),
        Number(m[5]),
        Number(m[6]),
      ).getTime()
    }
  }
  return Number.isNaN(ms) ? null : ms
}

// ---------------------------------------------------------------- 深扫工具

/**
 * 递归收集 JSON 树里的所有普通对象（不含数组本身）。
 * @param {any} root
 * @returns {object[]}
 */
export function deepFindObjects(root) {
  const out = []
  const seen = new Set()
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 64) return
    if (seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
    }
    out.push(node)
    for (const key of Object.keys(node)) {
      const value = node[key]
      if (value && typeof value === 'object') walk(value, depth + 1)
    }
  }
  walk(root, 0)
  return out
}

function toPatterns(patterns) {
  const list = Array.isArray(patterns) ? patterns : [patterns]
  const out = []
  for (const p of list) {
    if (!p) continue
    if (p instanceof RegExp) {
      out.push(p.global ? new RegExp(p.source, p.flags.replace(/g/g, '')) : p)
    } else if (typeof p === 'string') {
      out.push(new RegExp(p, 'i'))
    }
  }
  return out
}

/**
 * 字段名归一：去掉下划线/连字符/空格并转小写。
 * 这样 `shipping_id`、`order_status`、`goods_name` 这类 snake_case 字段名
 * 能命中契约里写的 camelCase 正则（正则本身保持契约原文）。
 */
function normalizeKey(key) {
  return String(key).replace(/[_\-\s]/g, '').toLowerCase()
}

/**
 * 在对象里按正则数组找第一个命中值（跳过 undefined / null / ''）。
 * 优先级：patterns 数组靠前的正则优先；同一正则内按对象键序。
 * @param {object} obj
 * @param {RegExp[]|RegExp|string[]} patterns
 * @returns {any} 命中的值；没命中返回 undefined
 */
export function pickByPattern(obj, patterns) {
  const list = toPatterns(patterns)
  if (!obj || typeof obj !== 'object') return undefined
  for (const re of list) {
    for (const key of Object.keys(obj)) {
      if (!re.test(normalizeKey(key))) continue
      const value = obj[key]
      if (value === undefined || value === null || value === '') continue
      return value
    }
  }
  return undefined
}

/**
 * 在对象里按正则数组收集所有命中项（同一对象可能有多个运单号字段）。
 * @param {object} obj
 * @param {RegExp[]|RegExp|string[]} patterns
 * @returns {{key:string,value:any}[]}
 */
export function collectByPattern(obj, patterns) {
  const list = toPatterns(patterns)
  const out = []
  if (!obj || typeof obj !== 'object') return out
  for (const key of Object.keys(obj)) {
    const norm = normalizeKey(key)
    if (!list.some((re) => re.test(norm))) continue
    const value = obj[key]
    if (value === undefined || value === null || value === '') continue
    out.push({ key, value })
  }
  return out
}

/**
 * 解析 orderListPath：支持 'a.b.c' 与 'a[0].b'。
 * @param {any} root
 * @param {string} path
 * @returns {any} 找不到返回 undefined
 */
export function resolvePath(root, path) {
  const raw = String(path || '').trim()
  if (!raw) return undefined
  const tokens = raw.match(/[^.[\]]+/g) || []
  let cur = root
  for (const token of tokens) {
    if (cur === undefined || cur === null) return undefined
    if (Array.isArray(cur)) {
      const idx = Number(token)
      if (!Number.isInteger(idx)) return undefined
      cur = cur[idx]
      continue
    }
    if (typeof cur !== 'object') return undefined
    if (!Object.prototype.hasOwnProperty.call(cur, token)) return undefined
    cur = cur[token]
  }
  return cur
}

// ---------------------------------------------------------------- 运单号校验

/**
 * 判断一个候选值是否是像样的运单号。
 * 规则（契约）：长度 < 6 或 > 40 丢弃；纯数字且长度 > 15 当作订单号丢弃；
 *              含中文但不含「运单/快递」丢弃。
 * @param {any} value
 * @returns {boolean}
 */
export function isValidTrackingNo(value) {
  if (value === undefined || value === null) return false
  if (typeof value === 'object') return false
  const text = String(value).trim()
  if (!text) return false
  if (text.length < 6 || text.length > 40) return false
  if (/^\d+$/.test(text) && text.length > 15) return false
  if (/[一-龥]/.test(text) && !/运单|快递/.test(text)) return false
  return true
}

// ---------------------------------------------------------------- 快递公司

let carriersModulePromise = null

async function loadCarriers() {
  if (carriersModulePromise) return carriersModulePromise
  carriersModulePromise = import('../carriers.js')
    .then((mod) => (mod && (mod.companyNameToCode ? mod : mod.default || null)))
    .catch(() => null)
  return carriersModulePromise
}

/**
 * 快递公司名 → 快递100 公司码。
 * 顺序：用户 carrierNameMap → C 组 companyNameToCode() → 空字符串。
 * @param {string} rawValue 平台返回的公司名/公司码
 * @param {object} platformCfg 平台 config（读 carrierNameMap）
 * @returns {Promise<string>}
 */
export async function resolveCarrierCode(rawValue, platformCfg = {}) {
  const raw = String(rawValue == null ? '' : rawValue).trim()
  if (!raw) return ''
  const map = platformCfg && platformCfg.carrierNameMap && typeof platformCfg.carrierNameMap === 'object'
    ? platformCfg.carrierNameMap
    : {}
  if (Object.prototype.hasOwnProperty.call(map, raw)) {
    const v = String(map[raw] || '').trim()
    if (v) return v
  }
  const lower = raw.toLowerCase()
  for (const key of Object.keys(map)) {
    if (String(key).trim().toLowerCase() === lower) {
      const v = String(map[key] || '').trim()
      if (v) return v
    }
  }
  const carriers = await loadCarriers()
  if (carriers && typeof carriers.companyNameToCode === 'function') {
    try {
      const code = await carriers.companyNameToCode(raw)
      if (code) return String(code)
    } catch {
      /* 映射失败就留空 */
    }
  }
  return ''
}

// ---------------------------------------------------------------- 订单 id

/**
 * 稳定 id：platform + ':' + trackingNo。
 * @param {string} platform
 * @param {string} trackingNo
 * @returns {string}
 */
export function orderKey(platform, trackingNo) {
  return `${String(platform || '')}:${String(trackingNo == null ? '' : trackingNo).trim()}`
}

// ---------------------------------------------------------------- 深扫提取

/**
 * 从任意 JSON 形状里提取归一订单。
 * @param {any} json 平台响应 JSON
 * @param {object} platformCfg 平台 config（orderListPath / carrierNameMap / statusMap）
 * @param {string} platform 平台标识
 * @returns {Promise<object[]>} Order[]
 */
export async function extractOrders(json, platformCfg = {}, platform = '') {
  const cfg = platformCfg || {}
  const orders = []
  if (json === undefined || json === null) return orders

  let roots = []
  const listPath = String(cfg.orderListPath || '').trim()
  if (listPath) {
    const resolved = resolvePath(json, listPath)
    if (Array.isArray(resolved)) {
      roots = resolved
    } else if (resolved && typeof resolved === 'object') {
      roots = [resolved]
    } else {
      // 路径失效（响应结构变了）→ 回退全树深扫，宁可多扫也不要漏
      roots = [json]
    }
  } else {
    roots = [json]
  }

  const seen = new Map()
  for (const root of roots) {
    const objects = deepFindObjects(root)
    for (const obj of objects) {
      const order = await buildOrder(obj, cfg, platform)
      if (!order) continue
      const prev = seen.get(order.id)
      if (!prev) {
        seen.set(order.id, order)
        orders.push(order)
        continue
      }
      // 同一运单号在多个对象里出现（父对象/子对象各带一份）→ 合并补齐缺失字段
      mergeOrder(prev, order)
    }
  }
  return orders
}

function mergeOrder(target, extra) {
  if (!target.title && extra.title) target.title = extra.title
  if (!target.carrier && extra.carrier) target.carrier = extra.carrier
  if (!target.carrierName && extra.carrierName) target.carrierName = extra.carrierName
  if (target.status === 'unknown' && extra.status && extra.status !== 'unknown') {
    target.status = extra.status
    target.statusText = extra.statusText
  }
  if (target.createdAt === null && extra.createdAt !== null) {
    target.createdAt = extra.createdAt
    target.updatedAt = extra.createdAt
  }
}

async function buildOrder(obj, cfg, platform) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null

  const candidates = collectByPattern(obj, TRACKING_PATTERNS)
  let trackingNo = ''
  for (const c of candidates) {
    if (isValidTrackingNo(c.value)) {
      trackingNo = String(c.value).trim()
      break
    }
  }
  if (!trackingNo) return null

  const rawCarrier = pickByPattern(obj, CARRIER_PATTERNS)
  const carrierName = rawCarrier === undefined ? '' : String(rawCarrier).trim()
  const carrier = await resolveCarrierCode(carrierName, cfg)

  const rawTitle = pickByPattern(obj, TITLE_PATTERNS)
  const title =
    rawTitle === undefined || rawTitle === null
      ? fallbackTitle(obj)
      : String(rawTitle).trim()

  const rawStatus = pickByPattern(obj, STATUS_PATTERNS)
  const status = await resolveStatus(rawStatus, platform, cfg.statusMap || null)
  const statusText = statusLabel(rawStatus, status)

  const rawTime = pickByPattern(obj, TIME_PATTERNS)
  const createdAt = parseTime(rawTime)

  return {
    id: orderKey(platform, trackingNo),
    platform: String(platform || ''),
    title,
    trackingNo,
    carrier,
    carrierName,
    status,
    statusText,
    createdAt,
    updatedAt: createdAt,
    // 与契约 TrackingResult 同形（轨迹由 A 组 aggregate / C 组 kuaidi100 填充）
    tracking: { ok: false, state: '', status: 'unknown', traces: [], fetchedAt: null, error: '' },
    error: '',
  }
}

function fallbackTitle(obj) {
  const raw = pickByPattern(obj, TITLE_FALLBACK_PATTERNS)
  if (raw === undefined || raw === null) return ''
  return String(raw).trim()
}

function statusLabel(raw, status) {
  if (typeof raw === 'string') {
    const text = raw.trim()
    // 平台自带中文状态文案 → 原样保留（信息量最大）
    if (text && /[一-龥]/.test(text)) return text
  }
  return STATUS_TEXT[status] || STATUS_TEXT.unknown
}

// ---------------------------------------------------------------- 平台级错误识别

/**
 * 平台级错误识别（保守版）：只看响应**顶层**的几个已知失败标记，
 * 不做全树扫描，避免把正常业务字段误判成错误。
 * 目的：让 UI 能区分「没有订单」和「登录态失效 / 接口被拒」。
 * @param {any} json
 * @param {string} platform
 * @returns {string} 错误说明；没有识别到错误返回 ''
 */
export function detectPlatformError(json, platform) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return ''
  const p = String(platform || '')

  if (p === 'taobao') {
    const ret = json.ret
    if (Array.isArray(ret)) {
      const fail = ret.find((r) => typeof r === 'string' && /^FAIL/i.test(r))
      if (fail) return String(fail)
    }
    return ''
  }
  if (p === 'jd') {
    const code = json.code
    if (code !== undefined && code !== null && String(code) !== '0' && String(code) !== '200') {
      const echo = json.echo || json.msg || json.message
      return `code=${code}${echo ? ' ' + String(echo).slice(0, 80) : ''}`
    }
    return ''
  }
  if (p === 'douyin') {
    const sc = json.status_code
    if (sc !== undefined && sc !== null && Number(sc) !== 0) {
      const msg = json.message || json.msg || ''
      return `status_code=${sc}${msg ? ' ' + String(msg).slice(0, 80) : ''}`
    }
    return ''
  }
  if (p === 'pdd') {
    const ec = json.error_code
    if (ec !== undefined && ec !== null && Number(ec) !== 0) {
      const msg = json.error_msg || json.msg || ''
      return `error_code=${ec}${msg ? ' ' + String(msg).slice(0, 80) : ''}`
    }
    return ''
  }
  return ''
}

/**
 * 平台 fetchOrders 的收尾：抽订单 + 识别平台级错误。
 * 平台级错误时仍返回已抽到的订单（不丢数据），但 ok=false 并带上说明。
 * @param {{ok:boolean,status:number,json:any,text:string,error:string}} res
 * @param {object} platformCfg
 * @param {string} platform
 * @returns {Promise<{ok:boolean,orders:object[],error:string}>}
 */
export async function finishFetch(res, platformCfg, platform) {
  const platformError = detectPlatformError(res && res.json, platform)
  const httpError = res && res.ok ? '' : (res && res.error) || `http-${res && res.status}`
  let orders = []
  try {
    orders = res ? await extractOrders(res.json, platformCfg, platform) : []
  } catch {
    orders = []
  }
  const error = platformError || httpError
  return { ok: !error, orders, error }
}

// ---------------------------------------------------------------- 适配器注册表

/**
 * 取平台适配器定义。
 * @param {string} platform 'taobao' | 'jd' | 'douyin' | 'pdd'
 * @returns {{platform:string,name:string,nameEn:string,defaultEndpoint:string,defaultHeaders:object,defaultMethod:string,defaultBody:string,buildParams:Function,fetchOrders:Function}}
 */
export function getAdapter(platform) {
  const key = String(platform || '').trim().toLowerCase()
  const adapter = ADAPTERS[key]
  if (!adapter) return null
  return {
    platform: adapter.platform,
    name: adapter.name,
    nameEn: adapter.nameEn,
    defaultEndpoint: adapter.defaultEndpoint,
    defaultHeaders: { ...adapter.defaultHeaders },
    defaultMethod: adapter.defaultMethod,
    defaultBody: adapter.defaultBody,
    buildParams: adapter.buildParams,
    fetchOrders: adapter.fetchOrders,
  }
}

/**
 * 取平台默认 config（与契约 Config.platforms 同构）。
 * @param {string} platform
 * @returns {object}
 */
export function defaultPlatformConfig(platform) {
  const adapter = getAdapter(platform)
  if (!adapter) return null
  return {
    enabled: true,
    cookie: '',
    endpoint: '',
    method: adapter.defaultMethod,
    headers: {},
    body: '',
    phoneParam: '',
    orderListPath: '',
    carrierNameMap: {},
  }
}

/**
 * 逐平台抓取订单，逐平台 try/catch，永不抛异常。
 * @param {object} cfg 整个 Config（{ phone, platforms: {...} }）
 * @param {object} ctx { logger, signal, timeoutMs }
 * @returns {Promise<{orders:object[],errors:{platform:string,message:string}[],skipped:{platform:string,reason:string}[]}>}
 */
export async function fetchAllPlatformOrders(cfg = {}, ctx = {}) {
  const config = cfg || {}
  const platforms = config.platforms && typeof config.platforms === 'object' ? config.platforms : {}
  const orders = []
  const errors = []
  const skipped = []

  for (const platform of PLATFORMS) {
    const pc = { ...(platforms[platform] || defaultPlatformConfig(platform) || {}) }
    if (pc.enabled === false) {
      skipped.push({ platform, reason: 'disabled' })
      continue
    }
    if (!String(pc.cookie || '').trim()) {
      skipped.push({ platform, reason: 'missing-cookie' })
      continue
    }
    const adapter = getAdapter(platform)
    if (!adapter) {
      errors.push({ platform, message: 'unknown-platform' })
      continue
    }
    try {
      const res = await adapter.fetchOrders({ ...pc, phone: config.phone || '' }, ctx)
      // 即使平台报了错（如登录态失效），已经解析出的订单也要保留，
      // 否则「部分成功」的数据会被整平台丢掉。
      for (const order of (res && res.orders) || []) {
        if (!order) continue
        orders.push({ ...order, platform: order.platform || platform })
      }
      if (!res || !res.ok) {
        errors.push({ platform, message: (res && res.error) || 'unknown-error' })
      }
    } catch (err) {
      errors.push({ platform, message: err && err.message ? err.message : String(err) })
    }
  }

  return { orders, errors, skipped }
}

export default {
  PLATFORMS,
  getAdapter,
  fetchAllPlatformOrders,
  extractOrders,
  deepFindObjects,
  pickByPattern,
  resolveCarrierCode,
  normalizeStatus,
  parseTime,
  orderKey,
}
