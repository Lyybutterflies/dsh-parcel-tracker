/**
 * dsh-parcel-tracker web client.
 *
 * Pure JS (no build step): the bundle registers a lazy factory into the host's
 * module table and React is taken from the host module table.
 *
 * Slots registered:
 *   - sidebar.panellist  id   'parcel-tracker'  (sidebar glyph)
 *   - main               key  'parcel-tracker'  (central panel; key MUST equal the panellist id)
 *   - settings.section   id   'parcel-tracker'  (configuration section)
 *
 * All visible copy goes through ctx.locale; every colour comes from a
 * --dsw-alias-* theme token (artwork excepted).
 */
window.__ModuleLoader__.load({
  id: 'dsh-parcel-tracker',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useMemo, useCallback, useRef } = React;

    const NS = 'dsh-parcel-tracker';
    const API = '/dsh-parcel';
    const POLL_INTERVAL = 30000;

    /* ------------------------------------------------------------------ *
     * Dictionaries (inline: client.js is plain JS and cannot import JSON) *
     * ------------------------------------------------------------------ */

    const zh = {
      metaTitle: '快递聚合',
      metaDescription: '同时显示抖音/京东/淘宝/拼多多四家平台的在途快递与轨迹。',
      panelTitle: '快递聚合',
      settingsTitle: '快递聚合设置',
      phoneLabel: '手机号',
      phoneNotSet: '未设置手机号',
      phoneHint: '用于在平台接口中按收件人手机号过滤本人订单。',
      refresh: '刷新',
      refreshing: '刷新中…',
      lastRefresh: '最后刷新',
      neverRefreshed: '尚未刷新',
      nextRefresh: '下次自动刷新',
      summaryInTransit: '在途',
      summaryDelivered: '已签收',
      summaryUnknown: '未知',
      platformTaobao: '淘宝',
      platformJd: '京东',
      platformDouyin: '抖音',
      platformPdd: '拼多多',
      platformManual: '手动添加',
      statusPending: '待揽收',
      statusInTransit: '在途',
      statusDelivered: '已签收',
      statusUnknown: '未知',
      trackingNo: '运单号',
      copyTrackingNo: '复制运单号',
      copied: '已复制',
      copyFailed: '复制失败，请手动选择运单号文本复制。',
      carrierLabel: '快递公司',
      carrierUnknown: '未知快递公司',
      carrierSelect: '选择快递公司',
      carrierRemember: '记住该快递公司',
      carrierChange: '更改',
      carrierSearch: '搜索快递公司名称或代码',
      carrierNoMatch: '没有匹配的快递公司',
      carrierRemembered: '已记住',
      latestTrace: '最新轨迹',
      noTrace: '暂无轨迹信息',
      traceError: '轨迹查询失败：{message}',
      traceIpBlocked: '快递100 暂时限制了本机查询（IP 限流），请稍后再试或填写 Key',
      traceRateLimited: '查询太频繁，稍后自动重试',
      traceInvalidParams: '快递公司码无效，请重新选择',
      traceTimeout: '查询超时，稍后自动重试',
      unknownTitle: '（无标题）',
      emptyLoading: '正在加载…',
      emptyNoPhone: '尚未配置手机号。请到「设置 → 快递聚合」填写手机号后再查看快递。',
      emptyNoPlatform: '尚未启用任何平台。请在下方勾选要聚合的平台，或到设置中配置。',
      emptyLoginExpired: '部分平台的登录态已失效。请重新复制并保存对应平台的 Cookie。',
      emptyNoOrders: '当前没有在途快递。',
      emptyNeedCookie: '手机号已保存，但还没配置任何平台的 Cookie，抓不到订单。到「设置 → 快递聚合」粘贴平台 Cookie，或用下面的「手动添加运单号」。',
      addManual: '手动添加运单号',
      manualTitle: '商品标题（可选）',
      manualTrackingNo: '运单号',
      manualCarrier: '快递公司码（可选，如 jd）',
      manualSubmit: '添加',
      manualAdded: '已添加运单号',
      manualFailed: '添加失败：{message}',
      manualListTitle: '手动运单号',
      manualListEmpty: '暂无手动运单号',
      manualDelete: '删除',
      manualDeleteFailed: '删除失败：{message}',
      errorsTitle: '抓取错误',
      errorItem: '{platform}：{message}',
      loadFailed: '加载失败：{message}',
      refreshFailed: '刷新失败：{message}',
      openSettings: '打开设置',
      advanced: '高级设置',
      cookieLabel: 'Cookie',
      cookieConfigured: '已配置（长度 {length}）',
      cookieNotConfigured: '未配置',
      cookiePending: '已填入（长度 {length}），点保存后生效',
      cookiePlaceholder: '留空表示不修改',
      cookieHint: '从浏览器开发者工具的请求头里复制该平台的完整 Cookie。',
      curlImportTitle: '从浏览器「Copy as cURL」一键导入（推荐）',
      curlImportHint: '在浏览器里登录该平台并打开「我的订单」，F12 打开开发者工具的 Network，找到返回订单列表的那条请求，右键 → Copy → Copy as cURL（bash 或 PowerShell 都行），把整段粘到下面。会自动填好 Cookie、接口地址、请求头、请求体。',
      curlImportPlaceholder: 'curl \'https://...\' -H \'cookie: ...\' ...',
      curlImportButton: '解析并填入',
      curlImportFailed: '没能从这段文本里解析出 cURL（需要包含以 http 开头的地址）',
      curlImported: '已填入：Cookie {cookie} 字符、请求头 {headers} 个',
      cookieHint: '手工方式：在开发者工具里选中订单请求，从 Request Headers 复制整条 Cookie 的值粘到上面。嫌麻烦就用上面的「Copy as cURL」一键导入。',
      testConnection: '测试连接',
      testing: '测试中…',
      testOk: '连接成功',
      testFailed: '连接失败：{message}',
      endpointLabel: '接口地址',
      endpointPlaceholder: '留空使用内置默认地址',
      methodLabel: '请求方法',
      headersLabel: '请求头（JSON）',
      headersPlaceholder: '{"Accept":"application/json"}',
      bodyLabel: '请求体',
      orderListPathLabel: '订单列表路径',
      orderListPathPlaceholder: '如 data.list，留空自动深扫',
      phoneParamLabel: '手机号参数名',
      phoneParamPlaceholder: '如 mobile / receiverPhone',
      carrierNameMapLabel: '公司名映射（JSON）',
      carrierNameMapPlaceholder: '{"中通快递":"zto"}',
      invalidJson: 'JSON 格式无效，请修正后再保存。',
      kuaidi100KeyLabel: '快递100 Key（可选）',
      kuaidi100KeyHint: '留空为免 key 模式，仅支持显式快递公司码。',
      refreshMinutesLabel: '订单刷新间隔（分钟）',
      trackRefreshMinutesLabel: '轨迹刷新间隔（分钟）',
      trackEnabledLabel: '查询快递轨迹',
      showDeliveredLabel: '显示已签收的快递',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
    savedRefreshing: '已保存，正在抓取订单…',
      saveFailed: '保存失败：{message}',
      close: '关闭',
    };

    const en = {
      metaTitle: 'Parcel Tracker',
      metaDescription: 'Shows in-transit parcels and tracking from Taobao, JD, Douyin and Pinduoduo in one place.',
      panelTitle: 'Parcel Tracker',
      settingsTitle: 'Parcel Tracker Settings',
      phoneLabel: 'Phone number',
      phoneNotSet: 'No phone number set',
      phoneHint: 'Used to filter your own orders on the platform APIs.',
      refresh: 'Refresh',
      refreshing: 'Refreshing…',
      lastRefresh: 'Last refresh',
      neverRefreshed: 'Never refreshed',
      nextRefresh: 'Next auto refresh',
      summaryInTransit: 'In transit',
      summaryDelivered: 'Delivered',
      summaryUnknown: 'Unknown',
      platformTaobao: 'Taobao',
      platformJd: 'JD',
      platformDouyin: 'Douyin',
      platformPdd: 'Pinduoduo',
      platformManual: 'Manual',
      statusPending: 'Pending pickup',
      statusInTransit: 'In transit',
      statusDelivered: 'Delivered',
      statusUnknown: 'Unknown',
      trackingNo: 'Tracking no.',
      copyTrackingNo: 'Copy tracking number',
      copied: 'Copied',
      copyFailed: 'Copy failed, please select the number and copy it manually.',
      carrierLabel: 'Carrier',
      carrierUnknown: 'Unknown carrier',
      carrierSelect: 'Select carrier',
      carrierRemember: 'Remember this carrier',
      carrierChange: 'Change',
      carrierSearch: 'Search carrier name or code',
      carrierNoMatch: 'No matching carrier',
      carrierRemembered: 'Remembered',
      latestTrace: 'Latest trace',
      noTrace: 'No tracking information yet',
      traceError: 'Tracking query failed: {message}',
      traceIpBlocked: 'Kuaidi100 is temporarily blocking this IP; retry later or set an API key',
      traceRateLimited: 'Too many queries, will retry automatically',
      traceInvalidParams: 'Invalid carrier code, please pick another',
      traceTimeout: 'Query timed out, will retry automatically',
      unknownTitle: '(no title)',
      emptyLoading: 'Loading…',
      emptyNoPhone: 'No phone number configured. Set it in Settings → Parcel Tracker first.',
      emptyNoPlatform: 'No platform enabled yet. Pick one below or configure it in Settings.',
      emptyLoginExpired: 'Some platform sessions expired. Re-copy and save the matching platform Cookie.',
      emptyNoOrders: 'No in-transit parcels right now.',
      emptyNeedCookie: 'Phone saved, but no platform Cookie configured yet — orders cannot be fetched. Paste platform Cookies in Settings → Parcel Tracker, or add tracking numbers manually below.',
      addManual: 'Add tracking number manually',
      manualTitle: 'Item title (optional)',
      manualTrackingNo: 'Tracking number',
      manualCarrier: 'Carrier code (optional, e.g. jd)',
      manualSubmit: 'Add',
      manualAdded: 'Tracking number added',
      manualFailed: 'Add failed: {message}',
      manualListTitle: 'Manual tracking numbers',
      manualListEmpty: 'No manual tracking number yet',
      manualDelete: 'Delete',
      manualDeleteFailed: 'Delete failed: {message}',
      errorsTitle: 'Fetch errors',
      errorItem: '{platform}: {message}',
      loadFailed: 'Failed to load: {message}',
      refreshFailed: 'Refresh failed: {message}',
      openSettings: 'Open settings',
      advanced: 'Advanced',
      cookieLabel: 'Cookie',
      cookieConfigured: 'Configured (length {length})',
      cookieNotConfigured: 'Not configured',
      cookiePending: 'Filled in (length {length}), takes effect after saving',
      cookiePlaceholder: 'Leave empty to keep the saved value',
      cookieHint: 'Copy the full Cookie header of that platform from your browser devtools.',
      curlImportTitle: 'Import from browser “Copy as cURL” (recommended)',
      curlImportHint: 'Log in on the platform website, open your order list, open DevTools → Network, right-click the request that returns the order list and choose Copy → Copy as cURL (bash or PowerShell both work), then paste the whole command below. Cookie, endpoint, headers and body get filled in automatically.',
      curlImportPlaceholder: 'curl \'https://...\' -H \'cookie: ...\' ...',
      curlImportButton: 'Parse and fill',
      curlImportFailed: 'No cURL command found in that text (it needs an http(s) URL)',
      curlImported: 'Filled in: cookie {cookie} chars, {headers} headers',
      cookieHint: 'Manual way: select the order request in DevTools and copy the whole Cookie value from Request Headers. Or use “Copy as cURL” above.',
      testConnection: 'Test connection',
      testing: 'Testing…',
      testOk: 'Connection OK',
      testFailed: 'Connection failed: {message}',
      endpointLabel: 'Endpoint',
      endpointPlaceholder: 'Leave empty to use the built-in default',
      methodLabel: 'HTTP method',
      headersLabel: 'Headers (JSON)',
      headersPlaceholder: '{"Accept":"application/json"}',
      bodyLabel: 'Request body',
      orderListPathLabel: 'Order list path',
      orderListPathPlaceholder: 'e.g. data.list, empty = auto deep scan',
      phoneParamLabel: 'Phone parameter name',
      phoneParamPlaceholder: 'e.g. mobile / receiverPhone',
      carrierNameMapLabel: 'Carrier name map (JSON)',
      carrierNameMapPlaceholder: '{"中通快递":"zto"}',
      invalidJson: 'Invalid JSON, please fix it before saving.',
      kuaidi100KeyLabel: 'Kuaidi100 key (optional)',
      kuaidi100KeyHint: 'Empty means the keyless mode, which only supports explicit carrier codes.',
      refreshMinutesLabel: 'Order refresh interval (minutes)',
      trackRefreshMinutesLabel: 'Tracking refresh interval (minutes)',
      trackEnabledLabel: 'Query parcel tracking',
      showDeliveredLabel: 'Show delivered parcels',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
    savedRefreshing: 'Saved — fetching orders…',
      saveFailed: 'Save failed: {message}',
      close: 'Close',
    };

    /* ------------------------------------------------------------------ *
     * Platform metadata                                                       *
     * ------------------------------------------------------------------ */

    const PLATFORMS = [
      { id: 'taobao', labelKey: 'platformTaobao', color: 'var(--dsw-alias-state-warn-primary)' },
      { id: 'jd', labelKey: 'platformJd', color: 'var(--dsw-alias-state-error-primary)' },
      { id: 'douyin', labelKey: 'platformDouyin', color: 'var(--dsw-alias-state-business-primary)' },
      { id: 'pdd', labelKey: 'platformPdd', color: 'var(--dsw-alias-state-success-primary)' },
    ];
    const PLATFORM_MAP = {};
    PLATFORMS.forEach((p) => { PLATFORM_MAP[p.id] = p; });

    /* ------------------------------------------------------------------ *
     * Helpers                                                                *
     * ------------------------------------------------------------------ */

    async function request(path, options) {
      let res;
      try {
        res = await fetch(API + path, options);
      } catch (e) {
        return { ok: false, error: (e && e.message) ? e.message : String(e) };
      }
      let data = null;
      try {
        data = await res.json();
      } catch (e) {
        data = null;
      }
      if (!data || typeof data !== 'object') {
        return { ok: false, error: 'HTTP ' + res.status };
      }
      if (data.ok === false) {
        return { ok: false, error: data.error ? String(data.error) : ('HTTP ' + res.status) };
      }
      return data;
    }

    function postJson(path, payload) {
      return request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
      });
    }

    function platformPayload(source) {
      const src = source && typeof source === 'object' ? source : {};
      return {
        enabled: src.enabled === true,
        endpoint: typeof src.endpoint === 'string' ? src.endpoint : '',
        method: typeof src.method === 'string' && src.method ? src.method : 'GET',
        headers: src.headers && typeof src.headers === 'object' && !Array.isArray(src.headers) ? src.headers : {},
        body: typeof src.body === 'string' ? src.body : '',
        phoneParam: typeof src.phoneParam === 'string' ? src.phoneParam : '',
        orderListPath: typeof src.orderListPath === 'string' ? src.orderListPath : '',
        carrierNameMap: src.carrierNameMap && typeof src.carrierNameMap === 'object' && !Array.isArray(src.carrierNameMap)
          ? src.carrierNameMap
          : {},
      };
    }

    /** Build a full config payload out of the (masked) config the server returned. */
    function payloadFromConfig(cfg) {
      const src = cfg && typeof cfg === 'object' ? cfg : {};
      const platforms = {};
      PLATFORMS.forEach((p) => {
        platforms[p.id] = platformPayload((src.platforms && src.platforms[p.id]) || {});
      });
      return {
        phone: typeof src.phone === 'string' ? src.phone : '',
        refreshMinutes: Number(src.refreshMinutes) > 0 ? Number(src.refreshMinutes) : 15,
        trackRefreshMinutes: Number(src.trackRefreshMinutes) > 0 ? Number(src.trackRefreshMinutes) : 10,
        showDelivered: src.showDelivered !== false,
        trackEnabled: src.trackEnabled !== false,
        carrierOverrides: src.carrierOverrides && typeof src.carrierOverrides === 'object' && !Array.isArray(src.carrierOverrides)
          ? src.carrierOverrides
          : {},
        manualOrders: Array.isArray(src.manualOrders) ? src.manualOrders : [],
        platforms,
      };
    }

    function errorMessage(err) {
      if (!err) return '';
      if (typeof err === 'string') return err;
      if (typeof err.message === 'string' && err.message) return err.message;
      if (typeof err.error === 'string' && err.error) return err.error;
      return String(err);
    }

    function platformLabel(t, platform) {
      const meta = PLATFORM_MAP[platform];
      return meta ? t(meta.labelKey) : t('platformManual');
    }

    function statusKey(status) {
      if (status === 'in_transit') return 'statusInTransit';
      if (status === 'delivered') return 'statusDelivered';
      if (status === 'pending') return 'statusPending';
      return 'statusUnknown';
    }

    function statusClass(status) {
      if (status === 'in_transit') return 'transit';
      if (status === 'delivered') return 'delivered';
      if (status === 'pending') return 'pending';
      return 'unknown';
    }

    /** 轨迹错误码 → 可读文案；未知错误码返回 null（调用方回落到 traceError 模板） */
    function traceErrorText(t, code, carriers) {
      const key = String(code || '');
      if (key === 'no-result') return t('noTrace');
      if (key === 'carrier-unknown') return t('carrierUnknown');
      if (key === 'ip-blocked') return t('traceIpBlocked');
      if (key === 'rate-limited') return t('traceRateLimited');
      if (key.indexOf('invalid-params') === 0) return t('traceInvalidParams');
      if (key === 'timeout' || key === 'connect-timeout') return t('traceTimeout');
      return null;
    }

    /** 公司码 → 展示名：优先 order.carrierName，其次 carriers 表，最后原样显示代码 */
    function carrierDisplayName(carrierCode, carrierName, carriers) {
      if (carrierName) return carrierName;
      if (!carrierCode) return '';
      const list = Array.isArray(carriers) ? carriers : [];
      for (const c of list) {
        if (c && c.code === carrierCode) return c.name || carrierCode;
      }
      return carrierCode;
    }

    // --- curl-parse-begin ---
    /** 把「Copy as cURL」整段文本切成 token（支持单/双引号、反斜杠续行、Windows 的 ^ 续行） */
    function tokenizeCurl(text) {
      const joined = String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/[\\^]\s*\n\s*/g, ' ')
        // Windows cmd 版「Copy as cURL」会用 ^ 转义 " & % < > | 等字符
        .replace(/\^(["'&%^<>|()!])/g, '$1');
      const tokens = [];
      let cur = '';
      let quote = '';
      let started = false;
      for (let i = 0; i < joined.length; i += 1) {
        const ch = joined[i];
        if (quote) {
          if (ch === quote) { quote = ''; continue; }
          if (ch === '\\' && quote === '"' && i + 1 < joined.length) { cur += joined[i + 1]; i += 1; continue; }
          cur += ch;
          continue;
        }
        if (ch === '"' || ch === "'") { quote = ch; started = true; continue; }
        if (ch === '\\' && i + 1 < joined.length) { cur += joined[i + 1]; i += 1; started = true; continue; }
        if (/\s/.test(ch)) {
          if (started || cur) { tokens.push(cur); cur = ''; started = false; }
          continue;
        }
        cur += ch;
        started = true;
      }
      if (started || cur) tokens.push(cur);
      return tokens;
    }

    /**
     * 解析一条 cURL 命令 → { url, method, headers, body, cookie }
     * 目的是让用户不用手工从 DevTools 里抄 Cookie / 请求头 / 请求体。
     */
    function parseCurl(text) {
      const tokens = tokenizeCurl(text);
      if (!tokens.length) return null;
      const out = { url: '', method: '', headers: {}, body: '', cookie: '' };
      let i = /^curl(\.exe)?$/i.test(tokens[0]) ? 1 : 0;
      const next = (k) => (k + 1 < tokens.length ? tokens[k + 1] : '');
      const addHeader = (raw) => {
        const line = String(raw || '');
        const at = line.indexOf(':');
        if (at <= 0) return;
        const key = line.slice(0, at).trim();
        const value = line.slice(at + 1).trim();
        if (!key || key.charAt(0) === ':') return;      // 丢弃 HTTP/2 伪头
        const lower = key.toLowerCase();
        if (lower === 'cookie') { out.cookie = value; return; }
        if (lower === 'host' || lower === 'content-length' || lower === 'connection'
          || lower === 'accept-encoding' || lower === 'transfer-encoding') return;  // 运行时自己算
        out.headers[key] = value;
      };
      while (i < tokens.length) {
        const tk = tokens[i];
        if (tk === '-H' || tk === '--header') { addHeader(next(i)); i += 2; continue; }
        if (tk === '-b' || tk === '--cookie') { out.cookie = next(i); i += 2; continue; }
        if (tk === '-X' || tk === '--request') { out.method = next(i).toUpperCase(); i += 2; continue; }
        if (tk === '-A' || tk === '--user-agent') { out.headers['User-Agent'] = next(i); i += 2; continue; }
        if (tk === '-e' || tk === '--referer') { out.headers.Referer = next(i); i += 2; continue; }
        if (tk === '--url') { out.url = next(i); i += 2; continue; }
        if (tk === '-d' || tk === '--data' || tk === '--data-raw' || tk === '--data-binary' || tk === '--data-urlencode') {
          out.body = out.body ? out.body + '&' + next(i) : next(i);
          i += 2;
          continue;
        }
        if (!out.url && /^\^?https?:\/\//i.test(tk)) { out.url = tk; i += 1; continue; }
        i += 1;
      }
      if (!out.url) return null;
      out.url = out.url.replace(/\^/g, '');   // cmd 转义残留的 ^（URL 里不可能合法出现）
      if (!out.method) out.method = out.body ? 'POST' : 'GET';
      return out;
    }
    // --- curl-parse-end ---

    function formatTime(ms) {
      const n = Number(ms);
      if (!Number.isFinite(n) || n <= 0) return '';
      try {
        return new Date(n).toLocaleString();
      } catch (e) {
        return String(n);
      }
    }

    /** A masked cookie is `{ cookieSet, cookieLength }`; a plain string is a draft value. */
    function cookieState(value) {
      if (!value) return { set: false, length: 0 };
      if (typeof value === 'string') return { set: value.length > 0, length: value.length };
      if (typeof value === 'object') {
        return { set: value.cookieSet === true, length: Number(value.cookieLength) || 0 };
      }
      return { set: false, length: 0 };
    }

    /* ------------------------------------------------------------------ *
     * Locale fan-out (host emits locale/change; components re-render)     *
     * ------------------------------------------------------------------ */

    const localeListeners = new Set();

    function useLocaleTick() {
      const [tick, setTick] = useState(0);
      useEffect(() => {
        const cb = () => setTick((n) => n + 1);
        localeListeners.add(cb);
        return () => { localeListeners.delete(cb); };
      }, []);
      return tick;
    }

    /* ------------------------------------------------------------------ *
     * Styles (rendered as a React element so unmounting removes them)      *
     * ------------------------------------------------------------------ */

    const CSS = [
      '.pt-root{box-sizing:border-box;display:flex;flex-direction:column;gap:12px;padding:14px 16px;',
      'font-family:var(--ds-font-family-sans);font-size:13px;line-height:1.55;color:var(--dsw-alias-label-primary);}',
      '.pt-root *,.pt-root *::before,.pt-root *::after{box-sizing:border-box;}',
      '.pt-header{display:flex;align-items:center;justify-content:space-between;gap:12px;}',
      '.pt-title{display:flex;align-items:baseline;gap:8px;font-size:15px;font-weight:600;}',
      '.pt-phone{font-size:12px;font-weight:400;color:var(--dsw-alias-label-secondary);}',
      '.pt-muted{color:var(--dsw-alias-label-tertiary);}',
      '.pt-meta{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:var(--dsw-alias-label-tertiary);}',
      '.pt-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-fill-l1);',
      'color:var(--dsw-alias-label-primary);border-radius:var(--dsw-radius-sm);padding:4px 10px;font-size:12px;',
      'font-family:inherit;cursor:pointer;}',
      '.pt-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);}',
      '.pt-btn:disabled{opacity:.55;cursor:not-allowed;}',
      '.pt-btn-primary{background:var(--dsw-alias-button-primary-fill);border-color:var(--dsw-alias-button-primary-fill);',
      'color:var(--dsw-alias-label-primary-foreground);}',
      '.pt-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);}',
      '.pt-btn-small{padding:2px 8px;font-size:11px;}',
      '.pt-btn-ghost{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary);}',
      '.pt-btn-ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
      '.pt-btn-danger{color:var(--dsw-alias-label-error);}',
      '.pt-platforms{display:flex;flex-wrap:wrap;gap:6px;}',
      '.pt-check{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;',
      'border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-fill-l1);',
      'cursor:pointer;font-size:12px;user-select:none;}',
      '.pt-check input{margin:0;accent-color:var(--dsw-alias-brand-primary);}',
      '.pt-dot{width:8px;height:8px;border-radius:50%;flex:none;display:inline-block;}',
      '.pt-summary{display:flex;gap:8px;}',
      '.pt-stat{flex:1;display:flex;flex-direction:column;gap:2px;padding:8px 10px;',
      'border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);}',
      '.pt-stat-num{font-size:18px;font-weight:600;}',
      '.pt-stat-label{font-size:11px;color:var(--dsw-alias-label-tertiary);}',
      '.pt-card{border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);',
      'background:var(--dsw-alias-bg-layer-1);padding:10px 12px;}',
      '.pt-card + .pt-card{margin-top:8px;}',
      '.pt-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px;}',
      '.pt-card-title{font-weight:600;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.pt-tag{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--dsw-alias-label-secondary);flex:none;}',
      '.pt-badge{display:inline-flex;align-items:center;border-radius:var(--dsw-radius-xs);padding:1px 7px;',
      'font-size:11px;border:1px solid transparent;flex:none;}',
      '.pt-badge-transit{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary);}',
      '.pt-badge-pending{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary);}',
      '.pt-badge-delivered{color:var(--dsw-alias-label-tertiary);border-color:var(--dsw-alias-border-l2);}',
      '.pt-badge-unknown{color:var(--dsw-alias-state-idle-primary);border-color:var(--dsw-alias-state-idle-primary);}',
      '.pt-card-head-right{display:inline-flex;align-items:center;gap:6px;flex:none;}',
      '.pt-eta{font-size:11px;color:var(--dsw-alias-state-success-primary);border:1px dashed var(--dsw-alias-state-success-primary);',
      'border-radius:var(--dsw-radius-xs);padding:1px 6px;white-space:nowrap;}',
      '.pt-kv{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:8px;font-size:12px;align-items:center;}',
      '.pt-kv-item{display:flex;align-items:center;gap:6px;}',
      '.pt-kv-label{color:var(--dsw-alias-label-tertiary);}',
      '.pt-kv-hint{color:var(--dsw-alias-label-tertiary);font-size:11px;}',
      '.pt-mono{font-family:var(--ds-font-family-code);}',
      '.pt-link{background:none;border:none;padding:0;color:var(--dsw-alias-link);cursor:pointer;font:inherit;font-size:12px;}',
      '.pt-link:hover{text-decoration:underline;}',
      '.pt-trace{margin-top:8px;padding:8px 10px;border-radius:var(--dsw-radius-sm);',
      'background:var(--dsw-alias-fill-l1);font-size:12px;}',
      '.pt-trace-time{color:var(--dsw-alias-label-tertiary);margin-right:6px;}',
      '.pt-errors{border:1px solid var(--dsw-alias-state-error-primary);border-radius:var(--dsw-radius-md);',
      'padding:8px 12px;background:var(--dsw-alias-fill-l1);}',
      '.pt-errors-title{font-weight:600;color:var(--dsw-alias-label-error);margin-bottom:4px;font-size:12px;}',
      '.pt-errors ul{margin:0;padding-left:18px;font-size:12px;}',
      '.pt-empty{padding:18px 12px;text-align:center;color:var(--dsw-alias-label-secondary);',
      'border:1px dashed var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);}',
      '.pt-note{font-size:12px;color:var(--dsw-alias-label-tertiary);margin:0;}',
      '.pt-err{color:var(--dsw-alias-label-error);font-size:12px;margin:0;}',
      '.pt-ok{color:var(--dsw-alias-state-success-primary);font-size:12px;margin:0;}',
      '.pt-field{display:flex;flex-direction:column;gap:4px;}',
      '.pt-label{font-size:12px;color:var(--dsw-alias-label-secondary);}',
      '.pt-input{width:100%;padding:5px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);',
      'background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;}',
      'textarea.pt-input{font-family:var(--ds-font-family-code);resize:vertical;}',
      '.pt-input-inline{width:auto;padding:2px 6px;}',
      '.pt-picker{position:relative;display:inline-flex;align-items:center;gap:6px;}',
      '.pt-picker-value{font-size:12px;}',
      '.pt-picker-menu{position:absolute;z-index:30;top:100%;left:0;margin-top:4px;min-width:220px;max-height:240px;',
      'overflow-y:auto;display:flex;flex-direction:column;padding:4px;background:var(--dsw-alias-bg-layer-2);',
      'border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);',
      'box-shadow:0 6px 20px rgba(0,0,0,0.14);}',
      '.pt-picker-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:4px 8px;',
      'background:none;border:none;border-radius:var(--dsw-radius-sm);cursor:pointer;font:inherit;font-size:12px;',
      'color:var(--dsw-alias-label-primary);text-align:left;}',
      '.pt-picker-item:hover,.pt-picker-item-hover{background:var(--dsw-alias-fill-l2);}',
      '.pt-picker-empty{padding:6px 8px;font-size:12px;color:var(--dsw-alias-label-tertiary);}',
      '.pt-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;}',
      '.pt-section{display:flex;flex-direction:column;gap:10px;padding:12px;',
      'border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);}',
      '.pt-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px;}',
      '.pt-disclosure{border-top:1px solid var(--dsw-alias-border-l1);padding-top:8px;}',
      '.pt-disclosure-toggle{background:none;border:none;padding:0;color:var(--dsw-alias-link);cursor:pointer;',
      'font-family:inherit;font-size:12px;}',
      '.pt-manual-list{display:flex;flex-direction:column;gap:6px;}',
      '.pt-manual-item{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;}',
      '.pt-status-line{display:flex;align-items:center;gap:8px;font-size:12px;flex-wrap:wrap;}',
      '.pt-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
      '.pt-row-top{position:sticky;top:0;z-index:6;padding:2px 0 8px;margin-bottom:2px;',
      'background:var(--dsw-alias-bg-layer-1);border-bottom:1px solid var(--dsw-alias-border-l1);}',
      '.pt-panel-icon{display:block;pointer-events:none;color:var(--dsw-alias-label-secondary);}',
      '.pt-panel-icon-active{color:var(--dsw-alias-label-primary);}',
    ].join('');

    function Styles() {
      return h('style', null, CSS);
    }

    /* ------------------------------------------------------------------ *
     * Sidebar glyph                                                          *
     * ------------------------------------------------------------------ */

    function PanelIcon(props) {
      const owner = props || {};
      const size = owner.size ? owner.size : 18;
      const active = owner.active === true;
      return h('svg', {
        className: 'pt-panel-icon' + (active ? ' pt-panel-icon-active' : ''),
        width: size,
        height: size,
        viewBox: '0 0 64 64',
        'aria-hidden': true,
        focusable: false,
        style: { display: 'block', pointerEvents: 'none' },
      },
        h('path', { d: 'M3 30 L20 20 L37 30 L20 40 Z', fill: 'currentColor', opacity: 0.32 }),
        h('path', {
          d: 'M3 30 V48 L20 58 L37 48 V30', fill: 'none', stroke: 'currentColor',
          strokeWidth: 4, strokeLinecap: 'round', strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M20 40 V58', fill: 'none', stroke: 'currentColor', strokeWidth: 4, strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M47 4 A11 11 0 0 0 36 15 C36 22 47 33 47 33 C47 33 58 22 58 15 A11 11 0 0 0 47 4 Z',
          fill: 'currentColor',
        }),
        h('path', {
          d: 'M47 9.5 A5.5 5.5 0 1 0 47 20.5 A5.5 5.5 0 1 0 47 9.5 Z',
          fill: 'var(--dsw-alias-bg-base)',
        }));
    }

    /* ------------------------------------------------------------------ *
     * Shared bits                                                            *
     * ------------------------------------------------------------------ */

    function Stat(props) {
      return h('div', { className: 'pt-stat' },
        h('span', { className: 'pt-stat-num' }, String(props.value)),
        h('span', { className: 'pt-stat-label' }, props.label));
    }

    /**
     * 快递公司选择器：默认只显示中文名 +「更改」。
     * 点开后是输入框，边打边过滤（最多 20 条），避免把 3000+ 公司塞进 DOM。
     */
    function CarrierPicker(props) {
      const t = props.t;
      const carriers = Array.isArray(props.carriers) ? props.carriers : [];
      const [open, setOpen] = useState(false);
      const [query, setQuery] = useState('');
      const [hover, setHover] = useState(-1);

      const matches = useMemo(() => {
        if (!open) return [];
        const q = query.trim().toLowerCase();
        const out = [];
        for (const c of carriers) {
          if (!c) continue;
          const name = String(c.name || '');
          const code = String(c.code || '');
          if (!q || name.toLowerCase().includes(q) || code.toLowerCase().includes(q)) {
            out.push(c);
            if (out.length >= 20) break;
          }
        }
        return out;
      }, [open, query, carriers]);

      const pick = (code) => {
        setOpen(false);
        setQuery('');
        setHover(-1);
        if (code !== props.value) props.onChange(code);
      };

      const onKeyDown = (e) => {
        if (e.key === 'Escape') {
          setOpen(false);
          return;
        }
        if (!matches.length) return;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setHover((i) => (i + 1) % matches.length);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setHover((i) => (i <= 0 ? matches.length - 1 : i - 1));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const target = matches[hover >= 0 ? hover : 0];
          if (target) pick(target.code);
        }
      };

      if (!open) {
        return h('span', { className: 'pt-picker' },
          h('span', { className: 'pt-picker-value' }, props.displayName || t('carrierSelect')),
          h('button', {
            type: 'button',
            className: 'pt-link',
            onClick: () => setOpen(true),
          }, t('carrierChange')));
      }

      return h('span', { className: 'pt-picker' },
        h('input', {
          className: 'pt-input pt-input-inline',
          type: 'text',
          autoFocus: true,
          value: query,
          placeholder: t('carrierSearch'),
          onInput: (e) => { setQuery(e.target.value); setHover(-1); },
          onKeyDown,
          onBlur: () => setTimeout(() => setOpen(false), 180),
        }),
        matches.length
          ? h('div', { className: 'pt-picker-menu' },
              matches.map((c, i) =>
                h('button', {
                  key: c.code || String(i),
                  type: 'button',
                  className: 'pt-picker-item' + (i === hover ? ' pt-picker-item-hover' : ''),
                  onMouseDown: (e) => { e.preventDefault(); pick(c.code); },
                  onMouseEnter: () => setHover(i),
                },
                  h('span', null, c.name || c.code),
                  h('span', { className: 'pt-kv-hint' }, c.code || ''))))
          : h('div', { className: 'pt-picker-menu' },
              h('div', { className: 'pt-picker-empty' }, t('carrierNoMatch'))));
    }

    function OrderCard(props) {
      const order = props.order || {};
      const t = props.t;
      const tracking = order.tracking && typeof order.tracking === 'object' ? order.tracking : {};
      const traces = Array.isArray(tracking.traces) ? tracking.traces : [];
      const latest = traces.length ? traces[0] : null;
      const meta = PLATFORM_MAP[order.platform];
      const status = typeof order.status === 'string' ? order.status : 'unknown';
      const carrierCode = typeof order.carrier === 'string' ? order.carrier : '';
      const carrierName = typeof order.carrierName === 'string' && order.carrierName ? order.carrierName : '';
      const choice = props.carrierChoice && props.carrierChoice[order.trackingNo] ? props.carrierChoice[order.trackingNo] : '';
      const current = carrierCode || choice;
      const carriers = Array.isArray(props.carriers) ? props.carriers : [];
      // 平台给出的预计送达文案（京东从轨迹里抽、拼多多取 timeForecast），没有就整块不渲染
      const eta = typeof tracking.eta === 'string' ? tracking.eta.trim() : '';

      const displayName = carrierDisplayName(carrierCode, carrierName, carriers);
      // 快递公司：显示中文名；点「更改」才展开搜索框（3000+ 公司不能直接塞 select）。
      const carrierNode = h('span', { className: 'pt-kv-item' },
        h('span', { className: 'pt-kv-label' }, t('carrierLabel')),
        h(CarrierPicker, {
          carriers,
          value: current,
          displayName: displayName || current,
          t,
          onChange: (code) => props.onCarrierChange(order, code),
        }),
        choice
          ? h('button', {
              type: 'button',
              className: 'pt-btn pt-btn-small',
              onClick: () => props.onRememberCarrier(order, choice),
            }, t('carrierRemember'))
          : null);

      return h('div', { className: 'pt-card' },
        h('div', { className: 'pt-card-head' },
          h('span', { className: 'pt-tag' },
            h('span', { className: 'pt-dot', style: { background: meta ? meta.color : 'var(--dsw-alias-label-tertiary)' } }),
            h('span', null, platformLabel(t, order.platform))),
          h('span', { className: 'pt-card-head-right' },
            eta ? h('span', { className: 'pt-eta' }, eta) : null,
            h('span', { className: 'pt-badge pt-badge-' + statusClass(status) }, t(statusKey(status))))),
        h('div', { className: 'pt-card-title', title: order.title || '' }, order.title || t('unknownTitle')),
        h('div', { className: 'pt-kv' },
          h('span', { className: 'pt-kv-item' },
            h('span', { className: 'pt-kv-label' }, t('trackingNo')),
            h('span', { className: 'pt-mono' }, order.trackingNo || ''),
            order.trackingNo
              ? h('button', {
                  type: 'button',
                  className: 'pt-link',
                  title: t('copyTrackingNo'),
                  onClick: () => props.onCopy(order.trackingNo),
                }, props.copied === order.trackingNo ? t('copied') : t('copyTrackingNo'))
              : null),
          carrierNode),
        h('div', { className: 'pt-trace' },
          latest
            ? h('div', null,
                h('span', { className: 'pt-trace-time' }, latest.time || ''),
                h('span', null, latest.context || ''))
            : h('div', { className: 'pt-note' },
                tracking.error
                  ? (traceErrorText(t, tracking.error, carriers) || t('traceError', { message: tracking.error }))
                  : t('noTrace'))),
        order.error
          ? h('div', { className: 'pt-err', style: { marginTop: '6px' } }, order.error)
          : null);
    }

    /* ------------------------------------------------------------------ *
     * Main panel                                                             *
     * ------------------------------------------------------------------ */

    function MainPanel(props) {
      const t = props.t;
      useLocaleTick();

      const [state, setState] = useState(null);
      const [loading, setLoading] = useState(true);
      const [loadError, setLoadError] = useState('');
      const [busy, setBusy] = useState(false);
      const [notice, setNotice] = useState(null);
      const [carriers, setCarriers] = useState([]);
      const [manualOpen, setManualOpen] = useState(false);
      const [manualForm, setManualForm] = useState({ title: '', trackingNo: '', carrier: '' });
      const [copied, setCopied] = useState('');
      const [carrierChoice, setCarrierChoice] = useState({});

      const stateRef = useRef(null);
      stateRef.current = state;
      const copyTimer = useRef(null);

      const loadState = useCallback(async (silent) => {
        if (!silent) setLoading(true);
        try {
          const data = await request('/state');
          if (data.ok) {
            setState(data);
            setLoadError('');
          } else {
            setLoadError(data.error || 'unknown');
          }
        } catch (e) {
          setLoadError((e && e.message) ? e.message : String(e));
        } finally {
          if (!silent) setLoading(false);
        }
      }, []);

      useEffect(() => {
        let alive = true;
        loadState(false);
        request('/carriers').then((data) => {
          if (alive && data.ok && Array.isArray(data.carriers)) setCarriers(data.carriers);
        }).catch(() => {});
        const timer = setInterval(() => { loadState(true); }, POLL_INTERVAL);
        return () => {
          alive = false;
          clearInterval(timer);
          if (copyTimer.current) clearTimeout(copyTimer.current);
        };
      }, [loadState]);

      const config = state && state.config ? state.config : null;
      const errors = state && Array.isArray(state.errors) ? state.errors : [];

      const orders = useMemo(() => {
        const list = state && Array.isArray(state.orders) ? state.orders : [];
        const showDelivered = !(config && config.showDelivered === false);
        return list.filter((o) => showDelivered || (o && o.status !== 'delivered'));
      }, [state, config]);

      const summary = useMemo(() => {
        let transit = 0;
        let delivered = 0;
        let unknown = 0;
        orders.forEach((o) => {
          const s = o && o.status;
          if (s === 'in_transit' || s === 'pending') transit += 1;
          else if (s === 'delivered') delivered += 1;
          else unknown += 1;
        });
        return { transit, delivered, unknown };
      }, [orders]);

      const enabledPlatforms = useMemo(() => {
        const set = {};
        PLATFORMS.forEach((p) => {
          const pc = config && config.platforms ? config.platforms[p.id] : null;
          set[p.id] = !!(pc && pc.enabled === true);
        });
        return set;
      }, [config]);

      const emptyKey = useMemo(() => {
        if (loading && !state) return 'emptyLoading';
        if (!config || !config.phone) return 'emptyNoPhone';
        const anyEnabled = PLATFORMS.some((p) => enabledPlatforms[p.id]);
        if (!anyEnabled) return 'emptyNoPlatform';
        // 没订单时优先判断「是不是压根没配 Cookie」——否则会误报成「当前没有在途快递」
        const enabled = PLATFORMS.filter((p) => enabledPlatforms[p.id]);
        const noCookie = enabled.filter((p) => {
          const pc = config && config.platforms ? config.platforms[p.id] : null;
          return !(pc && pc.cookieSet === true);
        });
        if (enabled.length && noCookie.length === enabled.length) return 'emptyNeedCookie';
        const broken = errors.some((e) => {
          const raw = (typeof e === 'string' ? e : JSON.stringify(e === undefined ? '' : e)).toLowerCase();
          return raw.indexOf('missing-cookie') !== -1
            || raw.indexOf('cookie') !== -1
            || raw.indexOf('login') !== -1
            || raw.indexOf('登录') !== -1
            || raw.indexOf('unauthorized') !== -1
            || raw.indexOf('401') !== -1
            || raw.indexOf('expired') !== -1
            || raw.indexOf('失效') !== -1;
        });
        if (broken) return 'emptyLoginExpired';
        return 'emptyNoOrders';
      }, [config, enabledPlatforms, errors, loading, state]);

      const onRefresh = useCallback(async () => {
        if (busy) return;
        setBusy(true);
        setNotice(null);
        try {
          const data = await postJson('/refresh', {});
          if (!data.ok) setNotice({ kind: 'err', text: t('refreshFailed', { message: data.error || '' }) });
          await loadState(true);
        } finally {
          setBusy(false);
        }
      }, [busy, loadState, t]);

      const togglePlatform = useCallback(async (id, next) => {
        const cfg = stateRef.current ? stateRef.current.config : null;
        if (!cfg) return;
        const payload = payloadFromConfig(cfg);
        payload.platforms[id].enabled = next;
        setBusy(true);
        setNotice(null);
        try {
          const data = await postJson('/config', payload);
          if (!data.ok) setNotice({ kind: 'err', text: data.error || '' });
          await loadState(true);
        } finally {
          setBusy(false);
        }
      }, [loadState]);

      const onCarrierChange = useCallback(async (order, code) => {
        setCarrierChoice((prev) => Object.assign({}, prev, { [order.trackingNo]: code }));
        const data = await postJson('/track', { trackingNo: order.trackingNo, carrier: code });
        if (!data.ok) setNotice({ kind: 'err', text: data.error || '' });
        else await loadState(true);
      }, [loadState]);

      const onRememberCarrier = useCallback(async (order, code) => {
        const cfg = stateRef.current ? stateRef.current.config : null;
        if (!cfg) return;
        const payload = payloadFromConfig(cfg);
        payload.carrierOverrides = Object.assign({}, payload.carrierOverrides, { [order.trackingNo]: code });
        const data = await postJson('/config', payload);
        if (!data.ok) setNotice({ kind: 'err', text: data.error || '' });
        else await loadState(true);
      }, [loadState]);

      const onCopy = useCallback(async (text) => {
        try {
          if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(text);
            setCopied(text);
            if (copyTimer.current) clearTimeout(copyTimer.current);
            copyTimer.current = setTimeout(() => setCopied(''), 1500);
          } else {
            setNotice({ kind: 'err', text: t('copyFailed') });
          }
        } catch (e) {
          setNotice({ kind: 'err', text: t('copyFailed') });
        }
      }, [t]);

      const submitManual = useCallback(async (ev) => {
        if (ev && ev.preventDefault) ev.preventDefault();
        const trackingNo = manualForm.trackingNo.trim();
        if (!trackingNo) {
          setNotice({ kind: 'err', text: t('manualTrackingNo') });
          return;
        }
        const body = {
          platform: 'manual',
          title: manualForm.title.trim() || trackingNo,
          trackingNo,
          createdAt: Date.now(),
        };
        const carrier = manualForm.carrier.trim();
        if (carrier) body.carrier = carrier;
        const data = await postJson('/manual-order', body);
        if (!data.ok) {
          setNotice({ kind: 'err', text: t('manualFailed', { message: data.error || '' }) });
          return;
        }
        setNotice({ kind: 'ok', text: t('manualAdded') });
        setManualForm({ title: '', trackingNo: '', carrier: '' });
        setManualOpen(false);
        await loadState(true);
      }, [loadState, manualForm, t]);

      const lastRefresh = state && state.updatedAt ? formatTime(state.updatedAt) : '';
      const nextRefresh = state && state.nextRefreshAt ? formatTime(state.nextRefreshAt) : '';

      return h('div', { className: 'pt-root' },
        h(Styles, null),
        h('div', { className: 'pt-header' },
          h('div', { className: 'pt-title' },
            h('span', null, t('panelTitle')),
            h('span', { className: 'pt-phone' },
              config && config.phone ? config.phone : t('phoneNotSet'))),
          h('button', {
            type: 'button',
            className: 'pt-btn pt-btn-primary',
            disabled: busy || (state && state.running === true),
            onClick: onRefresh,
          }, busy || (state && state.running === true) ? t('refreshing') : t('refresh'))),
        h('div', { className: 'pt-meta' },
          h('span', null, t('lastRefresh') + '：' + (lastRefresh || t('neverRefreshed'))),
          nextRefresh ? h('span', null, t('nextRefresh') + '：' + nextRefresh) : null),

        h('div', { className: 'pt-platforms' },
          PLATFORMS.map((p) => h('label', { key: p.id, className: 'pt-check' },
            h('input', {
              type: 'checkbox',
              checked: enabledPlatforms[p.id],
              onChange: (e) => togglePlatform(p.id, e.target.checked),
            }),
            h('span', { className: 'pt-dot', style: { background: p.color } }),
            h('span', null, t(p.labelKey))))),

        h('div', { className: 'pt-summary' },
          h(Stat, { label: t('summaryInTransit'), value: summary.transit }),
          h(Stat, { label: t('summaryDelivered'), value: summary.delivered }),
          h(Stat, { label: t('summaryUnknown'), value: summary.unknown })),

        loadError ? h('div', { className: 'pt-err' }, t('loadFailed', { message: loadError })) : null,
        notice
          ? h('div', { className: notice.kind === 'err' ? 'pt-err' : 'pt-ok' }, notice.text)
          : null,

        errors.length
          ? h('div', { className: 'pt-errors' },
              h('div', { className: 'pt-errors-title' }, t('errorsTitle')),
              h('ul', null, errors.map((e, i) => h('li', { key: 'err-' + i },
                t('errorItem', {
                  platform: e && e.platform ? platformLabel(t, e.platform) : t('platformManual'),
                  message: errorMessage(e),
                })))))
          : null,

        orders.length
          ? h('div', null, orders.map((o) => h(OrderCard, {
              key: o && o.id ? o.id : String(o && o.trackingNo),
              order: o,
              t,
              carriers,
              carrierChoice,
              copied,
              onCarrierChange,
              onRememberCarrier,
              onCopy,
            })))
          : h('div', { className: 'pt-empty' }, t(emptyKey)),

        h('div', { className: 'pt-section' },
          h('div', { className: 'pt-section-head' },
            h('span', { className: 'pt-label' }, t('addManual')),
            h('button', {
              type: 'button',
              className: 'pt-btn pt-btn-small',
              onClick: () => setManualOpen((v) => !v),
            }, manualOpen ? '−' : '+')),
          manualOpen
            ? h('form', { className: 'pt-grid', onSubmit: submitManual },
                h('div', { className: 'pt-field' },
                  h('label', { className: 'pt-label' }, t('manualTitle')),
                  h('input', {
                    className: 'pt-input',
                    value: manualForm.title,
                    placeholder: t('manualTitle'),
                    onChange: (e) => setManualForm((f) => Object.assign({}, f, { title: e.target.value })),
                  })),
                h('div', { className: 'pt-field' },
                  h('label', { className: 'pt-label' }, t('manualTrackingNo')),
                  h('input', {
                    className: 'pt-input',
                    value: manualForm.trackingNo,
                    placeholder: t('manualTrackingNo'),
                    onChange: (e) => setManualForm((f) => Object.assign({}, f, { trackingNo: e.target.value })),
                  })),
                h('div', { className: 'pt-field' },
                  h('label', { className: 'pt-label' }, t('manualCarrier')),
                  h('input', {
                    className: 'pt-input',
                    value: manualForm.carrier,
                    placeholder: t('manualCarrier'),
                    onChange: (e) => setManualForm((f) => Object.assign({}, f, { carrier: e.target.value })),
                  })),
                h('div', { className: 'pt-field' },
                  h('span', null, ' '),
                  h('button', { type: 'submit', className: 'pt-btn pt-btn-primary' }, t('manualSubmit'))))
            : null));
    }

    /* ------------------------------------------------------------------ *
     * Settings section                                                       *
     * ------------------------------------------------------------------ */

    function draftFromConfig(cfg) {
      const src = cfg && typeof cfg === 'object' ? cfg : {};
      const platforms = {};
      PLATFORMS.forEach((p) => {
        const s = (src.platforms && src.platforms[p.id]) || {};
        platforms[p.id] = {
          enabled: s.enabled === true,
          cookie: '',
          endpoint: typeof s.endpoint === 'string' ? s.endpoint : '',
          method: typeof s.method === 'string' && s.method ? s.method : 'GET',
          headersText: JSON.stringify(s.headers && typeof s.headers === 'object' ? s.headers : {}, null, 2),
          body: typeof s.body === 'string' ? s.body : '',
          phoneParam: typeof s.phoneParam === 'string' ? s.phoneParam : '',
          orderListPath: typeof s.orderListPath === 'string' ? s.orderListPath : '',
          carrierNameMapText: JSON.stringify(s.carrierNameMap && typeof s.carrierNameMap === 'object' ? s.carrierNameMap : {}, null, 2),
        };
      });
      const key = src.kuaidi100Key
        || (src.kuaidi100 && typeof src.kuaidi100 === 'object' ? src.kuaidi100.key : '')
        || '';
      return {
        phone: typeof src.phone === 'string' ? src.phone : '',
        refreshMinutes: Number(src.refreshMinutes) > 0 ? Number(src.refreshMinutes) : 15,
        trackRefreshMinutes: Number(src.trackRefreshMinutes) > 0 ? Number(src.trackRefreshMinutes) : 10,
        showDelivered: src.showDelivered !== false,
        trackEnabled: src.trackEnabled !== false,
        kuaidi100Key: typeof key === 'string' ? key : '',
        platforms,
      };
    }

    function SettingsSection(props) {
      const t = props.t;
      const close = props.close;
      useLocaleTick();

      const [state, setState] = useState(null);
      const [draft, setDraft] = useState(null);
      const [advanced, setAdvanced] = useState({});
      const [status, setStatus] = useState(null);
      const [saving, setSaving] = useState(false);
      const [tests, setTests] = useState({});
      const [jsonError, setJsonError] = useState('');
      const [curlOpen, setCurlOpen] = useState({});
      const [curlText, setCurlText] = useState({});
      const [busyDelete, setBusyDelete] = useState('');

      const stateRef = useRef(null);
      stateRef.current = state;

      const loadState = useCallback(async (keepDraft) => {
        try {
          const data = await request('/state');
          if (data.ok) {
            setState(data);
            // A test-connection run must not wipe what the user is typing.
            if (!keepDraft) setDraft(draftFromConfig(data.config));
          }
        } catch (e) {
          setStatus({ kind: 'err', text: (e && e.message) ? e.message : String(e) });
        }
      }, []);

      useEffect(() => {
        loadState();
      }, [loadState]);

      const config = state && state.config ? state.config : null;

      const manualOrders = useMemo(() => {
        if (config && Array.isArray(config.manualOrders) && config.manualOrders.length) return config.manualOrders;
        const list = state && Array.isArray(state.orders) ? state.orders : [];
        return list.filter((o) => o && o.platform === 'manual');
      }, [config, state]);

      const setPlatformField = useCallback((id, key, value) => {
        setDraft((d) => {
          if (!d) return d;
          const next = Object.assign({}, d);
          next.platforms = Object.assign({}, d.platforms);
          next.platforms[id] = Object.assign({}, d.platforms[id], { [key]: value });
          return next;
        });
      }, []);

      const onTest = useCallback(async (id) => {
        setTests((prev) => Object.assign({}, prev, { [id]: { busy: true } }));
        const data = await postJson('/refresh', { platforms: [id] });
        if (!data.ok) {
          setTests((prev) => Object.assign({}, prev, { [id]: { kind: 'err', text: data.error || '' } }));
          return;
        }
        const errs = Array.isArray(data.errors) ? data.errors : [];
        const hit = errs.find((e) => e && e.platform === id);
        if (hit) {
          setTests((prev) => Object.assign({}, prev, { [id]: { kind: 'err', text: errorMessage(hit) } }));
        } else {
          setTests((prev) => Object.assign({}, prev, { [id]: { kind: 'ok', text: t('testOk') } }));
        }
        await loadState(true);
      }, [loadState, t]);

      const onImportCurl = useCallback((id) => {
        const raw = String(curlText[id] || '');
        const parsed = parseCurl(raw);
        if (!parsed) {
          setStatus({ kind: 'err', text: t('curlImportFailed') });
          return;
        }
        setDraft((d) => {
          if (!d) return d;
          const cur = d.platforms[id] || {};
          const headers = Object.assign({}, parsed.headers);
          const next = Object.assign({}, d);
          next.platforms = Object.assign({}, d.platforms);
          next.platforms[id] = Object.assign({}, cur, {
            enabled: true,
            cookie: parsed.cookie || cur.cookie || '',
            endpoint: parsed.url,
            method: parsed.method,
            headersText: JSON.stringify(headers, null, 2),
            body: parsed.body || '',
          });
          return next;
        });
        setAdvanced((prev) => Object.assign({}, prev, { [id]: true }));
        setCurlText((prev) => Object.assign({}, prev, { [id]: '' }));
        setCurlOpen((prev) => Object.assign({}, prev, { [id]: false }));
        setStatus({
          kind: 'ok',
          text: t('curlImported', {
            cookie: parsed.cookie ? parsed.cookie.length : 0,
            headers: Object.keys(parsed.headers).length,
          }),
        });
      }, [curlText, t]);

      const onSave = useCallback(async () => {
        if (!draft) return;
        const headers = {};
        const maps = {};
        let broken = false;
        PLATFORMS.forEach((p) => {
          const d = draft.platforms[p.id];
          try {
            const parsed = JSON.parse(d.headersText && d.headersText.trim() ? d.headersText : '{}');
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
            headers[p.id] = parsed;
          } catch (e) {
            broken = true;
          }
          try {
            const parsed = JSON.parse(d.carrierNameMapText && d.carrierNameMapText.trim() ? d.carrierNameMapText : '{}');
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
            maps[p.id] = parsed;
          } catch (e) {
            broken = true;
          }
        });
        if (broken) {
          setJsonError(t('invalidJson'));
          return;
        }
        setJsonError('');

        const cfg = stateRef.current ? stateRef.current.config : null;
        const payload = payloadFromConfig(cfg);
        payload.phone = draft.phone.trim();
        payload.refreshMinutes = Math.max(1, Math.floor(Number(draft.refreshMinutes) || 15));
        payload.trackRefreshMinutes = Math.max(1, Math.floor(Number(draft.trackRefreshMinutes) || 10));
        payload.showDelivered = draft.showDelivered === true;
        payload.trackEnabled = draft.trackEnabled === true;
        PLATFORMS.forEach((p) => {
          const d = draft.platforms[p.id];
          const target = payload.platforms[p.id];
          target.enabled = d.enabled === true;
          target.endpoint = d.endpoint.trim();
          target.method = d.method || 'GET';
          target.headers = headers[p.id];
          target.body = d.body;
          target.phoneParam = d.phoneParam.trim();
          target.orderListPath = d.orderListPath.trim();
          target.carrierNameMap = maps[p.id];
          const cookie = typeof d.cookie === 'string' ? d.cookie.trim() : '';
          // Only a freshly typed cookie is sent; an empty field keeps the stored one.
          if (cookie) target.cookie = cookie;
        });
        if (draft.kuaidi100Key && draft.kuaidi100Key.trim()) payload.kuaidi100Key = draft.kuaidi100Key.trim();

        setSaving(true);
        setStatus(null);
        try {
          const data = await postJson('/config', payload);
          if (!data.ok) {
            setStatus({ kind: 'err', text: t('saveFailed', { message: data.error || '' }) });
            return;
          }
          setStatus({ kind: 'ok', text: t('savedRefreshing') });
          await loadState();
          // 保存后立刻在后台抓一次，省得用户还要自己回面板点刷新
          postJson('/refresh', {})
            .catch(() => null)
            .then(() => {
              setStatus({ kind: 'ok', text: t('saved') });
              return loadState(true);
            });
        } finally {
          setSaving(false);
        }
      }, [draft, loadState, t]);

      const onDeleteManual = useCallback(async (id) => {
        setBusyDelete(id);
        const data = await postJson('/manual-order/delete', { id });
        if (!data.ok) setStatus({ kind: 'err', text: t('manualDeleteFailed', { message: data.error || '' }) });
        await loadState();
        setBusyDelete('');
      }, [loadState, t]);

      if (!draft) {
        return h('div', { className: 'pt-root' },
          h(Styles, null),
          h('div', { className: 'pt-empty' }, t('emptyLoading')));
      }

      const platformAdvancedOpen = (id) => advanced[id] === true;

      // 保存按钮在页面最底部，设置页很长时容易看不到；顶部再放一条同样的操作行。
      const actionsRow = (extraClass) => h('div', { className: 'pt-row' + (extraClass ? ' ' + extraClass : '') },
        h('button', {
          type: 'button',
          className: 'pt-btn pt-btn-primary',
          disabled: saving,
          onClick: onSave,
        }, saving ? t('saving') : t('save')),
        close
          ? h('button', { type: 'button', className: 'pt-btn', onClick: () => close() }, t('close'))
          : null);

      return h('div', { className: 'pt-root' },
        h(Styles, null),
        actionsRow('pt-row-top'),

        h('div', { className: 'pt-section' },
          h('div', { className: 'pt-field' },
            h('label', { className: 'pt-label' }, t('phoneLabel')),
            h('input', {
              className: 'pt-input',
              value: draft.phone,
              onChange: (e) => setDraft((d) => Object.assign({}, d, { phone: e.target.value })),
              onKeyDown: (e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onSave();
                }
              },
            }),
            h('p', { className: 'pt-note' }, t('phoneHint'))),

          h('div', { className: 'pt-grid' },
            h('div', { className: 'pt-field' },
              h('label', { className: 'pt-label' }, t('refreshMinutesLabel')),
              h('input', {
                className: 'pt-input',
                type: 'number',
                min: 1,
                max: 1440,
                value: String(draft.refreshMinutes),
                onChange: (e) => setDraft((d) => Object.assign({}, d, { refreshMinutes: e.target.value })),
              })),
            h('div', { className: 'pt-field' },
              h('label', { className: 'pt-label' }, t('trackRefreshMinutesLabel')),
              h('input', {
                className: 'pt-input',
                type: 'number',
                min: 1,
                max: 1440,
                value: String(draft.trackRefreshMinutes),
                onChange: (e) => setDraft((d) => Object.assign({}, d, { trackRefreshMinutes: e.target.value })),
              }))),
          h('label', { className: 'pt-check' },
            h('input', {
              type: 'checkbox',
              checked: draft.trackEnabled,
              onChange: (e) => setDraft((d) => Object.assign({}, d, { trackEnabled: e.target.checked })),
            }),
            h('span', null, t('trackEnabledLabel'))),
          h('label', { className: 'pt-check' },
            h('input', {
              type: 'checkbox',
              checked: draft.showDelivered,
              onChange: (e) => setDraft((d) => Object.assign({}, d, { showDelivered: e.target.checked })),
            }),
            h('span', null, t('showDeliveredLabel'))),
          h('div', { className: 'pt-field' },
            h('label', { className: 'pt-label' }, t('kuaidi100KeyLabel')),
            h('input', {
              className: 'pt-input',
              type: 'password',
              value: draft.kuaidi100Key,
              placeholder: t('cookiePlaceholder'),
              onChange: (e) => setDraft((d) => Object.assign({}, d, { kuaidi100Key: e.target.value })),
            }),
            h('p', { className: 'pt-note' }, t('kuaidi100KeyHint')))),

        PLATFORMS.map((p) => {
          const d = draft.platforms[p.id];
          const mask = config && config.platforms ? config.platforms[p.id] : null;
          const cookie = cookieState(mask);
          const test = tests[p.id] || {};
          return h('div', { key: p.id, className: 'pt-section' },
            h('div', { className: 'pt-section-head' },
              h('label', { className: 'pt-check' },
                h('input', {
                  type: 'checkbox',
                  checked: d.enabled,
                  onChange: (e) => setPlatformField(p.id, 'enabled', e.target.checked),
                }),
                h('span', { className: 'pt-dot', style: { background: p.color } }),
                h('span', null, t(p.labelKey))),
              h('button', {
                type: 'button',
                className: 'pt-btn pt-btn-small',
                disabled: test.busy === true,
                onClick: () => onTest(p.id),
              }, test.busy ? t('testing') : t('testConnection'))),
            h('div', { className: 'pt-field' },
              h('label', { className: 'pt-label' }, t('cookieLabel')),
              h('input', {
                className: 'pt-input',
                type: 'password',
                value: d.cookie,
                placeholder: t('cookiePlaceholder'),
                onChange: (e) => setPlatformField(p.id, 'cookie', e.target.value),
              }),
              h('p', { className: 'pt-note' },
                d.cookie
                  ? t('cookiePending', { length: d.cookie.length })
                  : cookie.set
                    ? t('cookieConfigured', { length: cookie.length })
                    : t('cookieNotConfigured')),
              h('p', { className: 'pt-note' }, t('cookieHint'))),
            test.kind === 'ok'
              ? h('p', { className: 'pt-ok' }, t('testOk'))
              : test.kind === 'err'
                ? h('p', { className: 'pt-err' }, t('testFailed', { message: test.text || '' }))
                : null,
            h('div', { className: 'pt-disclosure' },
              h('button', {
                type: 'button',
                className: 'pt-disclosure-toggle',
                onClick: () => setCurlOpen((prev) => Object.assign({}, prev, { [p.id]: !(prev[p.id] === true) })),
              }, (curlOpen[p.id] === true ? '▾ ' : '▸ ') + t('curlImportTitle')),
              curlOpen[p.id] === true
                ? h('div', { className: 'pt-field', style: { marginTop: '8px' } },
                    h('p', { className: 'pt-note' }, t('curlImportHint')),
                    h('textarea', {
                      className: 'pt-input',
                      rows: 4,
                      value: curlText[p.id] || '',
                      placeholder: t('curlImportPlaceholder'),
                      onChange: (e) => setCurlText((prev) => Object.assign({}, prev, { [p.id]: e.target.value })),
                    }),
                    h('button', {
                      type: 'button',
                      className: 'pt-btn pt-btn-small',
                      onClick: () => onImportCurl(p.id),
                    }, t('curlImportButton')))
                : null),
            h('div', { className: 'pt-disclosure' },
              h('button', {
                type: 'button',
                className: 'pt-disclosure-toggle',
                onClick: () => setAdvanced((prev) => Object.assign({}, prev, { [p.id]: !platformAdvancedOpen(p.id) })),
              }, (platformAdvancedOpen(p.id) ? '▾ ' : '▸ ') + t('advanced')),
              platformAdvancedOpen(p.id)
                ? h('div', { className: 'pt-grid', style: { marginTop: '8px' } },
                    h('div', { className: 'pt-field' },
                      h('label', { className: 'pt-label' }, t('endpointLabel')),
                      h('input', {
                        className: 'pt-input',
                        value: d.endpoint,
                        placeholder: t('endpointPlaceholder'),
                        onChange: (e) => setPlatformField(p.id, 'endpoint', e.target.value),
                      })),
                    h('div', { className: 'pt-field' },
                      h('label', { className: 'pt-label' }, t('methodLabel')),
                      h('select', {
                        className: 'pt-input',
                        value: d.method,
                        onChange: (e) => setPlatformField(p.id, 'method', e.target.value),
                      },
                        h('option', { value: 'GET' }, 'GET'),
                        h('option', { value: 'POST' }, 'POST'))),
                    h('div', { className: 'pt-field' },
                      h('label', { className: 'pt-label' }, t('headersLabel')),
                      h('textarea', {
                        className: 'pt-input',
                        rows: 4,
                        value: d.headersText,
                        placeholder: t('headersPlaceholder'),
                        onChange: (e) => setPlatformField(p.id, 'headersText', e.target.value),
                      })),
                    h('div', { className: 'pt-field' },
                      h('label', { className: 'pt-label' }, t('bodyLabel')),
                      h('textarea', {
                        className: 'pt-input',
                        rows: 3,
                        value: d.body,
                        onChange: (e) => setPlatformField(p.id, 'body', e.target.value),
                      })),
                    h('div', { className: 'pt-field' },
                      h('label', { className: 'pt-label' }, t('orderListPathLabel')),
                      h('input', {
                        className: 'pt-input',
                        value: d.orderListPath,
                        placeholder: t('orderListPathPlaceholder'),
                        onChange: (e) => setPlatformField(p.id, 'orderListPath', e.target.value),
                      })),
                    h('div', { className: 'pt-field' },
                      h('label', { className: 'pt-label' }, t('phoneParamLabel')),
                      h('input', {
                        className: 'pt-input',
                        value: d.phoneParam,
                        placeholder: t('phoneParamPlaceholder'),
                        onChange: (e) => setPlatformField(p.id, 'phoneParam', e.target.value),
                      })),
                    h('div', { className: 'pt-field' },
                      h('label', { className: 'pt-label' }, t('carrierNameMapLabel')),
                      h('input', {
                        className: 'pt-input',
                        value: d.carrierNameMapText,
                        placeholder: t('carrierNameMapPlaceholder'),
                        onChange: (e) => setPlatformField(p.id, 'carrierNameMapText', e.target.value),
                      })))
                : null));
        }),

        h('div', { className: 'pt-section' },
          h('div', { className: 'pt-label' }, t('manualListTitle')),
          manualOrders.length
            ? h('div', { className: 'pt-manual-list' }, manualOrders.map((o) => h('div', {
                key: o && o.id ? o.id : String(o && o.trackingNo),
                className: 'pt-manual-item',
              },
                h('span', { className: 'pt-mono' }, (o && o.trackingNo) || ''),
                h('button', {
                  type: 'button',
                  className: 'pt-btn pt-btn-small pt-btn-danger',
                  disabled: busyDelete === (o && o.id),
                  onClick: () => onDeleteManual(o && o.id),
                }, t('manualDelete')))))
            : h('p', { className: 'pt-note' }, t('manualListEmpty'))),

        jsonError ? h('div', { className: 'pt-err' }, jsonError) : null,
        status
          ? h('div', { className: status.kind === 'err' ? 'pt-err' : 'pt-ok' }, status.text)
          : null,

        actionsRow(''));
    }

    /* ------------------------------------------------------------------ *
     * Plugin entry                                                           *
     * ------------------------------------------------------------------ */

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'parcel-tracker: dictionaries');
        const t = ctx.locale.bind(NS);

        // Re-render the components when the host language changes.
        ctx.effect(() => {
          const notify = () => {
            localeListeners.forEach((cb) => {
              try { cb(); } catch (e) { /* a broken subscriber must not break the rest */ }
            });
          };
          const off = typeof ctx.on === 'function' ? ctx.on('locale/change', notify) : null;
          const sub = ctx.locale && typeof ctx.locale.subscribe === 'function'
            ? ctx.locale.subscribe(notify)
            : null;
          return () => {
            if (typeof off === 'function') off();
            if (typeof sub === 'function') sub();
          };
        }, 'parcel-tracker: locale change');

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'parcel-tracker',
          order: 100,
          label: () => t('panelTitle'),
          locale: NS,
        }, PanelIcon));

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'parcel-tracker',
          locale: NS,
        }, (ownerProps) => h(MainPanel, { t })));

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'parcel-tracker',
          order: 40,
          label: () => t('settingsTitle'),
          locale: NS,
        }, (ownerProps) => h(SettingsSection, {
          t,
          close: ownerProps && typeof ownerProps.close === 'function' ? ownerProps.close : undefined,
        })));
      },
    };
  },
});
