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
      lineScanner && lineScanner(buffer);
    });
  };

  scanOutput(proc.stdout, stdoutLineScanner);
  scanOutput(proc.stderr, stderrLineScanner);

  return new Promise((resolve, reject) => {
    proc.stdout.on('close', () => resolve());
  });
}

async function runFFmpeg(inputFile, params, stderrLineScanner) {
  const pwd = await run('pwd');
  const ffmpeg = `docker run --volume=${pwd}:/pwd --rm jrottenberg/ffmpeg`;
  await run2(`${ffmpeg} -i /pwd/${inputFile} ${params}`, null, stderrLineScanner);
}

async function detectSilenceAndStill(inputFile) {
  const params = `\
    -filter:v "select='gt(scene,0.1)',showinfo" \
    -af silencedetect=noise=-50dB:d=2 \
    -f null \
    -
  `;
  const slienceStartRegex = /\[silencedetect @ 0x[0-9a-f]+\] silence_start: (\d(.\d+)?).+/;
  const slienceEndRegex = /\[silencedetect @ 0x[0-9a-f]+\] silence_end: (\d(.\d+)?).+/;
  const sceneChangeRegex = /\[Parsed_showinfo_1 @ 0x[0-9a-f]+\] n:   \d+ pts:  \d+ pts_time:(\d(.\d+)?).+/;
  const lineScanner = line => {
    const ss = slienceEndRegex.exec(line);
    if (ss) console.log('===========> silenceStart:', ss[1]);
  }
  await runFFmpeg(inputFile, params, lineScanner);
}

const args = process.argv.slice(2);

detectSilenceAndStill(args[0])
  .then(r => console.log('result=', r))

// run2('pwd')
//   .then(r => console.log('pwd', r))