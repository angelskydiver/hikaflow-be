export const fileChanges = (
  patch = '@@ -1 +1,3 @@\n-export const comments = {}\n\\ No newline at end of file\n+export const comments = {}\n+\n+// a new line',
) => {
  // const patch = ;

  // Split the patch into lines
  const lines = patch.split('\n');

  // Filter for added and removed lines
  const addedLines = lines
    .filter((line) => line.startsWith('+'))
    .map((line) => line.slice(1)); // Remove the '+' symbol
  const removedLines = lines
    .filter((line) => line.startsWith('-'))
    .map((line) => line.slice(1)); // Remove the '-' symbol

  // Remove any identical lines from both added and removed lines
  const uniqueAddedLines = addedLines.filter(
    (line) => !removedLines.includes(line),
  );
  const uniqueRemovedLines = removedLines.filter(
    (line) => !addedLines.includes(line),
  );

  console.log('Unique Added Lines:', uniqueAddedLines);
  console.log('Unique Removed Lines:', uniqueRemovedLines);
};

("@@ -4,7 +4,9 @@ dotenv.config()\n import express, { response } from 'express'\n import fetch from 'node-fetch'\n import { commentAction, queueConstants } from '../Common/index.js'\n-import amqp from 'amqplib'\n+\n+// import amqp from 'amqplib'\n+// changes here\n \n const app = express()\n \n@@ -32,9 +34,11 @@ const QueueConnection = async ()=>{\n     })\n }\n \n-QueueConnection()\n+// another line here\n \n+QueueConnection()\n+// add\n const port = process.env.PORT\n app.listen(port, ()=>{\n     console.log(`listening on ${port}`)\n-})\n\\ No newline at end of file\n+})");
