#!/usr/bin/env node
const stream = require('stream');

const util = require('util');
const exec = util.promisify(require('child_process').exec);

async function run(commandLine) {
  console.log(' => ' + commandLine);
  const { stdout, stderror } = await exec(commandLine);
  if (stdout) console.log(stdout);
  if (stderror) console.error(stderror);
  if (stderror) throw "Stopped because error occurred";
  return stdout && stdout.trim();
}

function run2(commandLine, stdoutLineScanner, stderrLineScanner) {
  const proc = require('child_process').exec(commandLine);
  proc.stdout.pipe(process.stdout);
  proc.stderr.pipe(process.stderr);

  const scanOutput = (stream, lineScanner) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let lines = buffer.split(/\r|\n/);
      const leftover = lines[lines.length - 1];
      lines = lines.splice(0, lines.length - 1);
      buffer = leftover;
      const filter = l => l && l.length > 0;
      lines.filter(filter).forEach(l => lineScanner && lineScanner(l));
    });
    stream.on('close', () => {
      lineScanner && buffer && lineScanner(buffer);
    });
  };

  stdoutLineScanner && scanOutput(proc.stdout, stdoutLineScanner);
  stderrLineScanner && scanOutput(proc.stderr, stderrLineScanner);

  return new Promise((resolve, reject) => {
    proc.stdout.on('close', () => resolve());
  });
}

async function runFFmpeg(inputFile, params, stderrLineScanner) {
  const pwd = await run('pwd');
  const ffmpeg = `docker run --volume=${pwd}:/pwd --rm jrottenberg/ffmpeg`;
  let frontParams = '', rearParams = params;
  if (params.front) {
    frontParams = params.front;
    rearParams = params.rear;
  }
  await run2(`${ffmpeg} ${frontParams} -i /pwd/${inputFile} ${rearParams}`, null, stderrLineScanner);
}

async function detectSilenceAndStill(inputFile) {
  const params = `\
    -filter:v "select='gt(scene,0.1)',showinfo" \
    -af silencedetect=noise=-40dB:d=3 \
    -f null \
    -
  `;
  const decimal = '\\d+(.\\d+)?';
  const hex = '0x[0-9a-f]+';
  const silenceStartRegex = new RegExp(`\\[silencedetect @ ${hex}\\] silence_start: (${decimal}).+`);
  const silenceEndRegex = new RegExp(`\\[silencedetect @ ${hex}\\] silence_end: (${decimal}).+`);;
  const sceneChangeRegex = new RegExp(`\\[Parsed_showinfo_1 @ ${hex}\\] n:\\s*\\d+ pts:\\s*\\d+\\s+pts_time:(${decimal}).+`);
  let silenceRanges = [];
  let start = null, end = null;
  const lineScanner = line => {
    const ss = silenceStartRegex.exec(line);
    if (ss) start = Number.parseFloat(ss[1]);
    const se = silenceEndRegex.exec(line);
    if (se) end = Number.parseFloat(se[1]);
    const sc = sceneChangeRegex.exec(line);
    if (sc && start !== null) {
      // If there's a scene change, discard this range
      console.log('===> Discard silence range starting at ' + start);
      start = null;
    }
    if (start !== null && end !== null) {
      silenceRanges.push([start, end]);
      start = null;
      end = null;
    }
  }
  await runFFmpeg(inputFile, params, lineScanner);
  return silenceRanges;
}

async function cutSilence(inputFile, outputFile) {
  const silenceRanges = await detectSilenceAndStill(inputFile);

  const sliceTempFile = idx => `slice-tmp${idx}.mov`;
  const joinlist = 'joinlist.txt';
  console.log('=== Cleaning up... ===');
  await run2('rm slice-tmp*.*');
  await run2(`rm ${joinlist}`);

  console.log('=== Splitting video by silence parts... ===', silenceRanges);
  let sliceCount = 0;
  const slice = async (start, end) => {
    const endPos = end ? `-to ${end}` : '';
    const sliceTemp = sliceTempFile(sliceCount++);
    await runFFmpeg(inputFile, `-y -ss ${start} ${endPos} -c copy /pwd/${sliceTemp}`);
    await run2(`echo "file '/pwd/${sliceTemp}'" >> ${joinlist}`)
  };
  for (let i = 0; i < silenceRanges.length; i++) {
    let start, end = silenceRanges[i][0];
    if (i === 0) start = 0;
    else start = silenceRanges[i - 1][1];
    await slice(start, end);
  }
  await slice(silenceRanges[silenceRanges.length - 1][1]);
  console.log('=== Joining videos... ===');
  await runFFmpeg(joinlist, { front: '-f concat -safe 0', rear: `-c copy /pwd/${outputFile}` });
}

const args = process.argv.slice(2);

cutSilence(args[0], args[1])
  .then(r => {
    console.log('done.');
    // console.log('Video written to ' + args[1])
  });

// detectSilenceAndStill(args[0])
//   .then(r => console.log('result=', r))

// run2('pwd')
//   .then(r => console.log('pwd', r))