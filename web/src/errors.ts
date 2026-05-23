/**
 * Maps Server-side error reasons (string codes) to user-facing 中文 messages.
 * Falls back to the original message when no translation is available.
 */
const ERROR_MESSAGES: Record<string, string> = {
  // Auth
  invalid_credentials: "用户名或密码错误",
  invalid_invite_code: "邀请码无效",
  username_taken: "该用户名已被注册",
  unauthenticated: "请先登录",
  forbidden: "权限不足,需要管理员账号",

  // SendKey
  needs_handshake: "需要先添加机器人为好友",
  no_alive_bot: "当前没有任何在线机器人,请联系管理员",
  no_pending_handshake: "没有进行中的握手请求,可能已过期",
  send_key_disabled: "此 SendKey 已被禁用",
  send_key_not_found: "SendKey 不存在",
  invalid_send_key: "SendKey 无效",
  bot_not_alive: "绑定的机器人不在线",
  no_alive_friendly_bot: "当前没有可用的机器人能够发送消息到该 QQ",
  bot_pool_empty: "机器人池为空,请联系管理员",
  send_failed: "发送失败,请稍后重试",

  // Common
  missing_key: "缺少 SendKey",
  missing_content: "消息内容不能为空",
  content_too_long: "消息内容过长(最多 4000 字)",
  title_too_long: "标题过长(最多 100 字)",

  // Bot admin
  qq_taken: "该 QQ 号已被其他机器人占用",
  bot_not_found: "机器人不存在",

  // User admin
  user_not_found: "用户不存在",
  cannot_delete_self_or_admin: "不能删除自己或管理员账号",

  // Rate limit
  rate_limit_exceeded: "操作过于频繁,请稍后再试",
  rate_limit_exceeded_ip: "请求过于频繁,请稍后再试",
  rate_limit_exceeded_auth: "登录尝试过于频繁,请 15 分钟后再试",
};

const STATUS_HINTS: Record<number, string> = {
  400: "请求参数有误",
  401: "未授权",
  403: "权限不足",
  404: "未找到",
  409: "冲突",
  429: "请求过于频繁",
  500: "服务器异常",
  502: "上游异常",
  503: "服务暂不可用",
};

export function translateError(
  message: string | undefined,
  code?: number,
): string {
  if (!message) {
    if (code !== undefined && STATUS_HINTS[code]) return STATUS_HINTS[code]!;
    return "未知错误";
  }
  if (ERROR_MESSAGES[message]) return ERROR_MESSAGES[message]!;
  // Fastify schema validation messages typically start with "body must..." etc.
  if (/must have required property/.test(message)) return "缺少必填字段";
  if (/must NOT have fewer than/.test(message)) return "字段长度不足";
  if (/must NOT have more than/.test(message)) return "字段长度超限";
  if (/must match pattern/.test(message)) return "字段格式不正确";
  if (/must be integer/.test(message)) return "字段必须为整数";
  if (/must be string/.test(message)) return "字段类型错误";
  if (code !== undefined && STATUS_HINTS[code]) return STATUS_HINTS[code]!;
  return message;
}
