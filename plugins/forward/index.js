// Forward Plugin - Agent任务转发工具

const { Type } = require('@sinclair/typebox');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

const LOG_PATH = process.env.OPENCLAW_LOG_PATH || path.join(process.env.HOME, '.openclaw', 'logs');
const LOG_FILE = path.join(LOG_PATH, 'forward-tool.log');

try {
  if (!fs.existsSync(LOG_PATH)) {
    fs.mkdirSync(LOG_PATH, { recursive: true });
  }
} catch (e) {}

const log = (entry) => {
  try {
    const logLine = JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n';
    fs.appendFileSync(LOG_FILE, logLine, 'utf8');
  } catch (e) {}
};

const generateTaskId = () => String(Date.now());

module.exports = {
  id: 'forward',
  name: 'Forward',
  description: 'Agent 任务转发工具',

  register(api) {
    api.logger.info('forward-tool: 开始注册...');

    api.registerTool((ctx) => {
      return {
        name: 'forward',
        label: "Forward",
        description: `转发任务给其他agent。示例：{"to":"yangxiao","content":"查询天气"}`,
        parameters: Type.Object({
          to: Type.String({ description: '目标agent ID' }),
          content: Type.String({ description: '任务内容' })
        }),

        async execute(_id, params) {
          const { to, content } = params;

          const sessionKey = ctx.sessionKey;
          const sessionKeys = sessionKey.split(":");

          let taskId = "";

          if (sessionKeys.length === 4 && sessionKeys[2] === "task") {
            // task session: 从 sessionKey 提取 taskId
            taskId = sessionKeys[3];
          } else if (sessionKeys.length === 4 && sessionKeys[2] === "cron") {
            // cron session: 生成新 taskId
            taskId = generateTaskId();
          } else {
            return {
              content: [{ type: "text", text: "❌ 当前会话不允许转发" }],
              isError: true
            };
          }

          const from = sessionKeys[1];
          const targetSessionKey = `agent:${to}:task:${taskId}`;
          const idempotencyKey = `forward-${taskId}-${Date.now()}`;

          const message = [
            '[协作任务]',
            `任务ID：${taskId}`,
            `来自：${from}`,
            '',
            content,
            '',
            '---'
          ].join('\n');

          const gatewayParams = {
            idempotencyKey,
            agentId: to,
            sessionKey: targetSessionKey,
            message
          };

          try {
            const paramsJson = JSON.stringify(gatewayParams);
            const out = fs.openSync(LOG_FILE, 'a');
            const err = fs.openSync(LOG_FILE, 'a');

            const child = spawn('openclaw', ['gateway', 'call', 'agent', '--params', paramsJson, '--json'], {
              detached: true,
              stdio: ['ignore', out, err]
            });
            child.unref();

            log({ event: 'forward', taskId, from, to, content: content.slice(0, 100) });

            return {
              content: [{
                type: 'text',
                text: `✓ 任务已转发给 ${to}\n任务ID：${taskId}\n来源：${from}`
              }]
            };
          } catch (e) {
            log({ event: 'forward_error', error: e.message });
            return {
              content: [{ type: 'text', text: `转发失败: ${e.message}` }],
              isError: true
            };
          }
        }
      };
    });

    api.logger.info('forward-tool: 注册完成');
  }
};
