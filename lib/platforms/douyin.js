/**
 * dsh-parcel-tracker — 抖音订单适配器（B 组 / lib/platforms/douyin.js）
 *
 * 实测（无登录态）：`https://aweme.snssdk.com/aweme/v1/order/list/?count=10`
 *   → {"status_code":1,"message":"Url does not match"}
 * 说明：抖音开放平台订单接口需要 access_token + 签名，默认端点只是起点；
 *       用户可在设置页覆盖 endpoint/headers/body。
 *       解析侧不依赖抖音的具体响应结构（通用深扫）；
 *       status 为数字时的启发式映射见 index.js 的 PLATFORM_STATUS_MAP。
 */

import { request } from './http.js'
import { finishFetch } from './index.js'

export const platform = 'douyin'
export const name = '抖音'
export const nameEn = 'Douyin'
export const defaultEndpoint = 'https://aweme.snssdk.com/aweme/v1/order/list/?count=10&offset=0'
export const defaultHeaders = {
  Accept: 'application/json',
  Referer: 'https://www.douyin.com/',
  Origin: 'https://www.douyin.com',
}
export const defaultMethod = 'GET'
export const defaultBody = ''

/**
 * @param {object} cfg 平台 config（额外可带 phone）
 * @returns {Record<string,string>}
 */
export function buildParams(cfg = {}) {
  const params = { count: '10', offset: '0' }
  const phone = String(cfg.phone || '').trim()
  const phoneParam = String(cfg.phoneParam || '').trim()
  if (phone && phoneParam) params[phoneParam] = phone
  return params
}

/**
 * @param {object} cfg 平台 config
 * @param {object} ctx { logger, signal, timeoutMs }
 * @returns {Promise<{ok:boolean,orders:any[],error:string}>}
 */
export async function fetchOrders(cfg = {}, ctx = {}) {
  const pc = { ...(cfg || {}) }
  try {
    const endpoint = String(pc.endpoint || '').trim() || defaultEndpoint
    const method = String(pc.method || '').trim().toUpperCase() || defaultMethod
    const params = buildParams(pc)
    const res = await request(
      platform,
      {
        ...pc,
        endpoint,
        method,
        params,
        defaultHeaders,
        defaultBody,
      },
      ctx,
    )
    if (!res.ok && !res.json) return { ok: false, orders: [], error: res.error || `http-${res.status}` }
    return await finishFetch(res, pc, platform)
  } catch (err) {
    return { ok: false, orders: [], error: err && err.message ? err.message : String(err) }
  }
}

export default {
  platform,
  name,
  nameEn,
  defaultEndpoint,
  defaultHeaders,
  defaultMethod,
  defaultBody,
  buildParams,
  fetchOrders,
}
