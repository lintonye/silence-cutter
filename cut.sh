#!/usr/bin/env bash

if [ $# -eq 0 ]
  then
    echo "Usage: cut.sh INPUT_FILENAME_IN_PWD [OUTPUT_FN_IN_PWD]"
    exit
fi


INPUT_FILENAME=$1
OUTPUT_FILENAME=$2

if [ -z "$2" ]
  then
    OUTPUT_FILENAME=out.mp4
fi

FFMPEG_STD_ARGS="-i /pwd/$INPUT_FILENAME"

# FFMPEG_ARGS="
#     $FFMPEG_STD_ARGS
#     -f mp4
#     /pwd/$OUTPUT_FILENAME
# "

### Silence detection
# FFMPEG_ARGS="
#     $FFMPEG_STD_ARGS
#     -af silencedetect=noise=-50dB:d=2 
#     -f null
#     -
# "

FFMPEG_ARGS="
    $FFMPEG_STD_ARGS
    -filter:v select='gt(scene,0.1)',showinfo
    -af silencedetect=noise=-50dB:d=2 
    -f null
    -
"

echo "
=========================================

  ffmpeg $FFMPEG_ARGS
=========================================
"

docker run \
  --volume=`pwd`:/pwd \
  --rm \
  jrottenberg/ffmpeg $FFMPEG_ARGS
