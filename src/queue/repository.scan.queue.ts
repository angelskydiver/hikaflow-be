import { Queue } from 'bullmq';

export const repositoryScanQueue = new Queue('repository-scan', {
  connection: {
    host: 'localhost', // Change if using a different host
    port: 6380,
  },
});
