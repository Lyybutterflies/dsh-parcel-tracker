/**
 * lib/aggregate.js —— 订单合并 / 去重 / 状态归一 / 排序 / 汇总
 *
 * 契约来源：CONTRACT.md「统一数据形状 → Order」。
 * 状态枚举只有四个：pending | in_transit | delivered | unknown。
 */

/** 合法状态集合 */
export const STATUSES = ['pending', 'in_transit', 'delivered', 'unknown']

/** 排序优先级：在途最前，其次待揽收，再次未知，最后已签收 */
const STATUS_RANK = { in_transit: 0, pending: 1, unknown: 2, delivered: 3 }

/** 快递100 state 码 → 归一状态（契约「快递100 契约」一节） */
const KUAIDI_STATE_MAP = {
  200: 'pending',
  201: 'in_transit', 202: 'in_transit', 203: 'in_transit', 204: 'in_transit',
  205: 'in_transit', 206: 'in_transit', 207: 'in_transit', 208: 'in_transit',
  209: 'in_transit', 210: 'in_transit',
  300: 'delivered', 301: 'delivered', 302: 'delivered', 303: 'delivered',
  304: 'delivered', 305: 'delivered', 306: 'delivered', 307: 'delivered',
  308: 'delivered', 309: 'delivered', 310: 'delivered', 311: 'delivered',
}

/**
 * 中文状态词 → 归一状态。
 * 顺序有讲究：「待*」必须排在「已揽收/已发货」之前，
 * 否则「待揽收」会被 `揽收` 命中而误判成 in_transit。
 */
const CN_STATUS_MAP = [
  [/签收|已收货|收货完成|完成签收/, 'delivered'],
  [/已送达|送达/, 'delivered'],
  [/待揽收|待发货|待收货|待付款|待支付|待确认|待配送|未发货|准备中|处理中|已下单|已支付|付款成功/, 'pending'],
  [/运输中|运输|在途|派送中|派送|配送中|已发货|已揽收|已取件|揽收|转运|途中/, 'in_transit'],
  [/取消|退款|关闭|作废|无效|失败/, 'unknown'],
]

/** 英文状态词 → 归一状态（淘宝/京东/拼多多常见的枚举名） */
const EN_STATUS_MAP = [
  [/^(wait_buyer_pay|wait_pay|created|pending|not_pay)$/, 'pending'],
  [/^(wait_seller_send_goods|wait_deliver_goods|wait_ship|to_be_shipped|pre_sale)$/, 'pending'],
  [/^(sent|delivering|in_transit|intransit|shipping|on_the_way|delivery|picked_up|shipping)/, 'in_transit'],
  [/^(trade_finished|received|delivered|completed|complete|finished|success|done)$/, 'delivered'],
  [/^(cancelled|canceled|closed|refunded|invalid|failed)$/, 'unknown'],
]

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 任意平台的原始状态 → 'pending' | 'in_transit' | 'delivered' | 'unknown'
 * 支持：归一状态原值、快递100 state 码（字符串/数字）、中文/英文状态词。
 */
export function normalizeStatus(raw) {
  if (raw === null || raw === undefined) return 'unknown'
  if (typeof raw === 'boolean') return 'unknown'

  if (typeof raw === 'number') {
    if (Number.isFinite(raw)) {
      const mapped = KUAIDI_STATE_MAP[raw]
      if (mapped) return mapped
      // 契约里只有 200..311 有定义；其余数字一律 unknown，
      // 不能凭「>=30 就算签收」猜 —— 那是平台私有状态码，不是快递100 state。
      return 'unknown'
    }
    return 'unknown'
  }

  const text = String(raw).trim()
  if (!text) return 'unknown'

  // 已经是归一状态
  if (STATUSES.includes(text)) return text

  // 纯数字字符串 → 按 state 码处理
  if (/^\d+$/.test(text)) return normalizeStatus(Number(text))

  const lower = text.toLowerCase().replace(/[\s-]+/g, '_')

  // 英文枚举
  for (const [re, status] of EN_STATUS_MAP) {
    if (re.test(lower)) return status
  }
  // 中文关键词
  for (const [re, status] of CN_STATUS_MAP) {
    if (re.test(text)) return status
  }
  // 英文枚举里没覆盖的，用子串兜底
  if (/deliver|ship|transit|pick|send/.test(lower)) return 'in_transit'
  if (/receiv|finish|complete/.test(lower)) return 'delivered'
  if (/wait|pend|creat|init/.test(lower)) return 'pending'

  return 'unknown'
}

/** 稳定 id：platform + ':' + trackingNo */
export function orderKey(platform, trackingNo) {
  return `${String(platform == null ? '' : platform)}:${String(trackingNo == null ? '' : trackingNo)}`
}

/** 取订单的稳定 id；缺失时用 platform+trackingNo 兜底 */
export function orderId(order) {
  if (!isPlainObject(order)) return ''
  const id = typeof order.id === 'string' ? order.id.trim() : ''
  if (id) return id
  return orderKey(order.platform, order.trackingNo)
}

/** 判断字段"非空"（null/undefined/空串都算空） */
function isEmptyValue(value) {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  if (isPlainObject(value)) return Object.keys(value).length === 0
  return false
}

/**
 * 判断一个 tracking 是不是"空占位"。
 * 平台适配器每次都会回一个 tracking 骨架 { ok:false, state:'', status:'unknown', traces:[], ... }，
 * 它不是新信息 —— 直接覆盖会把之前查到的真实轨迹抹掉。
 * @param {any} tracking
 * @returns {boolean}
 */
export function isEmptyTracking(tracking) {
  if (!isPlainObject(tracking)) return true
  if (tracking.ok === true) return false
  if (Array.isArray(tracking.traces) && tracking.traces.length > 0) return false
  if (tracking.state) return false
  if (tracking.status && tracking.status !== 'unknown') return false
  return true
}

/**
 * 按 id 合并两个订单数组：
 * - incoming 的**非空**字段覆盖 existing
 * - existing 的 tracking 缓存保留（incoming 没带 tracking 时不丢）
 * - incoming 带 tracking 时合并（保留 existing 的 traces，追加新的）
 */
export function mergeOrders(existing, incoming) {
  const out = new Map()
  const list = Array.isArray(existing) ? existing : []
  for (const item of list) {
    if (!isPlainObject(item)) continue
    const id = orderId(item)
    if (!id) continue
    out.set(id, { ...item })
  }

  const incomingList = Array.isArray(incoming) ? incoming : []
  for (const item of incomingList) {
    if (!isPlainObject(item)) continue
    const id = orderId(item)
    if (!id) continue
    const prev = out.get(id)
    if (!prev) {
      out.set(id, { ...item, id })
      continue
    }
    const merged = { ...prev }
    for (const [key, value] of Object.entries(item)) {
      if (key === 'tracking') continue // tracking 单独处理
      if (isEmptyValue(value)) continue // incoming 的空字段不覆盖
      merged[key] = value
    }
    merged.id = id
    // tracking：incoming 带真实轨迹就用 incoming；只是空占位骨架 → 保留旧的
    if (isPlainObject(item.tracking)) {
      const prevTracking = isPlainObject(prev.tracking) ? prev.tracking : null
      if (isEmptyTracking(item.tracking) && prevTracking) {
        merged.tracking = prevTracking
      } else {
        const nextTracking = { ...item.tracking }
        if (!Array.isArray(nextTracking.traces) && prevTracking && Array.isArray(prevTracking.traces)) {
          nextTracking.traces = prevTracking.traces
        }
        merged.tracking = nextTracking
      }
    } else if (prev.tracking !== undefined) {
      merged.tracking = prev.tracking
    }
    out.set(id, merged)
  }
  return Array.from(out.values())
}

/**
 * 去重：同 (platform, trackingNo) 只保留**最新**的一条（updatedAt 大者胜）。
 * 没有任何运单号的条目（trackingNo 为空）按 id 保留。
 */
export function dedupeOrders(orders) {
  const list = Array.isArray(orders) ? orders : []
  const byKey = new Map()
  const result = []
  for (const item of list) {
    if (!isPlainObject(item)) continue
    const trackingNo = typeof item.trackingNo === 'string' ? item.trackingNo.trim() : ''
    if (!trackingNo) {
      result.push(item)
      continue
    }
    const key = orderKey(item.platform, trackingNo)
    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, item)
      result.push(item)
      continue
    }
    const prevAt = Number(prev.updatedAt) || 0
    const nextAt = Number(item.updatedAt) || 0
    const idx = result.indexOf(prev)
    if (nextAt > prevAt) {
      if (idx >= 0) result[idx] = item
      byKey.set(key, item)
    }
  }
  return result
}

/** 排序：在途优先 → 同组按 updatedAt 倒序（新的在前） */
export function sortOrders(orders) {
  const list = Array.isArray(orders) ? [...orders] : []
  return list.sort((a, b) => {
    const sa = normalizeStatus(a && a.status)
    const sb = normalizeStatus(b && b.status)
    const ra = STATUS_RANK[sa] ?? 3
    const rb = STATUS_RANK[sb] ?? 3
    if (ra !== rb) return ra - rb
    const ta = Number(a && a.updatedAt) || 0
    const tb = Number(b && b.updatedAt) || 0
    if (ta !== tb) return tb - ta
    // 稳定兜底：按 id 字典序，保证同分时顺序确定
    return String((a && a.id) || '').localeCompare(String((b && b.id) || ''))
  })
}

/** 汇总：{ total, inTransit, delivered, unknown } */
export function summarize(orders) {
  const list = Array.isArray(orders) ? orders : []
  let inTransit = 0
  let delivered = 0
  let unknown = 0
  let pending = 0
  for (const item of list) {
    const s = normalizeStatus(item && item.status)
    if (s === 'in_transit') inTransit += 1
    else if (s === 'delivered') delivered += 1
    else if (s === 'pending') pending += 1
    else unknown += 1
  }
  return {
    total: list.length,
    inTransit,
    delivered,
    unknown: unknown + pending,
    pending,
  }
}
