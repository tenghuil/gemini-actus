import { Config } from '../config/config.js';
import { AgentRegistry } from '../agents/registry.js';
import { LocalAgentExecutor } from '../agents/local-executor.js';
import { CronService } from './service.js';
import type { LocalAgentDefinition } from '../agents/types.js';

import path from 'path';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const testStorePath = path.join(__dirname, 'test-cron-store.json');

async function main() {
  console.log('Starting Cron Demonstration...');
  const config = new Config({
    sessionId: 'test-session',
    targetDir: '.',
    debugMode: false,
    cwd: '.',
    model: 'gemini-1.5-pro',
  });
  const agentRegistry = new AgentRegistry(config);
  await agentRegistry.initialize();

  const cronService = new CronService(testStorePath, {
    onAgentTurn: async (message: string, timeoutSeconds?: number) => {
      console.log(`\n[CRON EVENT] Firing agent turn with message: "${message}"`);
      const coreDef = agentRegistry.getDefinition('core');
      
      if (!coreDef || coreDef.kind !== 'local') {
        throw new Error('Core agent not found or is not local.');
      }

      console.log('Initializing LocalAgentExecutor...');
      const executor = await LocalAgentExecutor.create(
        coreDef as LocalAgentDefinition,
        config,
        (activity) => {
          if (activity.type === 'THOUGHT_CHUNK' && activity.data['text']) {
            process.stdout.write(`💭 ${activity.data['text']}`);
          } else if (activity.type === 'TOOL_CALL_START') {
            process.stdout.write(`\n🛠️ Calling tool: ${activity.data['name']}\n`);
          } else if (activity.type === 'TOOL_CALL_END') {
            process.stdout.write(`✅ Tool ${activity.data['name']} finished.\n`);
          }
        }
      );

      console.log('Executing Agent Turn in isolation...');
      const controller = new AbortController();
      if (timeoutSeconds) {
        setTimeout(() => controller.abort(), timeoutSeconds * 1000);
      }

      const result = await executor.run({ initial_message: message }, controller.signal);
      console.log(`\n[CRON EVENT] Agent finished.`);
      console.log(`Termination reason: ${result.terminate_reason}`);
      console.log(`Result: ${result.result}\n`);
    }
  });

  await cronService.start();

  // Clean old jobs for the demo
  const oldJobs = await cronService.list({ includeDisabled: true });
  for (const job of oldJobs) {
    await cronService.remove(job.id);
  }

  console.log('Adding an agent turn cron job to run in 5 seconds...');
  await cronService.add({
    name: 'test-agent-turn',
    enabled: true,
    deleteAfterRun: true,
    schedule: { kind: 'at', at: new Date(Date.now() + 5000).toISOString() },
    payload: { kind: 'agentTurn', message: 'Say hello to me from the cron job!' }
  });

  // Also add a system event for testing
  await cronService.add({
    name: 'test-system-event',
    enabled: true,
    deleteAfterRun: true,
    schedule: { kind: 'at', at: new Date(Date.now() + 2000).toISOString() },
    payload: { kind: 'systemEvent', text: 'This system event fires quickly.' }
  });

  console.log('Cron Service running. Waiting for jobs to fire... Press Ctrl+C to exit.');
  
  // Keep alive
  setInterval(() => {}, 1000000);
}

main().catch(console.error);
