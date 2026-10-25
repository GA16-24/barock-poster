#!/usr/bin/env bash
# Downloads model weights one repo at a time (shared uplink) into /mnt/data. Reruns resume or skip.
set -euo pipefail
export HF_HOME=/mnt/data/barock3d/hf
export HF_ENDPOINT=https://hf-mirror.com
export HF_HUB_ENABLE_HF_TRANSFER=0
PY=~/barock3d/env/bin/python
until $PY -c 'import huggingface_hub' 2>/dev/null; do sleep 30; done

get1() { $PY -c "
import sys; from huggingface_hub import snapshot_download
p = snapshot_download(sys.argv[1], allow_patterns=sys.argv[2:] or None, max_workers=2)
print('ok', sys.argv[1], p)" "$@"; }
get() { for i in 1 2 3 4 5 6; do get1 "$@" && return 0; echo "retry $i: $1"; sleep 90; done; return 1; }

get microsoft/TRELLIS.2-4B
get microsoft/TRELLIS-image-large 'ckpts/ss_dec_conv3d_16l8_fp16*' pipeline.json
get camenduru/dinov3-vitl16-pretrain-lvd1689m
get ZhengPeng7/BiRefNet
get ovedrive/Qwen-Image-Edit-2511-4bit
get lightx2v/Qwen-Image-Edit-2511-Lightning Qwen-Image-Edit-2511-Lightning-8steps-V1.0-bf16.safetensors
echo ALL_WEIGHTS_DONE
