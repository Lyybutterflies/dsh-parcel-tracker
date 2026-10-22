/**
 * lib/store.js —— JSON 持久化（<base>/parcel-tracker/state.json）
 *
 * 并发安全：同一进程内所有写操作走一条 Promise 串行队列，
 * 避免"定时刷新"和"前端手动刷新"同时写坏文件。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { normalizeConfig } from './config.js'

/** 数据子目录名（契约：插件数据放 <base>/parcel-tracker/） */
export const DATA_DIR_NAME = 'parcel-tracker'

/** 状态文件名 */
export const STATE_FILE_NAME = 'state.json'

/**
 * 数据根目录：优先 DSH_HOME（跨 profile 共享配置更合理），其次 DSH_PROFILE_DIR，最后 ~/.dsh
 */
export function resolveBaseDir() {
  const home = process.env.DSH_HOME
  if (typeof home === 'string' && home.trim()) return path.resolve(home.trim())
  const profile = process.env.DSH_PROFILE_DIR
  if (typeof profile === 'string' && profile.trim()) return path.resolve(profile.trim())
  return path.join(os.homedir(), '.dsh')
}

/** 状态文件完整路径：<base>/parcel-tracker/state.json */
export function resolveStatePath() {
  return path.join(resolveBaseDir(), DATA_DIR_NAME, STATE_FILE_NAME)
}

/** 空状态骨架 */
export function emptyState() {
  return { config: normalizeConfig(null), orders: [], updatedAt: 0 }
}

/**
 * 进程内写队列：所有写操作串行执行。
 * chain 永远是「已完成」的 promise，下一个任务挂在它的 then 上。
 */
let writeChain = Promise.resolve()

/** 把 fn 挂进串行队列，返回 fn 的结果 promise */
export function enqueueWrite(fn) {
  const run = writeChain.then(() => fn())
  // 队列本身不能因为某次写失败而中断：接一个 catch 保持链活着
  writeChain = run.then(() => undefined, () => undefined)
  return run
}

/** 原子写：写同目录 tmp 文件 → rename 覆盖 */
function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath)
  try { fs.mkdirSync(dir, { recursive: true }) } catch (err) { /* 交给下面的写入报错 */ }
  const text = JSON.stringify(data, null, 2)
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`)
  fs.writeFileSync(tmp, text, 'utf8')
  try {
    fs.renameSync(tmp, filePath)
  } catch (err) {
    try { fs.unlinkSync(filePath) } catch (e2) {}
    fs.renameSync(tmp, filePath)
  }
}

/** 读状态；文件不存在/损坏返回空骨架 */
export function readState() {
  const file = resolveStatePath()
  try {
    const text = fs.readFileSync(file, 'utf8')
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyState()
    return {
      config: normalizeConfig(parsed.config),
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    }
  } catch (err) {
    return emptyState()
  }
}

/** 写状态（原子 + 串行）；返回写入后的状态对象 */
export function writeState(state) {
  const payload = {
    config: normalizeConfig(state && state.config),
    orders: Array.isArray(state && state.orders) ? state.orders : [],
    updatedAt: typeof (state && state.updatedAt) === 'number' ? state.updatedAt : Date.now(),
  }
  return enqueueWrite(() => {
    atomicWriteJson(resolveStatePath(), payload)
    return payload
  })
}

/** 只读订单数组 */
export function readOrders() {
  const state = readState()
  return Array.isArray(state.orders) ? state.orders : []
}

/** 只写订单数组（保留 config 与 updatedAt） */
export function writeOrders(orders) {
  return enqueueWrite(() => {
    const current = readState()
    const payload = {
      config: current.config,
      orders: Array.isArray(orders) ? orders : [],
      updatedAt: Date.now(),
    }
    atomicWriteJson(resolveStatePath(), payload)
    return payload
  })
}
