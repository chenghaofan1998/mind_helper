const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const windowsRuntime = path.join(projectRoot, "bin", "neutralino-win_x64.exe");

async function main() {
  if (validRuntime()) {
    console.log("Neutralino Windows runtime is ready.");
    return;
  }

  console.log("Neutralino Windows runtime is missing; downloading pinned binaries only...");
  const downloader = require("@neutralinojs/neu/src/modules/downloader");
  await downloader.downloadAndUpdateBinaries(false);
  if (!validRuntime()) throw new Error(`Neutralino runtime was not created: ${windowsRuntime}`);
  console.log("Neutralino Windows runtime is ready.");
}

function validRuntime() {
  try { return fs.statSync(windowsRuntime).size > 0; }
  catch { return false; }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
