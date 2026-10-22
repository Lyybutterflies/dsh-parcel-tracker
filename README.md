# dsh-parcel-tracker

DSH 插件：把**抖音 / 京东 / 淘宝 / 拼多多**四家平台的在途快递聚合到一屏，侧边栏一个图标点开即是汇总面板，快递轨迹用快递100 免 key 通道补齐。

## 它能做什么

| 能力 | 说明 |
|---|---|
| 四平台聚合 | 侧边栏「快递聚合」面板按平台分组列出在途快递，标出最新轨迹与状态 |
| 轨迹补全 | 拿到运单号后调快递100 查轨迹；公司码自动从平台返回的公司名映射（`顺丰速运 → shunfeng`） |
| 淘宝自动补运单号 | 淘宝订单列表本身不含运单号，插件会对「待收货」订单逐个调 mtop 物流接口（`mtop.taobao.logistics.detailorlist.query`，自己算 `sign`），拿到真实运单号与快递公司；单次最多查 8 单 |
| 京东自动补运单号 + 轨迹 | 京东订单列表走 `pcorder_center_list`（**不需要 h5st**），逐单走 `pcorder_center_traceMultiPackage` 取 `shipId`（运单号）、`thirdName`（快递公司）和**京东自家的完整轨迹**；有京东轨迹时优先用它，不再打快递100（省配额、避开 IP 限流）。单次最多查 12 单 |
| 拼多多自动补运单号 + 轨迹 | 拼多多 H5 是**服务端渲染**的，插件直接 GET `orders.html` 解析页面里的 `window.rawData.ordersStore.orders[]` 拿运单号（`trackingNumber`），再逐单 GET `goods_express.html` 拿快递公司（`shippingName`）与完整轨迹。**不需要 `anti_content`**。只跟未完结订单，单次最多查 8 单 |
| 预计送达 | 卡片右上角显示**平台给的**预计送达时间：京东从轨迹文案里抽（「您的订单预计10月23日24:00前送达」），拼多多取 `timeForecast.timeForecastDesc`（「预计明天送达」）。平台没给就不显示，不做本地估算 |
| 公司可改 | 每条运单的快递公司都能手动改：点「更改」输入关键字，从 3080 家官方码表里搜索选择（支持 ↑↓/Enter/Esc） |
| 手动添加 | 任何平台的单号都可手动录入，走同一套轨迹查询 |
| 设置页 | 「设置 → 快递聚合」填手机号、各平台 Cookie、刷新间隔、开关 |
| 定时刷新 | 默认每 15 分钟抓一次订单、每 10 分钟刷一次轨迹；打开面板时也会立刻刷一次 |

## 安装

```powershell
dsh plugin --profile desktop add "link:C:\Users\Administrator\Documents\deepseek-harness\default-workspace\dsh-parcel-tracker"
```

装完**完全重启 DSH**（关闭进程再打开，不是刷新页面），侧边栏才会出现图标。

卸载：

```powershell
dsh plugin --profile desktop remove dsh-parcel-tracker
```

## 上手流程（填完手机号之后做什么）

1. 打开「设置 → 快递聚合」，填手机号、点**保存**。保存后会立刻在后台抓一次订单（不用自己回面板点刷新）。
2. 回到侧边栏「快递聚合」面板：
   - 如果四个平台都还没填 Cookie，面板会明确提示「手机号已保存，但还没配置任何平台的 Cookie，抓不到订单」——这是正确提示，不是 bug；平台私有接口没有 Cookie 拿不到订单。
   - 想全自动聚合：去设置页给至少一个平台粘 Cookie——**用「从浏览器 Copy as cURL 一键导入」，见下一节**，保存后等后台抓取（约几秒）。
   - 只想查某个单号：用面板底部的「手动添加运单号」，不需要任何 Cookie。
3. 订单卡片上会显示运单号、快递公司、最新轨迹；轨迹靠快递100 补齐，点「刷新」可随时重查。

## 各平台 Cookie 怎么拿（推荐：Copy as cURL 一键导入）

三家平台的私有接口情况不同，最省事的办法是一律把浏览器里那条真实请求整段复制进来（签名、Cookie、请求头、请求体一次全带过来）：淘宝要 `_tb_token_` + `_m_h5_tk`（签名插件自己算）、京东只要 Cookie、拼多多连签名都不要（页面服务端渲染，拖整页请求即可）。

1. 用**电脑浏览器**登录目标平台，打开「我的订单」列表页。
2. F12 打开开发者工具 → **Network（网络）** → 刷新页面。
3. 在请求列表里找到返回订单列表的那条（可用过滤框搜关键词）：

   | 平台 | 订单页 | Network 过滤关键词 |
   |---|---|---|
   | 淘宝 | `https://buyertrade.taobao.com/trade/itemlist/list_bought_items.htm`（已买到的宝贝） | `asyncBought`、`buyertrade`、`mtop` |
   | 京东 | `https://order.jd.com/center/list.action`（我的订单，PC 版） | `pcorder_center_list`、`api.m.jd.com` |
   | 抖音 | `https://www.douyin.com/` → 抖音商城 → 我的订单 | `order/list`、`aweme` |
   | 拼多多 | `https://mobile.yangkeduo.com/orders.html`（个人中心 → 全部订单；建议把浏览器切成手机模式） | `orders.html`（整页请求，就是那条 document） |

4. 右键那条请求 → **Copy → Copy as cURL**（bash 或 PowerShell 版本都行）。
5. 回到 DSH：「设置 → 快递聚合」→ 展开对应平台的「**从浏览器 Copy as cURL 一键导入（推荐）**」→ 粘贴 → 点「解析并填入」。
6. 会自动填好 Cookie、接口地址、请求方法、请求头、请求体；点**保存**即可。Cookie 框会显示「已填入（长度 N）」和保存后的「已配置（长度 N）」。

手工兜底：也可以只复制请求头里的完整 `Cookie:` 值粘进 Cookie 框，但**签名参数拿不到**，多数情况下接口会拒绝——所以优先用 cURL 导入。

> 淘宝的特殊之处：内置接口用的是 Cookie（`_tb_token_` 走列表、`_m_h5_tk` 走运单号签名），**不需要你带 `sign`**，所以淘宝的 cURL 随便哪条都行，只要 Cookie 里同时有 `_tb_token_` 和 `_m_h5_tk`（PC 端订单页的任意请求都满足）。

> 京东的特殊之处：内置接口**不需要 `h5st`**（实测把签名参数删掉照样 200），只要 Cookie 里有 `__jda`（用它当 `uuid`）就够了。所以京东拖任意一条 `api.m.jd.com` 的 cURL 进来都行，重点是 Cookie 得是 **PC 端 `order.jd.com` 订单页的登录态**。

> 拼多多的特殊之处：**不需要 `anti_content`**，拖 `orders.html` 那条整页请求（document 类型）就行，插件会解析页面里的 `window.rawData`。订单数据里直接有运单号，但快递公司要逐单开物流详情页才有，所以拼多多单子的轨迹也走拼多多自己的数据、不打快递100。

> 安全说明：Cookie 属于登录态凭据，插件只在本地 `state.json` 里保存，接口返回前端时一律脱敏成 `{cookieSet, cookieLength}`，不会明文回传。

## 配置

打开「设置 → 快递聚合」，至少填 **手机号**，再按需填平台 Cookie。Cookie 从浏览器开发者工具里复制该平台请求的完整 `Cookie` 请求头即可。

四个平台的接口都是平台自家 App/H5 的私有接口，**没有「按手机号查快递」的公开能力**，所以：

- 手机号只作为接口的过滤参数发出去（字段名可在高级设置里改），能不能过滤取决于平台；
- Cookie 决定能不能拿到订单数据，过期就要重填；
- 平台接口会改，改了就调不动 —— 高级设置里可以整段替换接口地址、方法、请求头、请求体、订单列表路径，不用改代码。

## 已知边界（重要，别当成 bug）

1. **快递100 免 key 通道不稳定，且会被 IP 限流。** 免 key 通道必须先建立站点会话 cookie 才会返回真数据；同一单号短时间内重复查，会在「真实轨迹」和「查无结果」占位之间来回跳。**连续试查多个单号后，快递100 会对本机 IP 软封一段时间**，此时所有查询都退化成「查无结果」——这不是插件坏了，等一段时间或填一个快递100 的 Key 即可。插件已做 5 分钟结果缓存、失败不覆盖已有轨迹、面板可手动重试；识别到 `非法访问:IP禁止访问` 会显示「快递100 暂时限制了本机查询（IP 限流）」。
2. **「查无结果」不等于未签收。** 占位响应的 `state` 恰好是 3（签收），插件在解析前会先识别并拦成 `no-result`，不会误报已签收。
3. **快递公司码必须用快递100 官方码**（顺丰是 `shunfeng` 不是 `sf`，中通是 `zhongtong` 不是 `zto`）。`sf`/`zto`/`yt` 之类只作为输入别名。内置 3080 家官方码表。
4. **纯数字运单号不猜公司。** 12/13 位纯数字被圆通/中通/申通/韵达共用，猜错会把轨迹查成"参数错误"，比让你手选更糟。带唯一前缀的（SF/JD/JT/YT/ZT/ST/YD/DPK…）会自动识别；猜错或猜不出来时点卡片上的「更改」，从码表里搜索中文名或代码即可纠正，改完会记住。
5. **平台订单抓取依赖 Cookie，且接口私有。** 首次配置后如果面板显示抓取错误，看设置页的「测试连接」，多半是 Cookie 过期或接口变了。
6. **淘宝：订单和运单号都能自动拿，但需要 PC 登录态 Cookie。** 订单列表走 PC 页真实接口 `POST https://buyertrade.taobao.com/trade/itemlist/asyncBought.htm`（自动从 Cookie 取 `_tb_token_`，GBK 自动解码）；运单号走 mtop 接口 `mtop.taobao.logistics.detailorlist.query`（插件用 Cookie 里的 `_m_h5_tk` 自行计算 `sign=md5(token&t&appKey&data)`，不需要你手动带签名）。实测能拿到「圆通速递 YT7650771822822」这类结果。前提是 Cookie 来自 **PC 浏览器登录态**（在 `buyertrade.taobao.com` 订单页复制的 cURL），从手机 H5 复制来的 Cookie 权限不够。
7. **淘宝有风控，刷新别太勤。** 短时间内反复请求订单列表会返回 `FAIL_SYS_USER_VALIDATE / RGV587_ERROR`（要过滑块验证）。此时到浏览器正常打开一次「已买到的宝贝」页、过几分钟再点刷新；建议保持默认 15 分钟间隔。
8. **京东：订单列表里没有运单号。** 运单号只能从 `pcorder_center_traceMultiPackage` 的 `shipId` 拿，该接口**必须 POST + `body=<JSON 字符串>`**，用 GET 查询参数会返回 `{"success":false,"errCode":"202","errMessage":"数据校验失败"}`。好在它同时返回京东自家的完整轨迹（`orderTrackInfoList`，12–24 条），所以京东单子的轨迹不走快递100，直接显示京东数据，也就不会被快递100 的 IP 限流影响。只跟「等待收货/配送中」这类未完结订单，已完成的自动跳过。
9. **拼多多：靠解析服务端渲染的页面，一单要两个请求。** 订单页 `orders.html` 里 `window.rawData.ordersStore.orders[]` 直接有 `trackingNumber`，但 `shippingName` 是空的 —— 快递公司必须逐单再开 `goods_express.html` 才有（同页也带完整轨迹）。因此单次刷新最多跟 8 单，每单 2 个请求；订单量大时刷新会慢一些（实测 6 单三平台共 3 秒）。另外拼多多 Cookie 有效期偏短，报 `error_code=45001` 基本就是 Cookie 失效，重新拖一次 cURL 即可。
10. **抖音暂不支持自动抓取。** 抖音 PC 网页端没有商城/订单入口（`www.douyin.com` 无论 PC 还是手机 UA 都会跳 `/home`，只有「下载 App」），`haohuo.jinritemai.com` 外部打不开。要用抖音的快递，请在手机 App 里看订单，把运单号用面板底部「手动添加运单号」录进来。
11. **预计送达只有京东、拼多多有。** 京东把它写在**轨迹文案**里（`orderTrackInfoList[].title`，正则 `预计…送达`），拼多多有独立字段 `timeForecast.timeForecastDesc`；淘宝 mtop 物流接口只回 `mailNo`/`carrierName`、快递100 免 key 接口也没有送达时间，所以淘宝和手动添加的单子不显示 ETA。ETA 只在「平台这次刷新真的返回了」时才更新，平台撤掉就不会显示。

## 目录结构

```
dsh-parcel-tracker/
├── package.json            # bundle 声明：dsh.bundle.patch + dsh.client
├── cordis.patch.yml        # 插进 profile 的插件行
├── lib/
│   ├── index.js            # 宿主入口：注册 HTTP 路由 + 定时刷新
│   ├── config.js           # 配置读写/归一/脱敏
│   ├── store.js            # 订单与状态落盘（~/.dsh/parcel-tracker/state.json）
│   ├── aggregate.js        # 去重/合并/排序/统计
│   ├── server.js           # /dsh-parcel/* 九个接口 + 信任栅栏
│   ├── carriers.js         # 快递100 官方码表（3080 家）+ 名称/单号反查
│   ├── kuaidi100.js        # 轨迹查询（会话预热 + 缓存 + 占位识别）
│   └── platforms/          # 四平台适配器：http 基座 + taobao/jd/douyin/pdd
├── client.js               # 浏览器侧：侧边栏图标 / 主面板 / 设置页 / cURL 解析
├── locale/{zh,en}.json
├── scripts/                # 自测：test-curl（cURL 解析）、test-curl-cmd、test-c-group（码表/轨迹）、test-jd、test-pdd、test-e2e（宿主路由）
└── icon.svg
```

## 接口

宿主注册在 `/dsh-parcel` 下，全部返回 HTTP 200 与 `{ ok, ... }`：

`GET /state`、`GET /orders`、`POST /refresh`、`GET /config`、`POST /config`、`POST /track`、`POST /manual-order`、`POST /manual-order/delete`、`GET /carriers`
