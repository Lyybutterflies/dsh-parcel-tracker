# dsh-parcel-tracker 团队契约（唯一事实来源，组员只读，不得修改）

目标：DSH 插件，在 Web 侧边栏同时显示「手机号绑定的抖音 / 京东 / 淘宝 / 拼多多」四家平台的在途快递（运单号 + 快递轨迹）。

## 目录与文件归属（禁止跨组改文件）

```
dsh-parcel-tracker/
  package.json          ← A
  cordis.patch.yml      ← A
  index.js              ← A   host 入口 export function apply(ctx)
  lib/config.js         ← A   默认配置 + 校验 + 掩码
  lib/store.js          ← A   JSON 持久化
  lib/aggregate.js      ← A   合并/去重/状态归一
  lib/server.js         ← A   HTTP 路由注册
  lib/carriers.js       ← C   快递公司编码映射 + 前缀猜测
  lib/kuaidi100.js      ← C   快递100 查询客户端 + 缓存
  lib/platforms/index.js← B   适配器注册表
  lib/platforms/http.js ← B   共享 fetch 封装
  lib/platforms/taobao.js ← B
  lib/platforms/jd.js     ← B
  lib/platforms/douyin.js ← B
  lib/platforms/pdd.js    ← B
  client.js             ← D   web 端（纯 JS，无构建工具）
  locale/en.json        ← D
  locale/zh.json        ← D
  icon.svg              ← D
  README.md             ← D
```

## Node / 环境约束（重要）

- 只能 **纯 JS ESM**，不引入任何构建工具（本机无 esbuild/tsdown/typescript，npm 不在 PATH）。
- Node 运行时：`D:\deepseek\resources\runtime\primary-runtime\dependencies\node\bin\node.exe`（可执行 `node --check <file>` 做语法检查）。
- PowerShell 5.1 即可（无 pwsh）。无 git、无 pwsh。Python：`C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe`。
- 网络：`web_search` 不可用，用 `web_fetch` 或 node `fetch`。
- DSH host 端可用 ctx 服务：`ctx.webServer`、`ctx.effect`、`ctx.get`、`ctx.on`、`ctx.provide`、`ctx.inject`、`ctx.logger`、`ctx.connection`。
- 状态文件目录：优先 `process.env.DSH_PROFILE_DIR`（profile 目录），回退 `path.join(os.homedir(), '.dsh')`；插件数据放 `<base>/parcel-tracker/`。

## 统一数据形状

### Config（持久化在 state.json 的 `config` 字段）

```js
{
  phone: '',                    // 用户手机号（显示 + 传给平台做收件人过滤）
  refreshMinutes: 15,           // 订单轮询间隔
  trackRefreshMinutes: 10,      // 轨迹轮询间隔
  showDelivered: true,          // 是否显示已签收
  trackEnabled: true,           // 是否查快递轨迹
  carrierOverrides: {},         // { [trackingNo]: 'jd' } 手动指定快递公司码
  manualOrders: [],             // 见下 Order
  platforms: {
    taobao: { enabled: true, cookie: '', endpoint: '', method: 'GET', headers: {}, body: '', phoneParam: '', orderListPath: '', carrierNameMap: {} },
    jd:     { ...同构 },
    douyin: { ...同构 },
    pdd:    { ...同构 }
  }
}
```

- `cookie`：该平台的登录态 Cookie 字符串（用户自己填），**必须**掩码后再返回给前端（只回传 `cookieSet: true/false` 与长度）。
- `endpoint`：留空 = 用内置默认端点；用户可覆盖（应对接口变更）。
- `orderListPath`：从响应里取订单数组的 JSON 路径，如 `data.list`；留空 = 自动深扫。
- `phoneParam`：把手机号放进哪个请求参数名（如 `mobile` / `receiverPhone`）；留空 = 不传。
- `carrierNameMap`：把平台返回的公司名映射到快递100 公司码，如 `{"中通快递":"zto"}`。

### Order（归一后的订单；聚合、去重后的唯一条目）

```js
{
  id: 'taobao:JDVA001234567',   // 稳定 id：platform + ':' + trackingNo
  platform: 'taobao',            // taobao | jd | douyin | pdd | manual
  title: '商品标题',
  trackingNo: 'JDVA001234567',
  carrier: 'jd',                 // 快递100 公司码，'' = 未知
  carrierName: '京东物流',
  status: 'in_transit',          // pending | in_transit | delivered | unknown
  statusText: '运输中',
  createdAt: 1730000000000,      // epoch ms，可为 null
  updatedAt: 1730000000000,
  tracking: {
    ok: true,
    state: '303',                // 快递100 state 字符串
    status: 'delivered',         // 归一状态：pending|in_transit|delivered|unknown
    traces: [ { time: '2024-08-08 16:46:03', context: '快件已签收' } ],
    fetchedAt: 1730000000000,
    error: ''
  },
  error: ''                      // 抓取该订单失败的说明（平台级错误）
}
```

### TrackingResult（快递100 原始归一）

```js
{ ok: boolean, state: string, status: 'pending'|'in_transit'|'delivered'|'unknown',
  traces: [{ time, context }], fetchedAt: number, error: string }
```

## HTTP API（host 暴露，前端同源调用；路径前缀 `/dsh-parcel`）

| 方法 | 路径 | 请求体 | 响应 |
|---|---|---|---|
| GET | `/dsh-parcel/state` | - | `{ ok, config(掩码), orders, updatedAt, nextRefreshAt, running, errors[] }` |
| GET | `/dsh-parcel/orders` | - | `{ ok, orders, updatedAt }` |
| POST | `/dsh-parcel/refresh` | `{ platforms?: string[] }` | `{ ok, orders, updatedAt, errors[] }` |
| GET | `/dsh-parcel/config` | - | `{ ok, config(掩码) }` |
| POST | `/dsh-parcel/config` | 完整 config | `{ ok, config(掩码) }` |
| POST | `/dsh-parcel/track` | `{ trackingNo, carrier? }` | `{ ok, tracking }` |
| POST | `/dsh-parcel/manual-order` | `{ platform?, title, trackingNo, carrier?, createdAt? }` | `{ ok, order }` |
| POST | `/dsh-parcel/manual-order/delete` | `{ id }` | `{ ok }` |
| GET | `/dsh-parcel/carriers` | - | `{ ok, carriers: [{code,name}] }`（供前端下拉） |

响应统一 `Content-Type: application/json; charset=utf-8`；错误返回 `{ ok:false, error:'...' }` + HTTP 200（前端统一处理），只有路由不存在才 404。

## 快递100 契约（C 组实现，B/A 调用）

- 端点：`https://www.kuaidi100.com/query?type=<carrier>&postid=<trackingNo>`
- **免 key 模式下 `type=auto`/`all` 不可用**，必须显式公司码；公司码查不到时用 `lib/carriers.js` 的 `guessCarrier(trackingNo)` 猜，猜不到则 `carrier=''` 并在 UI 提示用户手选。
- 归一：`state` 字段 → `status`：`200`=待揽收→pending；`201`/`202`/`203`/`204`/`205`/`206`/`207`/`208`/`209`/`210`→in_transit；`300`/`303`/`301`/`302`/`304`/`305`/`306`/`307`/`308`/`309`/`310`/`311`→delivered；其他→unknown。
- `data[]` 数组每项 `{ time, ftime, context, location }` → `traces[]`（ftime 优先）。
- 缓存：同 (carrier, trackingNo) 在 TTL 内不重复请求（默认 5 分钟），防止触发频率限制。
- 必须设置请求超时（默认 10s）与 `User-Agent`；失败返回 `{ ok:false, error }` 而不是抛异常。

## 平台适配器契约（B 组实现，A 调用）

`lib/platforms/index.js` 导出：

```js
export const PLATFORMS = ['taobao', 'jd', 'douyin', 'pdd']
export function getAdapter(platform)   // 返回 { platform, name, nameEn, defaultEndpoint, defaultHeaders, defaultMethod, fetchOrders(cfg, ctx) }
export async function fetchAllPlatformOrders(cfg, ctx) // 返回 { orders: Order[], errors: {platform, message}[] }
```

- `fetchOrders(cfg, ctx)`：
  - `cfg` = 该平台的 config（cookie / endpoint / headers / body / phoneParam / orderListPath / carrierNameMap）。
  - `ctx` = `{ logger, signal, timeoutMs }`。
  - 返回 `{ ok, orders: Order[], error }`；**永远不抛异常**。
  - 缺 cookie → `{ ok:false, error:'missing-cookie' }`，不发起请求。
  - 统一用 `lib/platforms/http.js` 的 `request()`（带 UA、超时、UA/Referer 默认头、错误捕获）。
- **归一策略（关键）**：四家平台接口未公开文档且带签名，响应结构会变。所以采用「**通用深扫提取**」而不是硬编码字段：
  - 在响应 JSON 里递归遍历，找到包含运单号字段的对象；运单号候选字段名正则：`/(mailNo|trackingNo|waybillCode|logisticsNo|shippingId|voucherNo|deliveryNo|expressNo|运单号|快递单号)/i`。
  - 快递公司候选字段正则：`/(expressCompany|carrierCode|deliveryCompany|logisticsName|shippingType|companyName)/i`，值再用 `carrierNameMap` 映射，否则用 `lib/carriers.js` 的 `companyNameToCode()` 猜。
  - 标题字段正则：`/(goodsName|productName|itemName|title|subject|orderTitle)/i`。
  - 状态字段正则：`/(orderStatus|status|state|phase|orderState)/i`，映射到 pending/in_transit/delivered/unknown。
  - 时间字段正则：`/(createTime|orderTime|create_time|orderCreateTime|payTime|createDate)/i`，字符串转 epoch ms。
  - 若用户填了 `orderListPath`，先按路径取数组，再在数组元素内深扫；否则整棵树深扫。
  - 去掉明显不是运单号的值：长度 < 6 或 > 40、纯数字且长度 > 15 的订单号（除非平台已知是运单号）、含中文但不含「运单/快递」的字符串。
- 每个平台内置默认端点（可被用户覆盖）。已知公开端点（无登录态时基本拿不到数据，但仍作为默认起点）：
  - 淘宝 `https://h5api.m.taobao.com/h5/mtop.taobao.wireless.order.list.get/1.0/`
  - 京东 `https://api.m.jd.com/client.action?functionId=orderList&appid=pc-item-soa`
  - 抖音 `https://aweme.snssdk.com/aweme/v1/order/list/?count=10`
  - 拼多多 `https://mobile.yangkeduo.com/proxy/api/order/list`
  各自默认 headers 带合理 UA / Referer / Accept。
- 平台名（中文/英文）：淘宝 Taobao、京东 JD、抖音 Douyin、拼多多 Pinduoduo。

## 前端契约（D 组实现，client.js）

- 纯 JS，格式必须是：
  ```js
  window.__ModuleLoader__.load({ id: 'dsh-parcel-tracker', factory(require) {
    const React = require('react'); const h = React.createElement;
    return { inject: ['slots', 'locale'], apply(ctx) { /* ... */ } }
  } })
  ```
  React 从宿主 module table 取，**不要**引入任何 `@deepseek-ai/dsh-client-ui-*` 包，也不要 CDN。
- 注册三个 slot：
  1. `sidebar.panellist` → `{ name:'sidebar.panellist', id:'parcel-tracker', order: 100, label: () => t('panelTitle') }`（侧边栏图标，自绘 SVG）。
  2. `main` → `{ name:'main', key:'parcel-tracker' }`（中央主面板，key 必须与 panellist 的 id 一致）。
  3. `settings.section` → `{ name:'settings.section', id:'parcel-tracker', order: 40, label: () => t('settingsTitle') }`。
- 文案走 `ctx.locale.register('dsh-parcel-tracker', { zh, en })` + `ctx.locale.bind('dsh-parcel-tracker')`；中英文都要完整。
- 样式只用 `--dsw-alias-*` 主题 token，禁止硬编码颜色（ artwork SVG 除外）。
- 数据来源：`fetch('/dsh-parcel/state')`、`POST '/dsh-parcel/config'`、`POST '/dsh-parcel/refresh'` 等（相对路径，同源）。
- 面板内容：手机号、平台开关（淘宝/京东/抖音/拼多多）、每个平台的在途快递卡片（运单号、快递公司、最新一条轨迹、时间）、未识别快递公司的下拉手选、手动添加运单号、刷新按钮、设置项（手机号、各平台 Cookie、刷新间隔、显示已签收）。
- 空状态要有明确文案（未配置 / 无在途 / 平台登录态失效）。
- 组件内不要 `document.body.appendChild`，不要自己写 `<html>`。

## 交付要求（每个组员）

1. 只创建/修改自己负责的文件（见上表）。
2. 写完用 `node --check <file>` 检查每个 JS 文件语法（client.js 也要），必须全过。
3. 写一份简短的中文说明：实现了哪些文件、关键函数签名、已知限制（明确写「未验证」的不要写成已验证）。
4. 完成后用 `send_message` 把总结发给 `lead`（target: `lead`），不要直接回给用户。
