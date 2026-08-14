const fs = require('fs');
const readline = require('readline');

async function main() {
  const fileStream = fs.createReadStream('/Users/romeovalentine/.gemini/antigravity-ide/brain/973d64ce-aa43-4cae-a7a6-4fcfaa7d3e4c/.system_generated/logs/transcript_full.jsonl');
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  // Map to store current state of files that we touch
  let files = {};

  const prefix = '/Volumes/ROMEO HQ/SAM/';

  for await (const line of rl) {
    if (!line) continue;
    try {
      const step = JSON.parse(line);
      if (step.tool_calls) {
        for (const call of step.tool_calls) {
          if (!call.args || !call.args.TargetFile || !call.args.TargetFile.startsWith(prefix)) continue;
          
          const target = call.args.TargetFile;

          // If we haven't seen this file yet, load its base state from the newly cloned repo
          if (files[target] === undefined) {
             if (fs.existsSync(target)) {
                 files[target] = fs.readFileSync(target, 'utf8');
             } else {
                 files[target] = ""; // New file created during chat
             }
          }

          if (call.name === 'write_to_file' || call.name === 'default_api:write_to_file') {
             if (call.args.CodeContent !== undefined) {
                 files[target] = call.args.CodeContent;
             }
          } 
          else if (call.name === 'replace_file_content' || call.name === 'default_api:replace_file_content') {
             const before = call.args.TargetContent;
             const after = call.args.ReplacementContent;
             if (before !== undefined && after !== undefined) {
                 files[target] = files[target].replace(before, after);
             }
          }
          else if (call.name === 'multi_replace_file_content' || call.name === 'default_api:multi_replace_file_content') {
             if (call.args.ReplacementChunks) {
                 for (const chunk of call.args.ReplacementChunks) {
                     if (chunk.TargetContent !== undefined && chunk.ReplacementContent !== undefined) {
                         files[target] = files[target].replace(chunk.TargetContent, chunk.ReplacementContent);
                     }
                 }
             }
          }
        }
      }
    } catch (e) {
      // ignore JSON parse errors
    }
  }

  // Write all touched files back to the repo
  let count = 0;
  for (const [target, content] of Object.entries(files)) {
     if (!target.startsWith(prefix)) continue;
     const dir = target.substring(0, target.lastIndexOf('/'));
     if (dir) fs.mkdirSync(dir, {recursive: true});
     fs.writeFileSync(target, content);
     count++;
     console.log(`Restored: ${target.replace(prefix, '')}`);
  }
  console.log(`\nSuccessfully reconstructed ${count} files from memory.`);
}
main().catch(console.error);
