/**
 * lib/carriers.js —— 快递100 官方公司码表 + 名称/单号反查（C 组）
 *
 * 数据来源：快递100 官方公司注册表
 *   https://www.kuaidi100.com/company.do?method=js&t=202605280001
 * 原始文件留档：scripts/_company.raw.js（var jsoncom={'company':[...]}）
 * 全表 CARRIER_TOTAL 家，本文件全量收录为 CARRIERS（去重、按 type 再按 code 排序）。
 *
 * type 语义（快递100 注册表字段）：0=国内运输商，1=国际运输商，2=国内邮政。
 *
 * ⚠️ 关键结论（实测得出，别改回去）：
 *   1. 快递100 的官方码**不是**社区惯用缩写 —— 顺丰={`shunfeng`}（不是 sf）、
 *      中通=`zhongtong`（不是 zto）、申通=`shentong`（不是 sto）、
 *      中通快运=`zhongtongkuaiyun`（不是 ztky）、安能=`annengwuliu`、优速=`youshuwuliu`。
 *   2. 顺丰速运在注册表里是 **type=1**（国际运输商），不是 0。任何"只取 type 0/2"
 *      的过滤都会把顺丰整个丢掉 —— 所以这里**不做 type 过滤**，全量收录。
 *   3. 注册表里**没有**「天天快递」(ttkdex/tiantian)；不要凭记忆写这个码。
 *   4. 用错码时 `GET /query?type=<码>&postid=<单号>` 返回
 *      `{"message":"参数错误","status":"400","state":"0","data":[]}`，
 *      看起来像"查不到"，其实是公司码不存在。
 *   5. 对外输出（查询、存储、下拉选中值）永远是官方码；sf/zto/sto 之类只作为**输入别名**。
 */

/** 官方注册表：[{ code, name, type }]，按 type 升序、再按 code 升序。 */
export const CARRIERS = CARRIERS_PLACEHOLDER

/** 全表条数（构建时写入，便于自检） */
export const CARRIER_TOTAL = CARRIER_COUNT

/** code -> { code, name, type } */
export const CARRIER_MAP = /* @__PURE__ */ (() => {
  const map = Object.create(null)
  for (const item of CARRIERS) map[item.code] = item
  return map
})()

/**
 * 常用国内快递/快运码 —— 只用于界面下拉默认项与"猜公司"候选，
 * 查询时不限制（用户选了什么就查什么）。顺序按国内使用频率人工排列。
 */
export const COMMON_CODES = [
  'shunfeng',            // 顺丰速运
  'jd',                  // 京东物流
  'zhongtong',           // 中通快递
  'yuantong',            // 圆通速递
  'shentong',            // 申通快递
  'yunda',               // 韵达快递
  'jtexpress',           // 极兔速递
  'youzhengguonei',      // 邮政快递包裹
  'ems',                 // EMS
  'debangkuaidi',        // 德邦快递
  'debangwuliu',         // 德邦物流
  'huitongkuaidi',       // 百世快递
  'baishiwuliu',         // 百世快运
  'annengwuliu',         // 安能快运
  'youshuwuliu',         // 优速
  'suer',                // 速尔快递
  'kuayue',              // 跨越速运
  'zhaijisong',          // 宅急送
  'sxjdfreight',         // 顺心捷达
  'danniao',             // 菜鸟速递
  'jingdongkuaiyun',     // 京东快运
  'shunfengkuaiyun',     // 顺丰快运
  'zhongtongkuaiyun',    // 中通快运
  'yundakuaiyun',        // 韵达快运
  'ztocc',               // 中通冷链
  'yimidida',            // 壹米滴答
  'lianbangkuaidi',      // 联邦快递
  'youzhengdsbk',        // 邮政电商标快
  'youzhengbk',          // 邮政标准快递
  'suning',              // 苏宁物流
  'rrs',                 // 日日顺物流
  'tiandihuayu',         // 天地华宇
  'quanfengkuaidi',      // 全峰快递
  'cess',                // 国通快递
  'xinfengwuliu',        // 信丰物流
]

/** 常用码集合，供 listCarriers 分组 */
export const COMMON_SET = /* @__PURE__ */ (() => {
  const set = new Set()
  for (const code of COMMON_CODES) if (CARRIER_MAP[code]) set.add(code)
  return set
})()

/**
 * 输入别名 → 官方码。只收录「社区惯用叫法与官方码不一致」的高频项；
 * 键在构建时统一小写并去掉非字母数字/CJK 字符。
 */
export const CARRIER_ALIASES = /* @__PURE__ */ (() => {
  const raw = {
    sf: 'shunfeng',
    sfexpress: 'shunfeng',
    shunfengsuyun: 'shunfeng',
    sfky: 'shunfengkuaiyun',
    zto: 'zhongtong',
    zt: 'zhongtong',
    zhongtong: 'zhongtong',
    ztky: 'zhongtongkuaiyun',
    sto: 'shentong',
    st: 'shentong',
    shentong: 'shentong',
    yto: 'yuantong',
    yt: 'yuantong',
    yuantong: 'yuantong',
    yd: 'yunda',
    yunda: 'yunda',
    jt: 'jtexpress',
    jnt: 'jtexpress',
    jdl: 'jd',
    jdlogistics: 'jd',
    jingdong: 'jd',
    ems: 'ems',
    chinapost: 'youzhengguonei',
    yzgn: 'youzhengguonei',
    youzheng: 'youzhengguonei',
    db: 'debangkuaidi',
    dbwl: 'debangwuliu',
    debang: 'debangwuliu',
    ane: 'annengwuliu',
    anneng: 'annengwuliu',
    zjs: 'zhaijisong',
    best: 'huitongkuaidi',
    huitong: 'huitongkuaidi',
    bs: 'huitongkuaidi',
    baishi: 'huitongkuaidi',
    ky: 'kuayue',
    shunxin: 'sxjdfreight',
    cainiao: 'danniao',
    daniao: 'danniao',
    uc: 'youshuwuliu',
    yousu: 'youshuwuliu',
    ymdd: 'yimidida',
    tiantian: 'guoeryue',
    fedex: 'lianbangkuaidi',
    ups: 'ups',
    dhl: 'dhl',
    usps: 'usps',
  }
  const map = Object.create(null)
  for (const key of Object.keys(raw)) map[normalizeToken(key)] = raw[key]
  return map
})()

/** 名称归一时剔除的通用后缀/噪音词（先长后短，避免「快递」抢在「快递公司」前面）。 */
const NAME_NOISE = [
  '股份有限公司', '有限责任公司', '有限公司', '集团', '公司',
  '国际', '国内', '标准', '电商', '冷链', '大件',
  '快递物流', '物流运输', '快运物流', '速递物流',
  '快递', '速递', '速运', '物流', '快运', '包裹', '运输', '服务', '货运',
]

/** 去掉所有非字母数字/非 CJK 字符并转小写，用于比较。 */
function normalizeToken(input) {
  return String(input == null ? '' : input)
    .toLowerCase()
    .replace(/[^0-9a-z\u4e00-\u9fff]/g, '')
}

/** 再剥掉通用后缀，得到"品牌核心词"。 */
function stripNoise(norm) {
  let out = norm
  for (const word of NAME_NOISE) {
    const w = normalizeToken(word)
    if (!w) continue
    if (out.includes(w)) out = out.split(w).join('')
  }
  return out
}

/** 预构建「归一化名称 -> code」与「核心词 -> code」索引（首次调用时构建一次）。 */
let NAME_INDEX = null
let CORE_INDEX = null
/** 常用码优先级：数字越小越常用（用于消解「顺丰」该落到 shunfeng 还是 shunfengkuaiyun）。 */
const COMMON_RANK = /* @__PURE__ */ (() => {
  const rank = Object.create(null)
  COMMON_CODES.forEach((code, i) => { rank[code] = i })
  return rank
})()
function rankOf(code) {
  const r = COMMON_RANK[code]
  return r === undefined ? 1e6 : r
}
function nameIndexes() {
  if (NAME_INDEX) return { nameIndex: NAME_INDEX, coreIndex: CORE_INDEX }
  const nameIdx = Object.create(null)
  const coreIdx = Object.create(null)
  const coreRank = Object.create(null)
  for (const item of CARRIERS) {
    const norm = normalizeToken(item.name)
    if (norm && nameIdx[norm] === undefined) nameIdx[norm] = item.code
    const core = stripNoise(norm)
    if (core.length < 2) continue
    // 同名核心词冲突时（顺丰速运 / 顺丰快运 → 顺丰），选更常用、且名字更短的那个
    const prev = coreIdx[core]
    if (prev === undefined) {
      coreIdx[core] = item.code
      coreRank[core] = rankOf(item.code)
      continue
    }
    const prevRank = coreRank[core]
    const nextRank = rankOf(item.code)
    if (nextRank < prevRank) { coreIdx[core] = item.code; coreRank[core] = nextRank }
  }
  NAME_INDEX = nameIdx
  CORE_INDEX = coreIdx
  return { nameIndex: nameIdx, coreIndex: coreIdx }
}

/**
 * 公司名（中文/英文/别名/带后缀）→ 官方码。匹配不到返回 ''。
 * 顺序：本身是官方码 → 别名表 → 归一化名称精确命中 → 核心词命中 → 最长包含。
 * @param {string} raw
 * @returns {string}
 */
export function companyNameToCode(raw) {
  const text = String(raw == null ? '' : raw).trim()
  if (!text) return ''
  const lower = text.toLowerCase()
  if (CARRIER_MAP[lower]) return lower
  const token = normalizeToken(text)
  if (!token) return ''
  if (CARRIER_MAP[token]) return token
  const aliased = CARRIER_ALIASES[token]
  if (aliased && CARRIER_MAP[aliased]) return aliased
  const { nameIndex, coreIndex } = nameIndexes()
  if (nameIndex[token]) return nameIndex[token]
  const core = stripNoise(token)
  if (core.length >= 2) {
    if (coreIndex[core]) return coreIndex[core]
    if (nameIndex[core]) return nameIndex[core]
  }
  // 最长包含：「顺丰快运」不能被「顺丰」抢走，所以取命中长度最大的
  let bestCode = ''
  let bestLen = 0
  for (const item of CARRIERS) {
    const key = normalizeToken(item.name)
    if (key.length < 2 || key.length <= bestLen) continue
    if (token.includes(key)) { bestLen = key.length; bestCode = item.code }
  }
  if (bestCode) return bestCode
  if (core.length >= 2) {
    bestLen = 0
    for (const item of CARRIERS) {
      const key = stripNoise(normalizeToken(item.name))
      if (key.length < 2 || key.length <= bestLen) continue
      if (core.includes(key)) { bestLen = key.length; bestCode = item.code }
    }
    if (bestCode) return bestCode
  }
  return ''
}

/**
 * 依据运单号前缀/形态猜官方码（启发式，允许失败返回 ''）。
 * 只保留**前缀唯一**的规则；纯数字 12/13 位被圆通/中通/申通/韵达共用，故意不猜 ——
 * 错猜会把轨迹查成"参数错误/查无结果"，比让用户手选更糟。
 * @param {string} trackingNo
 * @returns {string}
 */
export function guessCarrier(trackingNo) {
  const no = String(trackingNo == null ? '' : trackingNo).trim().toUpperCase().replace(/[\s-]/g, '')
  if (no.length < 6 || no.length > 40) return ''
  // 顺丰：SF + 数字
  if (/^SF\d/.test(no)) return 'shunfeng'
  // 京东：JD 开头（JDVA/JD00/JDLD…）；含 KY 归京东快运
  if (/^JD/.test(no)) return /KY\d/.test(no) ? 'jingdongkuaiyun' : 'jd'
  // 极兔：JT 开头
  if (/^JT\d/.test(no) || /^JTX/.test(no)) return 'jtexpress'
  // 圆通：YT 开头
  if (/^YT\d/.test(no)) return 'yuantong'
  // 中通：ZT 开头（ZTKY 归中通快运）
  if (/^ZT/.test(no)) return /^ZTKY/.test(no) ? 'zhongtongkuaiyun' : 'zhongtong'
  // 申通：ST 开头
  if (/^ST\d/.test(no)) return 'shentong'
  // 韵达：YD / YN 开头
  if (/^(YD|YN)\d/.test(no)) return 'yunda'
  // 德邦：DPK / DEPPON / DB+数字
  if (/^(DPK|DEPPON)/.test(no) || /^DB\d/.test(no)) return 'debangkuaidi'
  // 宅急送
  if (/^ZJS/.test(no)) return 'zhaijisong'
  // 跨越速运
  if (/^KY\d/.test(no) || /^KUAYUE/.test(no)) return 'kuayue'
  // 百世 / 汇通
  if (/^(HT|BEST)/.test(no)) return 'huitongkuaidi'
  // 安能
  if (/^(ANE|ANNENG)/.test(no)) return 'annengwuliu'
  // 顺心捷达
  if (/^SXJD/.test(no)) return 'sxjdfreight'
  // 菜鸟速递
  if (/^(DN|CAINIAO)/.test(no)) return 'danniao'
  // 优速
  if (/^UC\d/.test(no) || /^YOUSU/.test(no)) return 'youshuwuliu'
  // 速尔
  if (/^(SE\d|SUER)/.test(no)) return 'suer'
  // 壹米滴答
  if (/^(YMDD|YIMI)/.test(no)) return 'yimidida'
  // 加运美
  if (/^(JYM|JIAYUN)/.test(no)) return 'jiayunmeiwuliu'
  // 苏宁
  if (/^(SN\d|SUNING)/.test(no)) return 'suning'
  // 邮政/EMS：EA/EB/… + 9 位数字 + CN
  if (/^(EA|EB|ED|EE|EF|EG|EH|EJ|EK|EL|EM|EN|EO|EP|EQ|ER|ES|ET|EU|EV|EW|EX|EY|EZ)\d{9}CN$/.test(no)) return 'ems'
  // 邮政包裹：LP + 数字 + CN，或 9 位数字 + CN
  if (/^LP\d{8,11}CN$/.test(no) || /^\d{9}CN$/.test(no)) return 'youzhengguonei'
  return ''
}

/** guessCarrier 的历史别名（lib/index.js 会依次尝试多个导出名）。 */
export const guessCarrierCode = guessCarrier
export const carrierFromTrackingNo = guessCarrier

/**
 * 供前端下拉：默认「常用在前、其余在后」，都带 name/type。
 * @param {{ commonOnly?: boolean, limit?: number }} [options]
 * @returns {{code:string,name:string,type:number}[]}
 */
export function listCarriers(options) {
  const opts = options || {}
  if (opts.commonOnly) {
    return COMMON_CODES
      .filter((code) => CARRIER_MAP[code])
      .map((code) => ({ code, name: CARRIER_MAP[code].name, type: CARRIER_MAP[code].type }))
  }
  const common = []
  const rest = []
  for (const item of CARRIERS) {
    if (COMMON_SET.has(item.code)) common.push(item)
    else rest.push(item)
  }
  common.sort((a, b) => COMMON_CODES.indexOf(a.code) - COMMON_CODES.indexOf(b.code))
  const all = common.concat(rest)
  return opts.limit > 0 ? all.slice(0, opts.limit) : all
}

/** 是否为官方注册表里的合法码。 */
export function isValidCarrier(code) {
  return Boolean(CARRIER_MAP[String(code == null ? '' : code).trim().toLowerCase()])
}

/** 官方码 → 中文名（查不到回落到码本身）。 */
export function carrierNameOf(code) {
  const item = CARRIER_MAP[String(code == null ? '' : code).trim().toLowerCase()]
  return item ? item.name : String(code == null ? '' : code)
}

/** 兼容导出：lib/index.js 会依次尝试 CARRIERS / CARRIER_LIST / CARRIER_MAP。 */
export const CARRIER_LIST = CARRIERS
