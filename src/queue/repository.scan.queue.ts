import { Queue } from 'bullmq';

export class connectionType {
  host: string;
  port: number;
}

export const repositoryScanQueue = new Queue('repository-scan', {
  connection: {
    host: 'localhost', // Change if using a different host
    port: parseInt(process.env.REDIS_PORT),
  },
});
