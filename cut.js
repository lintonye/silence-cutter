#!/usr/bin/env node
const stream = require("stream");

const util = require("util");
const exec = util.promisify(require("child_process").exec);

async function run(commandLine) {
  console.log(" => " + commandLine);
  const { stdout, stderror } = await exec(commandLine);
  if (stdout) console.log(stdout);
  if (stderror) console.error(stderror);
  if (stderror) throw "Stopped because error occurred";
  return stdout && stdout.trim();
}

function run2(commandLine, stdoutLineScanner, stderrLineScanner) {
  console.log(" => " + commandLine);
  const proc = require("child_process").exec(commandLine);
  proc.stdout.pipe(process.stdout);
  proc.stderr.pipe(process.stderr);

  const scanOutput = (stream, lineScanner) => {
    let buffer = "";
    stream.on("data", chunk => {
      buffer += chunk.toString("utf8");
      let lines = buffer.split(/\r|\n/);
      const leftover = lines[lines.length - 1];
      lines = lines.splice(0, lines.length - 1);
      buffer = leftover;
      const filter = l => l && l.length > 0;
      lines.filter(filter).forEach(l => lineScanner && lineScanner(l));
    });
    stream.on("close", () => {
      lineScanner && buffer && lineScanner(buffer);
    });
  };

  stdoutLineScanner && scanOutput(proc.stdout, stdoutLineScanner);
  stderrLineScanner && scanOutput(proc.stderr, stderrLineScanner);

  return new Promise((resolve, reject) => {
    proc.stdout.on("close", () => resolve());
  });
}

async function runFFmpeg(inputFile, params, stderrLineScanner) {
  const pwd = await run("pwd");
  const ffmpeg = `docker run --volume=${pwd}:/pwd --rm jrottenberg/ffmpeg`;
  let frontParams = "",
    rearParams = params;
  if (params.front) {
    frontParams = params.front;
    rearParams = params.rear;
  }
  await run2(
    `${ffmpeg} ${frontParams} -i "/pwd/${inputFile}" ${rearParams}`,
    null,
    stderrLineScanner
  );
}

async function detectSilenceAndStill(inputFile) {
  // disable scene detection for now
  // -filter:v "select='gt(scene,0.1)',showinfo" \
  const params = `\
    -af silencedetect=noise=-40dB:d=3 \
    -f null \
    -
  `;
  const decimal = "\\d+(.\\d+)?";
  const hex = "0x[0-9a-f]+";
  const silenceStartRegex = new RegExp(
    `\\[silencedetect @ ${hex}\\] silence_start: (${decimal}).+`
  );
  const silenceEndRegex = new RegExp(
    `\\[silencedetect @ ${hex}\\] silence_end: (${decimal}).+`
  );
  const sceneChangeRegex = new RegExp(
    `\\[Parsed_showinfo_1 @ ${hex}\\] n:\\s*\\d+ pts:\\s*\\d+\\s+pts_time:(${decimal}).+`
  );
  let silenceRanges = [];
  let start = null,
    end = null;
  const lineScanner = line => {
    const ss = silenceStartRegex.exec(line);
    if (ss) start = Number.parseFloat(ss[1]);
    const se = silenceEndRegex.exec(line);
    if (se) end = Number.parseFloat(se[1]);
    // const sc = sceneChangeRegex.exec(line);
    // if (sc && start !== null) {
    //   // If there's a scene change, discard this range
    //   console.log(
    //     `===> Discarded silence range starting at ${start} due to scene change.`
    //   );
    //   start = null;
    // }
    if (start !== null && end !== null) {
      if (start < 1) {
        start = 0;
      }
      silenceRanges.push([start, end]);
      console.log("=> pushing silence range: ", [start, end]);

      start = null;
      end = null;
    }
  };
  await runFFmpeg(inputFile, params, lineScanner);
  if (start !== null) silenceRanges.push([start, null]);
  return silenceRanges;
}

async function cutSilence(inputFile, outputFile) {
  console.log(`=> inputFile: ${inputFile}, outputFile: ${outputFile}`);

  const silenceRanges = await detectSilenceAndStill(inputFile);
  const tempFileDir = ".silence-cutter";
  await run2(`mkdir -p ${tempFileDir}`);

  const sliceTempFile = idx => `${tempFileDir}/slice-tmp${idx}.mov`;
  const joinlist = `${tempFileDir}/joinlist.txt`;
  console.log("=== Cleaning up... ===");
  await run2(`rm -f ${tempFileDir}/*.*`);

  console.log("=== Splitting video by silence parts... ===", silenceRanges);
  let sliceCount = 0;
  const slice = async (start, end) => {
    const endPos = end ? `-t ${end - start}` : "";
    const sliceTemp = sliceTempFile(sliceCount++);
    // https://trac.ffmpeg.org/wiki/Seeking#Cuttingsmallsections
    await runFFmpeg(inputFile, {
      front: `-ss ${start} ${endPos}`,
      rear: `-y -c copy -avoid_negative_ts 1 /pwd/${sliceTemp}`
    });
    await run2(`echo "file '/pwd/${sliceTemp}'" >> ${joinlist}`);
  };
  const padding = 0.1;
  for (let i = 0; i < silenceRanges.length; i++) {
    if (i === 0 && silenceRanges[i][0] === 0) continue;
    const start = i === 0 ? 0 : silenceRanges[i - 1][1] - padding;
    const end = silenceRanges[i][0] + padding;
    await slice(start, end);
  }
  const lastSilenceEnd = silenceRanges[silenceRanges.length - 1][1];
  lastSilenceEnd && (await slice(lastSilenceEnd));
  console.log("=== Joining videos... ===");
  // const concatFile = `${tempFileDir}/concatenated.mov`;
  await runFFmpeg(joinlist, {
    front: "-y -f concat -safe 0",
    rear: `-c copy "/pwd/${outputFile}"`
  });
  // await runFFmpeg(concatFile, `-y -f mp4 -c:a copy "/pwd/${outputFile}"`);
}

async function cutAll(inputFiles) {
  for (let inputFile of inputFiles) {
    const fn = inputFile.substr(0, inputFile.lastIndexOf("."));
    const outputFile = fn + "-silence-cut.mov";
    console.log(`Input: ${inputFile}, Output: ${outputFile}`);
    await cutSilence(inputFile, outputFile);
  }
}

const args = process.argv.slice(2);
const then = new Date();
cutAll(args).then(() => {
  console.log(
    `done. ${args.length} files. took ${(new Date() - then) / 1000}s.`
  );
});

// detectSilenceAndStill(args[0])
//   .then(r => console.log('result=', r))

// run2('pwd')
//   .then(r => console.log('pwd', r))
